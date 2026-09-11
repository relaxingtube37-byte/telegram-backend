import type { IPlayersRepo } from '../../interfaces/players.interface';
import type { PublishedPlayer } from '../../../types';
import type { PostgresClientPool } from '../../stagingPgPool';
import { getStagingPgPool } from '../../stagingPgPool';

export class PostgresPlayersAdapter implements IPlayersRepo {
  private pool: PostgresClientPool | null;

  constructor(pool: PostgresClientPool | null = null) {
    this.pool = pool;
  }

  setPool(pool: PostgresClientPool | null) {
    this.pool = pool;
  }

  private ensurePool(): PostgresClientPool {
    if (!this.pool) {
      this.pool = getStagingPgPool();
    }
    return this.pool;
  }

  private mapRowToPlayer(r: any): PublishedPlayer {
    const slug = (r.full_name_standard || 'player')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    return {
      id: r.numeric_id || 1,
      player_id: r.numeric_id || 1,
      slug,
      full_name: r.full_name_standard,
      short_name: r.full_name_standard ? r.full_name_standard.split(' ').pop() : undefined,
      country_code: r.country_code || undefined,
      gender: (r.gender === 'F' ? 'F' : 'M'),
      is_published: 1,
      is_featured: 0,
      created_at: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString()
    };
  }

  async getAll(limit = 100): Promise<PublishedPlayer[]> {
    const pool = this.ensurePool();
    const res = await pool.query(
      `SELECT player_id, full_name_standard, country_ioc AS country_code, gender, created_at, updated_at
       FROM identity.players
       ORDER BY full_name_standard ASC
       LIMIT $1`,
      [limit]
    );
    return res.rows.map((r: any) => this.mapRowToPlayer(r));
  }

  async getPublished(limit = 100): Promise<PublishedPlayer[]> {
    return this.getAll(limit);
  }

  async getFeatured(): Promise<PublishedPlayer[]> {
    const pool = this.ensurePool();
    const res = await pool.query(
      `SELECT player_id, full_name_standard, country_ioc AS country_code, gender, created_at, updated_at
       FROM identity.players
       WHERE full_name_standard IN ('Carlos Alcaraz', 'Novak Djokovic', 'Jannik Sinner', 'Daniil Medvedev', 'Aryna Sabalenka', 'Iga Swiatek', 'Coco Gauff')
       ORDER BY full_name_standard ASC`
    );
    return res.rows.map((r: any) => ({ ...this.mapRowToPlayer(r), is_featured: 1 }));
  }

  async getByPlayerId(playerId: number): Promise<PublishedPlayer | undefined> {
    const pool = this.ensurePool();
    const res = await pool.query(
      `SELECT player_id, full_name_standard, country_ioc AS country_code, gender, created_at, updated_at
       FROM identity.players
       WHERE player_id::text = $1
       LIMIT 1`,
      [String(playerId)]
    );
    if (!res.rows.length) return undefined;
    return this.mapRowToPlayer(res.rows[0]);
  }

  async getBySlugOrId(slugOrId: string | number): Promise<PublishedPlayer | undefined> {
    const pool = this.ensurePool();
    const str = String(slugOrId).replace(/-/g, ' ').toLowerCase();
    const res = await pool.query(
      `SELECT player_id, full_name_standard, country_ioc AS country_code, gender, created_at, updated_at
       FROM identity.players
       WHERE LOWER(full_name_standard) = $1 OR player_id::text = $2
       LIMIT 1`,
      [str, String(slugOrId)]
    );
    if (!res.rows.length) return undefined;
    return this.mapRowToPlayer(res.rows[0]);
  }

  // --- Strict Zero-Mutation Enforcement in Staging ---
  async upsert(_p: PublishedPlayer): Promise<number> {
    throw new Error('POSTGRES_MUTATION_PROHIBITED: Dual-write and mutation are NOT AUTHORIZED in Phase 8.');
  }

  async bulkUpsert(_players: PublishedPlayer[]): Promise<number> {
    throw new Error('POSTGRES_MUTATION_PROHIBITED: Dual-write and mutation are NOT AUTHORIZED in Phase 8.');
  }

  async delete(_playerId: number): Promise<boolean> {
    throw new Error('POSTGRES_MUTATION_PROHIBITED: Dual-write and mutation are NOT AUTHORIZED in Phase 8.');
  }

  async toggleFeatured(_playerId: number, _featured: boolean): Promise<boolean> {
    throw new Error('POSTGRES_MUTATION_PROHIBITED: Dual-write and mutation are NOT AUTHORIZED in Phase 8.');
  }
}
