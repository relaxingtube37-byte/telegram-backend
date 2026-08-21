import { Router } from 'express';
import { TelegramController } from '../controllers/telegram.controller';

const router = Router();

router.get('/user/:telegramId', TelegramController.getUserStatus);

export const telegramRoutes = router;
