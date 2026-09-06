import { db } from '../connection';

export type MatchCompleteness = 'csv_only' | 'api_basic' | 'stats' | 'full';

export interface PlayerMatchIndexRow {
  id: number;
  tracked_player_id: number;
  historical_match_id: number | null;
  rapid_event_id: number | null;
  match_fingerprint: string;
  match_date: string;
  opponent_name: string;
  won: number;
  tour: string | null;
  tourney_name: string | null;
  surface: string | null;
  score: string | null;
  completeness: MatchCompleteness;
  has_csv_stats: number;
  has_api_details: number;
  has_api_statistics: number;
  has_api_pbp: number;
  created_at: string;
  updated_at: string;
}

export interface UpsertPlayerMatchIndexInput {
  tracked_player_id: number;
  historical_match_id?: number | null;
  rapid_event_id?: number | null;
  match_fingerprint: string;
  match_date: string;
  opponent_name: string;
  won: boolean;
  tour?: string;
  tourney_name?: string;
  surface?: string;
  score?: string;
  completeness?: MatchCompleteness;
  has_csv_stats?: boolean;
  has_api_details?: boolean;
  has_api_statistics?: boolean;
  has_api_pbp?: boolean;
}

function computeCompleteness(flags: {
  has_csv_stats?: boolean;
  has_api_details?: boolean;
  has_api_statistics?: boolean;
  has_api_pbp?: boolean;
  rapid_event_id?: number | null;
}): MatchCompleteness {
  if (flags.has_csv_stats || flags.has_api_statistics) return 'full';
  if (flags.rapid_event_id) return 'api_basic';
  return 'csv_only';
}

export const PlayerMatchIndexRepo = {
  upsert(input: UpsertPlayerMatchIndexInput): PlayerMatchIndexRow {
    const now = new Date().toISOString();
    const existing = db
      .prepare('SELECT * FROM player_match_index WHERE tracked_player_id = ? AND match_fingerprint = ?')
      .get(input.tracked_player_id, input.match_fingerprint) as PlayerMatchIndexRow | undefined;

    const merged = {
      historical_match_id: input.historical_match_id ?? existing?.historical_match_id ?? null,
      rapid_event_id: input.rapid_event_id ?? existing?.rapid_event_id ?? null,
      has_csv_stats: input.has_csv_stats ? 1 : existing?.has_csv_stats ?? 0,
      has_api_details: input.has_api_details ? 1 : existing?.has_api_details ?? 0,
      has_api_statistics: input.has_api_statistics ? 1 : existing?.has_api_statistics ?? 0,
      has_api_pbp: input.has_api_pbp ? 1 : existing?.has_api_pbp ?? 0,
    };

    const completeness = computeCompleteness({
      has_csv_stats: merged.has_csv_stats === 1,
      has_api_details: merged.has_api_details === 1,
      has_api_statistics: merged.has_api_statistics === 1,
      has_api_pbp: merged.has_api_pbp === 1,
      rapid_event_id: merged.rapid_event_id,
    });

    if (existing) {
      db.prepare(
        `
        UPDATE player_match_index SET
          historical_match_id = COALESCE(@historical_match_id, historical_match_id),
          rapid_event_id = COALESCE(@rapid_event_id, rapid_event_id),
          match_date = @match_date,
          opponent_name = @opponent_name,
          won = @won,
          tour = COALESCE(@tour, tour),
          tourney_name = COALESCE(@tourney_name, tourney_name),
          surface = COALESCE(@surface, surface),
          score = COALESCE(@score, score),
          completeness = @completeness,
          has_csv_stats = @has_csv_stats,
          has_api_details = @has_api_details,
          has_api_statistics = @has_api_statistics,
          has_api_pbp = @has_api_pbp,
          updated_at = @updated_at
        WHERE id = @id
      `,
      ).run({
        id: existing.id,
        historical_match_id: merged.historical_match_id,
        rapid_event_id: merged.rapid_event_id,
        match_date: input.match_date,
        opponent_name: input.opponent_name,
        won: input.won ? 1 : 0,
        tour: input.tour || null,
        tourney_name: input.tourney_name || null,
        surface: input.surface || null,
        score: input.score || null,
        completeness,
        has_csv_stats: merged.has_csv_stats,
        has_api_details: merged.has_api_details,
        has_api_statistics: merged.has_api_statistics,
        has_api_pbp: merged.has_api_pbp,
        updated_at: now,
      });
      return this.getById(existing.id)!;
    }

    db.prepare(
      `
      INSERT INTO player_match_index (
        tracked_player_id, historical_match_id, rapid_event_id, match_fingerprint,
        match_date, opponent_name, won, tour, tourney_name, surface, score,
        completeness, has_csv_stats, has_api_details, has_api_statistics, has_api_pbp,
        created_at, updated_at
      ) VALUES (
        @tracked_player_id, @historical_match_id, @rapid_event_id, @match_fingerprint,
        @match_date, @opponent_name, @won, @tour, @tourney_name, @surface, @score,
        @completeness, @has_csv_stats, @has_api_details, @has_api_statistics, @has_api_pbp,
        @created_at, @updated_at
      )
    `,
    ).run({
      tracked_player_id: input.tracked_player_id,
      historical_match_id: merged.historical_match_id,
      rapid_event_id: merged.rapid_event_id,
      match_fingerprint: input.match_fingerprint,
      match_date: input.match_date,
      opponent_name: input.opponent_name,
      won: input.won ? 1 : 0,
      tour: input.tour || null,
      tourney_name: input.tourney_name || null,
      surface: input.surface || null,
      score: input.score || null,
      completeness,
      has_csv_stats: merged.has_csv_stats,
      has_api_details: merged.has_api_details,
      has_api_statistics: merged.has_api_statistics,
      has_api_pbp: merged.has_api_pbp,
      created_at: now,
      updated_at: now,
    });

    return db
      .prepare('SELECT * FROM player_match_index WHERE tracked_player_id = ? AND match_fingerprint = ?')
      .get(input.tracked_player_id, input.match_fingerprint) as PlayerMatchIndexRow;
  },

  getById(id: number): PlayerMatchIndexRow | null {
    return (db.prepare('SELECT * FROM player_match_index WHERE id = ?').get(id) as PlayerMatchIndexRow | undefined) || null;
  },

  listForPlayer(trackedPlayerId: number, limit = 5000): PlayerMatchIndexRow[] {
    return db
      .prepare(
        `
      SELECT * FROM player_match_index
      WHERE tracked_player_id = ?
      ORDER BY match_date DESC
      LIMIT ?
    `,
      )
      .all(trackedPlayerId, limit) as PlayerMatchIndexRow[];
  },

  /** Remove API-only index rows when player already has CSV-linked matches (fixes inflated counts). */
  pruneApiOnlyRows(trackedPlayerId?: number): number {
    if (trackedPlayerId) {
      const hasCsv = db
        .prepare(
          'SELECT 1 FROM player_match_index WHERE tracked_player_id = ? AND has_csv_stats = 1 LIMIT 1',
        )
        .get(trackedPlayerId);
      if (!hasCsv) return 0;
      return db
        .prepare(
          'DELETE FROM player_match_index WHERE tracked_player_id = ? AND has_csv_stats = 0',
        )
        .run(trackedPlayerId).changes;
    }

    const playersWithCsv = db
      .prepare(
        'SELECT DISTINCT tracked_player_id FROM player_match_index WHERE has_csv_stats = 1',
      )
      .all() as Array<{ tracked_player_id: number }>;

    let removed = 0;
    for (const row of playersWithCsv) {
      removed +=
        db
          .prepare(
            'DELETE FROM player_match_index WHERE tracked_player_id = ? AND has_csv_stats = 0',
          )
          .run(row.tracked_player_id).changes ?? 0;
    }
    return removed;
  },

  summariesForAllPlayers(sinceDate?: string): Map<
    number,
    {
      total: number;
      csv_only: number;
      api_basic: number;
      stats: number;
      full: number;
      withCsvStats: number;
      withApiStatistics: number;
      withApiPbp: number;
      withOdds: number;
      withRank: number;
      withServePct: number;
      lastMatchDate: string | null;
    }
  > {
    const rows = db
      .prepare(
        `
      SELECT pmi.tracked_player_id,
        COUNT(*) AS total,
        SUM(CASE WHEN pmi.completeness = 'csv_only' THEN 1 ELSE 0 END) AS csv_only,
        SUM(CASE WHEN pmi.completeness = 'api_basic' THEN 1 ELSE 0 END) AS api_basic,
        SUM(CASE WHEN pmi.completeness = 'stats' THEN 1 ELSE 0 END) AS stats,
        SUM(CASE WHEN pmi.completeness = 'full' THEN 1 ELSE 0 END) AS full,
        SUM(CASE WHEN pmi.has_csv_stats = 1 THEN 1 ELSE 0 END) AS withCsvStats,
        SUM(CASE WHEN pmi.has_api_statistics = 1 THEN 1 ELSE 0 END) AS withApiStatistics,
        SUM(CASE WHEN pmi.has_api_pbp = 1 THEN 1 ELSE 0 END) AS withApiPbp,
        SUM(CASE WHEN (
          (h.w_odds_match IS NOT NULL AND h.w_odds_match > 0)
          OR (h.l_odds_match IS NOT NULL AND h.l_odds_match > 0)
        ) THEN 1 ELSE 0 END) AS withOdds,
        SUM(CASE WHEN COALESCE(h.winner_rank, 0) > 0 OR COALESCE(h.loser_rank, 0) > 0 THEN 1 ELSE 0 END) AS withRank,
        SUM(CASE WHEN (
          (h.w_serve_won_pct IS NOT NULL AND h.w_serve_won_pct > 0)
          OR (h.l_serve_won_pct IS NOT NULL AND h.l_serve_won_pct > 0)
        ) THEN 1 ELSE 0 END) AS withServePct,
        MAX(pmi.match_date) AS lastMatchDate
      FROM player_match_index pmi
      LEFT JOIN historical_matches h ON h.id = pmi.historical_match_id
      WHERE pmi.has_csv_stats = 1
      ${sinceDate ? 'AND pmi.match_date >= @sinceDate' : ''}
      GROUP BY pmi.tracked_player_id
    `,
      )
      .all(sinceDate ? { sinceDate } : {}) as Array<{
      tracked_player_id: number;
      total: number;
      csv_only: number;
      api_basic: number;
      stats: number;
      full: number;
      withCsvStats: number;
      withApiStatistics: number;
      withApiPbp: number;
      withOdds: number;
      withRank: number;
      withServePct: number;
      lastMatchDate: string | null;
    }>;

    return new Map(rows.map((row) => [row.tracked_player_id, row]));
  },

  summaryForPlayer(trackedPlayerId: number): {
    total: number;
    csv_only: number;
    api_basic: number;
    stats: number;
    full: number;
    withCsvStats: number;
    withApiStatistics: number;
    withApiPbp: number;
  } {
    const rows = db
      .prepare(
        `
      SELECT completeness, has_csv_stats, has_api_statistics, has_api_pbp
      FROM player_match_index WHERE tracked_player_id = ? AND has_csv_stats = 1
    `,
      )
      .all(trackedPlayerId) as Array<{
      completeness: MatchCompleteness;
      has_csv_stats: number;
      has_api_statistics: number;
      has_api_pbp: number;
    }>;

    const out = {
      total: rows.length,
      csv_only: 0,
      api_basic: 0,
      stats: 0,
      full: 0,
      withCsvStats: 0,
      withApiStatistics: 0,
      withApiPbp: 0,
    };

    for (const row of rows) {
      out[row.completeness]++;
      if (row.has_csv_stats) out.withCsvStats++;
      if (row.has_api_statistics) out.withApiStatistics++;
      if (row.has_api_pbp) out.withApiPbp++;
    }
    return out;
  },

  listIncompleteApiBundles(
    trackedPlayerId: number,
    sinceDate: string,
    limit = 5000,
  ): Array<{ id: number; rapid_event_id: number; match_date: string }> {
    return db
      .prepare(
        `
      SELECT id, rapid_event_id, match_date FROM player_match_index
      WHERE tracked_player_id = @trackedPlayerId
        AND rapid_event_id IS NOT NULL
        AND match_date >= @sinceDate
        AND has_csv_stats = 0
        AND has_api_statistics = 0
      ORDER BY match_date DESC
      LIMIT @limit
    `,
      )
      .all({ trackedPlayerId, sinceDate, limit }) as Array<{
      id: number;
      rapid_event_id: number;
      match_date: string;
    }>;
  },

  /** Unique rapid_event_id values still missing serve stats from API */
  listDistinctIncompleteEventIds(trackedPlayerId: number, sinceDate: string, limit = 5000): number[] {
    const rows = db
      .prepare(
        `
      SELECT DISTINCT rapid_event_id FROM player_match_index
      WHERE tracked_player_id = @trackedPlayerId
        AND rapid_event_id IS NOT NULL
        AND match_date >= @sinceDate
        AND has_csv_stats = 0
        AND has_api_statistics = 0
      ORDER BY rapid_event_id DESC
      LIMIT @limit
    `,
      )
      .all({ trackedPlayerId, sinceDate, limit }) as Array<{ rapid_event_id: number }>;
    return rows.map((r) => r.rapid_event_id);
  },

  refreshBundleFlagsFromPool(trackedPlayerId: number): number {
    const rows = this.listForPlayer(trackedPlayerId, 10000);
    if (!rows.length) return 0;

    const cachedKeys = new Set(
      (
        db
          .prepare(
            `SELECT cache_key FROM pool_cache
             WHERE namespace IN ('event_statistics', 'event_pbp', 'event_details')
               AND payload_json NOT LIKE '%"__noData":true%'`,
          )
          .all() as Array<{ cache_key: string }>
      ).map((r) => r.cache_key),
    );

    let updated = 0;
    for (const row of rows) {
      if (!row.rapid_event_id) continue;
      const eid = row.rapid_event_id;
      const hasStats = cachedKeys.has(`event_statistics:${eid}`);
      const hasPbp = cachedKeys.has(`event_pbp:${eid}`);
      const hasDetails = cachedKeys.has(`event_details:${eid}`);
      if (
        hasStats !== Boolean(row.has_api_statistics) ||
        hasPbp !== Boolean(row.has_api_pbp) ||
        hasDetails !== Boolean(row.has_api_details)
      ) {
        this.updateBundleFlags(row.id, {
          has_api_statistics: hasStats ? 1 : 0,
          has_api_pbp: hasPbp ? 1 : 0,
          has_api_details: hasDetails ? 1 : 0,
        });
        updated++;
      }
    }
    return updated;
  },

  updateBundleFlags(
    id: number,
    flags: Partial<Pick<PlayerMatchIndexRow, 'has_api_details' | 'has_api_statistics' | 'has_api_pbp' | 'rapid_event_id' | 'historical_match_id'>>,
  ): void {
    const existing = this.getById(id);
    if (!existing) return;

    const merged = {
      has_api_details: flags.has_api_details ?? existing.has_api_details,
      has_api_statistics: flags.has_api_statistics ?? existing.has_api_statistics,
      has_api_pbp: flags.has_api_pbp ?? existing.has_api_pbp,
      rapid_event_id: flags.rapid_event_id ?? existing.rapid_event_id,
      historical_match_id: flags.historical_match_id ?? existing.historical_match_id,
    };

    const completeness = computeCompleteness({
      has_csv_stats: existing.has_csv_stats === 1,
      has_api_details: merged.has_api_details === 1,
      has_api_statistics: merged.has_api_statistics === 1,
      has_api_pbp: merged.has_api_pbp === 1,
      rapid_event_id: merged.rapid_event_id,
    });

    db.prepare(
      `
      UPDATE player_match_index SET
        rapid_event_id = COALESCE(@rapid_event_id, rapid_event_id),
        historical_match_id = COALESCE(@historical_match_id, historical_match_id),
        has_api_details = @has_api_details,
        has_api_statistics = @has_api_statistics,
        has_api_pbp = @has_api_pbp,
        completeness = @completeness,
        updated_at = @updated_at
      WHERE id = @id
    `,
    ).run({
      id,
      rapid_event_id: merged.rapid_event_id,
      historical_match_id: merged.historical_match_id,
      has_api_details: merged.has_api_details,
      has_api_statistics: merged.has_api_statistics,
      has_api_pbp: merged.has_api_pbp,
      completeness,
      updated_at: new Date().toISOString(),
    });
  },
};
