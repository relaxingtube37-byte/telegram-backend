import type { IPredictionsRepo } from '../../interfaces/predictions.interface';
import type { Prediction } from '../../../types';
import type { PostgresClientPool } from '../../stagingPgPool';
import { getStagingPgPool } from '../../stagingPgPool';

export class PostgresPredictionsAdapter implements IPredictionsRepo {
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

  private mapRowToPrediction(r: any): Prediction {
    // Map status
    let status: 'UPCOMING' | 'LIVE' | 'WON' | 'LOST' | 'VOID' = 'UPCOMING';
    if (r.result_score) {
      if (r.winner_prediction && r.predicted_winner_id && r.winner_player_id) {
        status = r.predicted_winner_id === r.winner_player_id ? 'WON' : 'LOST';
      } else {
        status = 'WON';
      }
    }

    return {
      id: r.run_id,
      fixture_id: r.match_id,
      home_name: r.home_name || 'Player 1',
      away_name: r.away_name || 'Player 2',
      predicted_winner: r.winner_prediction || r.home_name || 'Player 1',
      win_probability: Number(r.win_probability) || 0.5,
      confidence: (r.confidence_tier || 'MEDIUM') as 'HIGH' | 'MEDIUM' | 'LOW',
      status,
      result_score: r.result_score || undefined,
      created_at: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString()
    };
  }

  private get baseSelectQuery(): string {
    return `
      SELECT
        r.run_id,
        r.match_id,
        COALESCE(r.model_routing_config->>'model', 'gpt-4o') AS model_name,
        pw.full_name_standard AS winner_prediction,
        r.predicted_winner_id,
        (r.win_probability_pct / 100.0) AS win_probability,
        r.confidence_tier,
        r.created_at,
        p1.full_name_standard AS home_name,
        p2.full_name_standard AS away_name,
        m.surface,
        m.round_name,
        res.score_string AS result_score,
        res.winner_player_id
      FROM ai.predictionruns r
      LEFT JOIN matches.matches m ON m.match_id = r.match_id
      LEFT JOIN identity.players pw ON pw.player_id = r.predicted_winner_id
      LEFT JOIN matches.match_participants mp1 ON mp1.match_id = r.match_id AND mp1.side = 1
      LEFT JOIN identity.players p1 ON p1.player_id = mp1.player_id
      LEFT JOIN matches.match_participants mp2 ON mp2.match_id = r.match_id AND mp2.side = 2
      LEFT JOIN identity.players p2 ON p2.player_id = mp2.player_id
      LEFT JOIN matches.match_results res ON res.match_id = r.match_id
    `;
  }

  private buildQueryWithCte(filterClause: string): string {
    return `
      WITH r AS (
        SELECT * FROM ai.predictionruns ${filterClause}
      )
      SELECT
        r.run_id,
        r.match_id,
        COALESCE(r.model_routing_config->>'model', 'gpt-4o') AS model_name,
        pw.full_name_standard AS winner_prediction,
        r.predicted_winner_id,
        (r.win_probability_pct / 100.0) AS win_probability,
        r.confidence_tier,
        r.created_at,
        p1.full_name_standard AS home_name,
        p2.full_name_standard AS away_name,
        m.surface,
        m.round_name,
        res.score_string AS result_score,
        res.winner_player_id
      FROM r
      LEFT JOIN matches.matches m ON m.match_id = r.match_id
      LEFT JOIN identity.players pw ON pw.player_id = r.predicted_winner_id
      LEFT JOIN matches.match_participants mp1 ON mp1.match_id = r.match_id AND mp1.side = 1
      LEFT JOIN identity.players p1 ON p1.player_id = mp1.player_id
      LEFT JOIN matches.match_participants mp2 ON mp2.match_id = r.match_id AND mp2.side = 2
      LEFT JOIN identity.players p2 ON p2.player_id = mp2.player_id
      LEFT JOIN matches.match_results res ON res.match_id = r.match_id
      ORDER BY r.created_at DESC
    `;
  }

  async getAll(limit = 100): Promise<Prediction[]> {
    const pool = this.ensurePool();
    const query = this.buildQueryWithCte('ORDER BY created_at DESC LIMIT $1');
    const res = await pool.query(query, [limit]);
    return res.rows.map((r: any) => this.mapRowToPrediction(r));
  }

  async getActive(): Promise<Prediction[]> {
    const pool = this.ensurePool();
    const query = this.buildQueryWithCte("WHERE created_at > NOW() - INTERVAL '90 DAYS' ORDER BY created_at DESC LIMIT 50");
    const res = await pool.query(query);
    return res.rows.map((r: any) => this.mapRowToPrediction(r));
  }

  async getHistory(limit = 50): Promise<Prediction[]> {
    const pool = this.ensurePool();
    const query = this.buildQueryWithCte('ORDER BY created_at DESC LIMIT $1');
    const res = await pool.query(query, [limit]);
    return res.rows.map((r: any) => this.mapRowToPrediction(r));
  }

  async getById(id: number | string): Promise<Prediction | null> {
    const pool = this.ensurePool();
    const query = this.buildQueryWithCte('WHERE run_id::text = $1 LIMIT 1');
    const res = await pool.query(query, [String(id)]);
    if (!res.rows.length) return null;
    return this.mapRowToPrediction(res.rows[0]);
  }

  async getByFixtureId(fixtureId: number | string): Promise<Prediction | null> {
    const pool = this.ensurePool();
    const query = this.buildQueryWithCte('WHERE match_id::text = $1 LIMIT 1');
    const res = await pool.query(query, [String(fixtureId)]);
    if (!res.rows.length) return null;
    return this.mapRowToPrediction(res.rows[0]);
  }

  // --- Strict Zero-Mutation Enforcement in Staging ---
  async create(_p: Prediction): Promise<number> {
    throw new Error('POSTGRES_MUTATION_PROHIBITED: Dual-write and mutation are NOT AUTHORIZED in Phase 8.');
  }

  async updateResult(_id: number, _status: string, _resultScore?: string): Promise<boolean> {
    throw new Error('POSTGRES_MUTATION_PROHIBITED: Dual-write and mutation are NOT AUTHORIZED in Phase 8.');
  }

  async updateResultByFixtureId(_fixtureId: number, _status: string, _resultScore?: string): Promise<boolean> {
    throw new Error('POSTGRES_MUTATION_PROHIBITED: Dual-write and mutation are NOT AUTHORIZED in Phase 8.');
  }

  async updateChannelMessageId(_id: number, _messageId: number): Promise<void> {
    throw new Error('POSTGRES_MUTATION_PROHIBITED: Dual-write and mutation are NOT AUTHORIZED in Phase 8.');
  }

  async delete(_id: number): Promise<boolean> {
    throw new Error('POSTGRES_MUTATION_PROHIBITED: Dual-write and mutation are NOT AUTHORIZED in Phase 8.');
  }
}
