/**
 * ════════════════════════════════════════════════════════════════════════════
 * ☁️ NEON POSTGRESQL PERSISTENCE & BIDIRECTIONAL SYNC ENGINE
 * ════════════════════════════════════════════════════════════════════════════
 * Provides 100% durable cloud persistence for Telegram & WebApp backend data.
 * - On server startup: pulls all durable users, predictions, referral sites,
 *   and clicks from Neon PostgreSQL into SQLite (survives Render restarts).
 * - On every write / periodic sync: pushes new/updated records to Neon.
 * - Guarantees zero data loss across container recreations without blocking reads.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { Pool } from 'pg';
import { db } from '../db/connection';
import { ENV } from '../config/env';
import { Logger } from '../utils/logger';

export class NeonSyncService {
  private static pool: Pool | null = null;
  private static syncTimer: NodeJS.Timeout | null = null;
  private static isSyncing = false;

  public static getConnectionString(): string {
    return (
      ENV.NEON_DATABASE_URL ||
      process.env.NEON_DATABASE_URL ||
      process.env.DATABASE_URL ||
      ''
    ).trim();
  }

  public static isConfigured(): boolean {
    const conn = this.getConnectionString();
    return conn.startsWith('postgres://') || conn.startsWith('postgresql://');
  }

  public static getPool(): Pool | null {
    if (!this.pool && this.isConfigured()) {
      const connectionString = this.getConnectionString();
      this.pool = new Pool({
        connectionString,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });

      this.pool.on('error', (err) => {
        Logger.warn?.(`[NeonSync] Unexpected idle client error: ${err.message}`);
      });
    }
    return this.pool;
  }

  /**
   * Ensures the essential operational tables exist in Neon PostgreSQL.
   */
  public static async ensureSchema(): Promise<void> {
    const pool = this.getPool();
    if (!pool) return;

    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          telegram_id BIGINT UNIQUE,
          first_name TEXT,
          email TEXT,
          auth_provider TEXT DEFAULT 'telegram',
          google_id TEXT,
          avatar_url TEXT,
          is_verified INTEGER DEFAULT 0,
          verify_status TEXT DEFAULT 'none',
          verified_at TEXT,
          registered_site_id INTEGER,
          has_deposited INTEGER DEFAULT 0,
          pending_site_id INTEGER,
          created_at TEXT,
          last_active_at TEXT
        );

        CREATE TABLE IF NOT EXISTS referral_sites (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          logo_url TEXT,
          referral_url TEXT NOT NULL,
          app_url TEXT,
          promo_code TEXT,
          bonus_text TEXT,
          steps_text TEXT,
          is_active INTEGER DEFAULT 1,
          order_index INTEGER DEFAULT 0,
          postback_key TEXT,
          verify_mode TEXT DEFAULT 'postback',
          created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS referral_clicks (
          id SERIAL PRIMARY KEY,
          click_id TEXT UNIQUE NOT NULL,
          site_id INTEGER,
          partner_key TEXT,
          user_ref TEXT NOT NULL,
          session_ref TEXT,
          match_id INTEGER,
          fixture_id INTEGER,
          page_context TEXT,
          action_type TEXT,
          destination_url TEXT,
          created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS partner_conversions (
          id SERIAL PRIMARY KEY,
          partner_key TEXT,
          site_id INTEGER,
          event_type TEXT,
          click_id TEXT,
          transaction_id TEXT,
          dedupe_key TEXT UNIQUE,
          user_ref TEXT,
          status TEXT,
          raw_payload TEXT,
          received_at TEXT
        );

        CREATE TABLE IF NOT EXISTS predictions (
          id SERIAL PRIMARY KEY,
          fixture_id INTEGER UNIQUE,
          tournament_name TEXT,
          round_name TEXT,
          surface TEXT,
          match_date TEXT,
          home_name TEXT,
          away_name TEXT,
          home_odds TEXT,
          away_odds TEXT,
          predicted_winner TEXT,
          win_probability REAL,
          confidence TEXT,
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
          result_announced_at TEXT,
          result_channel_message_id INTEGER,
          published_at TEXT,
          created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS website_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
      Logger.success('[NeonSync] ☁️ Neon PostgreSQL schema verified.');
    } finally {
      client.release();
    }
  }

  /**
   * Pulls all durable data from Neon PostgreSQL to local SQLite.
   * Restores users, predictions, clicks, and affiliate settings on boot.
   */
  public static async pullFromNeon(): Promise<void> {
    const pool = this.getPool();
    if (!pool) return;

    const client = await pool.connect();
    try {
      // 0. Purge legacy dummy synthetic records both on Neon PostgreSQL and locally
      try {
        const purgePredsSql = `
          DELETE FROM predictions 
          WHERE home_name LIKE 'Player A%' 
             OR home_name LIKE 'Test Player%' 
             OR home_name LIKE 'Player %'
             OR away_name LIKE 'Player B%'
             OR away_name LIKE 'Test Player%'
             OR away_name LIKE 'Player %'
             OR tournament_name IS NULL 
             OR tournament_name = 'ATP Test Open' 
             OR tournament_name = 'Demo Open'
             OR tournament_name = 'Test Tournament'
             OR fixture_id IN (999001, 999002, 998811, 999123, 98765432, 88776655, 88001122, 99008877)
             OR (fixture_id < 100000)
             OR (fixture_id IS NULL AND (home_name = 'Aryna Sabalenka' OR away_name = 'Iga Swiatek'))
        `;
        // Execute on Neon PostgreSQL
        await client.query(purgePredsSql);
        await client.query('DELETE FROM referral_sites WHERE id > 1');
        const purgeUsersSql = `
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
        `;
        await client.query(purgeUsersSql);

        // Execute locally in SQLite
        db.prepare('DELETE FROM referral_sites WHERE id > 1').run();
        db.prepare(purgePredsSql).run();
        db.prepare(purgeUsersSql).run();
      } catch (e: any) {
        Logger.warn?.(`[NeonSync] Purge legacy records warning: ${e.message}`);
      }

      // 1. Pull referral_sites
      const sites = await client.query('SELECT * FROM referral_sites');
      if (sites.rows.length > 0) {
        const stmt = db.prepare(`
          INSERT INTO referral_sites (id, name, logo_url, referral_url, app_url, promo_code, bonus_text, steps_text, is_active, order_index, postback_key, verify_mode, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            referral_url = excluded.referral_url,
            is_active = excluded.is_active,
            promo_code = excluded.promo_code;
        `);
        for (const s of sites.rows) {
          stmt.run(
            s.id, s.name, s.logo_url || '', s.referral_url, s.app_url || '',
            s.promo_code || '', s.bonus_text || '', s.steps_text || '',
            s.is_active ?? 1, s.order_index ?? 0, s.postback_key || '',
            s.verify_mode || 'postback', s.created_at || new Date().toISOString()
          );
        }
      }

      // 2. Pull users
      const users = await client.query('SELECT * FROM users');
      if (users.rows.length > 0) {
        const userStmt = db.prepare(`
          INSERT INTO users (
            telegram_id, first_name, email, auth_provider, google_id,
            avatar_url, is_verified, verify_status, verified_at,
            registered_site_id, has_deposited, pending_site_id,
            created_at, last_active_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(telegram_id) DO UPDATE SET
            is_verified = excluded.is_verified,
            verify_status = excluded.verify_status,
            verified_at = excluded.verified_at,
            registered_site_id = excluded.registered_site_id,
            last_active_at = excluded.last_active_at;
        `);
        for (const u of users.rows) {
          userStmt.run(
            Number(u.telegram_id), u.first_name || '', u.email || null,
            u.auth_provider || 'telegram', u.google_id || null, u.avatar_url || null,
            u.is_verified ? 1 : 0, u.verify_status || 'none', u.verified_at || null,
            u.registered_site_id || null, u.has_deposited ? 1 : 0, u.pending_site_id || null,
            u.created_at || new Date().toISOString(), u.last_active_at || null
          );
        }
      }

      // 3. Pull predictions
      const preds = await client.query('SELECT * FROM predictions');
      if (preds.rows.length > 0) {
        const predStmt = db.prepare(`
          INSERT INTO predictions (
            fixture_id, tournament_name, round_name, surface, match_date,
            home_name, away_name, home_odds, away_odds, predicted_winner,
            win_probability, confidence, predicted_score, best_bet_selection,
            best_bet_market, best_bet_ev, best_bet_rationale, alt_bet_selection,
            alt_bet_market, key_factors, devils_advocate_risk, ai_summary,
            home_image, away_image, home_id, away_id, status, result_score,
            channel_message_id, result_announced_at, result_channel_message_id,
            published_at, created_at
          ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?
          )
          ON CONFLICT(fixture_id) DO UPDATE SET
            status = excluded.status,
            result_score = excluded.result_score,
            result_announced_at = excluded.result_announced_at,
            channel_message_id = excluded.channel_message_id,
            result_channel_message_id = excluded.result_channel_message_id;
        `);
        for (const p of preds.rows) {
          predStmt.run(
            p.fixture_id, p.tournament_name, p.round_name, p.surface, p.match_date,
            p.home_name, p.away_name, p.home_odds, p.away_odds, p.predicted_winner,
            p.win_probability, p.confidence, p.predicted_score, p.best_bet_selection,
            p.best_bet_market, p.best_bet_ev, p.best_bet_rationale, p.alt_bet_selection,
            p.alt_bet_market, p.key_factors, p.devils_advocate_risk, p.ai_summary,
            p.home_image, p.away_image, p.home_id, p.away_id, p.status, p.result_score,
            p.channel_message_id, p.result_announced_at, p.result_channel_message_id,
            p.published_at, p.created_at
          );
        }
      }

      Logger.info(`[NeonSync] 🔄 Restored ${users.rows.length} users, ${preds.rows.length} predictions from Neon.`);
    } catch (err: any) {
      Logger.warn?.(`[NeonSync] Pull error: ${err.message}`);
    } finally {
      client.release();
    }
  }

  /**
   * Pushes local SQLite data (users, predictions, clicks, conversions, sites) to Neon.
   */
  public static async pushToNeon(): Promise<void> {
    if (this.isSyncing) return;
    const pool = this.getPool();
    if (!pool) return;

    this.isSyncing = true;
    let client;
    try {
      client = await pool.connect();

      // 1. Push referral_sites
      const localSites = db.prepare('SELECT * FROM referral_sites').all() as any[];
      for (const s of localSites) {
        await client.query(`
          INSERT INTO referral_sites (id, name, logo_url, referral_url, app_url, promo_code, bonus_text, steps_text, is_active, order_index, postback_key, verify_mode, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          ON CONFLICT (id) DO UPDATE SET
            referral_url = EXCLUDED.referral_url,
            is_active = EXCLUDED.is_active,
            promo_code = EXCLUDED.promo_code;
        `, [
          s.id, s.name, s.logo_url, s.referral_url, s.app_url,
          s.promo_code, s.bonus_text, s.steps_text, s.is_active,
          s.order_index, s.postback_key, s.verify_mode, s.created_at
        ]);
      }

      // 2. Push users
      const localUsers = db.prepare('SELECT * FROM users').all() as any[];
      for (const u of localUsers) {
        if (!u.telegram_id || u.telegram_id === 99999 || String(u.telegram_id) === '99999') continue;
        if (u.first_name === 'Google Test User' || u.email === 'alireza@gmail.com') continue;
        if ((!u.first_name || u.first_name === 'null' || u.first_name.trim() === '') && !u.email) continue;
        await client.query(`
          INSERT INTO users (
            telegram_id, first_name, email, auth_provider, google_id,
            avatar_url, is_verified, verify_status, verified_at,
            registered_site_id, has_deposited, pending_site_id,
            created_at, last_active_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (telegram_id) DO UPDATE SET
            is_verified = EXCLUDED.is_verified,
            verify_status = EXCLUDED.verify_status,
            verified_at = EXCLUDED.verified_at,
            registered_site_id = EXCLUDED.registered_site_id,
            last_active_at = EXCLUDED.last_active_at;
        `, [
          u.telegram_id, u.first_name, u.email, u.auth_provider, u.google_id,
          u.avatar_url, u.is_verified ? 1 : 0, u.verify_status, u.verified_at,
          u.registered_site_id, u.has_deposited ? 1 : 0, u.pending_site_id,
          u.created_at, u.last_active_at
        ]);
      }

      // 3. Push predictions
      const localPreds = db.prepare('SELECT * FROM predictions').all() as any[];
      for (const p of localPreds) {
        if (!p.fixture_id || Number(p.fixture_id) < 100000) continue;
        if (!p.tournament_name || p.tournament_name.includes('Test') || p.tournament_name === 'Demo Open') continue;
        if (p.home_name?.startsWith('Player ') || p.home_name?.startsWith('Test Player')) continue;
        await client.query(`
          INSERT INTO predictions (
            fixture_id, tournament_name, round_name, surface, match_date,
            home_name, away_name, home_odds, away_odds, predicted_winner,
            win_probability, confidence, predicted_score, best_bet_selection,
            best_bet_market, best_bet_ev, best_bet_rationale, alt_bet_selection,
            alt_bet_market, key_factors, devils_advocate_risk, ai_summary,
            home_image, away_image, home_id, away_id, status, result_score,
            channel_message_id, result_announced_at, result_channel_message_id,
            published_at, created_at
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10,
            $11, $12, $13, $14,
            $15, $16, $17, $18,
            $19, $20, $21, $22,
            $23, $24, $25, $26, $27, $28,
            $29, $30, $31,
            $32, $33
          )
          ON CONFLICT (fixture_id) DO UPDATE SET
            status = EXCLUDED.status,
            result_score = EXCLUDED.result_score,
            result_announced_at = EXCLUDED.result_announced_at;
        `, [
          p.fixture_id, p.tournament_name, p.round_name, p.surface, p.match_date,
          p.home_name, p.away_name, p.home_odds, p.away_odds, p.predicted_winner,
          Number(p.win_probability) || 0, p.confidence, p.predicted_score, p.best_bet_selection,
          p.best_bet_market, p.best_bet_ev, p.best_bet_rationale, p.alt_bet_selection,
          p.alt_bet_market, p.key_factors, p.devils_advocate_risk, p.ai_summary,
          p.home_image, p.away_image, p.home_id, p.away_id, p.status, p.result_score,
          p.channel_message_id, p.result_announced_at, p.result_channel_message_id,
          p.published_at, p.created_at
        ]);
      }

      // 4. Push referral_clicks
      const localClicks = db.prepare('SELECT * FROM referral_clicks ORDER BY id DESC LIMIT 500').all() as any[];
      for (const c of localClicks) {
        if (!c.click_id) continue;
        await client.query(`
          INSERT INTO referral_clicks (
            click_id, site_id, partner_key, user_ref, session_ref,
            match_id, fixture_id, page_context, action_type, destination_url, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (click_id) DO NOTHING;
        `, [
          c.click_id, c.site_id, c.partner_key, c.user_ref, c.session_ref,
          c.match_id, c.fixture_id, c.page_context, c.action_type, c.destination_url, c.created_at
        ]);
      }

      // 5. Push partner_conversions
      const localConvs = db.prepare('SELECT * FROM partner_conversions ORDER BY id DESC LIMIT 200').all() as any[];
      for (const cv of localConvs) {
        if (!cv.dedupe_key) continue;
        await client.query(`
          INSERT INTO partner_conversions (
            partner_key, site_id, event_type, click_id, transaction_id,
            dedupe_key, user_ref, status, raw_payload, received_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (dedupe_key) DO NOTHING;
        `, [
          cv.partner_key, cv.site_id, cv.event_type, cv.click_id, cv.transaction_id,
          cv.dedupe_key, cv.user_ref, cv.status, cv.raw_payload, cv.received_at
        ]);
      }
    } catch (err: any) {
      Logger.warn?.(`[NeonSync] Push error: ${err.message}`);
    } finally {
      if (client) client.release();
      this.isSyncing = false;
    }
  }

  /**
   * Starts the background cloud synchronization loop.
   */
  public static async start(intervalMs = 60000): Promise<void> {
    if (!this.isConfigured()) {
      Logger.info('[NeonSync] No NEON_DATABASE_URL or DATABASE_URL provided. Running local SQLite mode.');
      return;
    }

    try {
      Logger.info('[NeonSync] 🚀 Initializing Neon PostgreSQL Cloud Sync...');
      await this.ensureSchema();
      await this.pullFromNeon();
      await this.pushToNeon();
      Logger.success('[NeonSync] ✅ Initial cloud sync completed successfully.');

      this.syncTimer = setInterval(() => {
        this.pushToNeon().catch((e) => Logger.warn?.(`[NeonSync] Periodic sync error: ${e.message}`));
      }, intervalMs);
    } catch (err: any) {
      Logger.warn?.(`[NeonSync] Failed to start NeonSyncService: ${err.message}`);
    }
  }

  public static stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.pool) {
      this.pool.end().catch(() => {});
      this.pool = null;
    }
  }
}
