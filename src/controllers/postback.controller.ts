import { Request, Response } from 'express';
import { VerificationService } from '../services/verification.service';

export const PostbackController = {
  handleWebhook: async (req: Request, res: Response) => {
    const { siteKey } = req.params;
    const targetKey = String(siteKey || req.query.key || req.query.secret || '');

    const rawSubId = String(
      req.query.subid || req.body?.subid ||
      req.query.sub1 || req.body?.sub1 ||
      req.query.telegram_id || req.body?.telegram_id ||
      req.query.user_id || req.body?.user_id ||
      req.query.sub_id || req.body?.sub_id ||
      req.query.click_id || req.body?.click_id || ''
    );

    const fullUrl = req.originalUrl.toLowerCase();
    const isDeposit = (
      fullUrl.includes('event=deposit') ||
      fullUrl.includes('event=ftd') ||
      fullUrl.includes('status=sale') ||
      fullUrl.includes('type=deposit')
    );

    const result = VerificationService.handlePostback(targetKey, rawSubId, isDeposit);
    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  },
};
