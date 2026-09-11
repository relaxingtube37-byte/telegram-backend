/**
 * src/db/outbox/dualWriteWorker.ts
 *
 * Asynchronous Staging Dual-Write Worker.
 * Reads pending outbox records from SQLite and performs idempotent upserts against staging PostgreSQL (Port 54350).
 *
 * Strict Production Safety Guards:
 *   - Only runs in staging (NODE_ENV !== 'production').
 *   - Fails closed if PostgreSQL target is not 127.0.0.1:54350.
 *   - Disarms instantly when feature flag is disabled.
 *   - Auto-tripping circuit breaker isolates PostgreSQL downtime.
 */

import { OutboxService } from './outbox.service';
import type { OutboxRecord } from './outbox.types';
import type { PostgresClientPool } from '../stagingPgPool';
import { getStagingPgPool } from '../stagingPgPool';
import { Logger } from '../../utils/logger';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface DualWriteWorkerConfig {
  batchSize?: number;
  leaseSeconds?: number;
  pollIntervalMs?: number;
  maxAttempts?: number;
  circuitFailureThreshold?: number;
  circuitCoolOffMs?: number;
}

export class StagingDualWriteWorker {
  private outboxService: OutboxService;
  private pgPool: PostgresClientPool | null;
  private isRunning = false;
  private isShuttingDown = false;
  private timer: NodeJS.Timeout | null = null;
  private activeWritesCount = 0;

  // Circuit Breaker State
  private circuitState: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private lastCircuitTripTime: number | null = null;

  // Config
  private batchSize: number;
  private leaseSeconds: number;
  private pollIntervalMs: number;
  private maxAttempts: number;
  private circuitThreshold: number;
  private circuitCoolOffMs: number;

  constructor(outboxService: OutboxService, pgPool: PostgresClientPool | null = null, config?: DualWriteWorkerConfig) {
    this.outboxService = outboxService;
    this.pgPool = pgPool;
    this.batchSize = config?.batchSize || 20;
    this.leaseSeconds = config?.leaseSeconds || 30;
    this.pollIntervalMs = config?.pollIntervalMs || 500;
    this.maxAttempts = config?.maxAttempts || 5;
    this.circuitThreshold = config?.circuitFailureThreshold || 5;
    this.circuitCoolOffMs = config?.circuitCoolOffMs || 10000;

    this.assertNotProductionTarget();
  }

  /**
   * Fail-closed security guard: strictly prohibits running against non-staging environments.
   */
  private assertNotProductionTarget(): void {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('PRODUCTION_TARGET_PROHIBITED: Dual-write worker is strictly forbidden in production.');
    }
    const targetHost = process.env.STAGING_PG_HOST || '127.0.0.1';
    const targetPort = Number(process.env.STAGING_PG_PORT) || 54350;
    if (targetHost !== '127.0.0.1' && targetHost !== 'localhost') {
      throw new Error(`PRODUCTION_TARGET_PROHIBITED: Staging worker cannot target remote host: ${targetHost}`);
    }
    if (targetPort !== 54350) {
      throw new Error(`PRODUCTION_TARGET_PROHIBITED: Staging worker cannot target non-staging port: ${targetPort}`);
    }
  }

  private getPool(): PostgresClientPool {
    if (!this.pgPool) {
      this.pgPool = getStagingPgPool();
    }
    return this.pgPool;
  }

  /**
   * Checks circuit breaker status.
   */
  getCircuitStatus(): { state: CircuitState; consecutiveFailures: number } {
    if (this.circuitState === 'OPEN' && this.lastCircuitTripTime) {
      if (Date.now() - this.lastCircuitTripTime > this.circuitCoolOffMs) {
        this.circuitState = 'HALF_OPEN';
      }
    }
    return { state: this.circuitState, consecutiveFailures: this.consecutiveFailures };
  }

  /**
   * Starts the background worker loop.
   */
  start(): void {
    if (this.isRunning) return;
    this.assertNotProductionTarget();
    this.isRunning = true;
    this.isShuttingDown = false;

    // Reclaim expired leases from previous crashes on startup
    const reclaimed = this.outboxService.reclaimExpiredLeases(this.leaseSeconds);
    if (reclaimed > 0) {
      Logger.info(`[DualWriteWorker] Reclaimed ${reclaimed} expired processing leases on startup.`);
    }

    this.scheduleNextPoll();
    Logger.info('[DualWriteWorker] Started asynchronous staging dual-write worker.');
  }

  private scheduleNextPoll(): void {
    if (!this.isRunning || this.isShuttingDown) return;
    this.timer = setTimeout(async () => {
      try {
        await this.processNextBatch();
      } catch (err: any) {
        Logger.error(`[DualWriteWorker] Unhandled poll error: ${err.message}`);
      } finally {
        this.scheduleNextPoll();
      }
    }, this.pollIntervalMs);
  }

  /**
   * Processes a single batch of claimed outbox events.
   * Exposed for deterministic testing.
   */
  async processNextBatch(): Promise<{ claimed: number; delivered: number; failed: number }> {
    // Check feature flag: disarm admission within <100ms
    if (process.env.ENABLE_STAGING_DUAL_WRITE !== 'true') {
      return { claimed: 0, delivered: 0, failed: 0 };
    }

    // Check circuit breaker
    const { state } = this.getCircuitStatus();
    if (state === 'OPEN') {
      return { claimed: 0, delivered: 0, failed: 0 };
    }

    const batch = this.outboxService.claimBatch(this.batchSize, this.leaseSeconds);
    if (batch.length === 0) {
      return { claimed: 0, delivered: 0, failed: 0 };
    }

    let delivered = 0;
    let failed = 0;

    for (const record of batch) {
      if (this.isShuttingDown) break;
      this.activeWritesCount++;
      try {
        await this.deliverRecord(record);
        this.outboxService.markDelivered(record.event_id);
        delivered++;

        // Successful delivery resets circuit failure counter
        this.consecutiveFailures = 0;
        if (this.circuitState === 'HALF_OPEN') {
          this.circuitState = 'CLOSED';
        }
      } catch (err: any) {
        failed++;
        this.consecutiveFailures++;
        this.outboxService.markFailed(record.event_id, err, this.maxAttempts);

        // Auto-trip circuit breaker if failure threshold reached
        if (this.consecutiveFailures >= this.circuitThreshold) {
          this.circuitState = 'OPEN';
          this.lastCircuitTripTime = Date.now();
          Logger.warn(`[DualWriteWorker] Circuit breaker TRIPPED to OPEN after ${this.consecutiveFailures} consecutive failures.`);
        }
      } finally {
        this.activeWritesCount--;
      }
    }

    return { claimed: batch.length, delivered, failed };
  }

  /**
   * Idempotent delivery handler against PostgreSQL staging schema.
   */
  private async deliverRecord(record: OutboxRecord): Promise<void> {
    const pool = this.getPool();
    const payload = JSON.parse(record.payload_json);

    switch (record.aggregate_type) {
      case 'PREDICTION': {
        // Upsert into ai.prediction_runs (or predictions.published_predictions)
        // Deterministic idempotency based on record.idempotency_key / run_id
        const runId = payload.run_id || record.idempotency_key;
        const matchId = payload.match_id || payload.fixture_id;
        const predWinnerId = payload.predicted_winner_id || '0fa358dd-d671-56e0-bfa1-3152e31bcf2a';
        const winProb = payload.win_probability_pct || (payload.win_probability ? payload.win_probability * 100 : 50.0);
        const confTier = payload.confidence || payload.confidence_tier || 'MEDIUM';
        const createdAt = payload.created_at || record.created_at;
        const latencyMs = payload.total_latency_ms || 120;
        const cutoffTime = payload.cutoff_timestamp_utc || createdAt;
        const schemaHash = payload.feature_schema_hash || record.payload_sha256;

        await pool.query(`
          INSERT INTO ai.prediction_runs (
            run_id, match_id, cutoff_timestamp_utc, feature_schema_hash, feature_snapshot,
            model_routing_config, predicted_winner_id, win_probability_pct, confidence_tier,
            quality_gate_passed, total_latency_ms, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, $10, $11
          )
          ON CONFLICT (run_id) DO UPDATE SET
            win_probability_pct = EXCLUDED.win_probability_pct,
            confidence_tier = EXCLUDED.confidence_tier
        `, [
          runId,
          matchId,
          cutoffTime,
          schemaHash,
          JSON.stringify(payload.feature_snapshot || { snapshot: 'dual_write_staged' }),
          JSON.stringify(payload.model_routing_config || { model: 'dual_write_v1' }),
          predWinnerId,
          winProb,
          confTier,
          latencyMs,
          createdAt
        ]);
        break;
      }

      case 'EDITORIAL': {
        const editorialId = payload.editorial_id || payload.id || record.idempotency_key;
        const matchId = payload.match_id || payload.fixture_id;
        const headline = payload.headline || 'Match Analysis';
        const summary = payload.summary || '';
        const tactical = payload.tactical_analysis || '';
        const status = payload.publish_status || (payload.is_published ? 'PUBLISHED' : 'DRAFT');
        const createdAt = payload.created_at || record.created_at;

        await pool.query(`
          INSERT INTO predictions.match_editorials (
            editorial_id, match_id, headline, summary, tactical_analysis, publish_status, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7
          )
          ON CONFLICT (editorial_id) DO UPDATE SET
            headline = EXCLUDED.headline,
            summary = EXCLUDED.summary,
            tactical_analysis = EXCLUDED.tactical_analysis,
            publish_status = EXCLUDED.publish_status
        `, [
          editorialId,
          matchId,
          headline,
          summary,
          tactical,
          status,
          createdAt
        ]);
        break;
      }

      default:
        // Generic no-op acknowledgment
        break;
    }
  }

  /**
   * Graceful shutdown: stops claiming work immediately (<100ms) and waits up to timeout for active writes.
   */
  async stop(timeoutMs = 1000): Promise<void> {
    this.isShuttingDown = true;
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const startWait = Date.now();
    while (this.activeWritesCount > 0 && Date.now() - startWait < timeoutMs) {
      await new Promise(r => setTimeout(r, 50));
    }

    Logger.info('[DualWriteWorker] Stopped staging dual-write worker.');
  }
}
