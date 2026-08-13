import { Request, Response } from 'express';
import { db, setVerified, setUserDeposited, getLatestUnverifiedUser } from './db';
import { bot } from './bot';

/**
 * Handle Affiliate Postback Webhook (e.g. from 1xBet / Melbet / 1Win / Partners)
 * URL: /api/postback/:siteKey?subid=123456789&secret=xxx
 */
export const handlePostbackWebhook = async (req: Request, res: Response) => {
  const { siteKey } = req.params;
  const targetKey = siteKey || (req.query.key as string) || (req.query.secret as string);

  // Find site by postback key
  let site = targetKey ? db.prepare('SELECT * FROM referral_sites WHERE postback_key = ? AND is_active = 1').get(targetKey) as any : null;
  if (!site) {
    site = db.prepare('SELECT * FROM referral_sites WHERE is_active = 1 ORDER BY id ASC LIMIT 1').get() as any;
  }

  if (!site) {
    return res.status(404).json({ error: 'No active referral site configured for postback webhook' });
  }

  // Extract raw subid from query or POST body parameters
  const rawSubId = (
    req.query.subid || req.body?.subid ||
    req.query.sub1 || req.body?.sub1 ||
    req.query.telegram_id || req.body?.telegram_id ||
    req.query.user_id || req.body?.user_id ||
    req.query.sub_id || req.body?.sub_id ||
    req.query.click_id || req.body?.click_id ||
    req.query.player_id || req.body?.player_id ||
    req.query.custom_id || req.body?.custom_id ||
    req.query.ext_id || req.body?.ext_id
  ) as string;

  let telegramId: number | null = null;
  if (rawSubId) {
    const digits = String(rawSubId).replace(/\D/g, '');
    if (digits && digits.length >= 5) {
      telegramId = parseInt(digits, 10);
    }
  }

  // Fallback matching: if subid was omitted by partner network, match to latest unverified click user
  if (!telegramId || isNaN(telegramId)) {
    const fallbackUser = getLatestUnverifiedUser(site.id);
    if (fallbackUser) {
      telegramId = fallbackUser.telegram_id;
      console.log(`[POSTBACK FALLBACK] subid was null, auto-matched to latest unverified user ${telegramId}`);
    }
  }

  if (!telegramId) {
    return res.status(400).json({ error: 'Missing numeric subid/user_id in request and no pending user found' });
  }

  // Check event type (deposit vs registration)
  const fullUrl = req.originalUrl.toLowerCase();
  const isDepositEvent = (
    fullUrl.includes('event=deposit') ||
    fullUrl.includes('event=ftd') ||
    fullUrl.includes('status=sale') ||
    fullUrl.includes('type=deposit') ||
    fullUrl.includes('type=ftd')
  );

  if (isDepositEvent) {
    setUserDeposited(telegramId);
    console.log(`🎉 [POSTBACK DEPOSIT] User ${telegramId} deposited via site "${site.name}"`);
  } else {
    setVerified(telegramId, site.id, 'postback');
    console.log(`✅ [POSTBACK VERIFIED] User ${telegramId} verified via site "${site.name}"`);
  }

  // Bot messaging skipped as requested
  // Verification status is recorded silently in database

  return res.json({
    success: true,
    status: isDepositEvent ? 'deposited' : 'verified',
    telegram_id: String(telegramId),
    site: site.name,
  });
};
