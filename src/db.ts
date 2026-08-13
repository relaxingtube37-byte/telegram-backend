import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const dbPath = process.env.DB_PATH || './data/telegram.db';
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

export const db = new Database(dbPath);

// Enable WAL mode for high performance concurrency
db.pragma('journal_mode = WAL');

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fixture_id INTEGER,
    match_title TEXT NOT NULL,
    tournament_name TEXT,
    surface TEXT,
    round_name TEXT,
    home_name TEXT NOT NULL,
    away_name TEXT NOT NULL,
    home_odds TEXT,
    away_odds TEXT,
    predicted_winner TEXT NOT NULL,
    predicted_score TEXT,
    win_probability INTEGER,
    confidence TEXT,
    key_factors TEXT,          -- JSON array of strings
    best_bet_market TEXT,
    best_bet_selection TEXT,
    best_bet_rationale TEXT,
    best_bet_ev TEXT,
    alt_bet_market TEXT,
    alt_bet_selection TEXT,
    alt_bet_rationale TEXT,
    alt_bet_risk TEXT,
    ai_summary TEXT,
    status TEXT DEFAULT 'UPCOMING', -- UPCOMING, LIVE, WON, LOST, VOID
    result_score TEXT,
    published_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS referral_sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    postback_key TEXT UNIQUE NOT NULL,
    verify_mode TEXT DEFAULT 'postback',
    app_url TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    subid TEXT UNIQUE,
    is_verified INTEGER DEFAULT 0,
    registered_site_id INTEGER,
    pending_site_id INTEGER,
    screenshot_file_id TEXT,
    verify_status TEXT DEFAULT 'none',
    verify_source TEXT DEFAULT '',
    has_deposited INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    verified_at TEXT,
    last_active_at TEXT
  );

  CREATE TABLE IF NOT EXISTS channel_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prediction_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    channel_id TEXT NOT NULL,
    posted_at TEXT NOT NULL,
    FOREIGN KEY(prediction_id) REFERENCES predictions(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Safe migrations for existing SQLite databases
try { db.exec("ALTER TABLE users ADD COLUMN last_active_at TEXT;"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN pending_site_id INTEGER;"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN screenshot_file_id TEXT;"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN verify_status TEXT DEFAULT 'none';"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN verify_source TEXT DEFAULT '';"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN has_deposited INTEGER DEFAULT 0;"); } catch {}
try { db.exec("ALTER TABLE referral_sites ADD COLUMN verify_mode TEXT DEFAULT 'postback';"); } catch {}
try { db.exec("ALTER TABLE referral_sites ADD COLUMN app_url TEXT DEFAULT '';"); } catch {}

console.log('✅ SQLite Database initialized at:', dbPath);

/**
 * Attach SubID=telegram_id to affiliate base URL
 */
export const buildReferralUrl = (baseUrl: string, telegramId: number): string => {
  if (!baseUrl || !baseUrl.trim()) return '';
  const cleanUrl = baseUrl.trim();
  const sub = String(telegramId);
  try {
    const parsed = new URL(cleanUrl);
    parsed.searchParams.set('subid', sub);
    parsed.searchParams.set('sub1', sub);
    if (!parsed.searchParams.has('sub_id')) parsed.searchParams.set('sub_id', sub);
    if (!parsed.searchParams.has('click_id')) parsed.searchParams.set('click_id', sub);
    return parsed.toString();
  } catch {
    const separator = cleanUrl.includes('?') ? '&' : '?';
    return `${cleanUrl}${separator}subid=${sub}&sub1=${sub}`;
  }
};

/**
 * Build /go/ click tracking URL
 */
export const buildGoUrl = (publicBaseUrl: string, siteId: number, telegramId: number): string => {
  const base = (publicBaseUrl || 'https://telegram-backend-2yck.onrender.com').trim().replace(/\/+$/, '');
  return `${base}/go/${siteId}/${telegramId}`;
};

/**
 * Get latest unverified user who clicked /go/ link (Fallback matching)
 */
export const getLatestUnverifiedUser = (siteId?: number): any => {
  if (siteId) {
    const user = db.prepare(`
      SELECT * FROM users 
      WHERE is_verified = 0 AND pending_site_id = ? 
      ORDER BY last_active_at DESC, telegram_id DESC LIMIT 1
    `).get(siteId);
    if (user) return user;
  }
  return db.prepare(`
    SELECT * FROM users 
    WHERE is_verified = 0 
    ORDER BY 
      CASE WHEN verify_status = 'pending' THEN 0 ELSE 1 END,
      COALESCE(last_active_at, created_at) DESC 
    LIMIT 1
  `).get();
};

/**
 * Mark user pending registration on a site
 */
export const setPendingSite = (telegramId: number, siteId: number) => {
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  if (!existing) {
    db.prepare(`
      INSERT INTO users (telegram_id, is_verified, pending_site_id, verify_status, created_at, last_active_at)
      VALUES (?, 0, ?, 'pending', ?, ?)
    `).run(telegramId, siteId, now, now);
  } else if (!(existing as any).is_verified) {
    db.prepare(`
      UPDATE users SET pending_site_id = ?, verify_status = 'pending', last_active_at = ? WHERE telegram_id = ?
    `).run(siteId, now, telegramId);
  }
};

/**
 * Mark user as verified
 */
export const setVerified = (telegramId: number, siteId?: number, source: string = 'postback') => {
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  if (existing) {
    db.prepare(`
      UPDATE users SET 
        is_verified = 1,
        verified_at = ?,
        verify_status = 'verified',
        verify_source = ?,
        registered_site_id = COALESCE(?, registered_site_id)
      WHERE telegram_id = ?
    `).run(now, source, siteId || null, telegramId);
  } else {
    db.prepare(`
      INSERT INTO users (telegram_id, is_verified, registered_site_id, verify_status, verify_source, created_at, verified_at, last_active_at)
      VALUES (?, 1, ?, 'verified', ?, ?, ?, ?)
    `).run(telegramId, siteId || null, source, now, now, now);
  }
};

/**
 * Mark user as deposited (VIP status)
 */
export const setUserDeposited = (telegramId: number) => {
  setVerified(telegramId, undefined, 'deposit');
  db.prepare('UPDATE users SET has_deposited = 1 WHERE telegram_id = ?').run(telegramId);
};
