import { Request, Response } from 'express';
import { db } from './db';

/**
 * Handle Affiliate Postback Webhook (e.g. from 1xBet / Melbet / Partners)
 * URL: /api/postback/:siteKey?subid=123456789&secret=xxx
 */
export const handlePostbackWebhook = (req: Request, res: Response) => {
  const { siteKey } = req.params;
  const rawSubId = (
    req.query.subid || req.body.subid ||
    req.query.sub1 || req.body.sub1 ||
    req.query.user_id || req.body.user_id ||
    req.query.telegram_id || req.body.telegram_id ||
    req.query.click_id || req.body.click_id ||
    req.query.sub_id || req.body.sub_id
  ) as string;

  if (!siteKey || !rawSubId) {
    return res.status(400).json({ error: 'Missing siteKey, subid, or sub1 parameter' });
  }

  // Find site
  const site = db.prepare('SELECT * FROM referral_sites WHERE postback_key = ? AND is_active = 1').get(siteKey) as any;
  if (!site) {
    return res.status(404).json({ error: 'Invalid or inactive referral site postback key' });
  }

  const telegramId = parseInt(rawSubId, 10);
  if (isNaN(telegramId)) {
    return res.status(400).json({ error: 'Invalid subid format (must be numeric telegram_id)' });
  }

  // Mark user verified
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId) as any;
  const now = new Date().toISOString();

  if (user) {
    db.prepare(`
      UPDATE users SET is_verified = 1, registered_site_id = ?, verified_at = ? WHERE telegram_id = ?
    `).run(site.id, now, telegramId);
  } else {
    db.prepare(`
      INSERT INTO users (telegram_id, subid, is_verified, registered_site_id, created_at, verified_at)
      VALUES (?, ?, 1, ?, ?, ?)
    `).run(telegramId, String(telegramId), site.id, now, now);
  }

  console.log(`✅ Postback Success: User ${telegramId} verified via site "${site.name}"`);
  return res.json({ success: true, message: `User ${telegramId} verified successfully` });
};
