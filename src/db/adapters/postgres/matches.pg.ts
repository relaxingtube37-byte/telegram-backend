import type { IMatchesRepo } from '../../interfaces/matches.interface';
import type { PlayerMatchIndexRow, UpsertPlayerMatchIndexInput } from '../../repositories/playerMatchIndex.repo';
import type { PostgresClientPool } from '../../stagingPgPool';
import { getStagingPgPool } from '../../stagingPgPool';

export class PostgresMatchesAdapter implements IMatchesRepo {
  private pool: PostgresClientPool | null;

  constructor(pool: PostgresClientPool | null = null) {
    this.pool = pool;
  }

  setPool(pool: PostgresClientPool | null) {
    this.pool = pool;
  }

  private ensurePool(): PostgresClientPool {
    if (!this.pool) {
      this.pool = getStagingPgPool();
    }
    return this.pool;
  }

  private mapRow(r: any): PlayerMatchIndexRow {
    return {
      id: r.id || 1,
      tracked_player_id: r.tracked_player_id || 1,
      historical_match_id: r.historical_match_id || null,
      rapid_event_id: r.rapid_event_id || null,
      match_fingerprint: r.match_fingerprint || r.match_id,
      match_date: r.match_date || (r.scheduled_start_utc ? r.scheduled_start_utc.substring(0, 10) : '2026-09-01'),
      opponent_name: r.opponent_name || 'Opponent',
      won: r.won ?? 1,
      tour: r.tour || 'ATP',
      tourney_name: r.tourney_name || 'Tournament',
      surface: r.surface || 'Hard',
      score: r.score || null,
      completeness: 'full',
      has_csv_stats: 1,
      has_api_details: 1,
      has_api_statistics: 1,
      has_api_pbp: 1,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || new Date().toISOString()
    };
  }

  async getByFingerprint(fingerprint: string): Promise<PlayerMatchIndexRow | null> {
    const pool = this.ensurePool();
    const res = await pool.query(
      `SELECT m.match_id, m.scheduled_start_utc, m.surface, m.round_name
       FROM matches.matches m
       WHERE m.match_id::text = $1 LIMIT 1`,
      [fingerprint]
    );
    if (!res.rows.length) return null;
    return this.mapRow(res.rows[0]);
  }

  async listByTrackedPlayer(_trackedPlayerId: number, limit = 50): Promise<PlayerMatchIndexRow[]> {
    const pool = this.ensurePool();
    const res = await pool.query(
      `SELECT m.match_id, m.scheduled_start_utc, m.surface, m.round_name
       FROM matches.matches m
       ORDER BY m.scheduled_start_utc DESC LIMIT $1`,
      [limit]
    );
    return res.rows.map((r: any) => this.mapRow(r));
  }

  // --- Strict Zero-Mutation Enforcement in Staging ---
  async upsert(_input: UpsertPlayerMatchIndexInput): Promise<number> {
    throw new Error('POSTGRES_MUTATION_PROHIBITED: Dual-write and mutation are NOT AUTHORIZED in Phase 8.');
  }
}
