/**
 * Quarantine flags for validated historical match rows.
 * Rows may remain in the dataset; flags control feature-family eligibility.
 */

export const QUARANTINE_FLAGS = {
  PLACEHOLDER_SERVE: 'QUARANTINE_PLACEHOLDER_SERVE',
  NO_RANK: 'QUARANTINE_NO_RANK',
  OUTSIDE_TOP100: 'QUARANTINE_OUTSIDE_TOP100',
  BAD_ODDS: 'QUARANTINE_BAD_ODDS',
  ONE_SIDED_ODDS: 'QUARANTINE_ONE_SIDED_ODDS',
  NO_SURFACE: 'QUARANTINE_NO_SURFACE',
  RETIREMENT_OR_WO: 'QUARANTINE_RETIREMENT_OR_WO',
  NON_SINGLES: 'QUARANTINE_NON_SINGLES',
  SYNTHETIC_SOURCE: 'QUARANTINE_SYNTHETIC_SOURCE',
  POSTMATCH_ONLY: 'QUARANTINE_POSTMATCH_ONLY',
  PRE_2024_ARCHIVE: 'QUARANTINE_PRE_2024_ARCHIVE',
} as const;

export type QuarantineFlag = (typeof QUARANTINE_FLAGS)[keyof typeof QUARANTINE_FLAGS];

export const ALL_QUARANTINE_FLAGS: QuarantineFlag[] = Object.values(QUARANTINE_FLAGS);

export function parseQuarantineFlags(csv: string | null | undefined): QuarantineFlag[] {
  if (!csv || !String(csv).trim()) return [];
  return String(csv)
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is QuarantineFlag => ALL_QUARANTINE_FLAGS.includes(s as QuarantineFlag));
}

export function hasQuarantineFlag(csv: string | null | undefined, flag: QuarantineFlag): boolean {
  return parseQuarantineFlags(csv).includes(flag);
}
