import {
  getPlayerSurfaceStatsFromPool,
  cleanPlayerSearchName,
  type PlayerPoolStatsResult,
} from './historicalPlayerStats.service';
import {
  queryH2HHistoricalMatchRows,
  queryRecentHistoricalMatchRows,
  resolveTrackedPlayerByName,
} from './playerHistoricalQuery.service';
import { queryPlayerRankAtDate } from './playerMatchesValidated.service';
import { orientSetsForWinner } from '../utils/matchScoreOrientation';
import { namesLikelyMatch } from '../scripts/historicalMatchKeys';
import { parseQuarantineFlags } from '../validation/quarantineFlags';

export interface HistoricalMatchValidation {
  quarantine_flags: string;
  quarantineFlagsList: string[];
  is_historical_usable: boolean;
  is_backtest_usable: boolean;
  is_roi_usable: boolean;
  is_surface_feature_usable: boolean;
  is_raw_serve_feature_usable: boolean;
  is_rank_usable: boolean;
  is_placeholder_serve: boolean;
}

export interface HistoricalMatchRow {
  id: number;
  tour: string;
  tourney_name: string;
  surface: string;
  match_date: string;
  round_name: string | null;
  winner_name: string;
  loser_name: string;
  winner_rank: number | null;
  loser_rank: number | null;
  score: string | null;
  minutes: number | null;
  w_odds_match: number | null;
  l_odds_match: number | null;
  validation?: HistoricalMatchValidation;
}

export interface PlayerAnalysisBundle {
  playerName: string;
  cleanName: string;
  beforeDate: string;
  surface: PlayerPoolStatsResult;
  recentMatches: HistoricalMatchRow[];
  rankAtDate: number | null;
  totalLocalMatches: number;
  dataSource: 'player_matches_validated';
}

function normalizeHistoricalRow<T extends { score?: string | null }>(row: T): T {
  const oriented = orientSetsForWinner(row.score);
  if (!oriented.length) return row;
  return {
    ...row,
    score: oriented.map((set) => `${set.winnerGames}-${set.loserGames}`).join(' '),
  };
}

function mapValidationFields(row: Record<string, unknown>): HistoricalMatchValidation | undefined {
  if (row.quarantine_flags == null && row.is_historical_usable == null) return undefined;
  const flagStr = String(row.quarantine_flags || '');
  return {
    quarantine_flags: flagStr,
    quarantineFlagsList: flagStr ? parseQuarantineFlags(flagStr) : [],
    is_historical_usable: Number(row.is_historical_usable || 0) === 1,
    is_backtest_usable: Number(row.is_backtest_usable || 0) === 1,
    is_roi_usable: Number(row.is_roi_usable || 0) === 1,
    is_surface_feature_usable: Number(row.is_surface_feature_usable || 0) === 1,
    is_raw_serve_feature_usable: Number(row.is_raw_serve_feature_usable || 0) === 1,
    is_rank_usable: Number(row.is_rank_usable || 0) === 1,
    is_placeholder_serve: Number(row.is_placeholder_serve || 0) === 1,
  };
}

function mapHistoricalRows(rows: Record<string, unknown>[]): HistoricalMatchRow[] {
  return rows.map((row) => {
    const normalized = normalizeHistoricalRow(row as unknown as HistoricalMatchRow);
    const validation = mapValidationFields(row);
    return validation ? { ...normalized, validation } : normalized;
  });
}
function queryRecentMatchRows(
  playerName: string,
  beforeDate: string,
  limit: number,
  excludeMatchId?: number | null,
): HistoricalMatchRow[] {
  return mapHistoricalRows(
    queryRecentHistoricalMatchRows({ playerName, beforeDate, limit, excludeMatchId }),
  );
}

function resolveRankAtDate(
  playerName: string,
  beforeDate: string,
  excludeMatchId?: number | null,
): number | null {
  const tracked = resolveTrackedPlayerByName(playerName);
  if (tracked) {
    const direct = queryPlayerRankAtDate({
      trackedPlayerId: tracked.id,
      beforeDate,
      excludeMatchId,
    });
    if (direct != null) return direct;
  }

  const matchName = tracked?.full_name || playerName;
  const rows = queryRecentHistoricalMatchRows({
    playerName,
    beforeDate,
    limit: 60,
    excludeMatchId,
  });
  const recentRows = mapHistoricalRows(rows);

  for (const row of recentRows) {
    const validation = row.validation;
    if (validation && !validation.is_rank_usable) continue;
    if (!row.winner_rank && !row.loser_rank) continue;
    if (namesLikelyMatch(row.winner_name, matchName)) {
      return Number(row.winner_rank || 0) > 0 ? Number(row.winner_rank) : null;
    }
    if (namesLikelyMatch(row.loser_name, matchName)) {
      return Number(row.loser_rank || 0) > 0 ? Number(row.loser_rank) : null;
    }
  }
  return null;
}

export function getPlayerAnalysisBundle(options: {
  playerName: string;
  beforeDate?: string;
  yearsBack?: number;
  recentLimit?: number;
  excludeMatchId?: number | null;
}): PlayerAnalysisBundle {
  const playerName = String(options.playerName || '').trim();
  const beforeDate = options.beforeDate || new Date().toISOString().slice(0, 10);
  const yearsBack = options.yearsBack ?? 3;
  const recentLimit = Math.min(Math.max(options.recentLimit ?? 20, 4), 40);
  const cleanName = cleanPlayerSearchName(playerName);

  const surface = getPlayerSurfaceStatsFromPool({ playerName, beforeDate, yearsBack });
  const recentMatches = playerName
    ? queryRecentMatchRows(playerName, beforeDate, recentLimit, options.excludeMatchId)
    : [];
  const rankAtDate = playerName
    ? resolveRankAtDate(playerName, beforeDate, options.excludeMatchId)
    : null;
  return {
    playerName,
    cleanName,
    beforeDate,
    surface,
    recentMatches,
    rankAtDate,
    totalLocalMatches: surface.totalMatches,
    dataSource: 'player_matches_validated',
  };
}

export function getHistoricalH2HBundle(options: {
  player1: string;
  player2: string;
  beforeDate?: string;
  excludeMatchId?: number | null;
}): {
  player1: string;
  player2: string;
  beforeDate: string;
  dataSource: 'player_matches_validated';
  matches: HistoricalMatchRow[];
  player1Recent: HistoricalMatchRow[];
  player2Recent: HistoricalMatchRow[];
} {
  const player1 = String(options.player1 || '').trim();
  const player2 = String(options.player2 || '').trim();
  const beforeDate = options.beforeDate || new Date().toISOString().slice(0, 10);

  const matches = mapHistoricalRows(
    queryH2HHistoricalMatchRows({
      player1,
      player2,
      beforeDate,
      limit: 50,
      excludeMatchId: options.excludeMatchId,
    }),
  );

  return {
    player1,
    player2,
    beforeDate,
    dataSource: 'player_matches_validated',
    matches,
    player1Recent: player1
      ? mapHistoricalRows(
          queryRecentHistoricalMatchRows({
            playerName: player1,
            beforeDate,
            limit: 12,
            excludeMatchId: options.excludeMatchId,
          }),
        )
      : [],
    player2Recent: player2
      ? mapHistoricalRows(
          queryRecentHistoricalMatchRows({
            playerName: player2,
            beforeDate,
            limit: 12,
            excludeMatchId: options.excludeMatchId,
          }),
        )
      : [],
  };
}