import { db } from '../db/connection';
import { buildCsvNamePatterns, namesLikelyMatch } from '../scripts/historicalMatchKeys';
import { TrackedPlayerRepo } from '../db/repositories/trackedPlayer.repo';
import {
  queryValidatedRecentRows,
  queryValidatedRowsForPlayer,
  VALIDATED_STATS_COLUMNS,
} from './playerMatchesValidated.service';

function getSentinelStore() {
  // Lazy load avoids circular init when scripts import sentinel modules alongside db connection.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../sentinel/sentinelRowProvider') as typeof import('../sentinel/sentinelRowProvider');
  return mod.getActiveSentinelStore();
}

export interface ResolvedTrackedPlayer {
  id: number;
  full_name: string;
}

export function resolveTrackedPlayerByName(playerName: string): ResolvedTrackedPlayer | null {
  const query = String(playerName || '').trim();
  if (!query) return null;

  const exact = TrackedPlayerRepo.list({ activeOnly: true, limit: 500 }).find(
    (row) => namesLikelyMatch(row.full_name, query),
  );
  if (!exact) return null;
  return { id: exact.id, full_name: exact.full_name };
}

/** @deprecated Use VALIDATED_STATS_COLUMNS via player_matches_validated view */
export const HISTORICAL_MATCH_STATS_COLUMNS = VALIDATED_STATS_COLUMNS;

export function extractSurnameToken(name: string): string {
  const clean = (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);

  const substantialTokens = clean.filter((t) => t.length >= 2);
  if (substantialTokens.length > 0) {
    const trimmed = (name || '').trim();
    if (/^[A-Za-z]{2,}\s+[A-Z](\.|\s|$)/i.test(trimmed)) {
      return substantialTokens[0];
    }
    return substantialTokens[substantialTokens.length - 1];
  }
  return clean[0] || '';
}

/**
 * Historical stats rows — queried directly from gold_matches_validated and gold_player_history_3y.
 */
export function queryHistoricalStatsRowsForPlayer(options: {
  playerName: string;
  fromDate: string;
  beforeDate: string;
  limit: number;
  excludeMatchId?: number | null;
}): Record<string, unknown>[] {
  const sentinelStore = getSentinelStore();
  if (sentinelStore) {
    return sentinelStore.queryHistoricalStatsRowsForPlayer(options);
  }

  const query = String(options.playerName || '').trim();
  if (!query) return [];

  const lastName = extractSurnameToken(query) || query.toLowerCase();

  const excludeClause = options.excludeMatchId != null ? 'AND gm.rapid_event_id != @excludeMatchId' : '';
  const excludeClauseG3y = options.excludeMatchId != null ? 'AND g3y.rapid_event_id != @excludeMatchId' : '';

  // 1. Matches from gold_matches_validated (2024-2026 singles)
  const goldRows = db
    .prepare(
      `
    SELECT
      gm.rapid_event_id AS id,
      gm.surface,
      gm.surface_raw,
      gm.match_date,
      gm.winner_name,
      gm.loser_name,
      gm.score,
      gm.w_svpt, gm.w_1stIn, gm.w_1stWon, gm.w_2ndWon, gm.w_bpSaved, gm.w_bpFaced,
      gm.l_svpt, gm.l_1stIn, gm.l_1stWon, gm.l_2ndWon, gm.l_bpSaved, gm.l_bpFaced,
      1 AS is_raw_serve_feature_usable,
      1 AS is_historical_usable,
      1 AS is_surface_feature_usable,
      1 AS is_rank_usable,
      1 AS is_backtest_usable,
      1 AS is_roi_usable,
      0 AS is_placeholder_serve,
      gm.winner_rank,
      gm.loser_rank,
      CASE WHEN lower(gm.winner_name) LIKE @pattern THEN gm.winner_rank ELSE gm.loser_rank END AS player_rank,
      CASE WHEN lower(gm.winner_name) LIKE @pattern THEN gm.loser_rank ELSE gm.winner_rank END AS opponent_rank,
      gm.winner_odds AS w_odds_match,
      gm.loser_odds AS l_odds_match,
      '' AS quarantine_flags
    FROM gold_matches_validated gm
    WHERE gm.match_date >= @fromDate
      AND gm.match_date < @beforeDate
      AND gm.is_non_singles = 0
      ${excludeClause}
      AND (
        lower(gm.winner_name) LIKE @pattern OR lower(gm.loser_name) LIKE @pattern
      )
    ORDER BY gm.match_date DESC
    LIMIT @limit
  `,
    )
    .all({
      fromDate: options.fromDate,
      beforeDate: options.beforeDate,
      pattern: `%${lastName}%`,
      excludeMatchId: options.excludeMatchId ?? null,
      limit: Math.max(options.limit * 2, 50),
    }) as Record<string, unknown>[];

  // 2. Prior history from gold_player_history_3y (where is_history_only = 1, years 2021-2023)
  const priorRows = db
    .prepare(
      `
    SELECT
      g3y.canonical_match_id AS id,
      g3y.surface,
      g3y.surface AS surface_raw,
      g3y.match_date,
      CASE WHEN g3y.won = 1 THEN g3y.player_name ELSE g3y.opponent_name END AS winner_name,
      CASE WHEN g3y.won = 0 THEN g3y.player_name ELSE g3y.opponent_name END AS loser_name,
      g3y.score,
      CASE WHEN g3y.won = 1 THEN g3y.svpt ELSE 0 END AS w_svpt,
      CASE WHEN g3y.won = 1 THEN g3y.first_in ELSE 0 END AS w_1stIn,
      CASE WHEN g3y.won = 1 THEN g3y.first_won ELSE 0 END AS w_1stWon,
      CASE WHEN g3y.won = 1 THEN g3y.second_won ELSE 0 END AS w_2ndWon,
      CASE WHEN g3y.won = 1 THEN g3y.bp_saved ELSE 0 END AS w_bpSaved,
      CASE WHEN g3y.won = 1 THEN g3y.bp_faced ELSE 0 END AS w_bpFaced,
      CASE WHEN g3y.won = 0 THEN g3y.svpt ELSE 0 END AS l_svpt,
      CASE WHEN g3y.won = 0 THEN g3y.first_in ELSE 0 END AS l_1stIn,
      CASE WHEN g3y.won = 0 THEN g3y.first_won ELSE 0 END AS l_1stWon,
      CASE WHEN g3y.won = 0 THEN g3y.second_won ELSE 0 END AS l_2ndWon,
      CASE WHEN g3y.won = 0 THEN g3y.bp_saved ELSE 0 END AS l_bpSaved,
      CASE WHEN g3y.won = 0 THEN g3y.bp_faced ELSE 0 END AS l_bpFaced,
      1 AS is_raw_serve_feature_usable,
      1 AS is_historical_usable,
      1 AS is_surface_feature_usable,
      0 AS is_rank_usable,
      1 AS is_backtest_usable,
      1 AS is_roi_usable,
      0 AS is_placeholder_serve,
      NULL AS winner_rank,
      NULL AS loser_rank,
      NULL AS player_rank,
      NULL AS opponent_rank,
      NULL AS w_odds_match,
      NULL AS l_odds_match,
      '' AS quarantine_flags
    FROM gold_player_history_3y g3y
    WHERE g3y.is_history_only = 1
      AND g3y.match_date >= @fromDate
      AND g3y.match_date < @beforeDate
      ${excludeClauseG3y}
      AND g3y.clean_player_name LIKE @pattern
    ORDER BY g3y.match_date DESC
    LIMIT @limit
  `,
    )
    .all({
      fromDate: options.fromDate,
      beforeDate: options.beforeDate,
      pattern: `%${lastName}%`,
      excludeMatchId: options.excludeMatchId ?? null,
      limit: Math.max(options.limit * 2, 50),
    }) as Record<string, unknown>[];

  const all = [...goldRows, ...priorRows]
    .filter(
      (row) =>
        namesLikelyMatch(String(row.winner_name || ''), options.playerName) ||
        namesLikelyMatch(String(row.loser_name || ''), options.playerName),
    )
    .sort((a, b) => String(b.match_date).localeCompare(String(a.match_date)))
    .slice(0, options.limit);

  return all;
}

export function queryRecentHistoricalMatchRows(options: {
  playerName: string;
  beforeDate: string;
  limit: number;
  excludeMatchId?: number | null;
}): Record<string, unknown>[] {
  const sentinelStore = getSentinelStore();
  if (sentinelStore) {
    return sentinelStore.queryRecentHistoricalMatchRows(options);
  }

  return queryHistoricalStatsRowsForPlayer({
    playerName: options.playerName,
    fromDate: '1900-01-01',
    beforeDate: options.beforeDate,
    limit: options.limit,
    excludeMatchId: options.excludeMatchId,
  });
}

export function queryH2HHistoricalMatchRows(options: {
  player1: string;
  player2: string;
  beforeDate: string;
  limit?: number;
  excludeMatchId?: number | null;
}): Record<string, unknown>[] {
  const sentinelStore = getSentinelStore();
  if (sentinelStore) {
    return sentinelStore.queryH2HHistoricalMatchRows(options);
  }

  const p1Last = extractSurnameToken(options.player1) || options.player1.toLowerCase();
  const p2Last = extractSurnameToken(options.player2) || options.player2.toLowerCase();
  const limit = options.limit ?? 50;

  const excludeClause = options.excludeMatchId != null ? 'AND gm.rapid_event_id != @excludeMatchId' : '';
  const excludeClauseG3y = options.excludeMatchId != null ? 'AND g3y.rapid_event_id != @excludeMatchId' : '';

  const goldRows = db
    .prepare(
      `
    SELECT
      gm.rapid_event_id AS id,
      gm.tour,
      gm.tourney_name,
      gm.surface,
      gm.surface_raw,
      gm.match_date,
      gm.round_name,
      gm.winner_name,
      gm.loser_name,
      gm.winner_rank,
      gm.loser_rank,
      gm.score,
      gm.winner_odds AS w_odds_match,
      gm.loser_odds AS l_odds_match,
      '' AS quarantine_flags,
      1 AS is_historical_usable,
      1 AS is_backtest_usable
    FROM gold_matches_validated gm
    WHERE gm.match_date < @beforeDate
      AND gm.is_non_singles = 0
      ${excludeClause}
      AND (
        (lower(gm.winner_name) LIKE @p1 OR lower(gm.loser_name) LIKE @p1)
        AND
        (lower(gm.winner_name) LIKE @p2 OR lower(gm.loser_name) LIKE @p2)
      )
    ORDER BY gm.match_date DESC
    LIMIT @limit
  `,
    )
    .all({
      beforeDate: options.beforeDate,
      p1: `%${p1Last}%`,
      p2: `%${p2Last}%`,
      excludeMatchId: options.excludeMatchId ?? null,
      limit: limit * 2,
    }) as Record<string, unknown>[];

  const priorRows = db
    .prepare(
      `
    SELECT
      g3y.canonical_match_id AS id,
      'ATP' AS tour,
      'Tour' AS tourney_name,
      g3y.surface,
      g3y.surface AS surface_raw,
      g3y.match_date,
      'Main' AS round_name,
      CASE WHEN g3y.won = 1 THEN g3y.player_name ELSE g3y.opponent_name END AS winner_name,
      CASE WHEN g3y.won = 0 THEN g3y.player_name ELSE g3y.opponent_name END AS loser_name,
      NULL AS winner_rank,
      NULL AS loser_rank,
      g3y.score,
      NULL AS w_odds_match,
      NULL AS l_odds_match,
      '' AS quarantine_flags,
      1 AS is_historical_usable,
      1 AS is_backtest_usable
    FROM gold_player_history_3y g3y
    WHERE g3y.is_history_only = 1
      AND g3y.match_date < @beforeDate
      ${excludeClauseG3y}
      AND (
        (g3y.clean_player_name LIKE @p1 AND lower(g3y.opponent_name) LIKE @p2)
        OR
        (g3y.clean_player_name LIKE @p2 AND lower(g3y.opponent_name) LIKE @p1)
      )
    ORDER BY g3y.match_date DESC
    LIMIT @limit
  `,
    )
    .all({
      beforeDate: options.beforeDate,
      p1: `%${p1Last}%`,
      p2: `%${p2Last}%`,
      excludeMatchId: options.excludeMatchId ?? null,
      limit: limit * 2,
    }) as Record<string, unknown>[];

  const all = [...goldRows, ...priorRows]
    .filter(
      (row) =>
        (namesLikelyMatch(String(row.winner_name || ''), options.player1) ||
          namesLikelyMatch(String(row.loser_name || ''), options.player1)) &&
        (namesLikelyMatch(String(row.winner_name || ''), options.player2) ||
          namesLikelyMatch(String(row.loser_name || ''), options.player2)),
    )
    .slice(0, limit);

  return all;
}
