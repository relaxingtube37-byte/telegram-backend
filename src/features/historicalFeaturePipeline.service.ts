import { namesLikelyMatch } from '../scripts/historicalMatchKeys';
import { queryHistoricalStatsRowsForPlayer } from '../services/playerHistoricalQuery.service';
import { aggregatePlayerSurfaceStatsFromRows } from '../services/historicalPlayerStats.service';
import { BACKTEST_PRODUCT_RULES, FEATURE_REGISTRY } from './featureRegistry';
import { filterRowsPointInTime, normalizeIsoDate } from './pointInTimeFilter';
import { assessServeRowQuality, extractPlayerServeSide } from './serveRowQuality';
import { validateHistoricalMatchForBacktest } from './historicalFeatureValidator';
import { evaluateTop100BothPlayersFilter, type ValidationFlag } from './validationFlags';

export interface HistoricalPlayerFeatureBundle {
  playerName: string;
  asOfDate: string;
  excludeMatchId: number | null;
  source: 'historical_tables';
  scope: 'historical';
  priorMatchCount: number;
  placeholderServeRowCount: number;
  estimatedServePctRowCount: number;
  flags: ValidationFlag[];
  surfaces: ReturnType<typeof aggregatePlayerSurfaceStatsFromRows>;
  productRules: typeof BACKTEST_PRODUCT_RULES;
  featureRegistryVersion: number;
}

export interface HistoricalMatchFeatureBundle {
  matchId: number | null;
  asOfDate: string;
  backtestMode: 'historical';
  source: 'historical_tables';
  scope: 'historical';
  homePlayer: HistoricalPlayerFeatureBundle;
  awayPlayer: HistoricalPlayerFeatureBundle;
  validation: ReturnType<typeof validateHistoricalMatchForBacktest> & {
    top100: ReturnType<typeof evaluateTop100BothPlayersFilter>;
  };
  featureRegistry: typeof FEATURE_REGISTRY;
  productRules: typeof BACKTEST_PRODUCT_RULES;
}

const REGISTRY_VERSION = 1;

function buildPlayerBundle(options: {
  playerName: string;
  asOfDate: string;
  excludeMatchId?: number | null;
  yearsBack?: number;
  limit?: number;
}): HistoricalPlayerFeatureBundle {
  const asOfDate = normalizeIsoDate(options.asOfDate) || new Date().toISOString().slice(0, 10);
  const yearsBack = Math.max(1, Math.min(options.yearsBack || 3, 8));
  const fromDate = new Date(`${asOfDate}T00:00:00.000Z`);
  fromDate.setUTCFullYear(fromDate.getUTCFullYear() - yearsBack);
  const fromIso = fromDate.toISOString().slice(0, 10);
  const limit = options.limit || 500;

  const rawRows = queryHistoricalStatsRowsForPlayer({
    playerName: options.playerName,
    fromDate: fromIso,
    beforeDate: asOfDate,
    limit,
    excludeMatchId: options.excludeMatchId,
  });

  const priorRows = filterRowsPointInTime(
    rawRows as Array<{ match_date?: string; id?: number }>,
    asOfDate,
    options.excludeMatchId,
  );

  let placeholderServeRowCount = 0;
  let estimatedServePctRowCount = 0;
  const flags = new Set<ValidationFlag>();

  for (const row of priorRows as Array<Record<string, unknown>>) {
    const won = namesLikelyMatch(String(row.winner_name || ''), options.playerName);
    const lost = namesLikelyMatch(String(row.loser_name || ''), options.playerName);
    if (!won && !lost) continue;
    const quality = assessServeRowQuality(extractPlayerServeSide(row, won));
    if (quality.isPlaceholder) placeholderServeRowCount += 1;
    if (quality.hasEstimatedServePct) estimatedServePctRowCount += 1;
    for (const f of quality.flags) flags.add(f);
  }

  const surfaces = aggregatePlayerSurfaceStatsFromRows(
    priorRows as Parameters<typeof aggregatePlayerSurfaceStatsFromRows>[0],
    options.playerName,
    { excludePlaceholderFromRawCounts: true },
  );

  return {
    playerName: options.playerName,
    asOfDate,
    excludeMatchId: options.excludeMatchId ?? null,
    source: 'historical_tables',
    scope: 'historical',
    priorMatchCount: priorRows.length,
    placeholderServeRowCount,
    estimatedServePctRowCount,
    flags: Array.from(flags),
    surfaces,
    productRules: BACKTEST_PRODUCT_RULES,
    featureRegistryVersion: REGISTRY_VERSION,
  };
}

export function buildHistoricalMatchFeatureBundle(options: {
  homePlayerName: string;
  awayPlayerName: string;
  asOfDate: string;
  matchId?: number | null;
  homeEventRank?: number | null;
  awayEventRank?: number | null;
  oddsClassification?: string | null;
  sourceTag?: 'historical' | 'frozen';
}): HistoricalMatchFeatureBundle {
  const asOfDate = normalizeIsoDate(options.asOfDate) || new Date().toISOString().slice(0, 10);
  const homePlayer = buildPlayerBundle({
    playerName: options.homePlayerName,
    asOfDate,
    excludeMatchId: options.matchId,
  });
  const awayPlayer = buildPlayerBundle({
    playerName: options.awayPlayerName,
    asOfDate,
    excludeMatchId: options.matchId,
  });

  const top100 = evaluateTop100BothPlayersFilter(options.homeEventRank, options.awayEventRank);
  const validation = validateHistoricalMatchForBacktest({
    homeEventRank: options.homeEventRank,
    awayEventRank: options.awayEventRank,
    oddsClassification: options.oddsClassification,
    sourceTag: options.sourceTag || 'historical',
    placeholderServeRowCount:
      homePlayer.placeholderServeRowCount + awayPlayer.placeholderServeRowCount,
    estimatedServePctRowCount:
      homePlayer.estimatedServePctRowCount + awayPlayer.estimatedServePctRowCount,
  });

  return {
    matchId: options.matchId ?? null,
    asOfDate,
    backtestMode: 'historical',
    source: 'historical_tables',
    scope: 'historical',
    homePlayer,
    awayPlayer,
    validation: { ...validation, top100 },
    featureRegistry: FEATURE_REGISTRY,
    productRules: BACKTEST_PRODUCT_RULES,
  };
}
