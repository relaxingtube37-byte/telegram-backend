/**
 * src/db/shadow/matches.shadow.ts
 *
 * Shadow-Comparing Decorator for IMatchesRepo.
 * Primary: SQLite (returned synchronously/immediately).
 * Shadow: PostgreSQL staging cluster (asynchronous, non-blocking, zero-error propagation).
 */

import type { IMatchesRepo } from '../interfaces/matches.interface';
import type { PlayerMatchIndexRow, UpsertPlayerMatchIndexInput } from '../repositories/playerMatchIndex.repo';
import type { PostgresMatchesAdapter } from '../adapters/postgres/matches.pg';
import { ShadowComparator } from './shadowComparator';

export class ShadowComparingMatchesRepo implements IMatchesRepo {
  private primary: IMatchesRepo;
  private shadow: PostgresMatchesAdapter;

  constructor(primary: IMatchesRepo, shadow: PostgresMatchesAdapter) {
    this.primary = primary;
    this.shadow = shadow;
  }

  async getByFingerprint(fingerprint: string): Promise<PlayerMatchIndexRow | null> {
    return ShadowComparator.runDetached(
      'MATCHES',
      'getByFingerprint',
      this.primary.getByFingerprint(fingerprint),
      () => this.shadow.getByFingerprint(fingerprint),
      () => `fp_${fingerprint}`
    );
  }

  async listByTrackedPlayer(trackedPlayerId: number, limit = 50): Promise<PlayerMatchIndexRow[]> {
    return ShadowComparator.runDetached(
      'MATCHES',
      'listByTrackedPlayer',
      this.primary.listByTrackedPlayer(trackedPlayerId, limit),
      () => this.shadow.listByTrackedPlayer(trackedPlayerId, limit),
      () => `trackedPlayer_${trackedPlayerId}`
    );
  }

  // Mutation methods delegate directly to primary
  async upsert(input: UpsertPlayerMatchIndexInput): Promise<number> {
    return this.primary.upsert(input);
  }
}
