import { Request } from 'express';
import { SettingsRepo } from '../db/repositories/settings.repo';
import { UsersRepo } from '../db/repositories/users.repo';
import {
  validateTelegramInitData,
  verifyWebSessionToken,
} from '../utils/telegramAuth';
import { ENV } from '../config/env';
import {
  ACCESS_MODE_SETTING_KEY,
  ACCESS_MODES,
  ACCESS_POLICY_SETTING_KEY,
  DEFAULT_ACCESS_LAYERS,
  DEFAULT_ACCESS_MODE,
  GUEST_STATS_LEVELS,
  type AccessMode,
  type AccessPolicyLayers,
  type AccessPolicySnapshot,
  type GuestStatsLevel,
} from './types';

export interface ResolvedAccess {
  access_mode: AccessMode;
  isVerified: boolean;
  telegramId: number | null;
  webId: string | null;
  layers: AccessPolicyLayers;
}

function getWebSessionSecret(): string {
  return (ENV.BOT_TOKEN || '') + ':' + (ENV.ADMIN_SECRET || 'ptin_web_secret_salt_2026');
}

export function normalizeAccessMode(raw?: string | null): AccessMode {
  const mode = String(raw || DEFAULT_ACCESS_MODE).trim().toUpperCase();
  if (mode === 'VIP_REFERRAL' || mode === 'DEPOSIT_REQUIRED') {
    // Legacy aliases → Phase A enum
    return mode === 'DEPOSIT_REQUIRED' ? ACCESS_MODES.GATED_LATER : ACCESS_MODES.REGISTRATION_REQUIRED;
  }
  if (
    mode === ACCESS_MODES.FREE ||
    mode === ACCESS_MODES.REGISTRATION_REQUIRED ||
    mode === ACCESS_MODES.GATED_LATER
  ) {
    return mode;
  }
  return DEFAULT_ACCESS_MODE;
}

export function normalizeGuestStatsLevel(raw?: string | null): GuestStatsLevel {
  const v = String(raw || GUEST_STATS_LEVELS.NONE).trim().toLowerCase();
  if (v === GUEST_STATS_LEVELS.PARTIAL || v === GUEST_STATS_LEVELS.FULL || v === GUEST_STATS_LEVELS.NONE) {
    return v;
  }
  return GUEST_STATS_LEVELS.NONE;
}

/**
 * Live read from SQLite settings — no process-level cache.
 */
export function loadAccessPolicy(): AccessPolicySnapshot {
  const access_mode = normalizeAccessMode(SettingsRepo.get(ACCESS_MODE_SETTING_KEY));
  const raw = SettingsRepo.get(ACCESS_POLICY_SETTING_KEY);
  let parsed: Partial<AccessPolicyLayers> = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  }

  // Optional fallback from website_config if access_policy not yet saved
  if (!raw) {
    const webRaw = SettingsRepo.get('website_config');
    if (webRaw) {
      try {
        const web = JSON.parse(webRaw);
        if (typeof web.guest_can_see_summary === 'boolean') {
          parsed.guest_can_see_summary = web.guest_can_see_summary;
        }
        if (typeof web.guest_can_see_ai_full === 'boolean') {
          parsed.guest_can_see_ai_full = web.guest_can_see_ai_full;
        }
        if (web.guest_stats_level) {
          parsed.guest_stats_level = web.guest_stats_level;
        } else if (typeof web.guest_can_see_stats === 'boolean') {
          parsed.guest_stats_level = web.guest_can_see_stats
            ? GUEST_STATS_LEVELS.PARTIAL
            : GUEST_STATS_LEVELS.NONE;
        }
      } catch {
        /* ignore */
      }
    }
  }

  const layers: AccessPolicyLayers = {
    guest_can_see_summary:
      typeof parsed.guest_can_see_summary === 'boolean'
        ? parsed.guest_can_see_summary
        : DEFAULT_ACCESS_LAYERS.guest_can_see_summary,
    guest_stats_level: normalizeGuestStatsLevel(
      parsed.guest_stats_level ?? DEFAULT_ACCESS_LAYERS.guest_stats_level
    ),
    guest_can_see_ai_full:
      typeof parsed.guest_can_see_ai_full === 'boolean'
        ? parsed.guest_can_see_ai_full
        : DEFAULT_ACCESS_LAYERS.guest_can_see_ai_full,
  };

  return { access_mode, layers };
}

export function saveAccessPolicyLayers(layers: Partial<AccessPolicyLayers>): AccessPolicyLayers {
  const current = loadAccessPolicy().layers;
  const next: AccessPolicyLayers = {
    guest_can_see_summary:
      typeof layers.guest_can_see_summary === 'boolean'
        ? layers.guest_can_see_summary
        : current.guest_can_see_summary,
    guest_stats_level: layers.guest_stats_level
      ? normalizeGuestStatsLevel(layers.guest_stats_level)
      : current.guest_stats_level,
    guest_can_see_ai_full:
      typeof layers.guest_can_see_ai_full === 'boolean'
        ? layers.guest_can_see_ai_full
        : current.guest_can_see_ai_full,
  };
  SettingsRepo.set(ACCESS_POLICY_SETTING_KEY, JSON.stringify(next));
  return next;
}

export function saveAccessMode(mode: string): AccessMode {
  const normalized = normalizeAccessMode(mode);
  SettingsRepo.set(ACCESS_MODE_SETTING_KEY, normalized);
  return normalized;
}

export function computeIsVerified(
  accessMode: AccessMode,
  user: { is_verified?: number; has_deposited?: number; auth_provider?: string; email?: string } | null | undefined
): boolean {
  if (accessMode === ACCESS_MODES.FREE) return true;
  if (!user) return false;
  // In REGISTRATION_REQUIRED: verified registration or Google registered user gets access
  return !!(user.is_verified || user.auth_provider === 'google' || user.email);
}

function extractSessionToken(req: Request): string | undefined {
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
 * Resolves member vs guest from Telegram initData or signed web session.
 * Decision is server-side only — client flags are ignored.
 */
export function resolveAccessFromRequest(req: Request): ResolvedAccess {
  const policy = loadAccessPolicy();
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
    const token = extractSessionToken(req);
    if (token) {
      const verified = verifyWebSessionToken(token, getWebSessionSecret());
      if (verified.valid && verified.payload) {
        telegramId = verified.payload.telegramId ?? null;
        webId = verified.payload.webId ?? null;
      }
    }
  }

  const user = telegramId ? UsersRepo.getByTelegramId(telegramId) : null;
  const isVerified = computeIsVerified(policy.access_mode, user);

  return {
    access_mode: policy.access_mode,
    isVerified,
    telegramId,
    webId,
    layers: policy.layers,
  };
}
