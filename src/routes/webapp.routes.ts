import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { PredictionsService } from '../services/predictions.service';
import { StatsService } from '../services/stats.service';
import { ReferralsRepo } from '../db/repositories/referrals.repo';
import { UsersRepo } from '../db/repositories/users.repo';
import { SettingsRepo } from '../db/repositories/settings.repo';
import { AnalysisController } from '../controllers/analysis.controller';
import { MatchAnalyticsService } from '../services/match-analytics.service';
import { PredictionsRepo } from '../db/repositories/predictions.repo';
import {
  validateTelegramInitData,
  validateTelegramWidgetAuth,
  createWebSessionToken,
  verifyWebSessionToken,
  WebSessionPayload,
} from '../utils/telegramAuth';
import { ENV } from '../config/env';
import { loadBusinessActionSettings } from '../business-actions';
import {
  computeIsVerified,
  getWebSessionSecret,
  normalizeAccessMode,
  redactDeepAnalytics,
  redactPrediction,
  resolveContentFlags,
  resolveWebappAccess,
  parseWebsiteConfig,
} from '../utils/contentAccess';

const router = Router();

// GET /api/webapp/matches/:fixtureId/betting
router.get('/matches/:fixtureId/betting', AnalysisController.getMatchBetting);

// GET /api/webapp/matches/:idOrSlug/editorial (Website SEO Editorial Mode)
router.get('/matches/:idOrSlug/editorial', AnalysisController.getMatchEditorial);

// GET /api/webapp/matches/deep-analytics?p1=&p2=&surface=&asOfDate=
router.get('/matches/deep-analytics', async (req: Request, res: Response) => {
  try {
    const { p1, p2, surface, asOfDate, matchDate } = req.query;
    if (!p1 || !p2) {
      return res.status(400).json({ error: 'Parameters p1 and p2 are required.' });
    }
    const access = resolveWebappAccess(req);
    const report = MatchAnalyticsService.generateDeepAnalytics(
      String(p1),
      String(p2),
      (surface as string) || 'Hard',
      (asOfDate as string) || (matchDate as string) || undefined
    );
    const data = redactDeepAnalytics(report, access);
    res.json({
      status: 'SUCCESS',
      verified: access.isVerified,
      access_mode: access.accessMode,
      content_layers: access.contentFlags,
      data,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/webapp/matches/:fixtureId/analytics — deep analytics by published fixture
router.get('/matches/:fixtureId/analytics', async (req: Request, res: Response) => {
  try {
    const fixtureId = Number(req.params.fixtureId);
    if (!fixtureId) return res.status(400).json({ error: 'Invalid fixtureId' });

    const prediction = PredictionsRepo.getByFixtureId(fixtureId);
    if (!prediction) {
      return res.status(404).json({ error: 'Match not found for fixture' });
    }

    const access = resolveWebappAccess(req);
    const report = MatchAnalyticsService.generateDeepAnalytics(
      prediction.home_name,
      prediction.away_name,
      prediction.surface || 'Hard',
      prediction.match_date ? String(prediction.match_date).slice(0, 10) : undefined
    );
    const data = redactDeepAnalytics(report, access);
    res.json({
      status: 'SUCCESS',
      verified: access.isVerified,
      access_mode: access.accessMode,
      content_layers: access.contentFlags,
      fixture_id: fixtureId,
      data,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/webapp/predictions
router.get('/predictions', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(String(req.query.limit || '100'), 10);
    const access = resolveWebappAccess(req);
    const predictions = PredictionsService.getAll(limit).map((p) => redactPrediction(p, access));
    res.json({
      predictions,
      verified: access.isVerified,
      access_mode: access.accessMode,
      content_layers: access.contentFlags,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/webapp/stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const access = resolveWebappAccess(req);
    const stats = StatsService.getSummary();
    // Aggregate win-rate always public (trust signal); detailed breakdown same
    res.json({
      ...stats,
      verified: access.isVerified,
      access_mode: access.accessMode,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/webapp/referrals
router.get('/referrals', async (req: Request, res: Response) => {
  try {
    const sites = ReferralsRepo.getActive();
    res.json(sites);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/webapp/auth - Cryptographically validated Telegram WebApp session
router.post('/auth', async (req: Request, res: Response) => {
  try {
    const { initData } = req.body;
    if (!initData) {
      return res.status(400).json({ error: 'Missing initData in request body' });
    }

    const session = validateTelegramInitData(initData);
    if (!session.valid || !session.user) {
      return res.status(401).json({ error: session.error || 'Unauthorized Telegram session' });
    }

    const { id: telegramId, first_name, username } = session.user;

    UsersRepo.touchActivity(telegramId);
    UsersRepo.upsertFromBot(telegramId, {
      first_name: first_name || undefined,
      username: username || undefined,
    });

    const user = UsersRepo.getByTelegramId(telegramId);
    const accessMode = normalizeAccessMode(SettingsRepo.get('access_mode'));
    const isVerified = computeIsVerified(accessMode, user);
    const contentFlags = resolveContentFlags();

    res.json({
      success: true,
      verified: isVerified,
      access_mode: accessMode,
      content_layers: contentFlags,
      user: {
        telegram_id: telegramId,
        first_name: user?.first_name || first_name,
        username: user?.username || username,
        is_verified: isVerified ? 1 : 0,
        registered_site_id: user?.registered_site_id,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/webapp/auth/web - Cryptographically signed session for standalone web visitors
router.post('/auth/web', async (req: Request, res: Response) => {
  try {
    const { sessionToken } = req.body || {};
    const secret = getWebSessionSecret();
    const verifiedSession = verifyWebSessionToken(sessionToken, secret);

    const accessMode = normalizeAccessMode(SettingsRepo.get('access_mode'));
    let payload: WebSessionPayload;

    if (verifiedSession.valid && verifiedSession.payload) {
      payload = verifiedSession.payload;
    } else {
      payload = {
        webId: `web_${crypto.randomBytes(12).toString('hex')}`,
        telegramId: null,
        createdAt: Date.now(),
      };
    }

    let isVerified = false;
    let userRecord = null;

    if (accessMode === 'FREE') {
      isVerified = true;
    } else if (payload.telegramId) {
      userRecord = UsersRepo.getByTelegramId(payload.telegramId);
      isVerified = computeIsVerified(accessMode, userRecord);
    }

    payload.createdAt = Date.now();
    const token = createWebSessionToken(payload, secret);
    const contentFlags = resolveContentFlags();

    res.json({
      success: true,
      verified: isVerified,
      access_mode: accessMode,
      content_layers: contentFlags,
      sessionToken: token,
      webId: payload.webId,
      telegramUser: userRecord
        ? {
            telegram_id: userRecord.telegram_id,
            first_name: userRecord.first_name,
            username: userRecord.username,
            is_verified: userRecord.is_verified,
          }
        : null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/webapp/auth/telegram-widget - Verify Telegram Login Widget payload and link to web session
router.post('/auth/telegram-widget', async (req: Request, res: Response) => {
  try {
    const { authData, sessionToken } = req.body || {};
    if (!authData) {
      return res.status(400).json({ error: 'Missing authData from Telegram Login Widget' });
    }

    const botToken = ENV.BOT_TOKEN;
    if (!botToken) {
      return res.status(500).json({ error: 'Server misconfiguration: BOT_TOKEN missing' });
    }

    const verification = validateTelegramWidgetAuth(authData, botToken);
    if (!verification.valid || !verification.user) {
      return res.status(401).json({ error: verification.error || 'Invalid Telegram auth signature' });
    }

    const tgUser = verification.user;
    UsersRepo.touchActivity(tgUser.id);
    UsersRepo.upsertFromBot(tgUser.id, {
      first_name: tgUser.first_name,
      username: tgUser.username,
    });

    const secret = getWebSessionSecret();
    const existingSession = verifyWebSessionToken(sessionToken, secret);

    const webId =
      existingSession.valid && existingSession.payload?.webId
        ? existingSession.payload.webId
        : `web_${crypto.randomBytes(12).toString('hex')}`;

    const userRecord = UsersRepo.getByTelegramId(tgUser.id);
    const accessMode = normalizeAccessMode(SettingsRepo.get('access_mode'));
    const isVerified = computeIsVerified(accessMode, userRecord);
    const contentFlags = resolveContentFlags();

    const newPayload: WebSessionPayload = {
      webId,
      telegramId: tgUser.id,
      createdAt: Date.now(),
    };
    const newToken = createWebSessionToken(newPayload, secret);

    res.json({
      success: true,
      verified: isVerified,
      access_mode: accessMode,
      content_layers: contentFlags,
      sessionToken: newToken,
      webId,
      telegramUser: {
        telegram_id: tgUser.id,
        first_name: userRecord?.first_name || tgUser.first_name,
        username: userRecord?.username || tgUser.username,
        is_verified: isVerified ? 1 : 0,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/webapp/user/:telegramId (DISABLED)
router.get('/user/:telegramId', async (req: Request, res: Response) => {
  try {
    return res.status(401).json({
      verified: false,
      error:
        'Direct unauthenticated user queries are disabled. Use POST /api/webapp/auth with Telegram initData or POST /api/webapp/auth/web with a signed session.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/webapp/config
router.get('/config', async (req: Request, res: Response) => {
  try {
    const accessMode = normalizeAccessMode(SettingsRepo.get('access_mode'));
    const websiteConfig = parseWebsiteConfig();
    const contentFlags = resolveContentFlags(websiteConfig);
    res.json({
      access_mode: accessMode,
      bot_username: ENV.BOT_USERNAME || 'admdinbetbetforbot',
      webapp_short_name: ENV.WEBAPP_SHORT_NAME || 'app',
      public_base_url: ENV.PUBLIC_BASE_URL || '',
      content_layers: contentFlags,
      ...websiteConfig,
      // Explicit flags win over spread duplicates
      guest_can_see_summary: contentFlags.guest_can_see_summary,
      guest_can_see_stats: contentFlags.guest_can_see_stats,
      guest_can_see_ai_full: contentFlags.guest_can_see_ai_full,
      guest_can_see_watch_live: contentFlags.guest_can_see_watch_live,
      payment_gateway_enabled: contentFlags.payment_gateway_enabled,
      unlock_via_referral: contentFlags.unlock_via_referral,
      business_actions: loadBusinessActionSettings(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export const webappRoutes = router;
