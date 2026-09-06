import { db } from '../db/connection';
import { parseQuarantineFlags, type QuarantineFlag } from '../validation/quarantineFlags';
import type { CanonicalSurface } from '../validation/surfaceNormalizer';

export interface ValidatedPlayerMatchRow {
  pmi_id: number;
  tracked_player_id: number;
  historical_match_id: number | null;
  match_fingerprint: string;
  match_date: string;
  opponent_name: string;
  won: number;
  player_name: string;
  player_tour: string;
  tour: string | null;
  tourney_name: string | null;
  round_name: string | null;
  winner_name: string | null;
  loser_name: string | null;
  score: string | null;
  player_rank: number | null;
  opponent_rank: number | null;
  surface_raw: string | null;
  surface_normalized: CanonicalSurface;
  w_odds_match: number | null;
  l_odds_match: number | null;
  w_ace: number | null;
  w_df: number | null;
  w_svpt: number | null;
  w_1stIn: number | null;
  w_1stWon: number | null;
  w_2ndWon: number | null;
  w_bpSaved: number | null;
  w_bpFaced: number | null;
  l_ace: number | null;
  l_df: number | null;
  l_svpt: number | null;
  l_1stIn: number | null;
  l_1stWon: number | null;
  l_2ndWon: number | null;
  l_bpSaved: number | null;
  l_bpFaced: number | null;
  w_serve_won_pct: number | null;
  l_serve_won_pct: number | null;
  w_bp_won_pct: number | null;
  l_bp_won_pct: number | null;
  quarantine_flags: string;
  is_historical_usable: number;
  is_backtest_usable: number;
  is_roi_usable: number;
  is_surface_feature_usable: number;
  is_raw_serve_feature_usable: number;
  is_rank_usable: number;
  is_placeholder_serve: number;
}

export const VALIDATED_STATS_COLUMNS = `
  v.historical_match_id AS id,
  v.surface_normalized AS surface,
  v.surface_raw,
  v.match_date,
  v.winner_name,
  v.loser_name,
  v.score,
  v.w_ace, v.w_df, v.w_svpt, v.w_1stIn, v.w_1stWon, v.w_2ndWon,
  v.w_bpSaved, v.w_bpFaced,
  v.l_ace, v.l_df, v.l_svpt, v.l_1stIn, v.l_1stWon, v.l_2ndWon,
  v.l_bpSaved, v.l_bpFaced,
  v.w_serve_won_pct, v.l_serve_won_pct,
  v.w_bp_won_pct, v.l_bp_won_pct,
  v.quarantine_flags,
  v.is_historical_usable,
  v.is_backtest_usable,
  v.is_roi_usable,
  v.is_surface_feature_usable,
  v.is_raw_serve_feature_usable,
  v.is_rank_usable,
  v.is_placeholder_serve,
  v.player_rank,
  v.opponent_rank,
  v.w_odds_match,
  v.l_odds_match
`;

export function enrichValidatedRow(row: Record<string, unknown>): ValidatedPlayerMatchRow & {
  quarantineFlagsList: QuarantineFlag[];
} {
  const flags = parseQuarantineFlags(String(row.quarantine_flags || ''));
  return {
    ...(row as unknown as ValidatedPlayerMatchRow),
    quarantineFlagsList: flags,
  };
}

export function queryValidatedRowsForPlayer(options: {
  trackedPlayerId: number;
  fromDate: string;
  beforeDate: string;
  limit: number;
  excludeMatchId?: number | null;
  requireHistoricalUsable?: boolean;
}): Array<ValidatedPlayerMatchRow & { quarantineFlagsList: QuarantineFlag[] }> {
  const usableClause = options.requireHistoricalUsable === false ? '' : 'AND v.is_historical_usable = 1';
  const excludeClause =
    options.excludeMatchId != null ? 'AND v.historical_match_id != @excludeMatchId' : '';

  const rows = db
    .prepare(
      `
    SELECT ${VALIDATED_STATS_COLUMNS}
    FROM player_matches_validated v
    WHERE v.tracked_player_id = @trackedId
      AND v.match_date >= @fromDate
      AND v.match_date < @beforeDate
      ${usableClause}
      ${excludeClause}
    ORDER BY v.match_date DESC
    LIMIT @limit
  `,
    )
    .all({
      trackedId: options.trackedPlayerId,
      fromDate: options.fromDate,
      beforeDate: options.beforeDate,
      limit: options.limit,
      excludeMatchId: options.excludeMatchId ?? null,
    }) as Record<string, unknown>[];

  return rows.map(enrichValidatedRow);
}

export function queryValidatedRecentRows(options: {
  trackedPlayerId: number;
  beforeDate: string;
  limit: number;
  excludeMatchId?: number | null;
}): Array<ValidatedPlayerMatchRow & { quarantineFlagsList: QuarantineFlag[] }> {
  return queryValidatedRowsForPlayer({
    trackedPlayerId: options.trackedPlayerId,
    fromDate: '1900-01-01',
    beforeDate: options.beforeDate,
    limit: options.limit,
    excludeMatchId: options.excludeMatchId,
    requireHistoricalUsable: true,
  });
}

/** Closest usable rank strictly before `beforeDate` (point-in-time). */
export function queryPlayerRankAtDate(options: {
  trackedPlayerId: number;
  beforeDate: string;
  excludeMatchId?: number | null;
}): number | null {
  const excludeClause =
    options.excludeMatchId != null ? 'AND v.historical_match_id != @excludeMatchId' : '';

  const row = db
    .prepare(
      `
    SELECT v.player_rank
    FROM player_matches_validated v
    WHERE v.tracked_player_id = @trackedId
      AND v.match_date < @beforeDate
      AND v.is_historical_usable = 1
      AND v.is_rank_usable = 1
      AND v.player_rank IS NOT NULL
      AND v.player_rank > 0
      ${excludeClause}
    ORDER BY v.match_date DESC
    LIMIT 1
  `,
    )
    .get({
      trackedId: options.trackedPlayerId,
      beforeDate: options.beforeDate,
      excludeMatchId: options.excludeMatchId ?? null,
    }) as { player_rank: number } | undefined;

  const rank = row?.player_rank;
  return rank != null && Number(rank) > 0 ? Number(rank) : null;
}

export function getValidatedLayerAuditSummary(since = '2024-01-01'): Record<string, number> {
  return db
    .prepare(
      `
    SELECT
      COUNT(*) AS total_rows,
      SUM(is_historical_usable) AS historical_usable,
      SUM(is_backtest_usable) AS backtest_usable,
      SUM(is_roi_usable) AS roi_usable,
      SUM(is_surface_feature_usable) AS surface_usable,
      SUM(is_raw_serve_feature_usable) AS raw_serve_usable,
      SUM(is_rank_usable) AS rank_usable,
      SUM(is_placeholder_serve) AS placeholder_serve_rows
    FROM player_matches_validated
    WHERE match_date >= @since
  `,
    )
    .get({ since }) as Record<string, number>;
}
