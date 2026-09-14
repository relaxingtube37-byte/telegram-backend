import { db } from './connection';
import { Logger } from '../utils/logger';
import { SEED_PLAYERS } from '../data/seedPlayers';

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

    // Seed top 300 ATP/WTA players into SQLite database (INSERT OR IGNORE is idempotent and takes <5ms)
    try {
      if (Array.isArray(SEED_PLAYERS) && SEED_PLAYERS.length > 0) {
        const insertStmt = db.prepare(`
          INSERT OR IGNORE INTO players (
            player_id, slug, full_name, short_name, country_code, country_name,
            ranking, gender, playstyle, is_featured, is_published, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, datetime('now'), datetime('now'))
        `);
        const insertMany = db.transaction((items: readonly any[]) => {
          for (const p of items) {
            insertStmt.run(
              p.player_id,
              p.slug,
              p.full_name,
              p.short_name || null,
              p.country_code || null,
              p.country_name || null,
              p.ranking || null,
              p.gender || 'M',
              p.playstyle || null
            );
          }
        });
        insertMany(SEED_PLAYERS);
        Logger.info(`[Migrations] Ensured top ATP/WTA seed players in database.`);
      }
    } catch (err: any) {
      Logger.warn('[Migrations] Player seed check:', err.message);
    }

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
    "ALTER TABLE predictions ADD COLUMN result_announced_at TEXT;",
    "ALTER TABLE predictions ADD COLUMN result_channel_message_id INTEGER;",
    "ALTER TABLE historical_matches ADD COLUMN rapid_event_id INTEGER;",
    "ALTER TABLE users ADD COLUMN referrer_id INTEGER;",
    "ALTER TABLE users ADD COLUMN referral_code TEXT;",
  ];

  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch {
      // Column already exists, safe to ignore
    }
  }

  // Existing settled channel posts: mark announced so restart/sync does not re-spam.
  // Only rows that already have a prediction channel message (i.e. were linked for replies).
  try {
    const backfill = db.prepare(`
      UPDATE predictions
      SET result_announced_at = COALESCE(result_announced_at, published_at, created_at, datetime('now'))
      WHERE status IN ('WON', 'LOST', 'VOID')
        AND channel_message_id IS NOT NULL
        AND result_announced_at IS NULL
    `).run();
    if (backfill.changes > 0) {
      Logger.info(`[Migrations] Backfilled result_announced_at on ${backfill.changes} settled prediction(s)`);
    }
  } catch (e: any) {
    Logger.warn('[Migrations] result_announced_at backfill:', e.message);
  }

  // Ensure access_mode setting defaults to REGISTRATION_REQUIRED for proper gating
  try {
    const existing = db.prepare("SELECT value FROM settings WHERE key = 'access_mode'").get() as { value: string } | undefined;
    if (!existing || existing.value === 'FREE') {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('access_mode', 'REGISTRATION_REQUIRED')").run();
      Logger.info('[Migrations] Enforced access_mode to REGISTRATION_REQUIRED');
    }
  } catch (e: any) {
    Logger.warn('Settings migration check:', e.message);
  }

  // Purge legacy dummy synthetic records
  try {
    db.prepare('DELETE FROM referral_sites WHERE id > 1').run();
    db.prepare(`
      DELETE FROM predictions 
      WHERE home_name LIKE 'Player A%' 
         OR home_name LIKE 'Test Player%' 
         OR tournament_name IS NULL 
         OR tournament_name = 'ATP Test Open' 
         OR tournament_name = 'Demo Open'
         OR (fixture_id IS NULL AND (home_name = 'Aryna Sabalenka' OR away_name = 'Iga Swiatek'))
    `).run();
    db.prepare(`
      DELETE FROM users 
      WHERE telegram_id IN (
        11223344, 99999999, 777888999, 555000111, 444333222, 
        900100200, 771122334, 778899112, 181436428, 99887766,
        99999, 8196898460650840, 907716999852, 434391463085576, 
        9506962061492124, 2296456773, 630659173439
      )
         OR email = 'testplayer@gmail.com'
         OR email = 'alireza@gmail.com'
         OR first_name = 'Test Player Updated'
         OR first_name = 'Google Test User'
         OR ((first_name IS NULL OR first_name = '' OR first_name = 'null') AND email IS NULL)
    `).run();
  } catch (e: any) {
    Logger.warn('[Migrations] Purge legacy records warning:', e.message);
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

  // Backfill existing Telegram users to verified member status in REGISTRATION_REQUIRED mode
  try {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE users 
      SET is_verified = 1, 
          verify_status = CASE WHEN verify_status = 'verified' THEN 'verified' ELSE 'telegram_verified' END,
          auth_provider = CASE WHEN auth_provider IS NULL OR auth_provider = '' THEN 'telegram' ELSE auth_provider END,
          verified_at = COALESCE(verified_at, ?)
      WHERE (auth_provider = 'telegram' OR (telegram_id IS NOT NULL AND telegram_id > 0)) AND is_verified = 0
    `).run(now);
  } catch (e: any) {
    Logger.warn('Telegram users verification backfill migration:', e.message);
  }

  // Normalize premature or fake LIVE predictions back to UPCOMING
  try {
    const res = db.prepare(`
      UPDATE predictions
      SET status = 'UPCOMING', result_score = NULL
      WHERE status = 'LIVE' AND (
        result_score IS NULL OR
        result_score = '' OR
        result_score = '0-0' OR
        result_score = '0-0   0-0    0-0'
      )
    `).run();
    if (res.changes > 0) {
      Logger.info(`[Migrations] Normalized ${res.changes} premature LIVE prediction(s) back to UPCOMING.`);
    }
  } catch (e: any) {
    Logger.warn('Premature LIVE predictions cleanup migration:', e.message);
  }

  // Auto-correct unfinished / retired / walkover predictions from LOST to VOID
  try {
    const res = db.prepare(`
      UPDATE predictions
      SET status = 'VOID',
          result_score = CASE
            WHEN result_score LIKE '%ret%' OR result_score = '1-0' OR result_score = '0-1' THEN '1-0 (Ret.)'
            WHEN result_score LIKE '%w/o%' OR result_score LIKE '%walkover%' THEN 'W/O'
            ELSE COALESCE(result_score, 'VOID')
          END
      WHERE (status = 'LOST' OR status = 'WON') AND (
        fixture_id = 17085122 OR
        result_score = '1-0' OR
        result_score = '0-1' OR
        result_score LIKE '%(Ret%)' OR
        result_score LIKE '%RET%' OR
        result_score LIKE '%W/O%'
      )
    `).run();
    if (res.changes > 0) {
      Logger.info(`[Migrations] Corrected ${res.changes} unfinished/retired prediction(s) from LOST to VOID.`);
    }
  } catch (e: any) {
    Logger.warn('Fix unfinished predictions migration:', e.message);
  }

  // Ensure 1WIN referral partner URL is set to the user's authentic affiliate link
  try {
    const userAffiliateUrl = (process.env.AFFILIATE_1WIN_URL || process.env.DEFAULT_AFFILIATE_URL || 'https://r1whtrt.life/betting?open=register&p=5ccv').trim();
    const res = db.prepare(`
      UPDATE referral_sites
      SET referral_url = ?, is_active = 1
      WHERE id = 1 OR LOWER(name) LIKE '%1win%'
    `).run(userAffiliateUrl);
    if (res.changes > 0) {
      Logger.info(`[Migrations] Set 1WIN affiliate destination URL to: ${userAffiliateUrl}`);
    }
  } catch (e: any) {
    Logger.warn('1WIN affiliate URL migration note:', e.message);
  }
};
