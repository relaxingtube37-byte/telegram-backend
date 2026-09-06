export type CanonicalSurface = 'Hard' | 'Clay' | 'Grass' | 'Carpet/Indoor' | 'Unknown';

export function normalizeSurfaceLabel(raw: string | null | undefined): CanonicalSurface {
  const s = String(raw || '').trim().toLowerCase();
  if (!s || s === 'no surface' || s === 'unknown' || s === 'n/a') return 'Unknown';
  if (s.includes('clay') || s === 'red clay') return 'Clay';
  if (s.includes('grass')) return 'Grass';
  if (s.includes('carpet') || s.includes('indoor')) return 'Carpet/Indoor';
  if (s.includes('hard')) return 'Hard';
  return 'Unknown';
}
