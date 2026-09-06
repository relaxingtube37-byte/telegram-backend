/**
 * Blocks synthetic sports-value imputation in validated historical pipelines.
 */

export const SYNTHETIC_SERVE_BLOCKED =
  'SYNTHETIC_SERVE_BLOCKED: estimateServeCounts is disabled in validated historical pipeline';

export const SYNTHETIC_BREAK_BLOCKED =
  'SYNTHETIC_BREAK_BLOCKED: estimateBreakPoints is disabled in validated historical pipeline';

export function assertSyntheticServeNotUsed(context = 'historical'): never {
  throw new Error(`${SYNTHETIC_SERVE_BLOCKED} (context=${context})`);
}

export function assertSyntheticBreakNotUsed(context = 'historical'): never {
  throw new Error(`${SYNTHETIC_BREAK_BLOCKED} (context=${context})`);
}
