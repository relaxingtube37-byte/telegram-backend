import { Router, Request, Response } from 'express';
import { PredictionsService } from '../services/predictions.service';
import { StatsService } from '../services/stats.service';
import { ReferralsRepo } from '../db/repositories/referrals.repo';
import { UsersRepo } from '../db/repositories/users.repo';
import { SettingsRepo } from '../db/repositories/settings.repo';

const router = Router();

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

// GET /api/webapp/user/:telegramId
router.get('/user/:telegramId', async (req: Request, res: Response) => {
  try {
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
