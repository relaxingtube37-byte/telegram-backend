import { db } from '../connection';

export type EditorialPublishStatus =
  | 'draft'
  | 'review'
  | 'approved'
  | 'published'
  | 'archived';

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
  /** Phase D fields */
  subtitle?: string | null;
  short_summary?: string | null;
  key_facts_json?: string | null;
  data_bullets_json?: string | null;
  tags_json?: string | null;
  seo_metadata_json?: string | null;
  share_text?: string | null;
  guest_safe_summary?: string | null;
  publish_status?: EditorialPublishStatus | string;
  version?: number;
  editor_name?: string | null;
  published_at?: string | null;
  status_history_json?: string | null;
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
    const stmt = db.prepare(
      `SELECT * FROM match_editorials
       WHERE is_published = 1 OR publish_status = 'published'
       ORDER BY COALESCE(published_at, updated_at, created_at) DESC LIMIT ?`
    );
    return (stmt.all(limit) as MatchEditorialRecord[]) || [];
  },

  listAll: (limit = 100): MatchEditorialRecord[] => {
    return (db
      .prepare('SELECT * FROM match_editorials ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as MatchEditorialRecord[]) || [];
  },

  upsert: (editorial: MatchEditorialRecord): { id: number; fixture_id: number; slug: string } => {
    const now = new Date().toISOString();
    const existing = EditorialsRepo.getByFixtureId(editorial.fixture_id);
    const publishStatus = editorial.publish_status || (editorial.is_published ? 'published' : 'draft');
    const isPublished = publishStatus === 'published' ? 1 : editorial.is_published !== undefined ? editorial.is_published : 0;

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
          subtitle = ?,
          short_summary = ?,
          key_facts_json = ?,
          data_bullets_json = ?,
          tags_json = ?,
          seo_metadata_json = ?,
          share_text = ?,
          guest_safe_summary = ?,
          publish_status = ?,
          version = ?,
          editor_name = ?,
          published_at = ?,
          status_history_json = ?,
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
        isPublished,
        editorial.subtitle ?? existing.subtitle ?? null,
        editorial.short_summary ?? existing.short_summary ?? null,
        editorial.key_facts_json ?? existing.key_facts_json ?? null,
        editorial.data_bullets_json ?? existing.data_bullets_json ?? null,
        editorial.tags_json ?? existing.tags_json ?? null,
        editorial.seo_metadata_json ?? existing.seo_metadata_json ?? null,
        editorial.share_text ?? existing.share_text ?? null,
        editorial.guest_safe_summary ?? existing.guest_safe_summary ?? null,
        publishStatus,
        editorial.version ?? (existing.version || 1) + 1,
        editorial.editor_name ?? existing.editor_name ?? null,
        publishStatus === 'published'
          ? editorial.published_at || existing.published_at || now
          : editorial.published_at ?? existing.published_at ?? null,
        editorial.status_history_json ?? existing.status_history_json ?? null,
        now,
        editorial.fixture_id
      );

      return { id: existing.id!, fixture_id: editorial.fixture_id, slug: editorial.slug || existing.slug };
    }

    const stmt = db.prepare(`
      INSERT INTO match_editorials (
        fixture_id, slug, headline, summary, tactical_analysis,
        surface_breakdown, h2h_breakdown, key_stats_json, author_name,
        seo_title, seo_description, ai_assisted, is_published,
        subtitle, short_summary, key_facts_json, data_bullets_json, tags_json,
        seo_metadata_json, share_text, guest_safe_summary, publish_status,
        version, editor_name, published_at, status_history_json,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?
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
      isPublished,
      editorial.subtitle || null,
      editorial.short_summary || null,
      editorial.key_facts_json || null,
      editorial.data_bullets_json || null,
      editorial.tags_json || null,
      editorial.seo_metadata_json || null,
      editorial.share_text || null,
      editorial.guest_safe_summary || null,
      publishStatus,
      editorial.version || 1,
      editorial.editor_name || null,
      publishStatus === 'published' ? editorial.published_at || now : null,
      editorial.status_history_json || null,
      now,
      now
    );

    return { id: Number(result.lastInsertRowid), fixture_id: editorial.fixture_id, slug: editorial.slug };
  },

  updateStatus: (
    fixtureId: number,
    nextStatus: EditorialPublishStatus,
    meta?: { editor?: string; note?: string }
  ): MatchEditorialRecord | null => {
    const existing = EditorialsRepo.getByFixtureId(fixtureId);
    if (!existing) return null;
    const now = new Date().toISOString();
    let history: Array<Record<string, unknown>> = [];
    try {
      history = existing.status_history_json ? JSON.parse(existing.status_history_json) : [];
    } catch {
      history = [];
    }
    history.push({
      from: existing.publish_status || (existing.is_published ? 'published' : 'draft'),
      to: nextStatus,
      at: now,
      editor: meta?.editor || null,
      note: meta?.note || null,
    });
    const publishedAt = nextStatus === 'published' ? now : existing.published_at || null;
    db.prepare(
      `UPDATE match_editorials SET
        publish_status = ?,
        is_published = ?,
        published_at = ?,
        editor_name = COALESCE(?, editor_name),
        status_history_json = ?,
        version = COALESCE(version, 1) + 1,
        updated_at = ?
       WHERE fixture_id = ?`
    ).run(
      nextStatus,
      nextStatus === 'published' ? 1 : 0,
      publishedAt,
      meta?.editor || null,
      JSON.stringify(history),
      now,
      fixtureId
    );
    return EditorialsRepo.getByFixtureId(fixtureId);
  },
};
