"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlePostbackWebhook = void 0;
const db_1 = require("./db");
/**
 * Handle Affiliate Postback Webhook (e.g. from 1xBet / Melbet / Partners)
 * URL: /api/postback/:siteKey?subid=123456789&secret=xxx
 */
const handlePostbackWebhook = (req, res) => {
    const { siteKey } = req.params;
    const subid = (req.query.subid || req.body.subid || req.query.user_id || req.body.user_id);
    const secret = (req.query.secret || req.body.secret);
    if (!siteKey || !subid) {
        return res.status(400).json({ error: 'Missing siteKey or subid parameter' });
    }
    // Find site
    const site = db_1.db.prepare('SELECT * FROM referral_sites WHERE postback_key = ? AND is_active = 1').get(siteKey);
    if (!site) {
        return res.status(404).json({ error: 'Invalid or inactive referral site postback key' });
    }
    const telegramId = parseInt(subid, 10);
    if (isNaN(telegramId)) {
        return res.status(400).json({ error: 'Invalid subid format (must be numeric telegram_id)' });
    }
    // Mark user verified
    const user = db_1.db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
    const now = new Date().toISOString();
    if (user) {
        db_1.db.prepare(`
      UPDATE users SET is_verified = 1, registered_site_id = ?, verified_at = ? WHERE telegram_id = ?
    `).run(site.id, now, telegramId);
    }
    else {
        db_1.db.prepare(`
      INSERT INTO users (telegram_id, subid, is_verified, registered_site_id, created_at, verified_at)
      VALUES (?, ?, 1, ?, ?, ?)
    `).run(telegramId, String(telegramId), site.id, now, now);
    }
    console.log(`✅ Postback Success: User ${telegramId} verified via site "${site.name}"`);
    return res.json({ success: true, message: `User ${telegramId} verified successfully` });
};
exports.handlePostbackWebhook = handlePostbackWebhook;
