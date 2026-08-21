import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { requireAdminAuth } from '../middlewares/adminAuth';

const router = Router();

router.use(requireAdminAuth);

router.get('/overview', AdminController.getOverview);
router.get('/predictions', AdminController.getPredictions);
router.post('/predictions/publish', AdminController.publishPrediction);
router.put('/predictions/:id/result', AdminController.updateResult);
router.post('/predictions/sync-results', AdminController.syncFixtureResults);
router.post('/predictions/batch-summary', AdminController.publishBatchSummary);

router.get('/users', AdminController.getUsers);
router.post('/users/verify', AdminController.toggleUserVerify);

router.get('/sites', AdminController.getSites);
router.post('/sites', AdminController.saveSite);
router.delete('/sites/:id', AdminController.deleteSite);

router.get('/settings', AdminController.getSettings);
router.post('/settings', AdminController.saveSetting);

router.get('/backup/export', AdminController.exportBackup);

router.get('/players', AdminController.getWebPlayers);
router.post('/players/publish', AdminController.publishPlayer);
router.delete('/players/:playerId', AdminController.deletePlayer);
router.post('/players/featured', AdminController.toggleFeaturedPlayer);
router.post('/website/config', AdminController.saveWebsiteConfig);

export const adminRoutes = router;
