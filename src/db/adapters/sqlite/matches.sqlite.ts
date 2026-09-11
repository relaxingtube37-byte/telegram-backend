import type { IMatchesRepo } from '../../interfaces/matches.interface';
import type { PlayerMatchIndexRow, UpsertPlayerMatchIndexInput } from '../../repositories/playerMatchIndex.repo';
import { PlayerMatchIndexRepo } from '../../repositories/playerMatchIndex.repo';
import { db } from '../../connection';

export class SqliteMatchesAdapter implements IMatchesRepo {
  async getByFingerprint(fingerprint: string): Promise<PlayerMatchIndexRow | null> {
    const row = db
      .prepare('SELECT * FROM player_match_index WHERE match_fingerprint = ?')
      .get(fingerprint) as PlayerMatchIndexRow | undefined;
    return row || null;
  }

  async listByTrackedPlayer(trackedPlayerId: number, limit = 50): Promise<PlayerMatchIndexRow[]> {
    return PlayerMatchIndexRepo.listForPlayer(trackedPlayerId, limit);
  }

  async upsert(input: UpsertPlayerMatchIndexInput): Promise<number> {
    const row = PlayerMatchIndexRepo.upsert(input);
    return row.id;
  }
}
