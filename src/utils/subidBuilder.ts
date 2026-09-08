import { ENV } from '../config/env';

/** Build partner destination with opaque click_id (no unnecessary PII in URL). */
export const buildReferralUrl = (
  baseUrl: string,
  clickId: string,
  opts?: { legacyUserSubid?: string }
): string => {
  if (!baseUrl || !baseUrl.trim()) return '';
  const cleanUrl = baseUrl.trim();
  const sub = String(clickId || '').trim();
  if (!sub) return cleanUrl;
  try {
    const parsed = new URL(cleanUrl);
    parsed.searchParams.set('subid', sub);
    parsed.searchParams.set('sub1', sub);
    if (!parsed.searchParams.has('sub_id')) parsed.searchParams.set('sub_id', sub);
    parsed.searchParams.set('click_id', sub);
    // Optional legacy bridge for partners that still echo numeric user ids
    if (opts?.legacyUserSubid && !parsed.searchParams.has('user_ref')) {
      // Do not put PII-heavy fields; numeric tracking id only when already in path
      parsed.searchParams.set('ptid', String(opts.legacyUserSubid));
    }
    return parsed.toString();
  } catch {
    const separator = cleanUrl.includes('?') ? '&' : '?';
    return `${cleanUrl}${separator}subid=${encodeURIComponent(sub)}&sub1=${encodeURIComponent(sub)}&click_id=${encodeURIComponent(sub)}`;
  }
};

export const buildGoUrl = (
  siteId: number,
  userRef: string | number,
  query?: Record<string, string | number | undefined>
): string => {
  const base = `${ENV.PUBLIC_BASE_URL}/go/${siteId}/${userRef}`;
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
};
