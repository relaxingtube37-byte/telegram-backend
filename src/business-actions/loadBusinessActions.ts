import { SettingsRepo } from '../db/repositories/settings.repo';
import {
  BUSINESS_ACTION_SETTING_KEY,
  DEFAULT_BUSINESS_ACTION_SETTINGS,
  type BusinessActionSettings,
} from './types';

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1' || v === 'true') return true;
  if (v === 0 || v === '0' || v === 'false') return false;
  return fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);
}

/** Live SQLite read — no cache (same pattern as access_policy). */
export function loadBusinessActionSettings(): BusinessActionSettings {
  const raw = SettingsRepo.get(BUSINESS_ACTION_SETTING_KEY);
  if (!raw) return { ...DEFAULT_BUSINESS_ACTION_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<BusinessActionSettings>;
    return {
      registration_referral_enabled: asBool(
        parsed.registration_referral_enabled,
        DEFAULT_BUSINESS_ACTION_SETTINGS.registration_referral_enabled
      ),
      watch_live_enabled: asBool(
        parsed.watch_live_enabled,
        DEFAULT_BUSINESS_ACTION_SETTINGS.watch_live_enabled
      ),
      payment_mode_placeholder_enabled: asBool(
        parsed.payment_mode_placeholder_enabled,
        DEFAULT_BUSINESS_ACTION_SETTINGS.payment_mode_placeholder_enabled
      ),
      shared_watch_live_url: String(parsed.shared_watch_live_url || '').trim(),
      allowed_redirect_hosts: asStringArray(parsed.allowed_redirect_hosts),
      watch_live_event_url_template: String(parsed.watch_live_event_url_template || '').trim(),
    };
  } catch {
    return { ...DEFAULT_BUSINESS_ACTION_SETTINGS };
  }
}

export function saveBusinessActionSettings(
  partial: Partial<BusinessActionSettings>
): BusinessActionSettings {
  const current = loadBusinessActionSettings();
  const next: BusinessActionSettings = {
    registration_referral_enabled:
      partial.registration_referral_enabled !== undefined
        ? asBool(partial.registration_referral_enabled, current.registration_referral_enabled)
        : current.registration_referral_enabled,
    watch_live_enabled:
      partial.watch_live_enabled !== undefined
        ? asBool(partial.watch_live_enabled, current.watch_live_enabled)
        : current.watch_live_enabled,
    payment_mode_placeholder_enabled:
      partial.payment_mode_placeholder_enabled !== undefined
        ? asBool(partial.payment_mode_placeholder_enabled, current.payment_mode_placeholder_enabled)
        : current.payment_mode_placeholder_enabled,
    shared_watch_live_url:
      partial.shared_watch_live_url !== undefined
        ? String(partial.shared_watch_live_url || '').trim()
        : current.shared_watch_live_url,
    allowed_redirect_hosts:
      partial.allowed_redirect_hosts !== undefined
        ? asStringArray(partial.allowed_redirect_hosts)
        : current.allowed_redirect_hosts,
    watch_live_event_url_template:
      partial.watch_live_event_url_template !== undefined
        ? String(partial.watch_live_event_url_template || '').trim()
        : current.watch_live_event_url_template,
  };
  SettingsRepo.set(BUSINESS_ACTION_SETTING_KEY, JSON.stringify(next));
  return next;
}
