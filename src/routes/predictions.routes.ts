import { Router } from 'express';
import { PredictionsController } from '../controllers/predictions.controller';

const router = Router();

router.get('/feed', PredictionsController.getFeed);
router.get('/active', PredictionsController.getActive);
router.get('/history', PredictionsController.getHistory);
router.get('/:id', PredictionsController.getById);

export const predictionsRoutes = router;
