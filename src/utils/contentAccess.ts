import { Request } from 'express';
import { SettingsRepo } from '../db/repositories/settings.repo';
import { UsersRepo } from '../db/repositories/users.repo';
import {
  validateTelegramInitData,
  verifyWebSessionToken,
} from './telegramAuth';
import { ENV } from '../config/env';
import type { Prediction, WebsiteConfig } from '../types';
import type { MatchDeepAnalyticsReport } from '../services/match-analytics.service';
import { loadAccessPolicy, DEFAULT_ACCESS_MODE, ACCESS_MODES } from '../access-policy';

export const ACCESS_MODE_FREE = 'FREE';
export const ACCESS_MODE_REGISTRATION = 'REGISTRATION_REQUIRED';
export const ACCESS_MODE_DEPOSIT = 'DEPOSIT_REQUIRED';
/** Legacy alias stored in older DBs */
export const ACCESS_MODE_VIP_REFERRAL = 'VIP_REFERRAL';

export interface ContentLayerFlags {
  guest_can_see_summary: boolean;
  guest_can_see_stats: boolean;
  guest_can_see_ai_full: boolean;
  guest_can_see_watch_live: boolean;
  payment_gateway_enabled: boolean;
  unlock_via_referral: boolean;
}

export interface ResolvedWebappAccess {
  accessMode: string;
  isVerified: boolean;
  telegramId: number | null;
  webId: string | null;
  contentFlags: ContentLayerFlags;
}

export const DEFAULT_CONTENT_FLAGS: ContentLayerFlags = {
  guest_can_see_summary: true,
  guest_can_see_stats: false,
  guest_can_see_ai_full: false,
  guest_can_see_watch_live: true,
  payment_gateway_enabled: false,
  unlock_via_referral: true,
};

export function getWebSessionSecret(): string {
  return (ENV.BOT_TOKEN || '') + ':' + (ENV.ADMIN_SECRET || 'ptin_web_secret_salt_2026');
}

export function parseWebsiteConfig(): WebsiteConfig {
  const raw = SettingsRepo.get('website_config');
  if (!raw) return {};
  try {
    return JSON.parse(raw) as WebsiteConfig;
  } catch {
    return {};
  }
}

export function resolveContentFlags(config?: WebsiteConfig): ContentLayerFlags {
  const c = config || parseWebsiteConfig();
  const policy = loadAccessPolicy();
  const layers = policy.layers;
  return {
    guest_can_see_summary:
      typeof layers.guest_can_see_summary === 'boolean'
        ? layers.guest_can_see_summary
        : (c.guest_can_see_summary ?? DEFAULT_CONTENT_FLAGS.guest_can_see_summary),
    guest_can_see_stats:
      layers.guest_stats_level !== 'none'
        ? true
        : (c.guest_can_see_stats ?? DEFAULT_CONTENT_FLAGS.guest_can_see_stats),
    guest_can_see_ai_full:
      typeof layers.guest_can_see_ai_full === 'boolean'
        ? layers.guest_can_see_ai_full
        : (c.guest_can_see_ai_full ?? DEFAULT_CONTENT_FLAGS.guest_can_see_ai_full),
    guest_can_see_watch_live: c.guest_can_see_watch_live ?? DEFAULT_CONTENT_FLAGS.guest_can_see_watch_live,
    payment_gateway_enabled: c.payment_gateway_enabled ?? DEFAULT_CONTENT_FLAGS.payment_gateway_enabled,
    unlock_via_referral: c.unlock_via_referral ?? DEFAULT_CONTENT_FLAGS.unlock_via_referral,
  };
}

export function normalizeAccessMode(raw?: string | null): string {
  const mode = (raw || DEFAULT_ACCESS_MODE).trim().toUpperCase();
  if (mode === ACCESS_MODE_VIP_REFERRAL) return ACCESS_MODE_REGISTRATION;
  if (
    mode === ACCESS_MODE_FREE ||
    mode === ACCESS_MODE_REGISTRATION ||
    mode === ACCESS_MODE_DEPOSIT ||
    mode === ACCESS_MODES.GATED_LATER
  ) {
    return mode;
  }
  return DEFAULT_ACCESS_MODE;
}

export function computeIsVerified(
  accessMode: string,
  user: { is_verified?: number; has_deposited?: number; auth_provider?: string; email?: string; telegram_id?: number; verify_status?: string } | null | undefined
): boolean {
  const mode = normalizeAccessMode(accessMode);
  if (mode === ACCESS_MODE_FREE) return true;
  if (!user) return false;
  if (mode === ACCESS_MODE_DEPOSIT) {
    return !!(user.has_deposited || (user.is_verified && user.verify_status === 'verified'));
  }
  // STRICT 2-STEP POLICY (Both Web & Telegram Mini-App):
  // Step 1: User connects account (Google or Telegram)
  // Step 2: User completes partner site registration (1WIN) via /referral/complete
  // Both steps are strictly mandatory for all access.
  return !!(user.is_verified && user.verify_status === 'verified');
}

function extractBearerOrHeaderToken(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (auth && typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const headerToken = req.headers['x-ptin-session'];
  if (typeof headerToken === 'string' && headerToken.trim()) return headerToken.trim();
  const q = req.query.sessionToken;
  if (typeof q === 'string' && q.trim()) return q.trim();
  return undefined;
}

/**
 * Resolves guest vs member access for a webapp request.
 * Accepts Bearer / x-ptin-session / ?sessionToken= or Telegram initData header/query.
 */
export function resolveWebappAccess(req: Request): ResolvedWebappAccess {
  const accessMode = normalizeAccessMode(SettingsRepo.get('access_mode'));
  const contentFlags = resolveContentFlags();

  let telegramId: number | null = null;
  let webId: string | null = null;

  const initData =
    (typeof req.headers['x-telegram-init-data'] === 'string'
      ? req.headers['x-telegram-init-data']
      : undefined) ||
    (typeof req.query.initData === 'string' ? req.query.initData : undefined);

  if (initData) {
    const session = validateTelegramInitData(initData);
    if (session.valid && session.user?.id) {
      telegramId = session.user.id;
    }
  }

  if (!telegramId) {
    const token = extractBearerOrHeaderToken(req);
    if (token) {
      const verified = verifyWebSessionToken(token, getWebSessionSecret());
      if (verified.valid && verified.payload) {
        telegramId = verified.payload.telegramId ?? null;
        webId = verified.payload.webId ?? null;
      }
    }
  }

  let user = null;
  if (telegramId) {
    user = UsersRepo.getByTelegramId(telegramId);
  }
  if (!user && webId && webId.startsWith('tg_')) {
    const id = parseInt(webId.slice(3), 10);
    if (!isNaN(id)) user = UsersRepo.getByTelegramId(id);
  }

  const isVerified = computeIsVerified(accessMode, user);

  return {
    accessMode,
    isVerified,
    telegramId,
    webId,
    contentFlags,
  };
}

function truncateSummary(text: string | undefined, maxLen = 220): string | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 1)}…`;
}

/**
 * Public teaser fields always kept for guests (teams + tournament + odds + status).
 * Deep AI / predictions / winner / probabilities strictly redacted until full 2-step verification.
 */
export function redactPrediction(
  prediction: Prediction,
  access: Pick<ResolvedWebappAccess, 'isVerified' | 'contentFlags'>
): Prediction & { content_locked?: boolean; content_layers?: ContentLayerFlags } {
  const { isVerified, contentFlags } = access;
  if (isVerified) {
    return {
      ...prediction,
      content_locked: false,
      content_layers: contentFlags,
    };
  }

  const out: Prediction & { content_locked?: boolean; content_layers?: ContentLayerFlags } = {
    ...prediction,
    content_locked: true,
    content_layers: contentFlags,
    predicted_winner: 'LOCKED',
    win_probability: undefined,
    confidence: undefined,
    predicted_score: undefined,
    key_factors: undefined,
    devils_advocate_risk: undefined,
    best_bet_selection: undefined,
    best_bet_market: undefined,
    best_bet_ev: undefined,
    best_bet_rationale: undefined,
    alt_bet_selection: undefined,
    alt_bet_market: undefined,
    ai_summary: contentFlags.guest_can_see_ai_full
      ? prediction.ai_summary
      : (contentFlags.guest_can_see_summary
          ? (typeof prediction.ai_summary === 'string'
              ? (prediction.ai_summary.slice(0, 280) + (prediction.ai_summary.length > 280 ? '…' : ''))
              : prediction.ai_summary)
          : undefined),
  };

  return out;
}

export function redactDeepAnalytics(
  report: MatchDeepAnalyticsReport,
  access: Pick<ResolvedWebappAccess, 'isVerified' | 'contentFlags'>
): MatchDeepAnalyticsReport | { locked: true; matchInfo: MatchDeepAnalyticsReport['matchInfo']; teaser?: Partial<MatchDeepAnalyticsReport> } {
  const { isVerified, contentFlags } = access;
  if (isVerified || contentFlags.guest_can_see_stats) {
    return report;
  }

  return {
    locked: true,
    matchInfo: report.matchInfo,
    teaser: {
      p1RollingForm: report.p1RollingForm,
      p2RollingForm: report.p2RollingForm,
      h2hSummary: report.h2hSummary,
      p1SurfaceMastery: report.p1SurfaceMastery,
      p2SurfaceMastery: report.p2SurfaceMastery,
      p1Workload: report.p1Workload,
      p2Workload: report.p2Workload,
      p1Clutch: report.p1Clutch,
      p2Clutch: report.p2Clutch,
      matchupGaps: report.matchupGaps,
      explanationCards: report.explanationCards,
    },
  };
}

export function redactEditorial(
  editorial: Record<string, unknown>,
  access: Pick<ResolvedWebappAccess, 'isVerified' | 'contentFlags'>
): Record<string, unknown> {
  const { isVerified, contentFlags } = access;
  if (isVerified || contentFlags.guest_can_see_ai_full) {
    return { ...editorial, content_locked: false };
  }

  const summarySource =
    (typeof editorial.guest_safe_summary === 'string' && editorial.guest_safe_summary) ||
    (typeof editorial.short_summary === 'string' && editorial.short_summary) ||
    (typeof editorial.summary === 'string' && editorial.summary) ||
    '';

  const summary =
    contentFlags.guest_can_see_summary && summarySource
      ? truncateSummary(summarySource, 280)
      : undefined;

  return {
    fixture_id: editorial.fixture_id,
    slug: editorial.slug,
    headline: editorial.headline,
    title: editorial.title || editorial.headline,
    subtitle: editorial.subtitle,
    summary,
    short_summary: summary,
    guest_safe_summary: summary,
    key_facts: contentFlags.guest_can_see_summary ? editorial.key_facts : undefined,
    data_bullets: contentFlags.guest_can_see_stats ? editorial.data_bullets : undefined,
    tags: editorial.tags,
    share_text: editorial.share_text,
    author_name: editorial.author_name,
    seo_title: editorial.seo_title,
    seo_description: editorial.seo_description,
    seo_metadata: editorial.seo_metadata,
    publish_status: editorial.publish_status,
    version: editorial.version,
    content_locked: true,
    tactical_analysis: undefined,
    surface_breakdown: undefined,
    h2h_breakdown: undefined,
    ai_analysis: undefined,
    key_stats: contentFlags.guest_can_see_stats ? editorial.key_stats : undefined,
    key_stats_json: contentFlags.guest_can_see_stats ? editorial.key_stats_json : undefined,
  };
}
