import { Router } from 'express';
import { GoRedirectController } from '../controllers/go-redirect.controller';

const router = Router();

router.get('/go/:siteId/:userId', GoRedirectController.handleRedirect);
router.get('/:siteId(\\d+)/:userId(\\d+)', GoRedirectController.handleRedirect);

export const goRoutes = router;
