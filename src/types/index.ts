export type { MatchStatus, AccessMode } from '../config/constants';
import type { MatchStatus, AccessMode } from '../config/constants';

export interface Prediction {
  id?: number;
  fixture_id?: number;
  tournament_name?: string;
  round_name?: string;
  surface?: string;
  match_date?: string;
  home_name: string;
  away_name: string;
  home_odds?: string;
  away_odds?: string;
  predicted_winner: string;
  win_probability: number;
  confidence: string;
  predicted_score?: string;
  best_bet_selection?: string;
  best_bet_market?: string;
  best_bet_ev?: string;
  best_bet_rationale?: string;
  alt_bet_selection?: string;
  alt_bet_market?: string;
  key_factors?: string[];
  devils_advocate_risk?: string;
  ai_summary?: string;
  home_image?: string;
  away_image?: string;
  home_id?: number;
  away_id?: number;
  status: MatchStatus;
  result_score?: string;
  channel_message_id?: number;
  published_at?: string;
  created_at?: string;
}

export interface TelegramUser {
  id?: number;
  telegram_id: number;
  is_verified: number; // 0 or 1
  verified_at?: string;
  registered_site_id?: number;
  verify_status?: string;
  verify_source?: string;
  has_deposited?: number;
  pending_site_id?: number;
  screenshot_file_id?: string;
  created_at?: string;
  last_active_at?: string;
}

export interface ReferralSite {
  id: number;
  name: string;
  logo_url: string;
  referral_url: string;
  app_url?: string;
  promo_code?: string;
  bonus_text?: string;
  steps_text?: string;
  is_active: number; // 0 or 1
  order_index: number;
  postback_key?: string;
  verify_mode?: 'postback' | 'manual';
  created_at?: string;
}

export interface SystemSetting {
  key: string;
  value: string;
}

export interface StatsSummary {
  totalPredictions: number;
  wonCount: number;
  lostCount: number;
  voidCount: number;
  winRatePct: number;
  activeCount: number;
}


export interface PublishedPlayer {
  id?: number;
  player_id: number;
  slug: string;
  full_name: string;
  short_name?: string;
  country_code?: string;
  country_name?: string;
  ranking?: number;
  gender: 'M' | 'F';
  image_url?: string;
  bio?: string;
  playstyle?: string;
  surface_stats_json?: string; // Serialized PlayerYearSurfaceStats[]
  recent_matches_json?: string; // Serialized Match[]
  ai_dossier_json?: string; // Serialized tactical strengths, weaknesses, radar
  is_featured?: number; // 0 or 1
  is_published?: number; // 0 or 1
  created_at?: string;
  updated_at?: string;
}

export interface WebsiteConfig {
  hero_title?: string;
  hero_subtitle?: string;
  announcement_badge?: string;
  announcement_url?: string;
  featured_player_ids?: number[];
  cta_button_text?: string;
  cta_button_url?: string;
  vip_banner_text?: string;
  vip_banner_url?: string;
}
