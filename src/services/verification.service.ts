import { UsersRepo } from '../db/repositories/users.repo';
import { ReferralsRepo } from '../db/repositories/referrals.repo';
import { ReferralClicksRepo } from '../db/repositories/referralClicks.repo';
import {
  PartnerConversionsRepo,
  buildConversionDedupeKey,
} from '../db/repositories/partnerConversions.repo';
import { buildReferralUrl } from '../utils/subidBuilder';
import { createClickId } from '../utils/clickId';
import { isDestinationAllowed } from '../utils/redirectWhitelist';
import {
  loadBusinessActionSettings,
  type PartnerEventType,
  type ReferralActionType,
} from '../business-actions';
import { Logger } from '../utils/logger';

export interface RedirectRequest {
  siteId: number;
  userRef: string;
  action?: ReferralActionType;
  sessionRef?: string;
  matchId?: number;
  fixtureId?: number;
  pageContext?: string;
}

export type RedirectResult =
  | {
      ok: true;
      url: string;
      click_id: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

function parseOptionalInt(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function resolveWatchLiveBaseUrl(siteReferralUrl: string): string {
  const biz = loadBusinessActionSettings();
  // Phase 2 template intentionally unused until an official partner pattern is configured.
  if (biz.watch_live_event_url_template) {
    // Structure reserved — do not invent event-specific deep links without a real template fill.
  }
  if (biz.shared_watch_live_url.trim()) return biz.shared_watch_live_url.trim();
  return siteReferralUrl;
}

export function detectPartnerEventType(queryAndBody: Record<string, unknown>, urlLower: string): PartnerEventType {
  const event = String(queryAndBody.event || queryAndBody.type || queryAndBody.status || '').toLowerCase();
  if (
    event === 'rejected' ||
    event === 'reject' ||
    event === 'declined' ||
    urlLower.includes('event=rejected') ||
    urlLower.includes('status=reject')
  ) {
    return 'rejected';
  }
  if (
    event === 'deposit' ||
    event === 'ftd' ||
    event === 'first_deposit' ||
    event === 'sale' ||
    urlLower.includes('event=deposit') ||
    urlLower.includes('event=ftd') ||
    urlLower.includes('status=sale') ||
    urlLower.includes('type=deposit')
  ) {
    return 'first_deposit';
  }
  if (event === 'registration' || event === 'reg' || urlLower.includes('event=registration')) {
    return 'registration';
  }
  if (
    event === 'verified' ||
    event === 'verified_registration' ||
    event === 'confirm' ||
    urlLower.includes('event=verified')
  ) {
    return 'verified_registration';
  }
  // Default unlock path (legacy postbacks without explicit event)
  return 'verified_registration';
}

export const VerificationService = {
  getRedirectUrl: (siteId: number, telegramId: number): string => {
    const result = VerificationService.buildAttributedRedirect({
      siteId,
      userRef: String(telegramId),
      action: 'registration',
      pageContext: 'legacy',
    });
    return result.ok ? result.url : '';
  },

  buildAttributedRedirect: (req: RedirectRequest): RedirectResult => {
    const biz = loadBusinessActionSettings();
    const action: ReferralActionType = req.action === 'watch_live' ? 'watch_live' : 'registration';

    if (action === 'registration' && !biz.registration_referral_enabled) {
      return { ok: false, status: 403, error: 'Registration referral is disabled' };
    }
    if (action === 'watch_live' && !biz.watch_live_enabled) {
      return { ok: false, status: 403, error: 'Watch live is disabled' };
    }

    const site = ReferralsRepo.getById(req.siteId);
    if (!site || !site.is_active) {
      return { ok: false, status: 404, error: 'Referral site not found or inactive' };
    }

    const baseUrl =
      action === 'watch_live'
        ? resolveWatchLiveBaseUrl(site.referral_url || '')
        : site.referral_url || '';

    if (!baseUrl) {
      return { ok: false, status: 404, error: 'No destination URL configured' };
    }

    if (!isDestinationAllowed(baseUrl)) {
      Logger.warn(`[GO REDIRECT] Blocked non-whitelisted host for site ${req.siteId}`);
      return { ok: false, status: 400, error: 'Destination URL is not on the allowed whitelist' };
    }

    const clickId = createClickId();
    const partnerKey = site.postback_key || site.name || `site_${site.id}`;
    const userRef = String(req.userRef || '').trim();
    if (!userRef) {
      return { ok: false, status: 400, error: 'Missing user reference' };
    }

    const numericUser = parseInt(userRef.replace(/\D/g, ''), 10);
    if (Number.isFinite(numericUser) && String(numericUser).length >= 5) {
      UsersRepo.setPendingSite(numericUser, site.id);
    }

    const destinationUrl = buildReferralUrl(baseUrl, clickId);

    if (!isDestinationAllowed(destinationUrl)) {
      return { ok: false, status: 400, error: 'Decorated destination failed whitelist check' };
    }

    ReferralClicksRepo.create({
      click_id: clickId,
      site_id: site.id,
      partner_key: partnerKey,
      user_ref: userRef,
      session_ref: req.sessionRef || null,
      match_id: req.matchId ?? null,
      fixture_id: req.fixtureId ?? null,
      page_context: req.pageContext || null,
      action_type: action,
      destination_url: destinationUrl,
    });

    return { ok: true, url: destinationUrl, click_id: clickId };
  },

  handlePostback: (targetKey: string, rawSubId?: string, isDeposit = false) => {
    // Backward-compatible thin wrapper used by older callers/tests
    const eventType: PartnerEventType = isDeposit ? 'first_deposit' : 'verified_registration';
    return VerificationService.handlePostbackDetailed({
      targetKey,
      correlationId: rawSubId,
      eventType,
      rawPayload: { subid: rawSubId, legacy_isDeposit: isDeposit },
    });
  },

  handlePostbackDetailed: (opts: {
    targetKey: string;
    correlationId?: string;
    transactionId?: string;
    eventType: PartnerEventType;
    rawPayload: Record<string, unknown>;
  }) => {
    let site = opts.targetKey ? ReferralsRepo.getByPostbackKey(opts.targetKey) : undefined;
    if (!site) {
      site = ReferralsRepo.getActive()[0];
    }
    const siteId = site ? site.id : undefined;
    const partnerKey = (site?.postback_key || site?.name || opts.targetKey || 'unknown').trim() || 'unknown';
    const siteName = site ? site.name : 'Default Partner';

    const correlation = String(opts.correlationId || '').trim();
    const transactionId = String(opts.transactionId || '').trim() || null;

    let click = correlation ? ReferralClicksRepo.getByClickId(correlation) : undefined;
    let userRef: string | null = click?.user_ref || null;

    // Legacy: correlation is numeric telegram id
    if (!userRef && correlation) {
      const digits = correlation.replace(/\D/g, '');
      if (digits && digits.length >= 5) {
        userRef = digits;
      }
    }

    if (!userRef && site) {
      const fallbackUser = UsersRepo.getLatestUnverified(site.id);
      if (fallbackUser) {
        userRef = String(fallbackUser.telegram_id);
        Logger.info(`[POSTBACK FALLBACK] Matched to user ${userRef}`);
      }
    }

    const dedupeKey = buildConversionDedupeKey({
      partner_key: partnerKey,
      event_type: opts.eventType,
      transaction_id: transactionId,
      click_id: click?.click_id || (correlation.startsWith('clk_') ? correlation : null),
    });

    if (opts.eventType === 'rejected') {
      const { record, inserted } = PartnerConversionsRepo.create({
        partner_key: partnerKey,
        site_id: siteId ?? null,
        event_type: 'rejected',
        click_id: click?.click_id || null,
        transaction_id: transactionId,
        dedupe_key: dedupeKey,
        user_ref: userRef,
        status: 'rejected',
        raw_payload: JSON.stringify(opts.rawPayload),
      });
      return {
        success: true,
        status: inserted ? 'rejected' : 'duplicate',
        duplicate: !inserted,
        conversion_id: record.id,
        telegram_id: userRef,
        site: siteName,
        event_type: 'rejected',
      };
    }

    if (!userRef) {
      PartnerConversionsRepo.create({
        partner_key: partnerKey,
        site_id: siteId ?? null,
        event_type: opts.eventType,
        click_id: click?.click_id || null,
        transaction_id: transactionId,
        dedupe_key: dedupeKey + '|failed_no_user',
        user_ref: null,
        status: 'failed',
        raw_payload: JSON.stringify(opts.rawPayload),
      });
      return {
        success: false,
        error: 'Missing click_id/user reference and no pending user found',
        event_type: opts.eventType,
      };
    }

    const { record, inserted } = PartnerConversionsRepo.create({
      partner_key: partnerKey,
      site_id: siteId ?? null,
      event_type: opts.eventType,
      click_id: click?.click_id || (correlation.startsWith('clk_') ? correlation : null),
      transaction_id: transactionId,
      dedupe_key: dedupeKey,
      user_ref: userRef,
      status: 'accepted',
      raw_payload: JSON.stringify(opts.rawPayload),
    });

    if (!inserted) {
      Logger.info(`[POSTBACK DUPLICATE] ${dedupeKey}`);
      return {
        success: true,
        status: 'duplicate',
        duplicate: true,
        conversion_id: record.id,
        telegram_id: userRef,
        site: siteName,
        event_type: opts.eventType,
      };
    }

    const telegramId = parseOptionalInt(userRef.replace(/\D/g, ''));
    if (telegramId && String(telegramId).length >= 5) {
      if (opts.eventType === 'first_deposit') {
        UsersRepo.setDeposited(telegramId);
        Logger.success(`[POSTBACK DEPOSIT] User ${telegramId} via "${siteName}"`);
      } else if (
        opts.eventType === 'verified_registration' ||
        opts.eventType === 'registration'
      ) {
        UsersRepo.setVerified(telegramId, siteId, 'postback');
        Logger.success(`[POSTBACK VERIFIED] User ${telegramId} via "${siteName}" (${opts.eventType})`);
      }
    }

    return {
      success: true,
      status: opts.eventType === 'first_deposit' ? 'deposited' : 'verified',
      duplicate: false,
      conversion_id: record.id,
      click_id: record.click_id,
      telegram_id: userRef,
      site: siteName,
      event_type: opts.eventType,
    };
  },
};
