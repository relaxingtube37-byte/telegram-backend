import { Request, Response } from 'express';
import { VerificationService, detectPartnerEventType } from '../services/verification.service';

function pick(req: Request, keys: string[]): string {
  for (const k of keys) {
    const q = (req.query as any)?.[k];
    const b = (req.body as any)?.[k];
    if (q != null && String(q) !== '') return String(q);
    if (b != null && String(b) !== '') return String(b);
  }
  return '';
}

export const PostbackController = {
  handleWebhook: async (req: Request, res: Response) => {
    const { siteKey } = req.params;
    const targetKey = String(siteKey || req.query.key || req.query.secret || '');

    // Prefer opaque click_id; fall back to legacy subid / telegram id
    const correlationId = pick(req, [
      'click_id',
      'subid',
      'sub1',
      'sub_id',
      'telegram_id',
      'user_id',
      'ptid',
    ]);

    const transactionId = pick(req, ['transaction_id', 'txn_id', 'tx_id', 'order_id', 'payment_id']);

    const merged: Record<string, unknown> = {
      ...(typeof req.query === 'object' ? (req.query as object) : {}),
      ...(typeof req.body === 'object' && req.body ? (req.body as object) : {}),
    };
    const fullUrl = String(req.originalUrl || '').toLowerCase();
    const eventType = detectPartnerEventType(merged, fullUrl);

    const rawPayload = {
      method: req.method,
      path: req.path,
      params: req.params,
      query: req.query,
      body: req.body,
      received_via: 'postback',
    };

    const result = VerificationService.handlePostbackDetailed({
      targetKey,
      correlationId,
      transactionId: transactionId || undefined,
      eventType,
      rawPayload,
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  },
};
