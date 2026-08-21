import { db } from '../connection';
import type { PublishedPlayer } from '../../types';

export const PlayersRepo = {
  getAll: (limit = 100): PublishedPlayer[] => {
    return db.prepare('SELECT * FROM players ORDER BY COALESCE(ranking, 999) ASC, full_name ASC LIMIT ?').all(limit) as PublishedPlayer[];
  },

  getPublished: (limit = 100): PublishedPlayer[] => {
    return db.prepare('SELECT * FROM players WHERE is_published = 1 ORDER BY COALESCE(ranking, 999) ASC, full_name ASC LIMIT ?').all(limit) as PublishedPlayer[];
  },

  getFeatured: (): PublishedPlayer[] => {
    return db.prepare('SELECT * FROM players WHERE is_published = 1 AND is_featured = 1 ORDER BY COALESCE(ranking, 999) ASC').all() as PublishedPlayer[];
  },

  getByPlayerId: (playerId: number): PublishedPlayer | undefined => {
    return db.prepare('SELECT * FROM players WHERE player_id = ?').get(playerId) as PublishedPlayer | undefined;
  },

  getBySlugOrId: (slugOrId: string | number): PublishedPlayer | undefined => {
    if (!isNaN(Number(slugOrId))) {
      const byId = db.prepare('SELECT * FROM players WHERE player_id = ? OR id = ?').get(Number(slugOrId), Number(slugOrId));
      if (byId) return byId as PublishedPlayer;
    }
    return db.prepare('SELECT * FROM players WHERE slug = ?').get(String(slugOrId).toLowerCase()) as PublishedPlayer | undefined;
  },

  upsert: (p: PublishedPlayer): number => {
    const now = new Date().toISOString();
    const slug = (p.slug || p.full_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')).trim();

    const stmt = db.prepare(`
      INSERT INTO players (
        player_id, slug, full_name, short_name, country_code, country_name,
        ranking, gender, image_url, bio, playstyle,
        surface_stats_json, recent_matches_json, ai_dossier_json,
        is_featured, is_published, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?
      )
      ON CONFLICT(player_id) DO UPDATE SET
        slug = excluded.slug,
        full_name = excluded.full_name,
        short_name = excluded.short_name,
        country_code = excluded.country_code,
        country_name = excluded.country_name,
        ranking = excluded.ranking,
        gender = excluded.gender,
        image_url = excluded.image_url,
        bio = excluded.bio,
        playstyle = excluded.playstyle,
        surface_stats_json = excluded.surface_stats_json,
        recent_matches_json = excluded.recent_matches_json,
        ai_dossier_json = excluded.ai_dossier_json,
        is_featured = excluded.is_featured,
        is_published = excluded.is_published,
        updated_at = excluded.updated_at
    `);

    const info = stmt.run(
      p.player_id, slug, p.full_name, p.short_name || null, p.country_code || null, p.country_name || null,
      p.ranking || null, p.gender || 'M', p.image_url || null, p.bio || null, p.playstyle || null,
      p.surface_stats_json || null, p.recent_matches_json || null, p.ai_dossier_json || null,
      p.is_featured ? 1 : 0, p.is_published !== undefined ? (p.is_published ? 1 : 0) : 1,
      p.created_at || now, now
    );

    return Number(info.lastInsertRowid);
  },

  delete: (playerId: number): boolean => {
    const info = db.prepare('DELETE FROM players WHERE player_id = ? OR id = ?').run(playerId, playerId);
    return info.changes > 0;
  },

  toggleFeatured: (playerId: number, featured: boolean): boolean => {
    const info = db.prepare('UPDATE players SET is_featured = ?, updated_at = ? WHERE player_id = ? OR id = ?').run(
      featured ? 1 : 0, new Date().toISOString(), playerId, playerId
    );
    return info.changes > 0;
  },
};
