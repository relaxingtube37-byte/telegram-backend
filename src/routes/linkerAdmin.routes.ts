import { Router } from 'express';
import { LinkerAdminController } from '../controllers/linkerAdmin.controller';
import { requireAdminAuth } from '../middlewares/adminAuth';

const router = Router();

// Defensive admin auth guard
router.use(requireAdminAuth);

// 1. Review Queue Listing & Details
router.get('/review-queue', LinkerAdminController.listReviewQueue);
router.get('/review-queue/:reviewId', LinkerAdminController.getReviewItem);

// 2. Admin Review Actions
router.post('/review-queue/:reviewId/approve', LinkerAdminController.approveItem);
router.post('/review-queue/:reviewId/reject', LinkerAdminController.rejectItem);

// 3. Split Action
router.post('/matches/:canonicalMatchId/split', LinkerAdminController.splitMatch);

// 4. Audit Trail
router.get('/audit-logs', LinkerAdminController.getAuditLogs);

export const linkerAdminRoutes = router;
