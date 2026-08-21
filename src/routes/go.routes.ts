import { Router } from 'express';
import { GoRedirectController } from '../controllers/go-redirect.controller';

const router = Router();

router.get('/:siteId/:userId', GoRedirectController.handleRedirect);

export const goRoutes = router;
