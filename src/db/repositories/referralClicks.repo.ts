import { db } from '../connection';
import type { ReferralActionType, ReferralClickRecord } from '../../business-actions/types';

export const ReferralClicksRepo = {
  create: (row: {
    click_id: string;
    site_id: number | null;
    partner_key: string;
    user_ref: string;
    session_ref?: string | null;
    match_id?: number | null;
    fixture_id?: number | null;
    page_context?: string | null;
    action_type: ReferralActionType;
    destination_url: string;
  }): ReferralClickRecord => {
    const created_at = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO referral_clicks (
          click_id, site_id, partner_key, user_ref, session_ref,
          match_id, fixture_id, page_context, action_type, destination_url, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.click_id,
        row.site_id,
        row.partner_key,
        row.user_ref,
        row.session_ref || null,
        row.match_id ?? null,
        row.fixture_id ?? null,
        row.page_context || null,
        row.action_type,
        row.destination_url,
        created_at
      );
    return {
      id: Number(info.lastInsertRowid),
      click_id: row.click_id,
      site_id: row.site_id,
      partner_key: row.partner_key,
      user_ref: row.user_ref,
      session_ref: row.session_ref || null,
      match_id: row.match_id ?? null,
      fixture_id: row.fixture_id ?? null,
      page_context: row.page_context || null,
      action_type: row.action_type,
      destination_url: row.destination_url,
      created_at,
    };
  },

  getByClickId: (clickId: string): ReferralClickRecord | undefined => {
    return db.prepare('SELECT * FROM referral_clicks WHERE click_id = ?').get(clickId) as
      | ReferralClickRecord
      | undefined;
  },

  count: (): number => {
    const row = db.prepare('SELECT COUNT(*) as c FROM referral_clicks').get() as { c: number };
    return row?.c || 0;
  },
};
