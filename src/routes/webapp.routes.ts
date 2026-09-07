import { Router, Request, Response } from 'express';
import { PredictionsService } from '../services/predictions.service';
import { StatsService } from '../services/stats.service';
import { ReferralsRepo } from '../db/repositories/referrals.repo';
import { UsersRepo } from '../db/repositories/users.repo';
import { SettingsRepo } from '../db/repositories/settings.repo';
import { AnalysisController } from '../controllers/analysis.controller';
import { validateTelegramInitData } from '../utils/telegramAuth';

const router = Router();

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

// GET /api/webapp/user/:telegramId (DEPRECATED: Use POST /api/webapp/auth with signed initData)
router.get('/user/:telegramId', async (req: Request, res: Response) => {
  try {
    res.setHeader(
      'X-Deprecation-Warning',
      'GET /api/webapp/user/:telegramId with raw telegramId is deprecated. Migrate to POST /api/webapp/auth with signed initData.'
    );

    const telegramId = parseInt(String(req.params.telegramId), 10);
    if (isNaN(telegramId)) return res.status(400).json({ error: 'Invalid telegramId' });

    const firstName = String(req.query.first_name || '');
    const username = String(req.query.username || '');

    UsersRepo.touchActivity(telegramId);
    if (firstName || username) {
      UsersRepo.upsertFromBot(telegramId, {
        first_name: firstName || undefined,
        username: username || undefined,
      });
    }

    const user = UsersRepo.getByTelegramId(telegramId);
    const accessMode = SettingsRepo.get('access_mode') || 'FREE';
    const isVerified = accessMode === 'FREE' ? true : !!(user && user.is_verified);

    res.json({
      verified: isVerified,
      access_mode: accessMode,
      user: user || null,
      deprecated: true,
      notice: 'Please authenticate using POST /api/webapp/auth with Telegram initData',
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
      ...websiteConfig,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export const webappRoutes = router;
