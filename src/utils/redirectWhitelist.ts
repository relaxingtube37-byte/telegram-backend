import { ReferralsRepo } from '../db/repositories/referrals.repo';
import { loadBusinessActionSettings } from '../business-actions';

/** Extract hostname from a URL; empty if invalid. */
export function extractHostname(url: string): string {
  try {
    return new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Allowed redirect hosts.
 * - If admin `allowed_redirect_hosts` is non-empty → strict allowlist only.
 * - Else → hosts from referral partners + shared watch URL (configured destinations only).
 */
export function buildAllowedRedirectHosts(): Set<string> {
  const hosts = new Set<string>();
  const biz = loadBusinessActionSettings();

  if (biz.allowed_redirect_hosts.length > 0) {
    for (const h of biz.allowed_redirect_hosts) {
      if (h) hosts.add(h.toLowerCase());
    }
    return hosts;
  }

  if (biz.shared_watch_live_url) {
    const h = extractHostname(biz.shared_watch_live_url);
    if (h) hosts.add(h);
  }
  for (const site of ReferralsRepo.getAll()) {
    const url = site.referral_url || (site as { base_url?: string }).base_url || '';
    const h = extractHostname(url);
    if (h) hosts.add(h);
    if (site.app_url) {
      const ah = extractHostname(site.app_url);
      if (ah) hosts.add(ah);
    }
  }
  return hosts;
}

export function isDestinationAllowed(destinationUrl: string): boolean {
  const host = extractHostname(destinationUrl);
  if (!host) return false;
  const allowed = buildAllowedRedirectHosts();
  if (allowed.size === 0) return false;
  return allowed.has(host);
}
