import { getBacktestPopulationExclusionFlags } from './featureRegistry';
import { evaluateTop100BothPlayersFilter, VALIDATION_FLAGS, type ValidationFlag } from './validationFlags';

export type OddsClassificationInput =
  | 'VERIFIED_PREMATCH'
  | 'LIKELY_PREMATCH'
  | 'UNKNOWN_SNAPSHOT'
  | 'LIVE_OR_INPLAY'
  | 'MODEL_FAIR'
  | 'SYNTHETIC_FALLBACK'
  | 'MISSING'
  | string;

export interface HistoricalMatchValidationInput {
  homeEventRank?: number | null;
  awayEventRank?: number | null;
  oddsClassification?: OddsClassificationInput | null;
  sourceTag?: 'historical' | 'frozen' | 'live_api' | 'archive_reload' | string;
  placeholderServeRowCount?: number;
  estimatedServePctRowCount?: number;
}

export interface HistoricalValidationResult {
  eligibleForBacktest: boolean;
  eligibleForRoi: boolean;
  flags: ValidationFlag[];
  rejectionReasons: string[];
}

const SYNTHETIC_ODDS_CLASSIFICATIONS = new Set([
  'SYNTHETIC_FALLBACK',
  'MODEL_FAIR',
]);

const ROI_ALLOWED_ODDS = new Set(['VERIFIED_PREMATCH', 'LIKELY_PREMATCH']);

export function classifyOddsFlags(classification: OddsClassificationInput | null | undefined): ValidationFlag[] {
  if (!classification) return [];
  if (SYNTHETIC_ODDS_CLASSIFICATIONS.has(classification)) {
    return [VALIDATION_FLAGS.SYNTHETIC_ODDS];
  }
  return [];
}

export function classifySourceFlags(sourceTag: string | undefined): ValidationFlag[] {
  if (!sourceTag) return [];
  if (sourceTag === 'historical' || sourceTag === 'frozen') return [];
  return [VALIDATION_FLAGS.NON_HISTORICAL_SOURCE];
}

export function validateHistoricalMatchForBacktest(
  input: HistoricalMatchValidationInput,
): HistoricalValidationResult {
  const flags: ValidationFlag[] = [];
  const rejectionReasons: string[] = [];

  const top100 = evaluateTop100BothPlayersFilter(input.homeEventRank, input.awayEventRank);
  flags.push(...top100.flags);
  if (!top100.passes) {
    rejectionReasons.push('Both players must be ranked 1-100 at event time (rank 101 excluded)');
  }

  flags.push(...classifyOddsFlags(input.oddsClassification ?? null));
  if (flags.includes(VALIDATION_FLAGS.SYNTHETIC_ODDS)) {
    rejectionReasons.push('Synthetic or model-fair odds are not allowed for official backtest ROI');
  }

  flags.push(...classifySourceFlags(input.sourceTag));
  if (flags.includes(VALIDATION_FLAGS.NON_HISTORICAL_SOURCE)) {
    rejectionReasons.push('Backtest must use historical or frozen sources only');
  }

  if ((input.placeholderServeRowCount ?? 0) > 0) {
    if (!flags.includes(VALIDATION_FLAGS.PLACEHOLDER_SERVE)) {
      flags.push(VALIDATION_FLAGS.PLACEHOLDER_SERVE);
    }
  }
  if ((input.estimatedServePctRowCount ?? 0) > 0) {
    if (!flags.includes(VALIDATION_FLAGS.ESTIMATED_SERVE_PCT)) {
      flags.push(VALIDATION_FLAGS.ESTIMATED_SERVE_PCT);
    }
  }

  const uniqueFlags = Array.from(new Set(flags));
  const exclusionFlags = getBacktestPopulationExclusionFlags();
  const hasBlockingFlag = uniqueFlags.some((f) => exclusionFlags.includes(f));

  const roiAllowed =
    ROI_ALLOWED_ODDS.has(String(input.oddsClassification || '')) &&
    !uniqueFlags.includes(VALIDATION_FLAGS.SYNTHETIC_ODDS) &&
    top100.passes;

  return {
    eligibleForBacktest: !hasBlockingFlag,
    eligibleForRoi: roiAllowed,
    flags: uniqueFlags,
    rejectionReasons,
  };
}
