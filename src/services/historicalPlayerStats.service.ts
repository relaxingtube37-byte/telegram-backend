import { db } from '../db/connection';
import { namesLikelyMatch } from '../scripts/historicalMatchKeys';
import { assessServeRowQuality, extractPlayerServeSide } from '../features/serveRowQuality';
import { normalizeSurfaceLabel } from '../validation/surfaceNormalizer';
import {
  assertSyntheticBreakNotUsed,
  assertSyntheticServeNotUsed,
} from '../validation/syntheticBlocker';
import {
  queryHistoricalStatsRowsForPlayer,
  resolveTrackedPlayerByName,
} from './playerHistoricalQuery.service';

export interface AggregatedSurfaceStats {
  surface: string;
  groundType: string;
  matches: number;
  wins: number;
  losses: number;
  effectiveMatches?: number;
  effectiveWins?: number;
  effectiveLosses?: number;
  decayHalfLifeDays?: number;
  aces: number;
  doubleFaults: number;
  servePointsTotal: number;
  firstServeIn: number;
  firstServeWon: number;
  secondServeWon: number;
  secondServeTotal: number;
  breakPointsSaved: number;
  breakPointsFaced: number;
  breakPointsScored: number;
  breakPointsTotal: number;
  firstServeTotal: number;
  firstServePointsScored: number;
  winnersTotal: number;
  unforcedErrorsTotal: number;
  source: 'sqlite_historical_pool';
}

export interface PlayerPoolStatsResult {
  playerName: string;
  cleanName: string;
  beforeDate: string;
  yearsBack: number;
  totalMatches: number;
  matchesWithServeStats: number;
  surfaces: AggregatedSurfaceStats[];
}

type DbMatchRow = {
  surface: string;
  surface_raw?: string | null;
  match_date: string;
  winner_name: string;
  loser_name: string;
  is_raw_serve_feature_usable?: number | null;
  is_placeholder_serve?: number | null;
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
  w_serve_won_pct?: number | null;
  l_serve_won_pct?: number | null;
  w_bp_won_pct?: number | null;
  l_bp_won_pct?: number | null;
};

export function cleanPlayerSearchName(name: string): string {
  if (!name) return '';
  const tracked = resolveTrackedPlayerByName(name);
  if (tracked) {
    const tokens = tracked.full_name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[\s-]+/)
      .filter((t) => t.length > 0);
    return tokens[tokens.length - 1] || tracked.full_name;
  }

  let normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  normalized = normalized.replace(/^[A-Z]\.\s*/i, '');
  normalized = normalized.replace(/\(.*\)/, '').replace(/\[.*\]/, '').trim();
  const tokens = normalized.split(/[\s-]+/).filter((t) => t.length > 0);
  if (tokens.length >= 2) {
    return tokens[tokens.length - 1];
  }
  return tokens[0] || normalized;
}

function surfaceNorm(surface: string, surfaceRaw?: string | null): string {
  return normalizeSurfaceLabel(surfaceRaw || surface);
}

function toGroundType(surface: string): string {
  const norm = surfaceNorm(surface);
  if (norm === 'Clay') return 'Red clay outdoor';
  if (norm === 'Grass') return 'Grass outdoor';
  if (norm === 'Carpet/Indoor') return 'Hardcourt indoor';
  if (norm === 'Unknown') return 'Hardcourt outdoor';
  return 'Hardcourt outdoor';
}

function playerWonMatch(row: DbMatchRow, playerName: string): boolean {
  return namesLikelyMatch(row.winner_name, playerName);
}

function playerLostMatch(row: DbMatchRow, playerName: string): boolean {
  return namesLikelyMatch(row.loser_name, playerName);
}

/**
 * @deprecated Blocked in validated historical pipeline — throws if called.
 */
function estimateServeCounts(_row: DbMatchRow, _isWinner: boolean): never {
  assertSyntheticServeNotUsed();
}

/**
 * @deprecated Blocked in validated historical pipeline — throws if called.
 */
function estimateBreakPoints(_row: DbMatchRow, _isWinner: boolean): never {
  assertSyntheticBreakNotUsed();
}

/** Truth-preserving: only raw counts when validated row allows; never imputes. */
function extractTruthPreservingContribution(row: DbMatchRow, isWinner: boolean) {
  const aces = Number(isWinner ? row.w_ace || 0 : row.l_ace || 0);
  const doubleFaults = Number(isWinner ? row.w_df || 0 : row.l_df || 0);

  const rawServeOk = Number(row.is_raw_serve_feature_usable || 0) === 1;
  if (!rawServeOk) {
    return {
      aces,
      doubleFaults,
      servePointsTotal: 0,
      firstServeIn: 0,
      firstServeWon: 0,
      secondServeWon: 0,
      secondServeTotal: 0,
      breakPointsSaved: 0,
      breakPointsFaced: 0,
      breakPointsScored: 0,
      breakPointsTotal: 0,
      firstServeTotal: 0,
      firstServePointsScored: 0,
    };
  }

  if (isWinner) {
    const svpt = Number(row.w_svpt || 0);
    const firstIn = Number(row.w_1stIn || 0);
    const firstWon = Number(row.w_1stWon || 0);
    const secondWon = Number(row.w_2ndWon || 0);
    const secondServes = Math.max(0, svpt - firstIn);
    const bpSaved = Number(row.w_bpSaved || 0);
    const bpFaced = Number(row.w_bpFaced || 0);

    const oppBpFaced = Number(row.l_bpFaced || 0);
    const oppBpSaved = Number(row.l_bpSaved || 0);
    const bpWon = oppBpFaced > 0 ? Math.max(0, oppBpFaced - oppBpSaved) : 0;

    return {
      aces,
      doubleFaults,
      servePointsTotal: svpt,
      firstServeIn: firstIn,
      firstServeWon: firstWon,
      secondServeWon: secondWon,
      secondServeTotal: secondServes,
      breakPointsSaved: bpSaved,
      breakPointsFaced: bpFaced,
      breakPointsScored: bpWon,
      breakPointsTotal: oppBpFaced,
      firstServeTotal: firstIn,
      firstServePointsScored: firstWon,
    };
  }

  const svpt = Number(row.l_svpt || 0);
  const firstIn = Number(row.l_1stIn || 0);
  const firstWon = Number(row.l_1stWon || 0);
  const secondWon = Number(row.l_2ndWon || 0);
  const secondServes = Math.max(0, svpt - firstIn);
  const bpSaved = Number(row.l_bpSaved || 0);
  const bpFaced = Number(row.l_bpFaced || 0);

  const oppBpFaced = Number(row.w_bpFaced || 0);
  const oppBpSaved = Number(row.w_bpSaved || 0);
  const bpWon = oppBpFaced > 0 ? Math.max(0, oppBpFaced - oppBpSaved) : 0;

  return {
    aces,
    doubleFaults,
    servePointsTotal: svpt,
    firstServeIn: firstIn,
    firstServeWon: firstWon,
    secondServeWon: secondWon,
    secondServeTotal: secondServes,
    breakPointsSaved: bpSaved,
    breakPointsFaced: bpFaced,
    breakPointsScored: bpWon,
    breakPointsTotal: oppBpFaced,
    firstServeTotal: firstIn,
    firstServePointsScored: firstWon,
  };
}

export interface AggregateSurfaceStatsOptions {
  /** When true, placeholder serve rows skip raw-count aggregation (default true in validated pipeline) */
  excludePlaceholderFromRawCounts?: boolean;
  /** Cutoff date for recency decay calculation (YYYY-MM-DD). If provided, calculates decay-weighted counts */
  beforeDate?: string;
  /** Half-life in days for exponential decay (default 365) */
  decayHalfLifeDays?: number;
}

export function aggregatePlayerSurfaceStatsFromRows(
  rows: DbMatchRow[],
  playerName: string,
  options?: AggregateSurfaceStatsOptions,
): AggregatedSurfaceStats[] {
  const excludePlaceholder = options?.excludePlaceholderFromRawCounts !== false;
  const beforeDate = options?.beforeDate;
  const halfLifeDays = options?.decayHalfLifeDays ?? 365;
  const buckets = new Map<string, AggregatedSurfaceStats>();

  for (const row of rows) {
    const won = playerWonMatch(row, playerName);
    const lost = playerLostMatch(row, playerName);
    if (!won && !lost) continue;

    const surface = surfaceNorm(row.surface, row.surface_raw);
    // Unknown surface rows are excluded from L2 aggregate KPI buckets (reported separately in audit).
    if (surface === 'Unknown') continue;
    const bucket =
      buckets.get(surface) ||
      ({
        surface,
        groundType: toGroundType(surface),
        matches: 0,
        wins: 0,
        losses: 0,
        effectiveMatches: 0,
        effectiveWins: 0,
        effectiveLosses: 0,
        decayHalfLifeDays: halfLifeDays,
        aces: 0,
        doubleFaults: 0,
        servePointsTotal: 0,
        firstServeIn: 0,
        firstServeWon: 0,
        secondServeWon: 0,
        secondServeTotal: 0,
        breakPointsSaved: 0,
        breakPointsFaced: 0,
        breakPointsScored: 0,
        breakPointsTotal: 0,
        firstServeTotal: 0,
        firstServePointsScored: 0,
        winnersTotal: 0,
        unforcedErrorsTotal: 0,
        source: 'sqlite_historical_pool',
      } as AggregatedSurfaceStats);

    let weight = 1.0;
    if (beforeDate && row.match_date) {
      const matchTime = new Date(row.match_date.slice(0, 10)).getTime();
      const asOfTime = new Date(beforeDate.slice(0, 10)).getTime();
      if (!isNaN(matchTime) && !isNaN(asOfTime) && asOfTime > matchTime) {
        const elapsedDays = Math.max(0, (asOfTime - matchTime) / (1000 * 60 * 60 * 24));
        weight = Math.pow(0.5, elapsedDays / halfLifeDays);
      }
    }

    bucket.matches += 1;
    if (won) bucket.wins += 1;
    else bucket.losses += 1;

    bucket.effectiveMatches = Math.round(((bucket.effectiveMatches || 0) + weight) * 100) / 100;
    if (won) bucket.effectiveWins = Math.round(((bucket.effectiveWins || 0) + weight) * 100) / 100;
    else bucket.effectiveLosses = Math.round(((bucket.effectiveLosses || 0) + weight) * 100) / 100;

    const serveQuality = assessServeRowQuality(extractPlayerServeSide(row, won));
    const skipRawServeCounts =
      excludePlaceholder &&
      (serveQuality.isPlaceholder || Number(row.is_raw_serve_feature_usable || 0) !== 1);

    const contrib = extractTruthPreservingContribution(row, won);
    bucket.aces += contrib.aces;
    bucket.doubleFaults += contrib.doubleFaults;
    if (!skipRawServeCounts) {
      bucket.servePointsTotal += contrib.servePointsTotal;
      bucket.firstServeIn += contrib.firstServeIn;
      bucket.firstServeWon += contrib.firstServeWon;
      bucket.secondServeWon += contrib.secondServeWon;
      bucket.secondServeTotal += contrib.secondServeTotal;
      bucket.breakPointsSaved += contrib.breakPointsSaved;
      bucket.breakPointsFaced += contrib.breakPointsFaced;
      bucket.breakPointsScored += contrib.breakPointsScored;
      bucket.breakPointsTotal += contrib.breakPointsTotal;
      bucket.firstServeTotal += contrib.firstServeTotal;
      bucket.firstServePointsScored += contrib.firstServePointsScored;
    }

    buckets.set(surface, bucket);
  }

  return Array.from(buckets.values()).sort((a, b) => b.matches - a.matches);
}

export function getPlayerSurfaceStatsFromPool(options: {
  playerName: string;
  beforeDate?: string;
  yearsBack?: number;
  limit?: number;
}): PlayerPoolStatsResult {
  const playerName = String(options.playerName || '').trim();
  const cleanName = cleanPlayerSearchName(playerName);
  const beforeDate = options.beforeDate || new Date().toISOString().slice(0, 10);
  const yearsBack = Math.max(1, Math.min(options.yearsBack || 3, 8));
  const fromDate = new Date(`${beforeDate}T00:00:00.000Z`);
  fromDate.setUTCFullYear(fromDate.getUTCFullYear() - yearsBack);
  const fromIso = fromDate.toISOString().slice(0, 10);
  const limit = options.limit || 500;

  const tracked = resolveTrackedPlayerByName(playerName);
  const matchName = tracked?.full_name || playerName;
  const rows = queryHistoricalStatsRowsForPlayer({
    playerName,
    fromDate: fromIso,
    beforeDate,
    limit,
  }) as DbMatchRow[];

  const surfaces = aggregatePlayerSurfaceStatsFromRows(rows, matchName, {
    excludePlaceholderFromRawCounts: true,
    beforeDate,
    decayHalfLifeDays: 365,
  });
  const matchesWithServeStats = rows.filter((row) => {
    const won = playerWonMatch(row, matchName);
    const svpt = won ? Number(row.w_svpt || 0) : Number(row.l_svpt || 0);
    const servePct = won ? Number(row.w_serve_won_pct || 0) : Number(row.l_serve_won_pct || 0);
    return svpt > 0 || servePct > 0;
  }).length;

  return {
    playerName,
    cleanName,
    beforeDate,
    yearsBack,
    totalMatches: rows.length,
    matchesWithServeStats,
    surfaces,
  };
}
