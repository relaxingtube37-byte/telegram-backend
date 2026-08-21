import { db } from './connection';
import { Logger } from '../utils/logger';

export const runMigrations = () => {
  const migrations = [
    "ALTER TABLE users ADD COLUMN last_active_at TEXT;",
    "ALTER TABLE users ADD COLUMN pending_site_id INTEGER;",
    "ALTER TABLE users ADD COLUMN screenshot_file_id TEXT;",
    "ALTER TABLE users ADD COLUMN verify_status TEXT DEFAULT 'none';",
    "ALTER TABLE users ADD COLUMN verify_source TEXT DEFAULT '';",
    "ALTER TABLE users ADD COLUMN has_deposited INTEGER DEFAULT 0;",
    "ALTER TABLE referral_sites ADD COLUMN verify_mode TEXT DEFAULT 'postback';",
    "ALTER TABLE referral_sites ADD COLUMN app_url TEXT DEFAULT '';",
    "ALTER TABLE predictions ADD COLUMN match_date TEXT;",
    "ALTER TABLE predictions ADD COLUMN devils_advocate_risk TEXT;",
    "ALTER TABLE predictions ADD COLUMN home_image TEXT;",
    "ALTER TABLE predictions ADD COLUMN away_image TEXT;",
    "ALTER TABLE predictions ADD COLUMN home_id INTEGER;",
    "ALTER TABLE predictions ADD COLUMN away_id INTEGER;",
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
      db.prepare("INSERT INTO settings (key, value) VALUES ('access_mode', 'FREE')").run();
    }
  } catch (e: any) {
    Logger.warn('Settings migration check:', e.message);
  }
};
