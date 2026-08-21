import { Router } from 'express';
import { PostbackController } from '../controllers/postback.controller';

const router = Router();

router.all('/:siteKey?', PostbackController.handleWebhook);

export const postbackRoutes = router;
