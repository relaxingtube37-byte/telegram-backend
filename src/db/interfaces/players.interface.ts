import type { PublishedPlayer } from '../../types';

export interface IPlayersRepo {
  getAll(limit?: number): Promise<PublishedPlayer[]>;
  getPublished(limit?: number): Promise<PublishedPlayer[]>;
  getFeatured(): Promise<PublishedPlayer[]>;
  getByPlayerId(playerId: number): Promise<PublishedPlayer | undefined>;
  getBySlugOrId(slugOrId: string | number): Promise<PublishedPlayer | undefined>;
  upsert(p: PublishedPlayer): Promise<number>;
  bulkUpsert(players: PublishedPlayer[]): Promise<number>;
  delete(playerId: number): Promise<boolean>;
  toggleFeatured(playerId: number, featured: boolean): Promise<boolean>;
}
