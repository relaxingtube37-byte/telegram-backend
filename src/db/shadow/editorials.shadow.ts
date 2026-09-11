/**
 * src/db/shadow/editorials.shadow.ts
 *
 * Shadow-Comparing Decorator for IEditorialsRepo.
 * Primary: SQLite (returned synchronously/immediately).
 * Shadow: PostgreSQL staging cluster (asynchronous, non-blocking, zero-error propagation).
 */

import type { IEditorialsRepo } from '../interfaces/editorials.interface';
import type { MatchEditorialRecord, EditorialPublishStatus } from '../repositories/editorials.repo';
import type { PostgresEditorialsAdapter } from '../adapters/postgres/editorials.pg';
import { ShadowComparator } from './shadowComparator';

export class ShadowComparingEditorialsRepo implements IEditorialsRepo {
  private primary: IEditorialsRepo;
  private shadow: PostgresEditorialsAdapter;

  constructor(primary: IEditorialsRepo, shadow: PostgresEditorialsAdapter) {
    this.primary = primary;
    this.shadow = shadow;
  }

  async getByFixtureId(fixtureId: number): Promise<MatchEditorialRecord | null> {
    return ShadowComparator.runDetached(
      'EDITORIALS',
      'getByFixtureId',
      this.primary.getByFixtureId(fixtureId),
      () => this.shadow.getByFixtureId(fixtureId),
      () => `fixture_${fixtureId}`
    );
  }

  async getBySlug(slug: string): Promise<MatchEditorialRecord | null> {
    return ShadowComparator.runDetached(
      'EDITORIALS',
      'getBySlug',
      this.primary.getBySlug(slug),
      () => this.shadow.getBySlug(slug),
      () => `slug_${slug}`
    );
  }

  async listPublished(limit = 20): Promise<MatchEditorialRecord[]> {
    return ShadowComparator.runDetached(
      'EDITORIALS',
      'listPublished',
      this.primary.listPublished(limit),
      () => this.shadow.listPublished(limit)
    );
  }

  async listAll(limit = 50): Promise<MatchEditorialRecord[]> {
    return ShadowComparator.runDetached(
      'EDITORIALS',
      'listAll',
      this.primary.listAll(limit),
      () => this.shadow.listAll(limit)
    );
  }

  // Mutation methods delegate directly to primary
  async upsert(record: MatchEditorialRecord): Promise<{ id: number; fixture_id: number; slug: string }> {
    return this.primary.upsert(record);
  }

  async updateStatus(
    fixtureId: number,
    nextStatus: EditorialPublishStatus,
    meta?: { editor?: string; note?: string }
  ): Promise<MatchEditorialRecord | null> {
    return this.primary.updateStatus(fixtureId, nextStatus, meta);
  }
}
