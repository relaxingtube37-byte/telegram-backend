import type { PlayerMatchIndexRow, UpsertPlayerMatchIndexInput } from '../repositories/playerMatchIndex.repo';

export interface IMatchesRepo {
  getByFingerprint(fingerprint: string): Promise<PlayerMatchIndexRow | null>;
  listByTrackedPlayer(trackedPlayerId: number, limit?: number): Promise<PlayerMatchIndexRow[]>;
  upsert(input: UpsertPlayerMatchIndexInput): Promise<number>;
}
