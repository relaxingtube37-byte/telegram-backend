/**
 * Validation flags for historical / backtest feature pipelines.
 * Product rules (fixed):
 * - Top-100 both players at event time (ranks 1..100 inclusive; 101 excluded)
 * - Frozen dataset is canonical backtest source
 * - Placeholder serve rows are not raw serve counts
 */

export const VALIDATION_FLAGS = {
  OUTSIDE_TOP100: 'OUTSIDE_TOP100',
  NO_EVENT_RANK: 'NO_EVENT_RANK',
  PLACEHOLDER_SERVE: 'PLACEHOLDER_SERVE',
  ESTIMATED_SERVE_PCT: 'ESTIMATED_SERVE_PCT',
  SYNTHETIC_ODDS: 'SYNTHETIC_ODDS',
  NON_HISTORICAL_SOURCE: 'NON_HISTORICAL_SOURCE',
} as const;

export type ValidationFlag = (typeof VALIDATION_FLAGS)[keyof typeof VALIDATION_FLAGS];

export const TOP100_MAX_RANK = 100;
export const TOP100_MIN_RANK = 1;

/** Event-time rank must be 1..100 inclusive. Rank 101 is excluded. */
export function isEventTimeTop100Rank(rank: number | null | undefined): rank is number {
  return (
    typeof rank === 'number' &&
    Number.isFinite(rank) &&
    rank >= TOP100_MIN_RANK &&
    rank <= TOP100_MAX_RANK
  );
}

export function classifyEventRank(rank: number | null | undefined): ValidationFlag | null {
  if (rank == null || !Number.isFinite(rank)) return VALIDATION_FLAGS.NO_EVENT_RANK;
  if (!isEventTimeTop100Rank(rank)) return VALIDATION_FLAGS.OUTSIDE_TOP100;
  return null;
}

export interface Top100FilterResult {
  passes: boolean;
  flags: ValidationFlag[];
  homeRank: number | null;
  awayRank: number | null;
}

/** Both players must be top 100 at event time. Uses event-time ranks only. */
export function evaluateTop100BothPlayersFilter(
  homeRank: number | null | undefined,
  awayRank: number | null | undefined,
): Top100FilterResult {
  const flags: ValidationFlag[] = [];
  const homeFlag = classifyEventRank(homeRank ?? null);
  const awayFlag = classifyEventRank(awayRank ?? null);
  if (homeFlag) flags.push(homeFlag);
  if (awayFlag && awayFlag !== homeFlag) flags.push(awayFlag);
  else if (awayFlag && !flags.includes(awayFlag)) flags.push(awayFlag);

  const passes =
    isEventTimeTop100Rank(homeRank ?? null) && isEventTimeTop100Rank(awayRank ?? null);

  return {
    passes,
    flags,
    homeRank: typeof homeRank === 'number' && Number.isFinite(homeRank) ? homeRank : null,
    awayRank: typeof awayRank === 'number' && Number.isFinite(awayRank) ? awayRank : null,
  };
}
