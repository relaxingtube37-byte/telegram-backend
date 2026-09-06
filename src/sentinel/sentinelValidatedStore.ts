/**
 * In-memory mirror of player_matches_validated for read-only sentinel leakage tests.
 * Mutations apply only to this copy — production SQLite is never modified.
 */
import { db } from '../db/connection';
import { buildCsvNamePatterns, namesLikelyMatch } from '../scripts/historicalMatchKeys';
import { TrackedPlayerRepo } from '../db/repositories/trackedPlayer.repo';
import { VALIDATED_STATS_COLUMNS } from '../services/playerMatchesValidated.service';

function resolveTrackedPlayerByName(playerName: string): { id: number; full_name: string } | null {
  const query = String(playerName || '').trim();
  if (!query) return null;
  const exact = TrackedPlayerRepo.list({ activeOnly: true, limit: 500 }).find((row) =>
    namesLikelyMatch(row.full_name, query),
  );
  if (!exact) return null;
  return { id: exact.id, full_name: exact.full_name };
}

export type SentinelMutationMode =
  | 'none'
  | 'remove_future_rows'
  | 'mutate_future_rows_extreme_values'
  | 'target_zero_future_outcomes';

export type SentinelStoreRow = Record<string, unknown> & {
  pmi_id: number;
  tracked_player_id: number;
  historical_match_id: number | null;
  match_date: string;
  player_name: string;
  opponent_name: string;
  won: number;
  winner_name: string | null;
  loser_name: string | null;
  is_historical_usable: number;
};

function toStatsShape(row: SentinelStoreRow): Record<string, unknown> {
  return {
    id: row.historical_match_id,
    surface: row.surface_normalized ?? row.surface,
    surface_raw: row.surface_raw,
    match_date: row.match_date,
    winner_name: row.winner_name,
    loser_name: row.loser_name,
    w_ace: row.w_ace,
    w_df: row.w_df,
    w_svpt: row.w_svpt,
    w_1stIn: row.w_1stIn,
    w_1stWon: row.w_1stWon,
    w_2ndWon: row.w_2ndWon,
    w_bpSaved: row.w_bpSaved,
    w_bpFaced: row.w_bpFaced,
    l_ace: row.l_ace,
    l_df: row.l_df,
    l_svpt: row.l_svpt,
    l_1stIn: row.l_1stIn,
    l_1stWon: row.l_1stWon,
    l_2ndWon: row.l_2ndWon,
    l_bpSaved: row.l_bpSaved,
    l_bpFaced: row.l_bpFaced,
    w_serve_won_pct: row.w_serve_won_pct,
    l_serve_won_pct: row.l_serve_won_pct,
    w_bp_won_pct: row.w_bp_won_pct,
    l_bp_won_pct: row.l_bp_won_pct,
    quarantine_flags: row.quarantine_flags,
    is_historical_usable: row.is_historical_usable,
    is_backtest_usable: row.is_backtest_usable,
    is_roi_usable: row.is_roi_usable,
    is_surface_feature_usable: row.is_surface_feature_usable,
    is_raw_serve_feature_usable: row.is_raw_serve_feature_usable,
    is_rank_usable: row.is_rank_usable,
    is_placeholder_serve: row.is_placeholder_serve,
    player_rank: row.player_rank,
    opponent_rank: row.opponent_rank,
    w_odds_match: row.w_odds_match,
    l_odds_match: row.l_odds_match,
  };
}

function toH2HShape(row: SentinelStoreRow): Record<string, unknown> {
  const won = Number(row.won || 0) === 1;
  return {
    id: row.historical_match_id,
    tour: row.tour,
    tourney_name: row.tourney_name,
    surface: row.surface_normalized ?? row.surface,
    surface_raw: row.surface_raw,
    match_date: row.match_date,
    round_name: row.round_name,
    winner_name: row.winner_name,
    loser_name: row.loser_name,
    winner_rank: won ? row.player_rank : row.opponent_rank,
    loser_rank: won ? row.opponent_rank : row.player_rank,
    score: row.score,
    w_odds_match: row.w_odds_match,
    l_odds_match: row.l_odds_match,
    quarantine_flags: row.quarantine_flags,
    is_historical_usable: row.is_historical_usable,
    is_backtest_usable: row.is_backtest_usable,
  };
}

function cloneRow(row: SentinelStoreRow): SentinelStoreRow {
  return { ...row };
}

function isAfterCutoff(matchDate: string, cutoff: string): boolean {
  return String(matchDate).slice(0, 10) > cutoff.slice(0, 10);
}

function applyExtremeMutation(row: SentinelStoreRow): void {
  row.player_rank = 9999;
  row.opponent_rank = 9999;
  row.w_odds_match = 99;
  row.l_odds_match = 99;
  row.score = '6-0 6-0';
  row.w_ace = 500;
  row.w_df = 200;
  row.l_ace = 500;
  row.l_df = 200;
  row.w_serve_won_pct = 100;
  row.l_serve_won_pct = 0;
  row.w_bp_won_pct = 100;
  row.l_bp_won_pct = 0;
  row.w_svpt = 100;
  row.w_1stIn = 0;
  row.l_svpt = 100;
  row.l_1stIn = 0;
  row.is_placeholder_serve = 0;
  row.is_raw_serve_feature_usable = 1;
}

function applyTargetZeroMutation(row: SentinelStoreRow): void {
  row.won = 0;
  row.score = null;
  row.w_odds_match = null;
  row.l_odds_match = null;
  row.w_ace = null;
  row.w_df = null;
  row.l_ace = null;
  row.l_df = null;
  row.w_svpt = null;
  row.w_1stIn = null;
  row.l_svpt = null;
  row.l_1stIn = null;
  row.w_serve_won_pct = null;
  row.l_serve_won_pct = null;
  row.w_bp_won_pct = null;
  row.l_bp_won_pct = null;
}

export class SentinelValidatedStore {
  private rows: SentinelStoreRow[];
  private removedPmiIds = new Set<number>();

  constructor(rows: SentinelStoreRow[]) {
    this.rows = rows.map(cloneRow);
  }

  static loadFromDb(since = '2020-01-01'): SentinelValidatedStore {
    const rows = db
      .prepare(
        `
      SELECT *
      FROM player_matches_validated
      WHERE match_date >= @since
      ORDER BY match_date ASC, pmi_id ASC
    `,
      )
      .all({ since }) as SentinelStoreRow[];
    return new SentinelValidatedStore(rows);
  }

  clone(): SentinelValidatedStore {
    const copy = new SentinelValidatedStore(this.rows);
    copy.removedPmiIds = new Set(this.removedPmiIds);
    return copy;
  }

  applyMutation(cutoff: string, mode: SentinelMutationMode): void {
    if (mode === 'none') return;
    for (const row of this.rows) {
      if (!isAfterCutoff(String(row.match_date), cutoff)) continue;
      if (mode === 'remove_future_rows') {
        this.removedPmiIds.add(row.pmi_id);
        continue;
      }
      if (mode === 'mutate_future_rows_extreme_values') {
        applyExtremeMutation(row);
        continue;
      }
      if (mode === 'target_zero_future_outcomes') {
        applyTargetZeroMutation(row);
      }
    }
  }

  private activeRows(): SentinelStoreRow[] {
    return this.rows.filter((row) => !this.removedPmiIds.has(row.pmi_id));
  }

  queryHistoricalStatsRowsForPlayer(options: {
    playerName: string;
    fromDate: string;
    beforeDate: string;
    limit: number;
    excludeMatchId?: number | null;
  }): Record<string, unknown>[] {
    const tracked = resolveTrackedPlayerByName(options.playerName);
    if (tracked) {
      const rows = this.activeRows()
        .filter(
          (row) =>
            row.tracked_player_id === tracked.id &&
            String(row.match_date) >= options.fromDate &&
            String(row.match_date) < options.beforeDate &&
            Number(row.is_historical_usable || 0) === 1 &&
            (options.excludeMatchId == null ||
              Number(row.historical_match_id) !== Number(options.excludeMatchId)),
        )
        .sort((a, b) => String(b.match_date).localeCompare(String(a.match_date)))
        .slice(0, options.limit)
        .map(toStatsShape);
      return rows;
    }

    const patterns = buildCsvNamePatterns(options.playerName).sort((a, b) => b.length - a.length);
    const pattern = patterns[0];
    if (!pattern) return [];

    const token = pattern.replace(/%/g, '').toLowerCase();
    return this.activeRows()
      .filter(
        (row) =>
          String(row.match_date) >= options.fromDate &&
          String(row.match_date) < options.beforeDate &&
          Number(row.is_historical_usable || 0) === 1 &&
          (String(row.winner_name || '').toLowerCase().includes(token) ||
            String(row.loser_name || '').toLowerCase().includes(token)),
      )
      .filter(
        (row) =>
          namesLikelyMatch(String(row.winner_name || ''), options.playerName) ||
          namesLikelyMatch(String(row.loser_name || ''), options.playerName),
      )
      .sort((a, b) => String(b.match_date).localeCompare(String(a.match_date)))
      .slice(0, options.limit)
      .map(toStatsShape);
  }

  queryRecentHistoricalMatchRows(options: {
    playerName: string;
    beforeDate: string;
    limit: number;
    excludeMatchId?: number | null;
  }): Record<string, unknown>[] {
    return this.queryHistoricalStatsRowsForPlayer({
      playerName: options.playerName,
      fromDate: '1900-01-01',
      beforeDate: options.beforeDate,
      limit: options.limit,
      excludeMatchId: options.excludeMatchId,
    });
  }

  queryH2HHistoricalMatchRows(options: {
    player1: string;
    player2: string;
    beforeDate: string;
    limit?: number;
    excludeMatchId?: number | null;
  }): Record<string, unknown>[] {
    const limit = options.limit ?? 50;
    const excludeId =
      options.excludeMatchId != null ? Number(options.excludeMatchId) : null;
    const tracked1 = resolveTrackedPlayerByName(options.player1);
    const tracked2 = resolveTrackedPlayerByName(options.player2);

    if (tracked1 && tracked2) {
      const idsForP2 = new Set(
        this.activeRows()
          .filter(
            (row) =>
              row.tracked_player_id === tracked2.id && String(row.match_date) < options.beforeDate,
          )
          .map((row) => row.historical_match_id),
      );

      return this.activeRows()
        .filter(
          (row) =>
            row.tracked_player_id === tracked1.id &&
            String(row.match_date) < options.beforeDate &&
            Number(row.is_historical_usable || 0) === 1 &&
            idsForP2.has(row.historical_match_id) &&
            (excludeId == null || Number(row.historical_match_id) !== excludeId),
        )
        .sort((a, b) => String(b.match_date).localeCompare(String(a.match_date)))
        .slice(0, limit)
        .map(toH2HShape);
    }

    const p1 = options.player1.split(/\s+/).pop()?.toLowerCase() || '';
    const p2 = options.player2.split(/\s+/).pop()?.toLowerCase() || '';
    return this.activeRows()
      .filter(
        (row) =>
          String(row.match_date) < options.beforeDate &&
          Number(row.is_historical_usable || 0) === 1 &&
          (excludeId == null || Number(row.historical_match_id) !== excludeId) &&
          (String(row.winner_name || '').toLowerCase().includes(p1) ||
            String(row.loser_name || '').toLowerCase().includes(p1)) &&
          (String(row.winner_name || '').toLowerCase().includes(p2) ||
            String(row.loser_name || '').toLowerCase().includes(p2)),
      )
      .filter(
        (row) =>
          (namesLikelyMatch(String(row.winner_name || ''), options.player1) ||
            namesLikelyMatch(String(row.loser_name || ''), options.player1)) &&
          (namesLikelyMatch(String(row.winner_name || ''), options.player2) ||
            namesLikelyMatch(String(row.loser_name || ''), options.player2)),
      )
      .sort((a, b) => String(b.match_date).localeCompare(String(a.match_date)))
      .slice(0, limit)
      .map(toH2HShape);
  }
}

export interface SentinelTargetMatch {
  matchId: number;
  matchDate: string;
  homePlayer: string;
  awayPlayer: string;
  homeRank: number | null;
  awayRank: number | null;
}

export function listSentinelTargetMatches(options: {
  cutoff: string;
  since?: string;
  playerFilter?: string;
  matchFilter?: number;
  limit?: number;
}): SentinelTargetMatch[] {
  const since = options.since || '2020-01-01';
  const limit = options.limit ?? 100;

  let sql = `
    SELECT
      v.historical_match_id AS match_id,
      v.match_date,
      v.winner_name,
      v.loser_name,
      MAX(CASE WHEN v.won = 1 THEN v.player_rank ELSE v.opponent_rank END) AS winner_rank,
      MAX(CASE WHEN v.won = 0 THEN v.player_rank ELSE v.opponent_rank END) AS loser_rank
    FROM player_matches_validated v
    WHERE v.match_date <= @cutoff
      AND v.match_date >= @since
      AND v.is_historical_usable = 1
      AND v.historical_match_id IS NOT NULL
  `;
  const params: Record<string, unknown> = { cutoff: options.cutoff, since };

  if (options.matchFilter != null) {
    sql += ' AND v.historical_match_id = @matchId';
    params.matchId = options.matchFilter;
  }
  if (options.playerFilter) {
    sql += ' AND (v.player_name LIKE @player OR v.opponent_name LIKE @player)';
    params.player = `%${options.playerFilter}%`;
  }

  sql += `
    GROUP BY v.historical_match_id
    ORDER BY v.match_date DESC
    LIMIT @limit
  `;
  params.limit = limit;

  const rows = db.prepare(sql).all(params) as Array<{
    match_id: number;
    match_date: string;
    winner_name: string;
    loser_name: string;
    winner_rank: number | null;
    loser_rank: number | null;
  }>;

  return rows.map((row) => ({
    matchId: Number(row.match_id),
    matchDate: String(row.match_date).slice(0, 10),
    homePlayer: row.winner_name,
    awayPlayer: row.loser_name,
    homeRank: row.winner_rank != null ? Number(row.winner_rank) : null,
    awayRank: row.loser_rank != null ? Number(row.loser_rank) : null,
  }));
}

/** Sanity check: store baseline matches DB for a sample query. */
export function verifyStoreParity(store: SentinelValidatedStore, playerName: string, beforeDate: string): boolean {
  const tracked = resolveTrackedPlayerByName(playerName);
  if (!tracked) return true;
  const fromDb = db
    .prepare(
      `
    SELECT ${VALIDATED_STATS_COLUMNS}
    FROM player_matches_validated v
    WHERE v.tracked_player_id = @id AND v.match_date < @before AND v.is_historical_usable = 1
    ORDER BY v.match_date DESC LIMIT 5
  `,
    )
    .all({ id: tracked.id, before: beforeDate }) as Record<string, unknown>[];
  const fromStore = store.queryHistoricalStatsRowsForPlayer({
    playerName,
    fromDate: '1900-01-01',
    beforeDate,
    limit: 5,
  });
  return JSON.stringify(fromDb.map((r) => r.id)) === JSON.stringify(fromStore.map((r) => r.id));
}
