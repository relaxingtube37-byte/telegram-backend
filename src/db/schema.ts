import { db } from './connection';

export const initSchema = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE NOT NULL,
      is_verified INTEGER DEFAULT 0,
      verified_at TEXT,
      registered_site_id INTEGER,
      verify_status TEXT DEFAULT 'none',
      verify_source TEXT DEFAULT '',
      has_deposited INTEGER DEFAULT 0,
      pending_site_id INTEGER,
      screenshot_file_id TEXT,
      created_at TEXT NOT NULL,
      last_active_at TEXT
    );

    CREATE TABLE IF NOT EXISTS referral_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      logo_url TEXT,
      referral_url TEXT NOT NULL,
      app_url TEXT DEFAULT '',
      promo_code TEXT,
      bonus_text TEXT,
      steps_text TEXT,
      is_active INTEGER DEFAULT 1,
      order_index INTEGER DEFAULT 0,
      postback_key TEXT,
      verify_mode TEXT DEFAULT 'postback',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id INTEGER UNIQUE,
      tournament_name TEXT,
      round_name TEXT,
      surface TEXT,
      match_date TEXT,
      home_name TEXT NOT NULL,
      away_name TEXT NOT NULL,
      home_odds TEXT,
      away_odds TEXT,
      predicted_winner TEXT NOT NULL,
      win_probability INTEGER NOT NULL,
      confidence TEXT NOT NULL,
      predicted_score TEXT,
      best_bet_selection TEXT,
      best_bet_market TEXT,
      best_bet_ev TEXT,
      best_bet_rationale TEXT,
      alt_bet_selection TEXT,
      alt_bet_market TEXT,
      key_factors TEXT,
      devils_advocate_risk TEXT,
      ai_summary TEXT,
      home_image TEXT,
      away_image TEXT,
      home_id INTEGER,
      away_id INTEGER,
      status TEXT DEFAULT 'UPCOMING',
      result_score TEXT,
      channel_message_id INTEGER,
      published_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS channel_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prediction_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      posted_at TEXT NOT NULL,
      FOREIGN KEY(prediction_id) REFERENCES predictions(id)
    );

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

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
};
