/**
 * src/db/shadow/players.shadow.ts
 *
 * Shadow-Comparing Decorator for IPlayersRepo.
 * Primary: SQLite (returned synchronously/immediately).
 * Shadow: PostgreSQL staging cluster (asynchronous, non-blocking, zero-error propagation).
 */

import type { IPlayersRepo } from '../interfaces/players.interface';
import type { PublishedPlayer } from '../../types';
import type { PostgresPlayersAdapter } from '../adapters/postgres/players.pg';
import { ShadowComparator } from './shadowComparator';

export class ShadowComparingPlayersRepo implements IPlayersRepo {
  private primary: IPlayersRepo;
  private shadow: PostgresPlayersAdapter;

  constructor(primary: IPlayersRepo, shadow: PostgresPlayersAdapter) {
    this.primary = primary;
    this.shadow = shadow;
  }

  async getAll(limit = 100): Promise<PublishedPlayer[]> {
    return ShadowComparator.runDetached(
      'PLAYERS',
      'getAll',
      this.primary.getAll(limit),
      () => this.shadow.getAll(limit)
    );
  }

  async getPublished(limit = 100): Promise<PublishedPlayer[]> {
    return ShadowComparator.runDetached(
      'PLAYERS',
      'getPublished',
      this.primary.getPublished(limit),
      () => this.shadow.getPublished(limit)
    );
  }

  async getFeatured(): Promise<PublishedPlayer[]> {
    return ShadowComparator.runDetached(
      'PLAYERS',
      'getFeatured',
      this.primary.getFeatured(),
      () => this.shadow.getFeatured()
    );
  }

  async getByPlayerId(playerId: number): Promise<PublishedPlayer | undefined> {
    return ShadowComparator.runDetached(
      'PLAYERS',
      'getByPlayerId',
      this.primary.getByPlayerId(playerId),
      () => this.shadow.getByPlayerId(playerId),
      () => `player_${playerId}`
    );
  }

  async getBySlugOrId(slugOrId: string | number): Promise<PublishedPlayer | undefined> {
    return ShadowComparator.runDetached(
      'PLAYERS',
      'getBySlugOrId',
      this.primary.getBySlugOrId(slugOrId),
      () => this.shadow.getBySlugOrId(slugOrId),
      () => `slugOrId_${slugOrId}`
    );
  }

  // Mutation methods delegate directly to primary
  async upsert(p: PublishedPlayer): Promise<number> {
    return this.primary.upsert(p);
  }

  async bulkUpsert(players: PublishedPlayer[]): Promise<number> {
    return this.primary.bulkUpsert(players);
  }

  async delete(playerId: number): Promise<boolean> {
    return this.primary.delete(playerId);
  }

  async toggleFeatured(playerId: number, featured: boolean): Promise<boolean> {
    return this.primary.toggleFeatured(playerId, featured);
  }
}
