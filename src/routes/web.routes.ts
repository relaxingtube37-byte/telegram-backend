import { Router } from 'express';
import { WebController } from '../controllers/web.controller';

const router = Router();

router.get('/landing', WebController.getLandingData);

export const webRoutes = router;
