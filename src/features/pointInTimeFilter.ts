/**
 * Point-in-time (as-of) filtering for prior-match features.
 * Rule: match_date < asOfDate; never include target match row.
 */

export function normalizeIsoDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 10);
}

export function isStrictlyBeforeAsOf(matchDate: string | null | undefined, asOfDate: string): boolean {
  const md = normalizeIsoDate(matchDate);
  const asOf = normalizeIsoDate(asOfDate);
  if (!md || !asOf) return false;
  return md < asOf;
}

export function passesPointInTimeRowFilter(
  row: { match_date?: string; id?: number | string },
  asOfDate: string,
  excludeMatchId?: number | string | null,
): boolean {
  if (!isStrictlyBeforeAsOf(row.match_date, asOfDate)) return false;
  if (excludeMatchId != null && String(row.id) === String(excludeMatchId)) return false;
  return true;
}

export function filterRowsPointInTime<T extends { match_date?: string; id?: number | string }>(
  rows: T[],
  asOfDate: string,
  excludeMatchId?: number | string | null,
): T[] {
  return rows.filter((row) => passesPointInTimeRowFilter(row, asOfDate, excludeMatchId));
}
