import { db } from '../connection';
import type { ReferralSite } from '../../types';

export const ReferralsRepo = {
  getAll: (): (ReferralSite & { base_url?: string })[] => {
    const rows = db.prepare('SELECT * FROM referral_sites ORDER BY order_index ASC, id ASC').all() as any[];
    return rows.map(r => ({ ...r, base_url: r.referral_url || r.base_url }));
  },

  getActive: (): (ReferralSite & { base_url?: string })[] => {
    const rows = db.prepare('SELECT * FROM referral_sites WHERE is_active = 1 ORDER BY order_index ASC, id ASC').all() as any[];
    return rows.map(r => ({ ...r, base_url: r.referral_url || r.base_url }));
  },

  getById: (id: number): (ReferralSite & { base_url?: string }) | undefined => {
    const r = db.prepare('SELECT * FROM referral_sites WHERE id = ?').get(id) as any;
    if (!r) return undefined;
    return { ...r, base_url: r.referral_url || r.base_url };
  },

  getByPostbackKey: (key: string): ReferralSite | undefined => {
    return db.prepare('SELECT * FROM referral_sites WHERE postback_key = ? AND is_active = 1').get(key) as ReferralSite | undefined;
  },

  create: (site: Partial<ReferralSite> & { base_url?: string }): number => {
    const now = new Date().toISOString();
    const url = site.referral_url || site.base_url || '';
    const info = db.prepare(`
      INSERT INTO referral_sites (name, logo_url, referral_url, app_url, promo_code, bonus_text, steps_text, is_active, order_index, postback_key, verify_mode, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      site.name || 'Unnamed Partner',
      site.logo_url || '',
      url,
      site.app_url || '',
      site.promo_code || '',
      site.bonus_text || '',
      site.steps_text || '',
      site.is_active !== undefined ? site.is_active : 1,
      site.order_index || 0,
      site.postback_key || '',
      site.verify_mode || 'postback',
      now
    );
    return Number(info.lastInsertRowid);
  },

  update: (id: number, site: Partial<ReferralSite> & { base_url?: string }): boolean => {
    const url = site.referral_url || site.base_url;
    const info = db.prepare(`
      UPDATE referral_sites SET
        name = COALESCE(?, name),
        logo_url = COALESCE(?, logo_url),
        referral_url = COALESCE(?, referral_url),
        app_url = COALESCE(?, app_url),
        promo_code = COALESCE(?, promo_code),
        bonus_text = COALESCE(?, bonus_text),
        steps_text = COALESCE(?, steps_text),
        is_active = COALESCE(?, is_active),
        order_index = COALESCE(?, order_index),
        postback_key = COALESCE(?, postback_key),
        verify_mode = COALESCE(?, verify_mode)
      WHERE id = ?
    `).run(
      site.name, site.logo_url, url, site.app_url,
      site.promo_code, site.bonus_text, site.steps_text,
      site.is_active, site.order_index, site.postback_key, site.verify_mode,
      id
    );
    return info.changes > 0;
  },

  delete: (id: number): boolean => {
    const info = db.prepare('DELETE FROM referral_sites WHERE id = ?').run(id);
    return info.changes > 0;
  },
};
