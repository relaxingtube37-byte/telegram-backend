import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { db, setPendingSite, setVerified, buildReferralUrl, buildGoUrl } from './db';
import { bot, publishPredictionToChannel, updateChannelPostResult, publishBatchSummaryToChannel } from './bot';
import { handlePostbackWebhook } from './postback';

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;
const adminSecret = process.env.ADMIN_SECRET || 'sofascore-tennis-admin-secret-2026';

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-secret', 'X-Admin-Secret'],
}));
app.use(express.json());

// ── JSON Syntax Error Guard ────────────────────────────────────────────────
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err) {
    console.error('[BAD JSON PAYLOAD]:', err.message);
    return res.status(400).json({ error: 'Malformed JSON payload: Invalid escape sequence or formatting' });
  }
  next(err);
});

// ── Admin Auth Middleware ──────────────────────────────────────────────────
const requireAdminAuth = (req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'OPTIONS') return next();

  const currentSecret = (process.env.ADMIN_SECRET || 'sofascore-tennis-admin-secret-2026').trim();
  const rawHeader = ((req.headers['x-admin-secret'] || req.query.secret) as string || '').trim();
  let decodedHeader = rawHeader;
  try {
    if (rawHeader) decodedHeader = decodeURIComponent(rawHeader).trim();
  } catch {}

  if (rawHeader !== currentSecret && decodedHeader !== currentSecret) {
    console.warn(`[AUTH FAILED] Received header: "${rawHeader}", Expected length: ${currentSecret.length}`);
    return res.status(401).json({ error: 'Unauthorized: Invalid Admin Secret' });
  }
  next();
};

// ── Health Check ───────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const currentSec = (process.env.ADMIN_SECRET || 'sofascore-tennis-admin-secret-2026').trim();
  const botTok = (process.env.BOT_TOKEN || '').trim();
  const chanId = (process.env.CHANNEL_ID || '').trim();

  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    adminSecretValue: currentSec,
    botTokenSet: Boolean(botTok && !botTok.includes('YOUR_')),
    channelIdSet: Boolean(chanId && !chanId.includes('12345')),
    channelIdValue: chanId,
  });
});

app.get('/api/admin/test-bot-channel', requireAdminAuth, async (req: Request, res: Response) => {
  const currentChannelId = (process.env.CHANNEL_ID || '').trim();
  const botUsernameEnv = (process.env.BOT_USERNAME || '').replace(/^@/, '').trim();
  const rawBotUsername = botUsernameEnv || 'admdinbetbetforbot';
  const webAppShortName = (process.env.WEBAPP_SHORT_NAME || 'app').trim();

  if (!bot) return res.status(500).json({ error: 'Bot is null. Check BOT_TOKEN.' });

  const targetUrl = `https://t.me/${rawBotUsername}/${webAppShortName}`;

  const { InlineKeyboard } = await import('grammy');
  const keyboard = new InlineKeyboard().url('🚀 Open Full Analysis in WebApp', targetUrl);

  try {
    const result = await bot.api.sendMessage(currentChannelId, '🎾 Test message with button', {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
    res.json({ success: true, messageId: result.message_id, targetUrl, channelId: currentChannelId });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message, targetUrl, channelId: currentChannelId });
  }
});

// ── WebApp Public Endpoints ────────────────────────────────────────────────

// Get published predictions for TWA
app.get('/api/webapp/predictions', (req, res) => {
  const predictions = db.prepare(`
    SELECT * FROM predictions ORDER BY id DESC LIMIT 50
  `).all().map((p: any) => ({
    ...p,
    key_factors: p.key_factors ? JSON.parse(p.key_factors) : [],
  }));

  res.json(predictions);
});

// Get channel accuracy stats
app.get('/api/webapp/stats', (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM predictions WHERE status IN ("WON", "LOST")').get() as any;
    const won = db.prepare('SELECT COUNT(*) as count FROM predictions WHERE status = "WON"').get() as any;
    const lost = db.prepare('SELECT COUNT(*) as count FROM predictions WHERE status = "LOST"').get() as any;
    const upcoming = db.prepare('SELECT COUNT(*) as count FROM predictions WHERE status = "UPCOMING"').get() as any;

    const totalSettled = total?.count || 0;
    const winCount = won?.count || 0;
    const lostCount = lost?.count || 0;
    const upcomingCount = upcoming?.count || 0;
    const winRate = totalSettled > 0 ? Math.round((winCount / totalSettled) * 100) : 0;

    res.json({
      totalPredictions: totalSettled + upcomingCount,
      settled: totalSettled,
      won: winCount,
      lost: lostCount,
      upcoming: upcomingCount,
      winRatePct: winRate,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Get active referral sites
app.get('/api/webapp/referrals', (req, res) => {
  const sites = db.prepare('SELECT id, name, base_url, app_url, verify_mode FROM referral_sites WHERE is_active = 1').all();
  res.json(sites);
});

// Click Tracking & Redirect Endpoint (/go/:siteId/:telegramId)
app.get(['/go/:siteId/:telegramId', '/api/go/:siteId/:telegramId'], (req: Request, res: Response) => {
  const siteId = parseInt(String(req.params.siteId || ''), 10);
  const telegramId = parseInt(String(req.params.telegramId || ''), 10);

  if (!telegramId || isNaN(telegramId)) {
    return res.status(400).send('Invalid telegram_id');
  }

  const site = db.prepare('SELECT * FROM referral_sites WHERE id = ? AND is_active = 1').get(siteId) as any;
  if (!site) {
    return res.status(404).send('Referral site not found');
  }

  // Record pending site click in DB
  setPendingSite(telegramId, siteId);

  // Check if site verification mode is instant on click (OPEN_LINK)
  if (site.verify_mode === 'open_link') {
    setVerified(telegramId, siteId, 'open_link');
    if (bot) {
      bot.api.sendMessage(
        telegramId,
        `✅ <b>Access Unlocked!</b>\n\nYour account access has been unlocked via <b>${site.name}</b>. All tennis AI match predictions are now unlocked!`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }
  }

  // Build target referral URL with subid tracking
  const targetUrl = buildReferralUrl(site.base_url, telegramId);
  return res.redirect(302, targetUrl);
});

// Get WebApp public config (access_mode)
app.get('/api/webapp/config', (req, res) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('access_mode') as any;
  const access_mode = row?.value || 'REGISTRATION_REQUIRED';
  res.json({ access_mode });
});

// Get user verification status & auto-record MiniApp visitors
app.all(['/api/webapp/user/:telegramId', '/api/webapp/user/ping'], (req: Request, res: Response) => {
  const tidParam = req.params.telegramId || req.body?.telegram_id || req.query?.telegram_id;
  const tid = parseInt(tidParam as string, 10);

  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('access_mode') as any;
  const access_mode = row?.value || 'REGISTRATION_REQUIRED';

  if (!tid || isNaN(tid)) {
    return res.json({ registered: false, verified: false, access_mode });
  }

  const first_name = (req.query.first_name || req.body?.first_name || '') as string;
  const username = (req.query.username || req.body?.username || '') as string;
  const now = new Date().toISOString();

  let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tid) as any;

  if (!user) {
    db.prepare(`
      INSERT INTO users (telegram_id, username, first_name, is_verified, created_at, last_active_at)
      VALUES (?, ?, ?, 0, ?, ?)
    `).run(tid, username || null, first_name || null, now, now);
    user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tid) as any;
  } else {
    // Update last_active_at & name info if available
    db.prepare(`
      UPDATE users SET 
        last_active_at = ?,
        username = COALESCE(NULLIF(?, ''), username),
        first_name = COALESCE(NULLIF(?, ''), first_name)
      WHERE telegram_id = ?
    `).run(now, username, first_name, tid);
  }

  res.json({
    registered: true,
    verified: user?.is_verified === 1,
    first_name: user?.first_name || first_name || null,
    username: user?.username || username || null,
    site_id: user?.registered_site_id,
    access_mode,
  });
});

// ── Referral Postback Webhook ─────────────────────────────────────────────
app.get('/api/postback/:siteKey', handlePostbackWebhook);
app.post('/api/postback/:siteKey', handlePostbackWebhook);
app.get('/postback/:siteKey', handlePostbackWebhook);
app.post('/postback/:siteKey', handlePostbackWebhook);

// ── Admin Endpoints (Used by state football Admin Panel) ──────────────────

// Admin: Publish prediction to Channel & TWA
app.post('/api/admin/predictions/publish', requireAdminAuth, async (req: Request, res: Response) => {
  const p = req.body;

  if (!p.match_title || !p.predicted_winner) {
    return res.status(400).json({ error: 'Match title and predicted winner are required' });
  }

  const now = new Date().toISOString();
  const keyFactorsJson = Array.isArray(p.key_factors) ? JSON.stringify(p.key_factors) : JSON.stringify([]);

  const result = db.prepare(`
    INSERT INTO predictions (
      fixture_id, match_title, tournament_name, surface, round_name,
      home_name, away_name, home_odds, away_odds,
      predicted_winner, predicted_score, win_probability, confidence,
      key_factors, best_bet_market, best_bet_selection, best_bet_rationale, best_bet_ev,
      alt_bet_market, alt_bet_selection, alt_bet_rationale, alt_bet_risk,
      ai_summary, status, published_at, created_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, 'UPCOMING', ?, ?
    )
  `).run(
    p.fixture_id || null, p.match_title, p.tournament_name || null, p.surface || null, p.round_name || null,
    p.home_name, p.away_name, p.home_odds || null, p.away_odds || null,
    p.predicted_winner, p.predicted_score || null, p.win_probability || 65, p.confidence || 'HIGH',
    keyFactorsJson, p.best_bet_market || null, p.best_bet_selection || null, p.best_bet_rationale || null, p.best_bet_ev || 'POSITIVE',
    p.alt_bet_market || null, p.alt_bet_selection || null, p.alt_bet_rationale || null, p.alt_bet_risk || 'LOW',
    p.ai_summary || null, now, now
  );

  const predictionId = result.lastInsertRowid as number;
  const prediction = db.prepare('SELECT * FROM predictions WHERE id = ?').get(predictionId);

  // Post to Telegram Channel if requested (default true)
  let channelMsgId: number | null = null;
  if (p.postToChannel !== false) {
    const isTeaserMode = p.isTeaser !== false; // default true if not specified
    channelMsgId = await publishPredictionToChannel(prediction, isTeaserMode);
    if (channelMsgId) {
      db.prepare(`
        INSERT INTO channel_posts (prediction_id, message_id, channel_id, posted_at)
        VALUES (?, ?, ?, ?)
      `).run(predictionId, channelMsgId, process.env.CHANNEL_ID || '', now);
    }
  }

  res.json({
    success: true,
    predictionId,
    postedToChannel: channelMsgId !== null,
    channelMessageId: channelMsgId,
  });
});

// Admin: Get all predictions for management
app.get('/api/admin/predictions', requireAdminAuth, (req, res) => {
  const predictions = db.prepare('SELECT * FROM predictions ORDER BY id DESC').all().map((p: any) => ({
    ...p,
    key_factors: p.key_factors ? JSON.parse(p.key_factors) : [],
  }));
  res.json(predictions);
});

// Admin: Update prediction result (WON / LOST / VOID / INTERRUPTED)
app.put('/api/admin/predictions/:id/result', requireAdminAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, result_score } = req.body;

  if (!['WON', 'LOST', 'VOID', 'INTERRUPTED', 'UPCOMING', 'LIVE'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status value' });
  }

  db.prepare(`
    UPDATE predictions SET status = ?, result_score = ? WHERE id = ?
  `).run(status, result_score || null, id);

  // If there's a channel post, reply update
  const post = db.prepare('SELECT * FROM channel_posts WHERE prediction_id = ?').get(id) as any;
  if (post && post.message_id && ['WON', 'LOST', 'VOID', 'INTERRUPTED'].includes(status)) {
    await updateChannelPostResult(post.message_id, status, result_score);
  }

  res.json({ success: true, id, status });
});

// Admin: Update batch prediction results & optionally post summary to Telegram Channel
app.post('/api/admin/predictions/batch-result', requireAdminAuth, async (req: Request, res: Response) => {
  const { items, postBatchSummary, batchTitle } = req.body;

  console.log(`📢 [BATCH RESULT REQUEST] Items count: ${Array.isArray(items) ? items.length : 0}, PostSummary: ${postBatchSummary}, Title: "${batchTitle || (postBatchSummary ? 'Daily Recap' : 'No Channel Post')}"`);

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Items array is required' });
  }

  const updatedPredictions: any[] = [];
  const stmt = db.prepare('UPDATE predictions SET status = ?, result_score = ? WHERE id = ?');

  for (const item of items) {
    if (item.id && ['WON', 'LOST', 'VOID', 'INTERRUPTED', 'UPCOMING', 'LIVE'].includes(item.status)) {
      stmt.run(item.status, item.result_score || null, item.id);
      const updated = db.prepare('SELECT * FROM predictions WHERE id = ?').get(item.id);
      if (updated) updatedPredictions.push(updated);
    }
  }

  let batchMessageId: number | null = null;
  if (postBatchSummary !== false && updatedPredictions.length > 0) {
    batchMessageId = await publishBatchSummaryToChannel(updatedPredictions, batchTitle);
  }

  res.json({
    success: true,
    count: updatedPredictions.length,
    postedBatchSummary: batchMessageId !== null,
    batchMessageId,
  });
});

// Admin: Delete prediction
app.delete('/api/admin/predictions/:id', requireAdminAuth, (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM predictions WHERE id = ?').run(id);
  db.prepare('DELETE FROM channel_posts WHERE prediction_id = ?').run(id);
  res.json({ success: true });
});

// Admin: Manage Referral Sites
app.get('/api/admin/referrals', requireAdminAuth, (req, res) => {
  const sites = db.prepare('SELECT * FROM referral_sites ORDER BY id DESC').all();
  res.json(sites);
});

app.post('/api/admin/referrals', requireAdminAuth, (req, res) => {
  const { name, base_url, postback_key, verify_mode = 'postback', app_url = '' } = req.body;
  if (!name || !base_url || !postback_key) {
    return res.status(400).json({ error: 'Name, base_url, and postback_key are required' });
  }

  const result = db.prepare(`
    INSERT INTO referral_sites (name, base_url, postback_key, verify_mode, app_url, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(name, base_url, postback_key, verify_mode, app_url, new Date().toISOString());

  res.json({ success: true, id: result.lastInsertRowid });
});

app.delete('/api/admin/referrals/:id', requireAdminAuth, (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM referral_sites WHERE id = ?').run(id);
  res.json({ success: true });
});

// Admin: Access Control Mode Settings (FREE | REGISTRATION_REQUIRED | DEPOSIT_REQUIRED)
app.get('/api/admin/settings', requireAdminAuth, (req, res) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('access_mode') as any;
  const access_mode = row?.value || 'REGISTRATION_REQUIRED';
  res.json({ access_mode });
});

app.post('/api/admin/settings', requireAdminAuth, (req, res) => {
  const { access_mode } = req.body;
  if (!['FREE', 'REGISTRATION_REQUIRED', 'DEPOSIT_REQUIRED'].includes(access_mode)) {
    return res.status(400).json({ error: 'Invalid access_mode. Must be FREE, REGISTRATION_REQUIRED, or DEPOSIT_REQUIRED' });
  }

  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('access_mode', access_mode);

  res.json({ success: true, access_mode });
});

// Admin: Users List & Manual Verification
app.get('/api/admin/users', requireAdminAuth, (req, res) => {
  const users = db.prepare(`
    SELECT u.*, s.name as site_name
    FROM users u
    LEFT JOIN referral_sites s ON u.registered_site_id = s.id
    ORDER BY u.telegram_id DESC
  `).all();
  res.json(users);
});

app.post('/api/admin/users/verify', requireAdminAuth, (req, res) => {
  const { telegram_id, verified } = req.body;
  const tid = parseInt(telegram_id, 10);
  if (isNaN(tid)) {
    return res.status(400).json({ error: 'Invalid telegram_id' });
  }

  const isVerified = verified !== false ? 1 : 0;
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tid);
  if (existing) {
    db.prepare('UPDATE users SET is_verified = ?, verified_at = ? WHERE telegram_id = ?').run(isVerified, isVerified ? now : null, tid);
  } else {
    db.prepare('INSERT INTO users (telegram_id, is_verified, created_at, verified_at) VALUES (?, ?, ?, ?)').run(tid, isVerified, now, isVerified ? now : null);
  }

  res.json({ success: true, telegram_id: tid, is_verified: isVerified });
});

// Admin: Database Backup Export
app.get('/api/admin/backup/export', requireAdminAuth, (req, res) => {
  const predictions = db.prepare('SELECT * FROM predictions').all();
  const referral_sites = db.prepare('SELECT * FROM referral_sites').all();
  const users = db.prepare('SELECT * FROM users').all();
  const settings = db.prepare('SELECT * FROM settings').all();

  const backupData = {
    format: 'sofascore-tennis-ai-backup',
    version: 1,
    exported_at: new Date().toISOString(),
    predictions,
    referral_sites,
    users,
    settings,
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=tennis-ai-backup-${new Date().toISOString().slice(0, 10)}.json`);
  res.send(JSON.stringify(backupData, null, 2));
});

// Admin: Database Backup Import
app.post('/api/admin/backup/import', requireAdminAuth, (req, res) => {
  const { backupData, mode = 'merge' } = req.body;

  if (!backupData || backupData.format !== 'sofascore-tennis-ai-backup') {
    return res.status(400).json({ error: 'Invalid backup file format' });
  }

  try {
    if (mode === 'replace') {
      db.prepare('DELETE FROM predictions').run();
      db.prepare('DELETE FROM referral_sites').run();
      db.prepare('DELETE FROM users').run();
      db.prepare('DELETE FROM settings').run();
    }

    // Import referral_sites
    if (Array.isArray(backupData.referral_sites)) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO referral_sites (id, name, base_url, postback_key, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      backupData.referral_sites.forEach((s: any) => {
        stmt.run(s.id, s.name, s.base_url, s.postback_key, s.is_active ?? 1, s.created_at || new Date().toISOString());
      });
    }

    // Import users
    if (Array.isArray(backupData.users)) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO users (telegram_id, username, first_name, subid, is_verified, registered_site_id, created_at, verified_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      backupData.users.forEach((u: any) => {
        stmt.run(u.telegram_id, u.username || null, u.first_name || null, u.subid || null, u.is_verified || 0, u.registered_site_id || null, u.created_at || new Date().toISOString(), u.verified_at || null);
      });
    }

    // Import predictions
    if (Array.isArray(backupData.predictions)) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO predictions (
          id, fixture_id, match_title, tournament_name, surface, round_name,
          home_name, away_name, home_odds, away_odds,
          predicted_winner, predicted_score, win_probability, confidence,
          key_factors, best_bet_market, best_bet_selection, best_bet_rationale, best_bet_ev,
          alt_bet_market, alt_bet_selection, alt_bet_rationale, alt_bet_risk,
          ai_summary, status, result_score, published_at, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?
        )
      `);
      backupData.predictions.forEach((p: any) => {
        stmt.run(
          p.id, p.fixture_id || null, p.match_title, p.tournament_name || null, p.surface || null, p.round_name || null,
          p.home_name, p.away_name, p.home_odds || null, p.away_odds || null,
          p.predicted_winner, p.predicted_score || null, p.win_probability || 65, p.confidence || 'HIGH',
          typeof p.key_factors === 'string' ? p.key_factors : JSON.stringify(p.key_factors || []),
          p.best_bet_market || null, p.best_bet_selection || null, p.best_bet_rationale || null, p.best_bet_ev || 'POSITIVE',
          p.alt_bet_market || null, p.alt_bet_selection || null, p.alt_bet_rationale || null, p.alt_bet_risk || 'LOW',
          p.ai_summary || null, p.status || 'UPCOMING', p.result_score || null, p.published_at || new Date().toISOString(), p.created_at || new Date().toISOString()
        );
      });
    }

    res.json({ success: true, mode, importedAt: new Date().toISOString() });
  } catch (e: any) {
    res.status(500).json({ error: `Import failed: ${e.message}` });
  }
});

// Start Express server
app.listen(port, () => {
  console.log(`🚀 Telegram WebApp & Admin Backend running on http://localhost:${port}`);
});
