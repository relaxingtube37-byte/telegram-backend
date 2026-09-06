import { db } from '../connection';

export interface MatchEditorialRecord {
  id?: number;
  fixture_id: number;
  slug: string;
  headline: string;
  summary: string;
  tactical_analysis: string;
  surface_breakdown?: string;
  h2h_breakdown?: string;
  key_stats_json?: string;
  author_name?: string;
  seo_title?: string;
  seo_description?: string;
  ai_assisted?: number;
  is_published?: number;
  created_at?: string;
  updated_at?: string;
}

export const EditorialsRepo = {
  getByFixtureId: (fixtureId: number): MatchEditorialRecord | null => {
    const stmt = db.prepare('SELECT * FROM match_editorials WHERE fixture_id = ?');
    return (stmt.get(fixtureId) as MatchEditorialRecord) || null;
  },

  getBySlug: (slug: string): MatchEditorialRecord | null => {
    const stmt = db.prepare('SELECT * FROM match_editorials WHERE slug = ?');
    return (stmt.get(slug) as MatchEditorialRecord) || null;
  },

  listPublished: (limit = 20): MatchEditorialRecord[] => {
    const stmt = db.prepare('SELECT * FROM match_editorials WHERE is_published = 1 ORDER BY created_at DESC LIMIT ?');
    return (stmt.all(limit) as MatchEditorialRecord[]) || [];
  },

  upsert: (editorial: MatchEditorialRecord): { id: number; fixture_id: number; slug: string } => {
    const now = new Date().toISOString();
    const existing = EditorialsRepo.getByFixtureId(editorial.fixture_id);

    if (existing) {
      const stmt = db.prepare(`
        UPDATE match_editorials SET
          slug = ?,
          headline = ?,
          summary = ?,
          tactical_analysis = ?,
          surface_breakdown = ?,
          h2h_breakdown = ?,
          key_stats_json = ?,
          author_name = ?,
          seo_title = ?,
          seo_description = ?,
          ai_assisted = ?,
          is_published = ?,
          updated_at = ?
        WHERE fixture_id = ?
      `);

      stmt.run(
        editorial.slug || existing.slug,
        editorial.headline,
        editorial.summary,
        editorial.tactical_analysis,
        editorial.surface_breakdown || null,
        editorial.h2h_breakdown || null,
        editorial.key_stats_json || null,
        editorial.author_name || 'PTIN Tennis Editorial Team',
        editorial.seo_title || null,
        editorial.seo_description || null,
        editorial.ai_assisted !== undefined ? editorial.ai_assisted : 1,
        editorial.is_published !== undefined ? editorial.is_published : 1,
        now,
        editorial.fixture_id
      );

      return { id: existing.id!, fixture_id: editorial.fixture_id, slug: editorial.slug || existing.slug };
    } else {
      const stmt = db.prepare(`
        INSERT INTO match_editorials (
          fixture_id, slug, headline, summary, tactical_analysis,
          surface_breakdown, h2h_breakdown, key_stats_json, author_name,
          seo_title, seo_description, ai_assisted, is_published, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?
        )
      `);

      const result = stmt.run(
        editorial.fixture_id,
        editorial.slug,
        editorial.headline,
        editorial.summary,
        editorial.tactical_analysis,
        editorial.surface_breakdown || null,
        editorial.h2h_breakdown || null,
        editorial.key_stats_json || null,
        editorial.author_name || 'PTIN Tennis Editorial Team',
        editorial.seo_title || null,
        editorial.seo_description || null,
        editorial.ai_assisted !== undefined ? editorial.ai_assisted : 1,
        editorial.is_published !== undefined ? editorial.is_published : 1,
        now,
        now
      );

      return { id: Number(result.lastInsertRowid), fixture_id: editorial.fixture_id, slug: editorial.slug };
    }
  }
};
