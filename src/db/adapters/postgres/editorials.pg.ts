import type { IEditorialsRepo } from '../../interfaces/editorials.interface';
import type { MatchEditorialRecord, EditorialPublishStatus } from '../../repositories/editorials.repo';
import type { PostgresClientPool } from './predictions.pg';

export class PostgresEditorialsAdapter implements IEditorialsRepo {
  private pool: PostgresClientPool | null;

  constructor(pool: PostgresClientPool | null = null) {
    this.pool = pool;
  }

  setPool(pool: PostgresClientPool | null) {
    this.pool = pool;
  }

  private ensurePool(): PostgresClientPool {
    if (!this.pool) {
      throw new Error('PostgreSQL staging pool is not connected or initialized.');
    }
    return this.pool;
  }

  async getByFixtureId(fixtureId: number): Promise<MatchEditorialRecord | null> {
    const pool = this.ensurePool();
    const res = await pool.query(
      'SELECT editorial_id, match_id, headline, summary, tactical_analysis, publish_status, created_at FROM predictions.match_editorials WHERE match_id = $1 LIMIT 1',
      [String(fixtureId)]
    );
    if (!res.rows.length) return null;
    const r = res.rows[0];
    return {
      id: r.editorial_id,
      fixture_id: Number(r.match_id) || fixtureId,
      slug: `match-${r.match_id}`,
      headline: r.headline,
      summary: r.summary,
      tactical_analysis: r.tactical_analysis || '',
      is_published: r.publish_status === 'PUBLISHED' ? 1 : 0,
      publish_status: r.publish_status,
      created_at: r.created_at
    };
  }

  async getBySlug(slug: string): Promise<MatchEditorialRecord | null> {
    const pool = this.ensurePool();
    const res = await pool.query(
      'SELECT editorial_id, match_id, headline, summary, tactical_analysis, publish_status, created_at FROM predictions.match_editorials WHERE slug = $1 LIMIT 1',
      [slug]
    );
    if (!res.rows.length) return null;
    const r = res.rows[0];
    return {
      id: r.editorial_id,
      fixture_id: Number(r.match_id) || 0,
      slug: slug,
      headline: r.headline,
      summary: r.summary,
      tactical_analysis: r.tactical_analysis || '',
      is_published: r.publish_status === 'PUBLISHED' ? 1 : 0,
      publish_status: r.publish_status,
      created_at: r.created_at
    };
  }

  async listPublished(limit = 20): Promise<MatchEditorialRecord[]> {
    const pool = this.ensurePool();
    const res = await pool.query(
      "SELECT editorial_id, match_id, headline, summary, tactical_analysis, publish_status, created_at FROM predictions.match_editorials WHERE publish_status = 'PUBLISHED' ORDER BY created_at DESC LIMIT $1",
      [limit]
    );
    return res.rows.map((r: any) => ({
      id: r.editorial_id,
      fixture_id: Number(r.match_id) || 0,
      slug: `match-${r.match_id}`,
      headline: r.headline,
      summary: r.summary,
      tactical_analysis: r.tactical_analysis || '',
      is_published: 1,
      publish_status: r.publish_status,
      created_at: r.created_at
    }));
  }

  async listAll(limit = 100): Promise<MatchEditorialRecord[]> {
    const pool = this.ensurePool();
    const res = await pool.query(
      'SELECT editorial_id, match_id, headline, summary, tactical_analysis, publish_status, created_at FROM predictions.match_editorials ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return res.rows.map((r: any) => ({
      id: r.editorial_id,
      fixture_id: Number(r.match_id) || 0,
      slug: `match-${r.match_id}`,
      headline: r.headline,
      summary: r.summary,
      tactical_analysis: r.tactical_analysis || '',
      is_published: r.publish_status === 'PUBLISHED' ? 1 : 0,
      publish_status: r.publish_status,
      created_at: r.created_at
    }));
  }

  async upsert(_record: MatchEditorialRecord): Promise<{ id: number; fixture_id: number; slug: string }> {
    throw new Error('POSTGRES_MUTATION_PROHIBITED: Dual-write is NOT AUTHORIZED in Phase 8 Entry Gate.');
  }

  async updateStatus(
    _fixtureId: number,
    _nextStatus: EditorialPublishStatus,
    _meta?: { editor?: string; note?: string }
  ): Promise<MatchEditorialRecord | null> {
    throw new Error('POSTGRES_MUTATION_PROHIBITED: Dual-write is NOT AUTHORIZED in Phase 8 Entry Gate.');
  }
}
