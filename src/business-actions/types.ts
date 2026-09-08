/** Phase C business CTAs — separate from access_policy (Phase A). */

export const BUSINESS_ACTION_SETTING_KEY = 'business_action_settings';

export type ReferralActionType = 'registration' | 'watch_live';

/** Extensible partner conversion events. */
export type PartnerEventType =
  | 'registration'
  | 'verified_registration'
  | 'first_deposit'
  | 'rejected';

export interface BusinessActionSettings {
  registration_referral_enabled: boolean;
  watch_live_enabled: boolean;
  /** Placeholder only — no real payment gateway in Phase C. */
  payment_mode_placeholder_enabled: boolean;
  /** Shared partner URL for Watch Live (phase 1). Empty → first active referral site. */
  shared_watch_live_url: string;
  /** Extra allowed redirect hosts (hostname only). Empty → derived from partners + shared URL. */
  allowed_redirect_hosts: string[];
  /**
   * Phase 2 structure only — official partner event deep-link template.
   * Leave empty until a documented pattern exists. Do not invent placeholders.
   * Example shape (unused until filled): `https://partner.example/event/{fixture_id}`
   */
  watch_live_event_url_template: string;
}

export const DEFAULT_BUSINESS_ACTION_SETTINGS: BusinessActionSettings = {
  registration_referral_enabled: true,
  watch_live_enabled: true,
  payment_mode_placeholder_enabled: false,
  shared_watch_live_url: '',
  allowed_redirect_hosts: [],
  watch_live_event_url_template: '',
};

export interface ReferralClickRecord {
  id: number;
  click_id: string;
  site_id: number | null;
  partner_key: string;
  user_ref: string;
  session_ref: string | null;
  match_id: number | null;
  fixture_id: number | null;
  page_context: string | null;
  action_type: ReferralActionType;
  destination_url: string;
  created_at: string;
}

export interface PartnerConversionRecord {
  id: number;
  partner_key: string;
  site_id: number | null;
  event_type: PartnerEventType;
  click_id: string | null;
  transaction_id: string | null;
  dedupe_key: string;
  user_ref: string | null;
  status: 'accepted' | 'duplicate' | 'rejected' | 'failed';
  raw_payload: string;
  received_at: string;
}
