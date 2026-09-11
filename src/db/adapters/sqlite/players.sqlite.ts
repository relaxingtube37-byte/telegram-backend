import type { IPlayersRepo } from '../../interfaces/players.interface';
import type { PublishedPlayer } from '../../../types';
import { PlayersRepo } from '../../repositories/players.repo';

export class SqlitePlayersAdapter implements IPlayersRepo {
  async getAll(limit = 100): Promise<PublishedPlayer[]> {
    return PlayersRepo.getAll(limit);
  }

  async getPublished(limit = 100): Promise<PublishedPlayer[]> {
    return PlayersRepo.getPublished(limit);
  }

  async getFeatured(): Promise<PublishedPlayer[]> {
    return PlayersRepo.getFeatured();
  }

  async getByPlayerId(playerId: number): Promise<PublishedPlayer | undefined> {
    return PlayersRepo.getByPlayerId(playerId);
  }

  async getBySlugOrId(slugOrId: string | number): Promise<PublishedPlayer | undefined> {
    return PlayersRepo.getBySlugOrId(slugOrId);
  }

  async upsert(p: PublishedPlayer): Promise<number> {
    return PlayersRepo.upsert(p);
  }

  async bulkUpsert(players: PublishedPlayer[]): Promise<number> {
    return PlayersRepo.bulkUpsert(players);
  }

  async delete(playerId: number): Promise<boolean> {
    return PlayersRepo.delete(playerId);
  }

  async toggleFeatured(playerId: number, featured: boolean): Promise<boolean> {
    return PlayersRepo.toggleFeatured(playerId, featured);
  }
}
