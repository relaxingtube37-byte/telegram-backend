/**
 * Detect placeholder serve rows in historical_matches.
 * Pattern: w_svpt=100 with w_1stIn=0 (CSV placeholder — not real point counts).
 */

import { VALIDATION_FLAGS, type ValidationFlag } from './validationFlags';

export interface ServeRowSide {
  svpt?: number | null;
  firstIn?: number | null;
  serveWonPct?: number | null;
}

export interface ServeRowQuality {
  isPlaceholder: boolean;
  hasRawServeCounts: boolean;
  hasEstimatedServePct: boolean;
  flags: ValidationFlag[];
}

export function isPlaceholderServePattern(svpt: number | null | undefined, firstIn: number | null | undefined): boolean {
  return Number(svpt) === 100 && Number(firstIn || 0) === 0;
}

export function assessServeRowQuality(side: ServeRowSide): ServeRowQuality {
  const svpt = Number(side.svpt || 0);
  const firstIn = Number(side.firstIn || 0);
  const servePct = Number(side.serveWonPct || 0);
  const flags: ValidationFlag[] = [];

  const isPlaceholder = isPlaceholderServePattern(svpt, firstIn);
  if (isPlaceholder) flags.push(VALIDATION_FLAGS.PLACEHOLDER_SERVE);

  const hasRawServeCounts = firstIn > 0;
  const hasEstimatedServePct = !hasRawServeCounts && servePct > 0 && svpt > 0;
  if (hasEstimatedServePct) flags.push(VALIDATION_FLAGS.ESTIMATED_SERVE_PCT);

  return {
    isPlaceholder,
    hasRawServeCounts,
    hasEstimatedServePct,
    flags,
  };
}

export function extractPlayerServeSide(
  row: Record<string, unknown>,
  playerWon: boolean,
): ServeRowSide {
  if (playerWon) {
    return {
      svpt: row.w_svpt as number | null,
      firstIn: row.w_1stIn as number | null,
      serveWonPct: row.w_serve_won_pct as number | null,
    };
  }
  return {
    svpt: row.l_svpt as number | null,
    firstIn: row.l_1stIn as number | null,
    serveWonPct: row.l_serve_won_pct as number | null,
  };
}
