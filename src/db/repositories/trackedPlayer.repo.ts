import { db } from '../connection';

export type TrackedPlayerTour = 'ATP' | 'WTA';
export type TrackedPlayerSyncStatus = 'pending' | 'syncing' | 'done' | 'error';

export interface TrackedPlayerRow {
  id: number;
  rapid_player_id: number;
  tour: TrackedPlayerTour;
  full_name: string;
  short_name: string | null;
  country_code: string | null;
  current_rank: number | null;
  gender: string;
  sync_status: TrackedPlayerSyncStatus;
  sync_error: string | null;
  last_sync_at: string | null;
  last_match_date: string | null;
  matches_in_db: number;
  matches_with_stats: number;
  last_sync_pages: number;
  added_by: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface UpsertTrackedPlayerInput {
  rapid_player_id: number;
  tour: TrackedPlayerTour;
  full_name: string;
  short_name?: string;
  country_code?: string;
  current_rank?: number;
  gender?: string;
  added_by?: string;
}

export const TrackedPlayerRepo = {
  list(options?: { activeOnly?: boolean; tour?: TrackedPlayerTour; limit?: number }): TrackedPlayerRow[] {
    const clauses: string[] = [];
    const params: Record<string, unknown> = { limit: options?.limit || 500 };

    if (options?.activeOnly !== false) clauses.push('is_active = 1');
    if (options?.tour) {
      clauses.push('tour = @tour');
      params.tour = options.tour;
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return db
      .prepare(
        `
      SELECT * FROM tracked_players
      ${where}
      ORDER BY (current_rank IS NULL), current_rank ASC, full_name ASC
      LIMIT @limit
    `,
      )
      .all(params) as TrackedPlayerRow[];
  },

  getById(id: number): TrackedPlayerRow | null {
    return (db.prepare('SELECT * FROM tracked_players WHERE id = ?').get(id) as TrackedPlayerRow | undefined) || null;
  },

  getByRapidId(rapidPlayerId: number): TrackedPlayerRow | null {
    return (
      (db.prepare('SELECT * FROM tracked_players WHERE rapid_player_id = ?').get(rapidPlayerId) as
        | TrackedPlayerRow
        | undefined) || null
    );
  },

  upsert(input: UpsertTrackedPlayerInput): TrackedPlayerRow {
    const now = new Date().toISOString();
    const existing = this.getByRapidId(input.rapid_player_id);

    if (existing) {
      db.prepare(
        `
        UPDATE tracked_players SET
          tour = @tour,
          full_name = @full_name,
          short_name = COALESCE(@short_name, short_name),
          country_code = COALESCE(@country_code, country_code),
          current_rank = COALESCE(@current_rank, current_rank),
          gender = COALESCE(@gender, gender),
          is_active = 1,
          updated_at = @updated_at
        WHERE rapid_player_id = @rapid_player_id
      `,
      ).run({
        rapid_player_id: input.rapid_player_id,
        tour: input.tour,
        full_name: input.full_name,
        short_name: input.short_name || null,
        country_code: input.country_code || null,
        current_rank: input.current_rank ?? null,
        gender: input.gender || 'M',
        updated_at: now,
      });
      return this.getByRapidId(input.rapid_player_id)!;
    }

    db.prepare(
      `
      INSERT INTO tracked_players (
        rapid_player_id, tour, full_name, short_name, country_code, current_rank, gender,
        sync_status, added_by, is_active, created_at, updated_at
      ) VALUES (
        @rapid_player_id, @tour, @full_name, @short_name, @country_code, @current_rank, @gender,
        'pending', @added_by, 1, @created_at, @updated_at
      )
    `,
    ).run({
      rapid_player_id: input.rapid_player_id,
      tour: input.tour,
      full_name: input.full_name,
      short_name: input.short_name || null,
      country_code: input.country_code || null,
      current_rank: input.current_rank ?? null,
      gender: input.gender || 'M',
      added_by: input.added_by || 'manual',
      created_at: now,
      updated_at: now,
    });

    return this.getByRapidId(input.rapid_player_id)!;
  },

  setSyncStatus(
    id: number,
    patch: Partial<
      Pick<
        TrackedPlayerRow,
        | 'sync_status'
        | 'sync_error'
        | 'last_sync_at'
        | 'last_match_date'
        | 'matches_in_db'
        | 'matches_with_stats'
        | 'last_sync_pages'
        | 'current_rank'
      >
    >,
  ): void {
    const fields: string[] = ['updated_at = @updated_at'];
    const params: Record<string, unknown> = { id, updated_at: new Date().toISOString() };

    if (patch.sync_status !== undefined) {
      fields.push('sync_status = @sync_status');
      params.sync_status = patch.sync_status;
    }
    if (patch.sync_error !== undefined) {
      fields.push('sync_error = @sync_error');
      params.sync_error = patch.sync_error;
    }
    if (patch.last_sync_at !== undefined) {
      fields.push('last_sync_at = @last_sync_at');
      params.last_sync_at = patch.last_sync_at;
    }
    if (patch.last_match_date !== undefined) {
      fields.push('last_match_date = @last_match_date');
      params.last_match_date = patch.last_match_date;
    }
    if (patch.matches_in_db !== undefined) {
      fields.push('matches_in_db = @matches_in_db');
      params.matches_in_db = patch.matches_in_db;
    }
    if (patch.matches_with_stats !== undefined) {
      fields.push('matches_with_stats = @matches_with_stats');
      params.matches_with_stats = patch.matches_with_stats;
    }
    if (patch.last_sync_pages !== undefined) {
      fields.push('last_sync_pages = @last_sync_pages');
      params.last_sync_pages = patch.last_sync_pages;
    }
    if (patch.current_rank !== undefined) {
      fields.push('current_rank = @current_rank');
      params.current_rank = patch.current_rank;
    }

    db.prepare(`UPDATE tracked_players SET ${fields.join(', ')} WHERE id = @id`).run(params);
  },

  count(): { total: number; pending: number; done: number; error: number } {
    const rows = db
      .prepare(
        `
      SELECT sync_status, COUNT(*) as c FROM tracked_players WHERE is_active = 1 GROUP BY sync_status
    `,
      )
      .all() as { sync_status: string; c: number }[];

    const out = { total: 0, pending: 0, done: 0, error: 0 };
    for (const row of rows) {
      out.total += row.c;
      if (row.sync_status === 'pending') out.pending += row.c;
      else if (row.sync_status === 'done') out.done += row.c;
      else if (row.sync_status === 'error') out.error += row.c;
    }
    return out;
  },
};
