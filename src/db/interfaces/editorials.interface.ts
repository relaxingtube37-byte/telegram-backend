import type { MatchEditorialRecord, EditorialPublishStatus } from '../repositories/editorials.repo';

export interface IEditorialsRepo {
  getByFixtureId(fixtureId: number): Promise<MatchEditorialRecord | null>;
  getBySlug(slug: string): Promise<MatchEditorialRecord | null>;
  listPublished(limit?: number): Promise<MatchEditorialRecord[]>;
  listAll(limit?: number): Promise<MatchEditorialRecord[]>;
  upsert(record: MatchEditorialRecord): Promise<{ id: number; fixture_id: number; slug: string }>;
  updateStatus(
    fixtureId: number,
    nextStatus: EditorialPublishStatus,
    meta?: { editor?: string; note?: string }
  ): Promise<MatchEditorialRecord | null>;
}
