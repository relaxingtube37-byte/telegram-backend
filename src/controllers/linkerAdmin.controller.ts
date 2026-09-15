import { Request, Response } from 'express';
import { getLinkerDryRunDb } from '../linker/linkerDb';
import {
  ReviewQueueService,
  LockConflictError,
  NotFoundError,
  ValidationError,
} from '../linker/reviewQueueService';

function getService(): ReviewQueueService {
  const db = getLinkerDryRunDb();
  return new ReviewQueueService(db);
}

export const LinkerAdminController = {
  listReviewQueue: async (req: Request, res: Response) => {
    try {
      const service = getService();
      const status = req.query.status as any;
      const source = req.query.source as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

      const result = service.listItems({ status, source, limit, offset });
      return res.json({ success: true, data: result });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  },

  getReviewItem: async (req: Request, res: Response) => {
    try {
      const service = getService();
      const rawId = Array.isArray(req.params.reviewId) ? req.params.reviewId[0] : req.params.reviewId;
      const reviewId = parseInt(String(rawId), 10);
      if (isNaN(reviewId)) {
        return res.status(400).json({ success: false, error: 'Invalid reviewId' });
      }

      const item = service.getItemById(reviewId);
      return res.json({ success: true, data: item });
    } catch (err: any) {
      if (err instanceof NotFoundError) {
        return res.status(404).json({ success: false, error: err.message });
      }
      return res.status(500).json({ success: false, error: err.message });
    }
  },

  approveItem: async (req: Request, res: Response) => {
    try {
      const service = getService();
      const rawId = Array.isArray(req.params.reviewId) ? req.params.reviewId[0] : req.params.reviewId;
      const reviewId = parseInt(String(rawId), 10);
      if (isNaN(reviewId)) {
        return res.status(400).json({ success: false, error: 'Invalid reviewId' });
      }

      const expectedLockVersion =
        typeof req.body.expected_lock_version === 'number'
          ? req.body.expected_lock_version
          : typeof req.body.lock_version === 'number'
          ? req.body.lock_version
          : undefined;

      if (expectedLockVersion === undefined) {
        return res.status(400).json({
          success: false,
          error: 'expected_lock_version (number) is required for optimistic concurrency',
        });
      }

      const targetCanonicalId = req.body.target_canonical_id;
      const reason = req.body.reason;
      const actor = req.body.actor || 'admin';

      const result = service.approve(reviewId, {
        expectedLockVersion,
        targetCanonicalId,
        actor,
        reason,
      });

      return res.json({ success: true, data: result });
    } catch (err: any) {
      if (err instanceof LockConflictError) {
        return res.status(409).json({ success: false, error: err.message });
      }
      if (err instanceof NotFoundError) {
        return res.status(404).json({ success: false, error: err.message });
      }
      if (err instanceof ValidationError) {
        return res.status(400).json({ success: false, error: err.message });
      }
      return res.status(500).json({ success: false, error: err.message });
    }
  },

  rejectItem: async (req: Request, res: Response) => {
    try {
      const service = getService();
      const rawId = Array.isArray(req.params.reviewId) ? req.params.reviewId[0] : req.params.reviewId;
      const reviewId = parseInt(String(rawId), 10);
      if (isNaN(reviewId)) {
        return res.status(400).json({ success: false, error: 'Invalid reviewId' });
      }

      const expectedLockVersion =
        typeof req.body.expected_lock_version === 'number'
          ? req.body.expected_lock_version
          : typeof req.body.lock_version === 'number'
          ? req.body.lock_version
          : undefined;

      if (expectedLockVersion === undefined) {
        return res.status(400).json({
          success: false,
          error: 'expected_lock_version (number) is required for optimistic concurrency',
        });
      }

      const reason = req.body.reason;
      const actor = req.body.actor || 'admin';

      const result = service.reject(reviewId, {
        expectedLockVersion,
        actor,
        reason,
      });

      return res.json({ success: true, data: result });
    } catch (err: any) {
      if (err instanceof LockConflictError) {
        return res.status(409).json({ success: false, error: err.message });
      }
      if (err instanceof NotFoundError) {
        return res.status(404).json({ success: false, error: err.message });
      }
      if (err instanceof ValidationError) {
        return res.status(400).json({ success: false, error: err.message });
      }
      return res.status(500).json({ success: false, error: err.message });
    }
  },

  splitMatch: async (req: Request, res: Response) => {
    try {
      const service = getService();
      const rawMatchId = Array.isArray(req.params.canonicalMatchId) ? req.params.canonicalMatchId[0] : req.params.canonicalMatchId;
      const canonicalMatchId = String(rawMatchId || '');
      if (!canonicalMatchId) {
        return res.status(400).json({ success: false, error: 'canonicalMatchId is required' });
      }

      const sourceToDetach = req.body.source_to_detach || req.body.sourceToDetach;
      if (!sourceToDetach) {
        return res.status(400).json({
          success: false,
          error: 'source_to_detach (string) is required to identify which source to separate',
        });
      }

      const reason = req.body.reason;
      if (!reason || !reason.trim()) {
        return res.status(400).json({
          success: false,
          error: 'reason (string) is required for split audit trail',
        });
      }

      const expectedVersion =
        typeof req.body.expected_version === 'number'
          ? req.body.expected_version
          : typeof req.body.version === 'number'
          ? req.body.version
          : undefined;

      const actor = req.body.actor || 'admin';

      const result = service.split(canonicalMatchId, {
        sourceToDetach,
        expectedVersion,
        actor,
        reason,
      });

      return res.json({ success: true, data: result });
    } catch (err: any) {
      if (err instanceof LockConflictError) {
        return res.status(409).json({ success: false, error: err.message });
      }
      if (err instanceof NotFoundError) {
        return res.status(404).json({ success: false, error: err.message });
      }
      if (err instanceof ValidationError) {
        return res.status(400).json({ success: false, error: err.message });
      }
      return res.status(500).json({ success: false, error: err.message });
    }
  },

  getAuditLogs: async (req: Request, res: Response) => {
    try {
      const service = getService();
      const rawReviewId = req.query.review_id;
      const reviewId = rawReviewId ? parseInt(String(rawReviewId), 10) : undefined;
      const action = req.query.action as string | undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
      const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;

      const result = service.getAuditLogs({ reviewId, action, limit, offset });
      return res.json({ success: true, data: result });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  },
};
