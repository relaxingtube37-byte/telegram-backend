import type { IEditorialsRepo } from '../../interfaces/editorials.interface';
import { EditorialsRepo, type MatchEditorialRecord, type EditorialPublishStatus } from '../../repositories/editorials.repo';

export class SqliteEditorialsAdapter implements IEditorialsRepo {
  async getByFixtureId(fixtureId: number): Promise<MatchEditorialRecord | null> {
    return EditorialsRepo.getByFixtureId(fixtureId);
  }

  async getBySlug(slug: string): Promise<MatchEditorialRecord | null> {
    return EditorialsRepo.getBySlug(slug);
  }

  async listPublished(limit = 20): Promise<MatchEditorialRecord[]> {
    return EditorialsRepo.listPublished(limit);
  }

  async listAll(limit = 100): Promise<MatchEditorialRecord[]> {
    return EditorialsRepo.listAll(limit);
  }

  async upsert(record: MatchEditorialRecord): Promise<{ id: number; fixture_id: number; slug: string }> {
    return EditorialsRepo.upsert(record);
  }

  async updateStatus(
    fixtureId: number,
    nextStatus: EditorialPublishStatus,
    meta?: { editor?: string; note?: string }
  ): Promise<MatchEditorialRecord | null> {
    return EditorialsRepo.updateStatus(fixtureId, nextStatus, meta);
  }
}
