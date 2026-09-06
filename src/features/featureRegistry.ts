/**
 * Canonical feature registry for tennis prediction / backtest pipelines.
 *
 * Product rules encoded here:
 * 1. Top-100 both players required for backtests (event-time rank 1..100).
 * 2. Frozen dataset is the official backtest baseline.
 * 3. Placeholder serve rows excluded from raw-count features; pct features flagged ESTIMATED.
 */

export type FeatureUsageScope = 'historical' | 'live' | 'both';

export interface FeatureDefinition {
  id: string;
  sourceTable: string;
  sourceColumns: string[];
  formula: string;
  pointInTimeRule: string;
  scope: FeatureUsageScope;
  /** Validation flags that may apply when this feature is used */
  possibleFlags?: string[];
  /** Backtest population gate — match excluded if flag present */
  backtestExcludesOnFlag?: string[];
}

export const BACKTEST_PRODUCT_RULES = {
  top100Required: true,
  top100MaxRank: 100,
  top100MinRank: 1,
  canonicalBacktestPath: 'tracked_db' as const,
  placeholderServeExcludedFromRawCounts: true,
  syntheticOddsBlockedForRoi: true,
  historicalOnlyForBacktest: true,
  minBacktestDate: '2024-01-01',
  pre2024ArchiveExcluded: true,
} as const;

export const FEATURE_REGISTRY: FeatureDefinition[] = [
  {
    id: 'event_time_rank_home',
    sourceTable: 'historical_matches | frozen.preMatchFeatures',
    sourceColumns: ['winner_rank', 'loser_rank', 'homePlayer.eventTimeRanking'],
    formula: 'Player rank at tournament event time (not current/live rank)',
    pointInTimeRule: 'Rank snapshot dated on or before match start; never live 2026 board',
    scope: 'both',
    possibleFlags: ['NO_EVENT_RANK', 'OUTSIDE_TOP100'],
    backtestExcludesOnFlag: ['NO_EVENT_RANK', 'OUTSIDE_TOP100'],
  },
  {
    id: 'event_time_rank_away',
    sourceTable: 'historical_matches | frozen.preMatchFeatures',
    sourceColumns: ['winner_rank', 'loser_rank', 'awayPlayer.eventTimeRanking'],
    formula: 'Opponent rank at tournament event time',
    pointInTimeRule: 'Same as event_time_rank_home',
    scope: 'both',
    possibleFlags: ['NO_EVENT_RANK', 'OUTSIDE_TOP100'],
    backtestExcludesOnFlag: ['NO_EVENT_RANK', 'OUTSIDE_TOP100'],
  },
  {
    id: 'market_odds_prematch',
    sourceTable: 'historical_matches | frozen.preMatchFeatures.marketOdds',
    sourceColumns: ['w_odds_match', 'l_odds_match', 'marketOdds.homeOdds', 'marketOdds.awayOdds', 'marketOdds.classification'],
    formula: 'Pre-match book odds from historical source; ROI only when VERIFIED_PREMATCH or LIKELY_PREMATCH',
    pointInTimeRule: 'Odds captured before match start; no post-match or synthetic fallback for ROI',
    scope: 'both',
    possibleFlags: ['SYNTHETIC_ODDS'],
    backtestExcludesOnFlag: ['SYNTHETIC_ODDS'],
  },
  {
    id: 'prior_recent_matches',
    sourceTable: 'player_match_index + historical_matches',
    sourceColumns: ['pmi.match_date', 'pmi.won', 'pmi.opponent_name', 'h.score', 'h.surface'],
    formula: 'Last N prior matches for player ordered by match_date DESC',
    pointInTimeRule: 'h.match_date < asOfDate AND h.id != targetMatchId',
    scope: 'historical',
  },
  {
    id: 'prior_surface_win_rate',
    sourceTable: 'player_match_index + historical_matches',
    sourceColumns: ['pmi.won', 'h.surface'],
    formula: 'wins_on_surface / matches_on_surface over prior rows',
    pointInTimeRule: 'h.match_date < asOfDate',
    scope: 'historical',
  },
  {
    id: 'prior_h2h_record',
    sourceTable: 'historical_matches',
    sourceColumns: ['winner_name', 'loser_name', 'match_date'],
    formula: 'Count prior meetings won by each player',
    pointInTimeRule: 'h.match_date < asOfDate for both players',
    scope: 'historical',
  },
  {
    id: 'prior_serve_aces_sum',
    sourceTable: 'historical_matches',
    sourceColumns: ['w_ace', 'l_ace'],
    formula: 'Sum aces from prior matches (raw count when available)',
    pointInTimeRule: 'h.match_date < asOfDate; exclude PLACEHOLDER_SERVE rows from raw-count aggregation',
    scope: 'historical',
    possibleFlags: ['PLACEHOLDER_SERVE'],
  },
  {
    id: 'prior_serve_won_pct_avg',
    sourceTable: 'historical_matches',
    sourceColumns: ['w_serve_won_pct', 'l_serve_won_pct'],
    formula: 'Mean serve-won % from prior matches',
    pointInTimeRule: 'h.match_date < asOfDate',
    scope: 'historical',
    possibleFlags: ['PLACEHOLDER_SERVE', 'ESTIMATED_SERVE_PCT'],
  },
  {
    id: 'prior_first_serve_in_total',
    sourceTable: 'historical_matches',
    sourceColumns: ['w_1stIn', 'l_1stIn', 'w_svpt', 'l_svpt'],
    formula: 'Sum first serves in — ONLY when w_1stIn > 0 (real raw counts)',
    pointInTimeRule: 'h.match_date < asOfDate; skip rows flagged PLACEHOLDER_SERVE',
    scope: 'historical',
    possibleFlags: ['PLACEHOLDER_SERVE'],
    backtestExcludesOnFlag: [],
  },
  {
    id: 'label_actual_winner',
    sourceTable: 'historical_matches | frozen.actualResult',
    sourceColumns: ['winner_name', 'actualResult.winnerSide'],
    formula: 'Post-match outcome — label only, never prediction input',
    pointInTimeRule: 'Excluded from all pre-match feature bundles',
    scope: 'historical',
  },
];

export function getFeatureById(id: string): FeatureDefinition | undefined {
  return FEATURE_REGISTRY.find((f) => f.id === id);
}

export function getHistoricalFeatures(): FeatureDefinition[] {
  return FEATURE_REGISTRY.filter((f) => f.scope === 'historical' || f.scope === 'both');
}

export function getBacktestPopulationExclusionFlags(): string[] {
  const flags = new Set<string>();
  for (const f of FEATURE_REGISTRY) {
    for (const flag of f.backtestExcludesOnFlag || []) flags.add(flag);
  }
  flags.add('NON_HISTORICAL_SOURCE');
  return Array.from(flags);
}
