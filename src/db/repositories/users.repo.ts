import { db } from '../connection';
import type { TelegramUser } from '../../types';

export const UsersRepo = {
  getAll: (limit = 200): any[] => {
    return db.prepare('SELECT * FROM users ORDER BY COALESCE(last_active_at, created_at) DESC LIMIT ?').all(limit);
  },

  getByTelegramId: (telegramId: number): any => {
    return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  },

  getByGoogleId: (googleId: string): any => {
    return db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);
  },

  getByEmail: (email: string): any => {
    return db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email);
  },

  upsertFromGoogle: (profile: {
    googleId: string;
    email: string;
    name?: string;
    picture?: string;
    syntheticId: number;
  }): any => {
    const now = new Date().toISOString();
    let existing = db.prepare('SELECT * FROM users WHERE google_id = ?').get(profile.googleId) as any;
    if (!existing && profile.email) {
      existing = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(profile.email) as any;
    }

    if (existing) {
      db.prepare(`
        UPDATE users SET
          email = COALESCE(?, email),
          first_name = COALESCE(?, first_name),
          avatar_url = COALESCE(?, avatar_url),
          google_id = COALESCE(?, google_id),
          auth_provider = CASE WHEN auth_provider IS NULL OR auth_provider = '' THEN 'google' ELSE auth_provider END,
          last_active_at = ?
        WHERE id = ?
      `).run(
        profile.email,
        profile.name || null,
        profile.picture || null,
        profile.googleId,
        now,
        existing.id
      );
      return db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id);
    } else {
      const info = db.prepare(`
        INSERT INTO users (
          telegram_id,
          first_name,
          email,
          auth_provider,
          google_id,
          avatar_url,
          is_verified,
          created_at,
          last_active_at
        )
        VALUES (?, ?, ?, 'google', ?, ?, 0, ?, ?)
      `).run(
        profile.syntheticId,
        profile.name || null,
        profile.email,
        profile.googleId,
        profile.picture || null,
        now,
        now
      );
      return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    }
  },

  getLatestUnverified: (siteId?: number): any => {
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
  },

  touchActivity: (telegramId: number): void => {
    const now = new Date().toISOString();
    const existing = db.prepare('SELECT id FROM users WHERE telegram_id = ?').get(telegramId);
    if (!existing) {
      db.prepare('INSERT INTO users (telegram_id, is_verified, created_at, last_active_at) VALUES (?, 0, ?, ?)').run(telegramId, now, now);
    } else {
      db.prepare('UPDATE users SET last_active_at = ? WHERE telegram_id = ?').run(now, telegramId);
    }
  },

  upsertFromBot: (telegramId: number, profile: { first_name?: string; username?: string }): void => {
    const now = new Date().toISOString();
    const existing = db.prepare('SELECT id FROM users WHERE telegram_id = ?').get(telegramId);
    if (!existing) {
      db.prepare(`
        INSERT INTO users (telegram_id, first_name, username, is_verified, created_at, last_active_at)
        VALUES (?, ?, ?, 0, ?, ?)
      `).run(telegramId, profile.first_name || null, profile.username || null, now, now);
    } else {
      db.prepare(`
        UPDATE users SET 
          first_name = COALESCE(?, first_name),
          username = COALESCE(?, username),
          last_active_at = ?
        WHERE telegram_id = ?
      `).run(profile.first_name || null, profile.username || null, now, telegramId);
    }
  },

  setPendingSite: (telegramId: number, siteId: number): void => {
    const now = new Date().toISOString();
    const existing = db.prepare('SELECT id, is_verified FROM users WHERE telegram_id = ?').get(telegramId) as any;
    if (!existing) {
      db.prepare(`
        INSERT INTO users (telegram_id, is_verified, pending_site_id, verify_status, created_at, last_active_at)
        VALUES (?, 0, ?, 'pending', ?, ?)
      `).run(telegramId, siteId, now, now);
    } else if (!existing.is_verified) {
      db.prepare('UPDATE users SET pending_site_id = ?, verify_status = \'pending\', last_active_at = ? WHERE telegram_id = ?').run(siteId, now, telegramId);
    }
  },

  setVerified: (telegramId: number, siteId?: number, source: string = 'postback'): void => {
    const now = new Date().toISOString();
    const existing = db.prepare('SELECT id FROM users WHERE telegram_id = ?').get(telegramId);
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
  },

  setManualVerified: (telegramId: number, verified: boolean): void => {
    const now = new Date().toISOString();
    const isV = verified ? 1 : 0;
    const vStat = verified ? 'verified' : 'none';
    const vAt = verified ? now : null;

    const existing = db.prepare('SELECT id FROM users WHERE telegram_id = ?').get(telegramId);
    if (existing) {
      db.prepare('UPDATE users SET is_verified = ?, verify_status = ?, verify_source = \'manual_admin\', verified_at = ? WHERE telegram_id = ?').run(isV, vStat, vAt, telegramId);
    } else {
      db.prepare('INSERT INTO users (telegram_id, is_verified, verify_status, verify_source, created_at, verified_at, last_active_at) VALUES (?, ?, ?, \'manual_admin\', ?, ?, ?)').run(telegramId, isV, vStat, now, vAt, now);
    }
  },

  setDeposited: (telegramId: number): void => {
    UsersRepo.setVerified(telegramId, undefined, 'deposit');
    db.prepare('UPDATE users SET has_deposited = 1 WHERE telegram_id = ?').run(telegramId);
  },
};
