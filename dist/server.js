"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = require("./db");
const bot_1 = require("./bot");
const postback_1 = require("./postback");
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 8080;
const adminSecret = process.env.ADMIN_SECRET || 'sofascore-tennis-admin-secret-2026';
app.use((0, cors_1.default)({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-secret', 'X-Admin-Secret'],
}));
app.use(express_1.default.json());
// ── JSON Syntax Error Guard ────────────────────────────────────────────────
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && 'body' in err) {
        console.error('[BAD JSON PAYLOAD]:', err.message);
        return res.status(400).json({ error: 'Malformed JSON payload: Invalid escape sequence or formatting' });
    }
    next(err);
});
// ── Admin Auth Middleware ──────────────────────────────────────────────────
const requireAdminAuth = (req, res, next) => {
    if (req.method === 'OPTIONS')
        return next();
    const currentSecret = (process.env.ADMIN_SECRET || 'sofascore-tennis-admin-secret-2026').trim();
    const rawHeader = ((req.headers['x-admin-secret'] || req.query.secret) || '').trim();
    let decodedHeader = rawHeader;
    try {
        if (rawHeader)
            decodedHeader = decodeURIComponent(rawHeader).trim();
    }
    catch { }
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
app.get('/api/admin/test-bot-channel', requireAdminAuth, async (req, res) => {
    const currentChannelId = (process.env.CHANNEL_ID || '').trim();
    const botUsernameEnv = (process.env.BOT_USERNAME || '').replace(/^@/, '').trim();
    const rawBotUsername = botUsernameEnv || 'admdinbetbetforbot';
    const webAppShortName = (process.env.WEBAPP_SHORT_NAME || 'app').trim();
    if (!bot_1.bot)
        return res.status(500).json({ error: 'Bot is null. Check BOT_TOKEN.' });
    const targetUrl = `https://t.me/${rawBotUsername}/${webAppShortName}`;
    const { InlineKeyboard } = await Promise.resolve().then(() => __importStar(require('grammy')));
    const keyboard = new InlineKeyboard().url('🚀 Open Full Analysis in WebApp', targetUrl);
    try {
        const result = await bot_1.bot.api.sendMessage(currentChannelId, '🎾 Test message with button', {
            parse_mode: 'HTML',
            reply_markup: keyboard,
        });
        res.json({ success: true, messageId: result.message_id, targetUrl, channelId: currentChannelId });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message, targetUrl, channelId: currentChannelId });
    }
});
// ── WebApp Public Endpoints ────────────────────────────────────────────────
// Get published predictions for TWA
app.get('/api/webapp/predictions', (req, res) => {
    const predictions = db_1.db.prepare(`
    SELECT * FROM predictions ORDER BY id DESC LIMIT 50
  `).all().map((p) => ({
        ...p,
        key_factors: p.key_factors ? JSON.parse(p.key_factors) : [],
    }));
    res.json(predictions);
});
// Get channel accuracy stats
app.get('/api/webapp/stats', (req, res) => {
    try {
        const total = db_1.db.prepare('SELECT COUNT(*) as count FROM predictions WHERE status IN ("WON", "LOST")').get();
        const won = db_1.db.prepare('SELECT COUNT(*) as count FROM predictions WHERE status = "WON"').get();
        const lost = db_1.db.prepare('SELECT COUNT(*) as count FROM predictions WHERE status = "LOST"').get();
        const upcoming = db_1.db.prepare('SELECT COUNT(*) as count FROM predictions WHERE status = "UPCOMING"').get();
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
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// Get active referral sites
app.get('/api/webapp/referrals', (req, res) => {
    const sites = db_1.db.prepare('SELECT id, name, base_url, app_url, verify_mode FROM referral_sites WHERE is_active = 1').all();
    res.json(sites);
});
// Click Tracking & Redirect Endpoint (/go/:siteId/:telegramId)
app.get(['/go/:siteId/:telegramId', '/api/go/:siteId/:telegramId'], (req, res) => {
    const siteId = parseInt(String(req.params.siteId || ''), 10);
    const telegramId = parseInt(String(req.params.telegramId || ''), 10);
    if (!telegramId || isNaN(telegramId)) {
        return res.status(400).send('Invalid telegram_id');
    }
    const site = db_1.db.prepare('SELECT * FROM referral_sites WHERE id = ? AND is_active = 1').get(siteId);
    if (!site) {
        return res.status(404).send('Referral site not found');
    }
    // Record pending site click in DB
    (0, db_1.setPendingSite)(telegramId, siteId);
    // Check if site verification mode is instant or free (free / open_link)
    if (site.verify_mode === 'free' || site.verify_mode === 'open_link') {
        (0, db_1.setVerified)(telegramId, siteId, site.verify_mode || 'free');
    }
    // Build target referral URL with subid tracking
    const targetUrl = (0, db_1.buildReferralUrl)(site.base_url, telegramId);
    return res.redirect(302, targetUrl);
});
// Get WebApp public config (access_mode)
app.get('/api/webapp/config', (req, res) => {
    const row = db_1.db.prepare('SELECT value FROM settings WHERE key = ?').get('access_mode');
    const access_mode = row?.value || 'REGISTRATION_REQUIRED';
    res.json({ access_mode });
});
// Get user verification status & auto-record MiniApp visitors
app.all(['/api/webapp/user/:telegramId', '/api/webapp/user/ping'], (req, res) => {
    const tidParam = req.params.telegramId || req.body?.telegram_id || req.query?.telegram_id;
    const tid = parseInt(tidParam, 10);
    const row = db_1.db.prepare('SELECT value FROM settings WHERE key = ?').get('access_mode');
    const access_mode = row?.value || 'REGISTRATION_REQUIRED';
    if (!tid || isNaN(tid)) {
        return res.json({ registered: false, verified: false, access_mode });
    }
    const first_name = (req.query.first_name || req.body?.first_name || '');
    const username = (req.query.username || req.body?.username || '');
    const now = new Date().toISOString();
    let user = db_1.db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tid);
    if (!user) {
        db_1.db.prepare(`
      INSERT INTO users (telegram_id, username, first_name, is_verified, created_at, last_active_at)
      VALUES (?, ?, ?, 0, ?, ?)
    `).run(tid, username || null, first_name || null, now, now);
        user = db_1.db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tid);
    }
    else {
        // Update last_active_at & name info if available
        db_1.db.prepare(`
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
app.get('/api/postback/:siteKey', postback_1.handlePostbackWebhook);
app.post('/api/postback/:siteKey', postback_1.handlePostbackWebhook);
app.get('/postback/:siteKey', postback_1.handlePostbackWebhook);
app.post('/postback/:siteKey', postback_1.handlePostbackWebhook);
// ── Admin Endpoints (Used by state football Admin Panel) ──────────────────
// Admin: Publish prediction to Channel & TWA
app.post('/api/admin/predictions/publish', requireAdminAuth, async (req, res) => {
    const p = req.body;
    if (!p.match_title || !p.predicted_winner) {
        return res.status(400).json({ error: 'Match title and predicted winner are required' });
    }
    const now = new Date().toISOString();
    const keyFactorsJson = Array.isArray(p.key_factors) ? JSON.stringify(p.key_factors) : JSON.stringify([]);
    const result = db_1.db.prepare(`
    INSERT INTO predictions (
      fixture_id, match_title, tournament_name, surface, round_name, match_date,
      home_name, away_name, home_odds, away_odds,
      predicted_winner, predicted_score, win_probability, confidence,
      key_factors, best_bet_market, best_bet_selection, best_bet_rationale, best_bet_ev,
      alt_bet_market, alt_bet_selection, alt_bet_rationale, alt_bet_risk,
      devils_advocate_risk, ai_summary, status, published_at, created_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, 'UPCOMING', ?, ?
    )
  `).run(p.fixture_id || null, p.match_title, p.tournament_name || null, p.surface || null, p.round_name || null, p.match_date || null, p.home_name, p.away_name, p.home_odds || null, p.away_odds || null, p.predicted_winner, p.predicted_score || null, p.win_probability || 65, p.confidence || 'HIGH', keyFactorsJson, p.best_bet_market || null, p.best_bet_selection || null, p.best_bet_rationale || null, p.best_bet_ev || 'POSITIVE', p.alt_bet_market || null, p.alt_bet_selection || null, p.alt_bet_rationale || null, p.alt_bet_risk || 'LOW', p.devils_advocate_risk || null, p.ai_summary || null, now, now);
    const predictionId = result.lastInsertRowid;
    const prediction = db_1.db.prepare('SELECT * FROM predictions WHERE id = ?').get(predictionId);
    // Post to Telegram Channel if requested (default true)
    let channelMsgId = null;
    if (p.postToChannel !== false) {
        const isTeaserMode = p.isTeaser !== false; // default true if not specified
        channelMsgId = await (0, bot_1.publishPredictionToChannel)(prediction, isTeaserMode);
        if (channelMsgId) {
            db_1.db.prepare(`
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
    const predictions = db_1.db.prepare('SELECT * FROM predictions ORDER BY id DESC').all().map((p) => ({
        ...p,
        key_factors: p.key_factors ? JSON.parse(p.key_factors) : [],
    }));
    res.json(predictions);
});
// Admin: Auto-sync match results by fixture_id from Desktop app
app.post('/api/admin/predictions/sync-fixture-results', requireAdminAuth, async (req, res) => {
    const { results } = req.body;
    if (!Array.isArray(results) || results.length === 0) {
        return res.json({ success: true, updatedCount: 0, items: [] });
    }
    const updatedItems = [];
    const stmt = db_1.db.prepare(`
    UPDATE predictions 
    SET status = ?, result_score = ? 
    WHERE fixture_id = ? AND status IN ('UPCOMING', 'LIVE')
  `);
    for (const r of results) {
        if (r.fixture_id && ['WON', 'LOST', 'VOID', 'INTERRUPTED', 'LIVE'].includes(r.status)) {
            const resUpdate = stmt.run(r.status, r.result_score || null, r.fixture_id);
            if (resUpdate.changes > 0) {
                const updated = db_1.db.prepare('SELECT * FROM predictions WHERE fixture_id = ?').get(r.fixture_id);
                if (updated) {
                    updatedItems.push(updated);
                    // Also update channel message reply if exists
                    const post = db_1.db.prepare('SELECT * FROM channel_posts WHERE prediction_id = ?').get(updated.id);
                    if (post && post.message_id && ['WON', 'LOST', 'VOID', 'INTERRUPTED'].includes(r.status)) {
                        try {
                            await (0, bot_1.updateChannelPostResult)(post.message_id, r.status, r.result_score);
                        }
                        catch (err) {
                            console.warn(`[CHANNEL REPLY UPDATE FAILED] message_id: ${post.message_id}:`, err.message);
                        }
                    }
                }
            }
        }
    }
    console.log(`✅ [AUTO-SYNC FIXTURE RESULTS] Received ${results.length} results, updated ${updatedItems.length} prediction(s)`);
    res.json({ success: true, updatedCount: updatedItems.length, items: updatedItems });
});
// Admin: Update prediction result (WON / LOST / VOID / INTERRUPTED)
app.put('/api/admin/predictions/:id/result', requireAdminAuth, async (req, res) => {
    const { id } = req.params;
    const { status, result_score } = req.body;
    if (!['WON', 'LOST', 'VOID', 'INTERRUPTED', 'UPCOMING', 'LIVE'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status value' });
    }
    db_1.db.prepare(`
    UPDATE predictions SET status = ?, result_score = ? WHERE id = ?
  `).run(status, result_score || null, id);
    // If there's a channel post, reply update
    const post = db_1.db.prepare('SELECT * FROM channel_posts WHERE prediction_id = ?').get(id);
    if (post && post.message_id && ['WON', 'LOST', 'VOID', 'INTERRUPTED'].includes(status)) {
        await (0, bot_1.updateChannelPostResult)(post.message_id, status, result_score);
    }
    res.json({ success: true, id, status });
});
// Admin: Update batch prediction results & optionally post summary to Telegram Channel
app.post('/api/admin/predictions/batch-result', requireAdminAuth, async (req, res) => {
    const { items, postBatchSummary, batchTitle } = req.body;
    console.log(`📢 [BATCH RESULT REQUEST] Items count: ${Array.isArray(items) ? items.length : 0}, PostSummary: ${postBatchSummary}, Title: "${batchTitle || (postBatchSummary ? 'Daily Recap' : 'No Channel Post')}"`);
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Items array is required' });
    }
    const updatedPredictions = [];
    const stmt = db_1.db.prepare('UPDATE predictions SET status = ?, result_score = ? WHERE id = ?');
    for (const item of items) {
        if (item.id && ['WON', 'LOST', 'VOID', 'INTERRUPTED', 'UPCOMING', 'LIVE'].includes(item.status)) {
            stmt.run(item.status, item.result_score || null, item.id);
            const updated = db_1.db.prepare('SELECT * FROM predictions WHERE id = ?').get(item.id);
            if (updated)
                updatedPredictions.push(updated);
        }
    }
    let batchMessageId = null;
    if (postBatchSummary !== false && updatedPredictions.length > 0) {
        batchMessageId = await (0, bot_1.publishBatchSummaryToChannel)(updatedPredictions, batchTitle);
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
    try {
        const { id } = req.params;
        // Delete child records first to satisfy Foreign Key constraints
        db_1.db.prepare('DELETE FROM channel_posts WHERE prediction_id = ?').run(id);
        db_1.db.prepare('DELETE FROM predictions WHERE id = ?').run(id);
        res.json({ success: true, id });
    }
    catch (e) {
        console.error(`[DELETE PREDICTION FAILED] ID: ${req.params.id}:`, e.message);
        res.status(500).json({ error: e.message });
    }
});
// Admin: Batch Delete predictions
app.post('/api/admin/predictions/batch-delete', requireAdminAuth, (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'ids array is required' });
        }
        const deletePostsStmt = db_1.db.prepare('DELETE FROM channel_posts WHERE prediction_id = ?');
        const deletePredStmt = db_1.db.prepare('DELETE FROM predictions WHERE id = ?');
        const deleteTx = db_1.db.transaction((idList) => {
            for (const id of idList) {
                deletePostsStmt.run(id);
                deletePredStmt.run(id);
            }
        });
        deleteTx(ids);
        res.json({ success: true, deletedCount: ids.length });
    }
    catch (e) {
        console.error('[BATCH DELETE FAILED]:', e.message);
        res.status(500).json({ error: e.message });
    }
});
// Admin: Manage Referral Sites
app.get('/api/admin/referrals', requireAdminAuth, (req, res) => {
    const sites = db_1.db.prepare('SELECT * FROM referral_sites ORDER BY id DESC').all();
    res.json(sites);
});
app.post('/api/admin/referrals', requireAdminAuth, (req, res) => {
    const { name, base_url, postback_key, verify_mode = 'postback', app_url = '' } = req.body;
    if (!name || !base_url || !postback_key) {
        return res.status(400).json({ error: 'Name, base_url, and postback_key are required' });
    }
    const result = db_1.db.prepare(`
    INSERT INTO referral_sites (name, base_url, postback_key, verify_mode, app_url, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(name, base_url, postback_key, verify_mode, app_url, new Date().toISOString());
    res.json({ success: true, id: result.lastInsertRowid });
});
app.delete('/api/admin/referrals/:id', requireAdminAuth, (req, res) => {
    const { id } = req.params;
    db_1.db.prepare('DELETE FROM referral_sites WHERE id = ?').run(id);
    res.json({ success: true });
});
// Admin: Access Control Mode Settings (FREE | REGISTRATION_REQUIRED | DEPOSIT_REQUIRED)
app.get('/api/admin/settings', requireAdminAuth, (req, res) => {
    const row = db_1.db.prepare('SELECT value FROM settings WHERE key = ?').get('access_mode');
    const access_mode = row?.value || 'REGISTRATION_REQUIRED';
    res.json({ access_mode });
});
app.post('/api/admin/settings', requireAdminAuth, (req, res) => {
    const { access_mode } = req.body;
    if (!['FREE', 'REGISTRATION_REQUIRED', 'DEPOSIT_REQUIRED'].includes(access_mode)) {
        return res.status(400).json({ error: 'Invalid access_mode. Must be FREE, REGISTRATION_REQUIRED, or DEPOSIT_REQUIRED' });
    }
    db_1.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run('access_mode', access_mode);
    res.json({ success: true, access_mode });
});
// Admin: Users List & Manual Verification
app.get('/api/admin/users', requireAdminAuth, (req, res) => {
    const users = db_1.db.prepare(`
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
    const existing = db_1.db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tid);
    if (existing) {
        db_1.db.prepare('UPDATE users SET is_verified = ?, verified_at = ? WHERE telegram_id = ?').run(isVerified, isVerified ? now : null, tid);
    }
    else {
        db_1.db.prepare('INSERT INTO users (telegram_id, is_verified, created_at, verified_at) VALUES (?, ?, ?, ?)').run(tid, isVerified, now, isVerified ? now : null);
    }
    res.json({ success: true, telegram_id: tid, is_verified: isVerified });
});
// Admin: Database Backup Export
app.get('/api/admin/backup/export', requireAdminAuth, (req, res) => {
    const predictions = db_1.db.prepare('SELECT * FROM predictions').all();
    const referral_sites = db_1.db.prepare('SELECT * FROM referral_sites').all();
    const users = db_1.db.prepare('SELECT * FROM users').all();
    const settings = db_1.db.prepare('SELECT * FROM settings').all();
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
            db_1.db.prepare('DELETE FROM predictions').run();
            db_1.db.prepare('DELETE FROM referral_sites').run();
            db_1.db.prepare('DELETE FROM users').run();
            db_1.db.prepare('DELETE FROM settings').run();
        }
        // Import referral_sites
        if (Array.isArray(backupData.referral_sites)) {
            const stmt = db_1.db.prepare(`
        INSERT OR REPLACE INTO referral_sites (id, name, base_url, postback_key, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
            backupData.referral_sites.forEach((s) => {
                stmt.run(s.id, s.name, s.base_url, s.postback_key, s.is_active ?? 1, s.created_at || new Date().toISOString());
            });
        }
        // Import users
        if (Array.isArray(backupData.users)) {
            const stmt = db_1.db.prepare(`
        INSERT OR REPLACE INTO users (telegram_id, username, first_name, subid, is_verified, registered_site_id, created_at, verified_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
            backupData.users.forEach((u) => {
                stmt.run(u.telegram_id, u.username || null, u.first_name || null, u.subid || null, u.is_verified || 0, u.registered_site_id || null, u.created_at || new Date().toISOString(), u.verified_at || null);
            });
        }
        // Import predictions
        if (Array.isArray(backupData.predictions)) {
            const stmt = db_1.db.prepare(`
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
            backupData.predictions.forEach((p) => {
                stmt.run(p.id, p.fixture_id || null, p.match_title, p.tournament_name || null, p.surface || null, p.round_name || null, p.home_name, p.away_name, p.home_odds || null, p.away_odds || null, p.predicted_winner, p.predicted_score || null, p.win_probability || 65, p.confidence || 'HIGH', typeof p.key_factors === 'string' ? p.key_factors : JSON.stringify(p.key_factors || []), p.best_bet_market || null, p.best_bet_selection || null, p.best_bet_rationale || null, p.best_bet_ev || 'POSITIVE', p.alt_bet_market || null, p.alt_bet_selection || null, p.alt_bet_rationale || null, p.alt_bet_risk || 'LOW', p.ai_summary || null, p.status || 'UPCOMING', p.result_score || null, p.published_at || new Date().toISOString(), p.created_at || new Date().toISOString());
            });
        }
        res.json({ success: true, mode, importedAt: new Date().toISOString() });
    }
    catch (e) {
        res.status(500).json({ error: `Import failed: ${e.message}` });
    }
});
// Start Express server
app.listen(port, () => {
    console.log(`🚀 Telegram WebApp & Admin Backend running on http://localhost:${port}`);
});
