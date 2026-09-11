/**
 * src/db/stagingPgPool.ts
 *
 * PostgreSQL Connection Pool Configuration for Isolated Staging Cluster (Port 54350).
 *
 * Strict Architecture Invariants:
 *   1. Isolated Staging Cluster only (Default: 127.0.0.1:54350).
 *   2. Never connects to production database engines.
 *   3. Non-blocking with 3000ms connect timeout and 5000ms statement timeout.
 *   4. Safe resource disposal via pool.end().
 */

import { Pool, PoolConfig } from 'pg';
import { Logger } from '../utils/logger';

export interface PostgresClientPool {
  query(sql: string, params?: any[]): Promise<{ rows: any[] }>;
  end(): Promise<void>;
}

export class StagingPgPool implements PostgresClientPool {
  private pool: Pool | null = null;
  private config: PoolConfig;

  constructor(customConfig?: Partial<PoolConfig>) {
    this.config = {
      host: process.env.STAGING_PG_HOST || '127.0.0.1',
      port: Number(process.env.STAGING_PG_PORT) || 54350,
      user: process.env.STAGING_PG_USER || 'postgres',
      password: process.env.STAGING_PG_PASSWORD || '',
      database: process.env.STAGING_PG_DATABASE || 'postgres',
      max: 5,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      statement_timeout: 5000,
      ...customConfig
    };
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = new Pool(this.config);
      this.pool.on('error', (err) => {
        Logger.debug(`[StagingPgPool Error] Idle client error: ${err.message}`);
      });
    }
    return this.pool;
  }

  async query(sql: string, params?: any[]): Promise<{ rows: any[] }> {
    const pool = this.getPool();
    const result = await pool.query(sql, params);
    return { rows: result.rows };
  }

  async end(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  getConfig(): Readonly<PoolConfig> {
    return { ...this.config };
  }
}

// Global singleton instance for staging
let globalStagingPool: StagingPgPool | null = null;

export function getStagingPgPool(): StagingPgPool {
  if (!globalStagingPool) {
    globalStagingPool = new StagingPgPool();
  }
  return globalStagingPool;
}
