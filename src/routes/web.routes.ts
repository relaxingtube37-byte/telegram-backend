import { Router } from 'express';
import { WebController } from '../controllers/web.controller';

const router = Router();

router.get('/landing', WebController.getLandingData);
router.get('/config', WebController.getConfig);
router.get('/players', WebController.getPlayers);
router.get('/players/:slugOrId', WebController.getPlayerDetails);

export const webRoutes = router;
