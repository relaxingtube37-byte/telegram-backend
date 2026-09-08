import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { AnalysisController } from '../controllers/analysis.controller';
import { requireAdminAuth } from '../middlewares/adminAuth';

const router = Router();

router.use(requireAdminAuth);

router.post('/analysis/ingest', AnalysisController.ingestAnalysis);
router.get('/editorials', AnalysisController.listEditorials);
router.get('/editorials/:fixtureId', AnalysisController.getEditorialAdmin);
router.post('/editorials/:fixtureId/status', AnalysisController.transitionEditorialStatus);
router.post('/editorials/validate', AnalysisController.validateEditorial);

router.get('/overview', AdminController.getOverview);
router.get('/predictions', AdminController.getPredictions);
router.post('/predictions/publish', AdminController.publishPrediction);
router.put('/predictions/:id/result', AdminController.updateResult);
router.post('/predictions/sync-results', AdminController.syncFixtureResults);
router.post('/predictions/sync-fixture-results', AdminController.syncFixtureResults);
router.post('/predictions/batch-summary', AdminController.publishBatchSummary);
router.post('/predictions/batch-announcement', AdminController.publishBatchAnnouncement);

router.get('/users', AdminController.getUsers);
router.post('/users/verify', AdminController.toggleUserVerify);
router.get('/channel-stats', AdminController.getChannelStats);

router.get('/sites', AdminController.getSites);
router.post('/sites', AdminController.saveSite);
router.delete('/sites/:id', AdminController.deleteSite);

// Aliases for /referrals
router.get('/referrals', AdminController.getSites);
router.post('/referrals', AdminController.saveSite);
router.delete('/referrals/:id', AdminController.deleteSite);

router.delete('/predictions/:id', AdminController.deletePrediction);
router.post('/predictions/batch-delete', AdminController.batchDeletePredictions);

router.get('/settings', AdminController.getSettings);
router.post('/settings', AdminController.saveSetting);

router.get('/backup/export', AdminController.exportBackup);
router.get('/backup/export-full', AdminController.exportFullBackup);
router.get('/backup/download-sqlite', AdminController.downloadWalSafeSqlite);
router.post('/backup/import', AdminController.importBackup);
router.post('/predictions/run-settler', AdminController.runResultSettler);

router.get('/players', AdminController.getWebPlayers);
router.post('/players/publish', AdminController.publishPlayer);
router.post('/players/bulk-sync', AdminController.publishWebPlayersBulk);
router.delete('/players/:playerId', AdminController.deletePlayer);
router.post('/players/featured', AdminController.toggleFeaturedPlayer);
router.post('/website/config', AdminController.saveWebsiteConfig);

export const adminRoutes = router;
