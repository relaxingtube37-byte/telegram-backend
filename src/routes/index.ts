import { Router } from 'express';
import { adminRoutes } from './admin.routes';
import { predictionsRoutes } from './predictions.routes';
import { telegramRoutes } from './telegram.routes';
import { webRoutes } from './web.routes';
import { postbackRoutes } from './postback.routes';
import { webappRoutes } from './webapp.routes';
import { HealthController } from '../controllers/health.controller';

const router = Router();

router.get('/health', HealthController.check);
router.get('/api/cron/warmup', HealthController.cronWarmup);
router.get('/api/cron/daily-players', HealthController.cronDailyPlayers);
router.use('/api/admin', adminRoutes);
router.use('/api/predictions', predictionsRoutes);
router.use('/api/telegram', telegramRoutes);
router.use('/api/web', webRoutes);
router.use('/api/webapp', webappRoutes);
router.use('/api/postback', postbackRoutes);

// Fallback aliases so that WebApp functions even if VITE_API_BASE was set to domain root or /webapp
router.use('/webapp', webappRoutes);
router.use('/', webappRoutes);

export const apiRouter = router;

