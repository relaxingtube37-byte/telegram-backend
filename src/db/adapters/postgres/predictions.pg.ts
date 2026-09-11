import type { IPredictionsRepo } from '../../interfaces/predictions.interface';
import type { Prediction } from '../../../types';

export interface PostgresClientPool {
  query(sql: string, params?: any[]): Promise<{ rows: any[] }>;
}

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
      throw new Error('PostgreSQL staging pool is not connected or initialized.');
    }
    return this.pool;
  }

  async getAll(limit = 100): Promise<Prediction[]> {
    const pool = this.ensurePool();
    const res = await pool.query(
      'SELECT run_id, match_id, model_name, winner_prediction, win_probability, confidence_tier, created_at FROM ai.predictionruns ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return res.rows.map((r: any) => ({
      id: r.run_id,
      fixture_id: r.match_id,
      home_name: 'Player 1',
      away_name: 'Player 2',
      predicted_winner: r.winner_prediction,
      win_probability: Number(r.win_probability) || 0,
      confidence: r.confidence_tier || 'MEDIUM',
      status: 'UPCOMING' as any,
      created_at: r.created_at
    }));
  }

  async getActive(): Promise<Prediction[]> {
    const pool = this.ensurePool();
    const res = await pool.query(
      "SELECT run_id, match_id, winner_prediction, win_probability, confidence_tier, created_at FROM ai.predictionruns WHERE created_at > NOW() - INTERVAL '48 HOURS' ORDER BY created_at DESC"
    );
    return res.rows.map((r: any) => ({
      id: r.run_id,
      fixture_id: r.match_id,
      home_name: 'Player 1',
      away_name: 'Player 2',
      predicted_winner: r.winner_prediction,
      win_probability: Number(r.win_probability) || 0,
      confidence: r.confidence_tier || 'MEDIUM',
      status: 'UPCOMING' as any,
      created_at: r.created_at
    }));
  }

  async getHistory(limit = 50): Promise<Prediction[]> {
    const pool = this.ensurePool();
    const res = await pool.query(
      'SELECT run_id, match_id, winner_prediction, win_probability, confidence_tier, created_at FROM ai.predictionruns ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return res.rows.map((r: any) => ({
      id: r.run_id,
      fixture_id: r.match_id,
      home_name: 'Player 1',
      away_name: 'Player 2',
      predicted_winner: r.winner_prediction,
      win_probability: Number(r.win_probability) || 0,
      confidence: r.confidence_tier || 'MEDIUM',
      status: 'WON' as any,
      created_at: r.created_at
    }));
  }

  async getById(id: number | string): Promise<Prediction | null> {
    const pool = this.ensurePool();
    const res = await pool.query(
      'SELECT run_id, match_id, winner_prediction, win_probability, confidence_tier, created_at FROM ai.predictionruns WHERE run_id = $1',
      [String(id)]
    );
    if (!res.rows.length) return null;
    const r = res.rows[0];
    return {
      id: r.run_id,
      fixture_id: r.match_id,
      home_name: 'Player 1',
      away_name: 'Player 2',
      predicted_winner: r.winner_prediction,
      win_probability: Number(r.win_probability) || 0,
      confidence: r.confidence_tier || 'MEDIUM',
      status: 'UPCOMING' as any,
      created_at: r.created_at
    };
  }

  async getByFixtureId(fixtureId: number): Promise<Prediction | null> {
    const pool = this.ensurePool();
    const res = await pool.query(
      'SELECT run_id, match_id, winner_prediction, win_probability, confidence_tier, created_at FROM ai.predictionruns WHERE match_id = $1 LIMIT 1',
      [String(fixtureId)]
    );
    if (!res.rows.length) return null;
    const r = res.rows[0];
    return {
      id: r.run_id,
      fixture_id: r.match_id,
      home_name: 'Player 1',
      away_name: 'Player 2',
      predicted_winner: r.winner_prediction,
      win_probability: Number(r.win_probability) || 0,
      confidence: r.confidence_tier || 'MEDIUM',
      status: 'UPCOMING' as any,
      created_at: r.created_at
    };
  }

  async create(_p: Prediction): Promise<number> {
    throw new Error('POSTGRES_MUTATION_PROHIBITED: Dual-write is NOT AUTHORIZED in Phase 8 Entry Gate.');
  }

  async updateResult(_id: number, _status: string, _resultScore?: string): Promise<boolean> {
    throw new Error('POSTGRES_MUTATION_PROHIBITED: Dual-write is NOT AUTHORIZED in Phase 8 Entry Gate.');
  }

  async updateResultByFixtureId(_fixtureId: number, _status: string, _resultScore?: string): Promise<boolean> {
    throw new Error('POSTGRES_MUTATION_PROHIBITED: Dual-write is NOT AUTHORIZED in Phase 8 Entry Gate.');
  }

  async updateChannelMessageId(_id: number, _channelMsgId: number): Promise<void> {
    throw new Error('POSTGRES_MUTATION_PROHIBITED: Dual-write is NOT AUTHORIZED in Phase 8 Entry Gate.');
  }

  async delete(_id: number): Promise<boolean> {
    throw new Error('POSTGRES_MUTATION_PROHIBITED: Dual-write is NOT AUTHORIZED in Phase 8 Entry Gate.');
  }
}
