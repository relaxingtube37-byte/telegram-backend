/**
 * src/db/shadow/predictions.shadow.ts
 *
 * Shadow-Comparing Decorator for IPredictionsRepo.
 * Primary: SQLite (returned synchronously/immediately).
 * Shadow: PostgreSQL staging cluster (asynchronous, non-blocking, zero-error propagation).
 */

import type { IPredictionsRepo } from '../interfaces/predictions.interface';
import type { Prediction } from '../../types';
import type { PostgresPredictionsAdapter } from '../adapters/postgres/predictions.pg';
import { ShadowComparator } from './shadowComparator';

export class ShadowComparingPredictionsRepo implements IPredictionsRepo {
  private primary: IPredictionsRepo;
  private shadow: PostgresPredictionsAdapter;

  constructor(primary: IPredictionsRepo, shadow: PostgresPredictionsAdapter) {
    this.primary = primary;
    this.shadow = shadow;
  }

  async getAll(limit = 100): Promise<Prediction[]> {
    return ShadowComparator.runDetached(
      'PREDICTIONS',
      'getAll',
      this.primary.getAll(limit),
      () => this.shadow.getAll(limit)
    );
  }

  async getActive(): Promise<Prediction[]> {
    return ShadowComparator.runDetached(
      'PREDICTIONS',
      'getActive',
      this.primary.getActive(),
      () => this.shadow.getActive()
    );
  }

  async getHistory(limit = 50): Promise<Prediction[]> {
    return ShadowComparator.runDetached(
      'PREDICTIONS',
      'getHistory',
      this.primary.getHistory(limit),
      () => this.shadow.getHistory(limit)
    );
  }

  async getById(id: number): Promise<Prediction | null> {
    return ShadowComparator.runDetached(
      'PREDICTIONS',
      'getById',
      this.primary.getById(id),
      () => this.shadow.getById(id),
      () => `id_${id}`
    );
  }

  async getByFixtureId(fixtureId: number): Promise<Prediction | null> {
    return ShadowComparator.runDetached(
      'PREDICTIONS',
      'getByFixtureId',
      this.primary.getByFixtureId(fixtureId),
      () => this.shadow.getByFixtureId(fixtureId),
      () => `fixture_${fixtureId}`
    );
  }

  // Mutation methods delegate directly to primary
  async create(p: Prediction): Promise<number> {
    return this.primary.create(p);
  }

  async updateResult(id: number, status: string, resultScore?: string): Promise<boolean> {
    return this.primary.updateResult(id, status, resultScore);
  }

  async updateResultByFixtureId(fixtureId: number, status: string, resultScore?: string): Promise<boolean> {
    return this.primary.updateResultByFixtureId(fixtureId, status, resultScore);
  }

  async updateChannelMessageId(id: number, channelMsgId: number): Promise<void> {
    return this.primary.updateChannelMessageId(id, channelMsgId);
  }

  async delete(id: number): Promise<boolean> {
    return this.primary.delete(id);
  }
}
