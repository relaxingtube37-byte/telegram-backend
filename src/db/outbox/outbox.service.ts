/**
 * src/db/outbox/outbox.service.ts
 *
 * Transactional SQLite Outbox Service for Phase 9 Dual-Write.
 * Guarantees zero loss of write intent across crashes and restarts.
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ensureOutboxSchema } from './outbox.schema';
import type { AppendOutboxInput, OutboxRecord, OutboxMetrics, DlqForensicEnvelope } from './outbox.types';
import { Logger } from '../../utils/logger';

const SOURCE_COMMIT = '8bb3e3e';
const SCRATCH_DIR = path.resolve(__dirname, '../../../scratch/postgres-phase-9-dual-write');
const DLQ_LOG_PATH = path.join(SCRATCH_DIR, 'dlq_records.jsonl');

export class OutboxService {
  private db: Database.Database;

  private cachedInsertStmt: Database.Statement | null = null;

  constructor(db: Database.Database) {
    this.db = db;
    ensureOutboxSchema(this.db);
    if (!fs.existsSync(SCRATCH_DIR)) {
      try { fs.mkdirSync(SCRATCH_DIR, { recursive: true }); } catch (e) {}
    }
  }

  private getInsertStmt(activeDb: Database.Database): Database.Statement {
    if (activeDb === this.db) {
      if (!this.cachedInsertStmt) {
        this.cachedInsertStmt = this.db.prepare(`
          INSERT INTO postgres_dual_write_outbox (
            event_id, aggregate_type, aggregate_id, operation, payload_json, payload_sha256,
            idempotency_key, status, attempt_count, available_at, created_at, updated_at
          ) VALUES (
            @event_id, @aggregate_type, @aggregate_id, @operation, @payload_json, @payload_sha256,
            @idempotency_key, 'PENDING', 0, @available_at, @created_at, @updated_at
          )
        `);
      }
      return this.cachedInsertStmt;
    }
    return activeDb.prepare(`
      INSERT INTO postgres_dual_write_outbox (
        event_id, aggregate_type, aggregate_id, operation, payload_json, payload_sha256,
        idempotency_key, status, attempt_count, available_at, created_at, updated_at
      ) VALUES (
        @event_id, @aggregate_type, @aggregate_id, @operation, @payload_json, @payload_sha256,
        @idempotency_key, 'PENDING', 0, @available_at, @created_at, @updated_at
      )
    `);
  }

  /**
   * Sanitizes payload by stripping credentials, tokens, or auth headers before serialization.
   */
  private sanitizePayload(payload: any): any {
    if (!payload || typeof payload !== 'object') return payload;
    const sanitized = Array.isArray(payload) ? [...payload] : { ...payload };
    const sensitiveKeys = ['password', 'secret', 'token', 'authorization', 'api_key', 'rapidapi_key'];
    for (const k of Object.keys(sanitized)) {
      if (sensitiveKeys.some(s => k.toLowerCase().includes(s))) {
        sanitized[k] = '[REDACTED]';
      } else if (typeof sanitized[k] === 'object' && sanitized[k] !== null) {
        sanitized[k] = this.sanitizePayload(sanitized[k]);
      }
    }
    return sanitized;
  }

  /**
   * Appends an outbox event.
   * MUST be executed within the same SQLite transaction as the primary business mutation.
   */
  appendTransactionalEvent(input: AppendOutboxInput, customDb?: Database.Database): OutboxRecord {
    const activeDb = customDb || this.db;
    const eventId = crypto.randomUUID();
    const cleanPayload = this.sanitizePayload(input.payload);
    const payloadJson = JSON.stringify(cleanPayload);
    const payloadSha256 = crypto.createHash('sha256').update(payloadJson).digest('hex');
    const now = new Date().toISOString();
    const availableAt = input.availableAt ? input.availableAt.toISOString() : now;

    const stmt = this.getInsertStmt(activeDb);
    stmt.run({
      event_id: eventId,
      aggregate_type: input.aggregateType,
      aggregate_id: input.aggregateId,
      operation: input.operation,
      payload_json: payloadJson,
      payload_sha256: payloadSha256,
      idempotency_key: input.idempotencyKey,
      available_at: availableAt,
      created_at: now,
      updated_at: now
    });

    return {
      event_id: eventId,
      aggregate_type: input.aggregateType,
      aggregate_id: input.aggregateId,
      operation: input.operation,
      payload_json: payloadJson,
      payload_sha256: payloadSha256,
      idempotency_key: input.idempotencyKey,
      status: 'PENDING',
      attempt_count: 0,
      available_at: availableAt,
      locked_at: null,
      delivered_at: null,
      last_error: null,
      created_at: now,
      updated_at: now
    };
  }

  /**
   * Claims a batch of PENDING events by locking them and transitioning to PROCESSING.
   */
  claimBatch(limit = 20, leaseSeconds = 30): OutboxRecord[] {
    const now = new Date().toISOString();
    const claimTx = this.db.transaction(() => {
      const selectStmt = this.db.prepare(`
        SELECT * FROM postgres_dual_write_outbox
        WHERE status = 'PENDING' AND available_at <= ?
        ORDER BY available_at ASC, rowid ASC
        LIMIT ?
      `);
      const rows = selectStmt.all(now, limit) as OutboxRecord[];
      if (rows.length === 0) return [];

      const updateStmt = this.db.prepare(`
        UPDATE postgres_dual_write_outbox
        SET status = 'PROCESSING', locked_at = ?, updated_at = ?
        WHERE event_id = ?
      `);

      for (const r of rows) {
        updateStmt.run(now, now, r.event_id);
        r.status = 'PROCESSING';
        r.locked_at = now;
      }
      return rows;
    });

    return claimTx();
  }

  /**
   * Marks an outbox event as successfully delivered to PostgreSQL.
   */
  markDelivered(eventId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE postgres_dual_write_outbox
      SET status = 'DELIVERED', delivered_at = ?, locked_at = NULL, updated_at = ?
      WHERE event_id = ?
    `).run(now, now, eventId);
  }

  /**
   * Records a failed delivery attempt with exponential backoff or DLQ promotion.
   */
  markFailed(eventId: string, error: Error | any, maxAttempts = 5, backoffBaseMs = 1000): void {
    const now = new Date();
    const nowIso = now.toISOString();
    const errorMsg = error?.message || String(error);
    const errorCode = error?.code || 'UNKNOWN_ERROR';

    const row = this.db.prepare(`
      SELECT * FROM postgres_dual_write_outbox WHERE event_id = ?
    `).get(eventId) as OutboxRecord | undefined;

    if (!row) return;

    const newAttempts = row.attempt_count + 1;

    if (newAttempts >= maxAttempts) {
      // Move to Dead-Letter Queue (DLQ)
      this.moveToDlq(row, newAttempts, errorCode, errorMsg);
    } else {
      // Exponential backoff
      const delayMs = Math.min(60000, backoffBaseMs * Math.pow(2, newAttempts - 1));
      const nextAvailable = new Date(now.getTime() + delayMs).toISOString();

      this.db.prepare(`
        UPDATE postgres_dual_write_outbox
        SET status = 'PENDING',
            attempt_count = ?,
            available_at = ?,
            locked_at = NULL,
            last_error = ?,
            updated_at = ?
        WHERE event_id = ?
      `).run(newAttempts, nextAvailable, errorMsg, nowIso, eventId);
    }
  }

  /**
   * Promotes an exhausted outbox record to the DLQ table and audit log.
   */
  private moveToDlq(row: OutboxRecord, finalAttempts: number, errorCode: string, errorMsg: string): void {
    const nowIso = new Date().toISOString();
    this.db.prepare(`
      UPDATE postgres_dual_write_outbox
      SET status = 'DLQ',
          attempt_count = ?,
          locked_at = NULL,
          last_error = ?,
          updated_at = ?
      WHERE event_id = ?
    `).run(finalAttempts, errorMsg, nowIso, row.event_id);

    // Append envelope to dlq_records.jsonl
    const envelope: DlqForensicEnvelope = {
      event_id: row.event_id,
      idempotency_key: row.idempotency_key,
      aggregate_type: row.aggregate_type,
      aggregate_id: row.aggregate_id,
      operation: row.operation,
      payload_json: row.payload_json,
      payload_sha256: row.payload_sha256,
      attempt_count: finalAttempts,
      first_failed_at: row.created_at,
      last_failed_at: nowIso,
      last_error_code: errorCode,
      last_error_message: errorMsg,
      source_commit: SOURCE_COMMIT
    };

    try {
      fs.appendFileSync(DLQ_LOG_PATH, JSON.stringify(envelope) + '\n', 'utf8');
    } catch (e: any) {
      Logger.error(`Failed to append to DLQ log file: ${e.message}`);
    }
  }

  /**
   * Reclaims abandoned PROCESSING rows whose lease has expired.
   */
  reclaimExpiredLeases(leaseSeconds = 30): number {
    const thresholdTime = new Date(Date.now() - leaseSeconds * 1000).toISOString();
    const now = new Date().toISOString();

    const result = this.db.prepare(`
      UPDATE postgres_dual_write_outbox
      SET status = 'PENDING', locked_at = NULL, updated_at = ?
      WHERE status = 'PROCESSING' AND locked_at <= ?
    `).run(now, thresholdTime);

    return result.changes;
  }

  /**
   * Replays an item from DLQ back to PENDING state (authenticated/controlled).
   */
  replayDlqItem(eventId: string): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE postgres_dual_write_outbox
      SET status = 'PENDING', available_at = ?, locked_at = NULL, attempt_count = 0, updated_at = ?
      WHERE event_id = ? AND status = 'DLQ'
    `).run(now, now, eventId);

    return result.changes > 0;
  }

  /**
   * Returns current count metrics for observability.
   */
  getMetrics(): OutboxMetrics {
    const rows = this.db.prepare(`
      SELECT status, COUNT(*) as count
      FROM postgres_dual_write_outbox
      GROUP BY status
    `).all() as { status: string; count: number }[];

    const metrics: OutboxMetrics = {
      total: 0,
      pending: 0,
      processing: 0,
      delivered: 0,
      failed: 0,
      dlq: 0
    };

    for (const r of rows) {
      metrics.total += r.count;
      if (r.status === 'PENDING') metrics.pending = r.count;
      else if (r.status === 'PROCESSING') metrics.processing = r.count;
      else if (r.status === 'DELIVERED') metrics.delivered = r.count;
      else if (r.status === 'FAILED') metrics.failed = r.count;
      else if (r.status === 'DLQ') metrics.dlq = r.count;
    }

    return metrics;
  }
}
