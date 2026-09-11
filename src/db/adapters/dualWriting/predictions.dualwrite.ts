/**
 * src/db/adapters/dualWriting/predictions.dualwrite.ts
 *
 * Dual-Writing Decorator for IPredictionsRepo.
 * Atomically couples SQLite primary business mutations with durable outbox insertions
 * inside a single SQLite transaction.
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';
import type { IPredictionsRepo } from '../../interfaces/predictions.interface';
import type { Prediction } from '../../../types';
import { OutboxService } from '../../outbox/outbox.service';
import { db as defaultDb } from '../../connection';

export class DualWritingPredictionsRepo implements IPredictionsRepo {
  private primary: IPredictionsRepo;
  private outboxService: OutboxService;
  private db: Database.Database;
  private cachedInsertStmt: Database.Statement | null = null;
  private cachedTxRunner: ((input: Prediction) => number) | null = null;

  constructor(primary: IPredictionsRepo, outboxService?: OutboxService, db?: Database.Database) {
    this.primary = primary;
    this.db = db || defaultDb;
    this.outboxService = outboxService || new OutboxService(this.db);
  }

  // --- Primary Unaltered Reads (100% SQLite) ---
  async getAll(limit = 100): Promise<Prediction[]> {
    return this.primary.getAll(limit);
  }

  async getActive(): Promise<Prediction[]> {
    return this.primary.getActive();
  }

  async getHistory(limit = 50): Promise<Prediction[]> {
    return this.primary.getHistory(limit);
  }

  async getById(id: number): Promise<Prediction | null> {
    return this.primary.getById(id);
  }

  async getByFixtureId(fixtureId: number): Promise<Prediction | null> {
    return this.primary.getByFixtureId(fixtureId);
  }

  // --- Atomic Business Mutation + Outbox Append ---
  async create(p: Prediction): Promise<number> {
    // If staging dual-write is not active, standard primary write
    if (process.env.ENABLE_STAGING_DUAL_WRITE !== 'true') {
      return this.primary.create(p);
    }

    if (!this.cachedTxRunner) {
      if (!this.cachedInsertStmt) {
        this.cachedInsertStmt = this.db.prepare(`
          INSERT INTO predictions (
            fixture_id, home_name, away_name, predicted_winner, win_probability,
            confidence, status, model_name, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
      }
      const insertStmt = this.cachedInsertStmt;

      this.cachedTxRunner = this.db.transaction((inData: Prediction) => {
        const now = inData.created_at || new Date().toISOString();
        const status = inData.status || 'UPCOMING';
        const model = (inData as any).model_name || 'tennis-predictor-v1';

        const res = insertStmt.run(
          inData.fixture_id,
          inData.home_name,
          inData.away_name,
          inData.predicted_winner,
          inData.win_probability,
          inData.confidence,
          status,
          model,
          now
        );

        const predictionId = Number(res.lastInsertRowid);
        const prediction: Prediction = {
          ...inData,
          id: predictionId,
          created_at: now
        };

        // 2. Durable outbox insert in SAME atomic transaction
        const idempotencyKey = `pred:create:${inData.fixture_id}:${now}`;
        this.outboxService.appendTransactionalEvent({
          aggregateType: 'PREDICTION',
          aggregateId: String(inData.fixture_id),
          operation: 'CREATE',
          payload: { ...prediction, run_id: crypto.randomUUID() },
          idempotencyKey
        }, this.db);

        return predictionId;
      });
    }

    return this.cachedTxRunner(p);
  }

  async updateResult(id: number, status: string, score?: string): Promise<boolean> {
    const success = await this.primary.updateResult(id, status, score);
    if (process.env.ENABLE_STAGING_DUAL_WRITE === 'true' && success) {
      const idempotencyKey = `pred:result:${id}:${new Date().toISOString()}`;
      this.outboxService.appendTransactionalEvent({
        aggregateType: 'PREDICTION',
        aggregateId: String(id),
        operation: 'UPDATE_RESULT',
        payload: { id, status, score },
        idempotencyKey
      }, this.db);
    }
    return success;
  }

  async updateResultByFixtureId(fixtureId: number, status: string, score?: string): Promise<boolean> {
    const success = await this.primary.updateResultByFixtureId(fixtureId, status, score);
    if (process.env.ENABLE_STAGING_DUAL_WRITE === 'true' && success) {
      const idempotencyKey = `pred:result_fixture:${fixtureId}:${new Date().toISOString()}`;
      this.outboxService.appendTransactionalEvent({
        aggregateType: 'PREDICTION',
        aggregateId: String(fixtureId),
        operation: 'UPDATE_RESULT_FIXTURE',
        payload: { fixtureId, status, score },
        idempotencyKey
      }, this.db);
    }
    return success;
  }

  async updateChannelMessageId(id: number, channelMsgId: number): Promise<void> {
    await this.primary.updateChannelMessageId(id, channelMsgId);
  }

  async delete(id: number): Promise<boolean> {
    const success = await this.primary.delete(id);
    if (process.env.ENABLE_STAGING_DUAL_WRITE === 'true' && success) {
      const idempotencyKey = `pred:delete:${id}:${new Date().toISOString()}`;
      this.outboxService.appendTransactionalEvent({
        aggregateType: 'PREDICTION',
        aggregateId: String(id),
        operation: 'DELETE',
        payload: { id },
        idempotencyKey
      }, this.db);
    }
    return success;
  }
}
