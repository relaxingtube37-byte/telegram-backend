import { db } from './connection';
import { Logger } from '../utils/logger';

export const runMigrations = () => {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS players (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          player_id INTEGER UNIQUE NOT NULL,
          slug TEXT NOT NULL,
          full_name TEXT NOT NULL,
          short_name TEXT,
          country_code TEXT,
          country_name TEXT,
          ranking INTEGER,
          gender TEXT DEFAULT 'M',
          image_url TEXT,
          bio TEXT,
          playstyle TEXT,
          surface_stats_json TEXT,
          recent_matches_json TEXT,
          ai_dossier_json TEXT,
          is_featured INTEGER DEFAULT 0,
          is_published INTEGER DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS website_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS match_analytics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fixture_id INTEGER UNIQUE NOT NULL,
          tournament_name TEXT,
          round_name TEXT,
          match_date TEXT,
          home_id INTEGER,
          away_id INTEGER,
          home_name TEXT NOT NULL,
          away_name TEXT NOT NULL,
          surface TEXT,
          status TEXT DEFAULT 'SUCCESS',
          error_message TEXT,
          energy_json TEXT,
          surface_kpis_json TEXT,
          synergy_json TEXT,
          tactical_json TEXT,
          markov_odds_json TEXT,
          raw_result_json TEXT,
          computed_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    } catch {}

  const migrations = [
    "ALTER TABLE users ADD COLUMN username TEXT;",
    "ALTER TABLE users ADD COLUMN first_name TEXT;",
    "ALTER TABLE users ADD COLUMN last_active_at TEXT;",
    "ALTER TABLE users ADD COLUMN pending_site_id INTEGER;",
    "ALTER TABLE users ADD COLUMN screenshot_file_id TEXT;",
    "ALTER TABLE users ADD COLUMN verify_status TEXT DEFAULT 'none';",
    "ALTER TABLE users ADD COLUMN verify_source TEXT DEFAULT '';",
    "ALTER TABLE users ADD COLUMN has_deposited INTEGER DEFAULT 0;",
    "ALTER TABLE users ADD COLUMN email TEXT;",
    "ALTER TABLE users ADD COLUMN auth_provider TEXT DEFAULT 'telegram';",
    "ALTER TABLE users ADD COLUMN google_id TEXT;",
    "ALTER TABLE users ADD COLUMN avatar_url TEXT;",
    "ALTER TABLE referral_sites ADD COLUMN verify_mode TEXT DEFAULT 'postback';",
    "ALTER TABLE referral_sites ADD COLUMN app_url TEXT DEFAULT '';",
    "ALTER TABLE predictions ADD COLUMN match_date TEXT;",
    "ALTER TABLE predictions ADD COLUMN devils_advocate_risk TEXT;",
    "ALTER TABLE predictions ADD COLUMN home_image TEXT;",
    "ALTER TABLE predictions ADD COLUMN away_image TEXT;",
    "ALTER TABLE predictions ADD COLUMN home_id INTEGER;",
    "ALTER TABLE predictions ADD COLUMN away_id INTEGER;",
    "ALTER TABLE historical_matches ADD COLUMN rapid_event_id INTEGER;",
  ];

  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch {
      // Column already exists, safe to ignore
    }
  }

  // Ensure default access_mode setting exists
  try {
    const existing = db.prepare("SELECT value FROM settings WHERE key = 'access_mode'").get();
    if (!existing) {
      db.prepare("INSERT INTO settings (key, value) VALUES ('access_mode', 'REGISTRATION_REQUIRED')").run();
    }
  } catch (e: any) {
    Logger.warn('Settings migration check:', e.message);
  }

  // Phase C: attribution + conversion tables + business_action_settings seed
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS referral_clicks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        click_id TEXT UNIQUE NOT NULL,
        site_id INTEGER,
        partner_key TEXT NOT NULL,
        user_ref TEXT NOT NULL,
        session_ref TEXT,
        match_id INTEGER,
        fixture_id INTEGER,
        page_context TEXT,
        action_type TEXT NOT NULL,
        destination_url TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS partner_conversions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        partner_key TEXT NOT NULL,
        site_id INTEGER,
        event_type TEXT NOT NULL,
        click_id TEXT,
        transaction_id TEXT,
        dedupe_key TEXT UNIQUE NOT NULL,
        user_ref TEXT,
        status TEXT NOT NULL,
        raw_payload TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_referral_clicks_user_ref ON referral_clicks(user_ref);
      CREATE INDEX IF NOT EXISTS idx_partner_conversions_click ON partner_conversions(click_id);
    `);
  } catch (e: any) {
    Logger.warn('Phase C attribution tables migration:', e.message);
  }

  try {
    const biz = db.prepare("SELECT value FROM settings WHERE key = 'business_action_settings'").get();
    if (!biz) {
      const defaults = JSON.stringify({
        registration_referral_enabled: true,
        watch_live_enabled: true,
        payment_mode_placeholder_enabled: false,
        shared_watch_live_url: '',
        allowed_redirect_hosts: [],
        watch_live_event_url_template: '',
      });
      db.prepare("INSERT INTO settings (key, value) VALUES ('business_action_settings', ?)").run(defaults);
    }
  } catch (e: any) {
    Logger.warn('business_action_settings seed:', e.message);
  }

  // Phase D: enrich match_editorials for editorial package + workflow
  const phaseDEditorialCols = [
    "ALTER TABLE match_editorials ADD COLUMN subtitle TEXT;",
    "ALTER TABLE match_editorials ADD COLUMN short_summary TEXT;",
    "ALTER TABLE match_editorials ADD COLUMN key_facts_json TEXT;",
    "ALTER TABLE match_editorials ADD COLUMN data_bullets_json TEXT;",
    "ALTER TABLE match_editorials ADD COLUMN tags_json TEXT;",
    "ALTER TABLE match_editorials ADD COLUMN seo_metadata_json TEXT;",
    "ALTER TABLE match_editorials ADD COLUMN share_text TEXT;",
    "ALTER TABLE match_editorials ADD COLUMN guest_safe_summary TEXT;",
    "ALTER TABLE match_editorials ADD COLUMN publish_status TEXT DEFAULT 'draft';",
    "ALTER TABLE match_editorials ADD COLUMN version INTEGER DEFAULT 1;",
    "ALTER TABLE match_editorials ADD COLUMN editor_name TEXT;",
    "ALTER TABLE match_editorials ADD COLUMN published_at TEXT;",
    "ALTER TABLE match_editorials ADD COLUMN status_history_json TEXT;",
  ];
  for (const sql of phaseDEditorialCols) {
    try {
      db.exec(sql);
    } catch {
      // column exists
    }
  }
  try {
    db.exec(`UPDATE match_editorials SET publish_status = 'published' WHERE is_published = 1 AND (publish_status IS NULL OR publish_status = '')`);
    db.exec(`UPDATE match_editorials SET publish_status = 'draft' WHERE (publish_status IS NULL OR publish_status = '')`);
  } catch (e: any) {
    Logger.warn('Phase D publish_status backfill:', e.message);
  }

  // Backfill existing Google OAuth / email users to verified member status
  try {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE users 
      SET is_verified = 1, 
          verify_status = CASE WHEN verify_status = 'verified' THEN 'verified' ELSE 'google_verified' END,
          verified_at = COALESCE(verified_at, ?)
      WHERE (auth_provider = 'google' OR email IS NOT NULL) AND is_verified = 0
    `).run(now);
  } catch (e: any) {
    Logger.warn('Google users verification backfill migration:', e.message);
  }
};
