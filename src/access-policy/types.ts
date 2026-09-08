/**
 * Phase A — Access policy for guest vs verified member content.
 * Values are read live from SQLite settings on every request (no in-memory cache).
 */

export const ACCESS_MODES = {
  FREE: 'FREE',
  REGISTRATION_REQUIRED: 'REGISTRATION_REQUIRED',
  /** Placeholder for future deposit / payment gateway gating */
  GATED_LATER: 'GATED_LATER',
} as const;

export type AccessMode = (typeof ACCESS_MODES)[keyof typeof ACCESS_MODES];

/** How much deep stats a guest may see */
export const GUEST_STATS_LEVELS = {
  NONE: 'none',
  PARTIAL: 'partial',
  FULL: 'full',
} as const;

export type GuestStatsLevel = (typeof GUEST_STATS_LEVELS)[keyof typeof GUEST_STATS_LEVELS];

export interface AccessPolicyLayers {
  /** Short AI summary (1–2 lines) for guests */
  guest_can_see_summary: boolean;
  /** Deep stats visibility for guests */
  guest_stats_level: GuestStatsLevel;
  /** Full AI dossier / long analysis for guests */
  guest_can_see_ai_full: boolean;
}

export interface AccessPolicySnapshot {
  access_mode: AccessMode;
  layers: AccessPolicyLayers;
}

export const DEFAULT_ACCESS_MODE: AccessMode = ACCESS_MODES.REGISTRATION_REQUIRED;

export const DEFAULT_ACCESS_LAYERS: AccessPolicyLayers = {
  guest_can_see_summary: true,
  guest_stats_level: GUEST_STATS_LEVELS.NONE,
  guest_can_see_ai_full: false,
};

export const ACCESS_POLICY_SETTING_KEY = 'access_policy';
export const ACCESS_MODE_SETTING_KEY = 'access_mode';

/** Always-public match teaser fields (never stripped for guests). */
export const PUBLIC_MATCH_TEASER_FIELDS = [
  'id',
  'fixture_id',
  'tournament_name',
  'round_name',
  'surface',
  'match_date',
  'home_name',
  'away_name',
  'home_odds',
  'away_odds',
  'home_image',
  'away_image',
  'home_id',
  'away_id',
  'predicted_winner',
  'win_probability',
  'confidence',
  'status',
  'result_score',
  'published_at',
  'created_at',
] as const;

/** Fields locked for guests unless layers allow them. */
export const GATED_MATCH_DEEP_FIELDS = [
  'ai_summary',
  'key_factors',
  'devils_advocate_risk',
  'best_bet_selection',
  'best_bet_market',
  'best_bet_ev',
  'best_bet_rationale',
  'alt_bet_selection',
  'alt_bet_market',
  'predicted_score',
] as const;
