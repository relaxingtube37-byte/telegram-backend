import { db } from '../connection';
import type { PartnerConversionRecord, PartnerEventType } from '../../business-actions/types';

export function buildConversionDedupeKey(opts: {
  partner_key: string;
  event_type: PartnerEventType;
  transaction_id?: string | null;
  click_id?: string | null;
}): string {
  const tx = (opts.transaction_id || '').trim();
  const click = (opts.click_id || '').trim();
  const correlation = tx || click || `anon_${Date.now()}`;
  return `${opts.partner_key}|${opts.event_type}|${correlation}`;
}

export const PartnerConversionsRepo = {
  findByDedupeKey: (dedupeKey: string): PartnerConversionRecord | undefined => {
    return db.prepare('SELECT * FROM partner_conversions WHERE dedupe_key = ?').get(dedupeKey) as
      | PartnerConversionRecord
      | undefined;
  },

  create: (row: {
    partner_key: string;
    site_id: number | null;
    event_type: PartnerEventType;
    click_id: string | null;
    transaction_id: string | null;
    dedupe_key: string;
    user_ref: string | null;
    status: PartnerConversionRecord['status'];
    raw_payload: string;
  }): { record: PartnerConversionRecord; inserted: boolean } => {
    const existing = PartnerConversionsRepo.findByDedupeKey(row.dedupe_key);
    if (existing) {
      return { record: existing, inserted: false };
    }
    const received_at = new Date().toISOString();
    try {
      const info = db
        .prepare(
          `INSERT INTO partner_conversions (
            partner_key, site_id, event_type, click_id, transaction_id,
            dedupe_key, user_ref, status, raw_payload, received_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          row.partner_key,
          row.site_id,
          row.event_type,
          row.click_id,
          row.transaction_id,
          row.dedupe_key,
          row.user_ref,
          row.status,
          row.raw_payload,
          received_at
        );
      return {
        inserted: true,
        record: {
          id: Number(info.lastInsertRowid),
          partner_key: row.partner_key,
          site_id: row.site_id,
          event_type: row.event_type,
          click_id: row.click_id,
          transaction_id: row.transaction_id,
          dedupe_key: row.dedupe_key,
          user_ref: row.user_ref,
          status: row.status,
          raw_payload: row.raw_payload,
          received_at,
        },
      };
    } catch (e: any) {
      // Unique race → treat as duplicate
      const again = PartnerConversionsRepo.findByDedupeKey(row.dedupe_key);
      if (again) return { record: again, inserted: false };
      throw e;
    }
  },

  count: (): number => {
    const row = db.prepare('SELECT COUNT(*) as c FROM partner_conversions').get() as { c: number };
    return row?.c || 0;
  },
};
