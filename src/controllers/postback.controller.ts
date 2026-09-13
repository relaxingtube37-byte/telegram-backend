import { Request, Response } from 'express';
import { VerificationService, detectPartnerEventType } from '../services/verification.service';
import { Logger } from '../utils/logger';

function isUnsubstitutedMacro(val: string): boolean {
  if (!val) return false;
  return (
    (val.startsWith('{') && val.endsWith('}')) ||
    (val.startsWith('[') && val.endsWith(']')) ||
    (val.startsWith('$') && val.length > 2) ||
    val.includes('{') ||
    val.includes('}')
  );
}

function pick(req: Request, keys: string[]): string {
  const qMap: Record<string, string> = {};
  if (req.query && typeof req.query === 'object') {
    for (const [k, v] of Object.entries(req.query)) {
      if (v != null && String(v).trim() !== '') {
        qMap[k.toLowerCase()] = String(v).trim();
      }
    }
  }
  const bMap: Record<string, string> = {};
  if (req.body && typeof req.body === 'object') {
    for (const [k, v] of Object.entries(req.body)) {
      if (v != null && String(v).trim() !== '') {
        bMap[k.toLowerCase()] = String(v).trim();
      }
    }
  }
  for (const target of keys) {
    const t = target.toLowerCase();
    const candidate = qMap[t] || bMap[t];
    if (candidate && !isUnsubstitutedMacro(candidate)) {
      return candidate;
    }
  }
  return '';
}

export const PostbackController = {
  handleWebhook: async (req: Request, res: Response) => {
    const { siteKey } = req.params;
    const targetKey = String(siteKey || req.query.key || req.query.secret || req.query.site || '').trim();

    Logger.info(`[POSTBACK INCOMING] ${req.method} ${req.originalUrl} | Query: ${JSON.stringify(req.query)} | Body: ${JSON.stringify(req.body)}`);

    // 1. Scan all parameters for an authentic system click_id (starting with clk_)
    let correlationId = '';
    const allEntries = [
      ...Object.entries(req.query || {}),
      ...Object.entries(req.body || {}),
      ...Object.entries(req.params || {}),
    ];

    for (const [_, val] of allEntries) {
      const s = String(val || '').trim();
      if (!isUnsubstitutedMacro(s)) {
        if (/^clk_[a-f0-9]{16,32}$/i.test(s) || (s.startsWith('clk_') && s.length >= 15)) {
          correlationId = s;
          break;
        }
      }
    }

    // 2. If no clk_ pattern found, pick candidate keys case-insensitively
    if (!correlationId) {
      correlationId = pick(req, [
        'click_id', 'clickid', 'click',
        'subid', 'sub_id', 'sub1', 'sub_1', 'sub_id_1', 'subid1',
        'sub2', 'sub_2', 'sub3',
        'custom1', 'custom',
        'telegram_id', 'tg_id',
        'user_id', 'player_id', 'client_id', 'account_id',
        'ptid', 'uid', 'email', 'user_ref',
      ]);
    }

    const transactionId = pick(req, ['transaction_id', 'txn_id', 'tx_id', 'order_id', 'payment_id', 'id']);

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

    Logger.info(`[POSTBACK RESULT] ${JSON.stringify(result)}`);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  },
};
