import { Router } from 'express';
import { WebController } from '../controllers/web.controller';

const router = Router();

router.get('/landing', WebController.getLandingData);
router.get('/config', WebController.getConfig);
router.get('/tournaments/live', WebController.getLiveTournaments);
router.get('/tournaments/today', WebController.getTodayTournaments);
router.get('/tournaments/date/:date', WebController.getTournamentsByDate);
router.get('/pool/stats', WebController.getPoolStats);
router.get('/rankings/:tour', WebController.getRankings);
router.get('/players', WebController.getPlayers);
router.get('/players/:playerId/image', WebController.getPlayerImage);
router.get('/players/:slugOrId', WebController.getPlayerDetails);

export const webRoutes = router;