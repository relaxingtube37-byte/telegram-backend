import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { PredictionsService } from '../services/predictions.service';
import { StatsService } from '../services/stats.service';
import { ReferralsRepo } from '../db/repositories/referrals.repo';
import { UsersRepo } from '../db/repositories/users.repo';
import { SettingsRepo } from '../db/repositories/settings.repo';
import { AnalysisController } from '../controllers/analysis.controller';
import {
  validateTelegramInitData,
  validateTelegramWidgetAuth,
  createWebSessionToken,
  verifyWebSessionToken,
  WebSessionPayload,
} from '../utils/telegramAuth';
import { ENV } from '../config/env';

const router = Router();

function getWebSessionSecret(): string {
  return (ENV.BOT_TOKEN || '') + ':' + (ENV.ADMIN_SECRET || 'ptin_web_secret_salt_2026');
}

// GET /api/webapp/matches/:fixtureId/betting
router.get('/matches/:fixtureId/betting', AnalysisController.getMatchBetting);

// GET /api/webapp/matches/:idOrSlug/editorial (Website SEO Editorial Mode)
router.get('/matches/:idOrSlug/editorial', AnalysisController.getMatchEditorial);

// GET /api/webapp/predictions
router.get('/predictions', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(String(req.query.limit || '100'), 10);
    const predictions = PredictionsService.getAll(limit);
    res.json(predictions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/webapp/stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = StatsService.getSummary();
    res.json(stats);
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
    const accessMode = SettingsRepo.get('access_mode') || 'FREE';
    const isVerified = accessMode === 'FREE' ? true : !!(user && user.is_verified);

    res.json({
      success: true,
      verified: isVerified,
      access_mode: accessMode,
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

    const accessMode = SettingsRepo.get('access_mode') || 'FREE';
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
      isVerified = !!(userRecord && userRecord.is_verified);
    }

    // Refresh timestamp and sign
    payload.createdAt = Date.now();
    const token = createWebSessionToken(payload, secret);

    res.json({
      success: true,
      verified: isVerified,
      access_mode: accessMode,
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
    const accessMode = SettingsRepo.get('access_mode') || 'FREE';
    const isVerified = accessMode === 'FREE' ? true : !!(userRecord && userRecord.is_verified);

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

// GET /api/webapp/user/:telegramId (DISABLED: Direct unauthenticated verification queries are blocked)
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
    const accessMode = SettingsRepo.get('access_mode') || 'FREE';
    const rawConfig = SettingsRepo.get('website_config');
    const websiteConfig = rawConfig ? JSON.parse(rawConfig) : {};
    res.json({
      access_mode: accessMode,
      bot_username: ENV.BOT_USERNAME || 'admdinbetbetforbot',
      webapp_short_name: ENV.WEBAPP_SHORT_NAME || 'app',
      ...websiteConfig,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export const webappRoutes = router;
