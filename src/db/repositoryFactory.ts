import type { IPredictionsRepo } from './interfaces/predictions.interface';
import type { IEditorialsRepo } from './interfaces/editorials.interface';
import type { IPlayersRepo } from './interfaces/players.interface';
import type { IMatchesRepo } from './interfaces/matches.interface';
import type { Prediction } from '../types';
import { SqlitePredictionsAdapter } from './adapters/sqlite/predictions.sqlite';
import { SqliteEditorialsAdapter } from './adapters/sqlite/editorials.sqlite';
import { SqlitePlayersAdapter } from './adapters/sqlite/players.sqlite';
import { SqliteMatchesAdapter } from './adapters/sqlite/matches.sqlite';
import { PostgresPredictionsAdapter } from './adapters/postgres/predictions.pg';
import { PostgresEditorialsAdapter } from './adapters/postgres/editorials.pg';
import { PostgresPlayersAdapter } from './adapters/postgres/players.pg';
import { PostgresMatchesAdapter } from './adapters/postgres/matches.pg';
import { Logger } from '../utils/logger';

/**
 * Non-blocking Staging Shadow Comparing Wrapper for IPredictionsRepo.
 * Primary: SQLite (returned synchronously/immediately).
 * Shadow: PostgreSQL staging cluster (asynchronous, non-blocking, zero-error propagation).
 */
export class ShadowComparingPredictionsRepo implements IPredictionsRepo {
  private primary: IPredictionsRepo;
  private shadow: PostgresPredictionsAdapter;

  constructor(primary: IPredictionsRepo, shadow: PostgresPredictionsAdapter) {
    this.primary = primary;
    this.shadow = shadow;
  }

  private runShadow(actionName: string, shadowFn: () => Promise<any>, primaryResult: any) {
    // Non-blocking fire-and-forget in staging
    setImmediate(async () => {
      try {
        const shadowResult = await shadowFn();
        const primaryCount = Array.isArray(primaryResult) ? primaryResult.length : (primaryResult ? 1 : 0);
        const shadowCount = Array.isArray(shadowResult) ? shadowResult.length : (shadowResult ? 1 : 0);
        if (primaryCount !== shadowCount) {
          Logger.warn(`[Phase 8 Shadow Divergence] ${actionName}: SQLite returned ${primaryCount} rows, Postgres returned ${shadowCount} rows.`);
        }
      } catch (err: any) {
        // Strict circuit breaker: errors in shadow read must never bubble up
        Logger.debug(`[Phase 8 Shadow Comparator] Suppressed shadow read error in ${actionName}: ${err.message}`);
      }
    });
  }

  async getAll(limit = 100): Promise<Prediction[]> {
    const result = await this.primary.getAll(limit);
    this.runShadow('getAll', () => this.shadow.getAll(limit), result);
    return result;
  }

  async getActive(): Promise<Prediction[]> {
    const result = await this.primary.getActive();
    this.runShadow('getActive', () => this.shadow.getActive(), result);
    return result;
  }

  async getHistory(limit = 50): Promise<Prediction[]> {
    const result = await this.primary.getHistory(limit);
    this.runShadow('getHistory', () => this.shadow.getHistory(limit), result);
    return result;
  }

  async getById(id: number | string): Promise<Prediction | null> {
    const result = await this.primary.getById(id as number);
    this.runShadow('getById', () => this.shadow.getById(id), result);
    return result;
  }

  async getByFixtureId(fixtureId: number): Promise<Prediction | null> {
    const result = await this.primary.getByFixtureId(fixtureId);
    this.runShadow('getByFixtureId', () => this.shadow.getByFixtureId(fixtureId), result);
    return result;
  }

  async create(p: Prediction): Promise<number> {
    return this.primary.create(p);
  }

  async updateResult(id: number, status: string, resultScore?: string): Promise<boolean> {
    return this.primary.updateResult(id, status, resultScore);
  }

  async updateResultByFixtureId(fixtureId: number, status: string, resultScore?: string): Promise<boolean> {
    return this.primary.updateResultByFixtureId(fixtureId, status, resultScore);
  }

  async updateChannelMessageId(id: number, messageId: number): Promise<void> {
    return this.primary.updateChannelMessageId(id, messageId);
  }

  async delete(id: number): Promise<boolean> {
    return this.primary.delete(id);
  }
}

/**
 * Authoritative Repository Factory
 * Invariant: Production reads are strictly hardcoded to SQLite.
 */
export class RepositoryFactory {
  private static sqlitePredictions = new SqlitePredictionsAdapter();
  private static sqliteEditorials = new SqliteEditorialsAdapter();
  private static sqlitePlayers = new SqlitePlayersAdapter();
  private static sqliteMatches = new SqliteMatchesAdapter();

  private static pgPredictions = new PostgresPredictionsAdapter();
  private static pgEditorials = new PostgresEditorialsAdapter();
  private static pgPlayers = new PostgresPlayersAdapter();
  private static pgMatches = new PostgresMatchesAdapter();

  /**
   * Returns active IPredictionsRepo implementation.
   * Default: SQLite.
   * Staging Feature Flag: ENABLE_STAGING_PG_ADAPTER / ENABLE_STAGING_PG_SHADOW (non-production only).
   */
  static getPredictionsRepo(): IPredictionsRepo {
    const isStagingPg = process.env.ENABLE_STAGING_PG_ADAPTER === 'true' && process.env.NODE_ENV !== 'production';
    if (isStagingPg) {
      return this.pgPredictions;
    }
    const isStagingShadow = process.env.ENABLE_STAGING_PG_SHADOW === 'true' && process.env.NODE_ENV !== 'production';
    if (isStagingShadow) {
      return new ShadowComparingPredictionsRepo(this.sqlitePredictions, this.pgPredictions);
    }
    return this.sqlitePredictions;
  }

  /**
   * Returns active IEditorialsRepo implementation.
   */
  static getEditorialsRepo(): IEditorialsRepo {
    const isStagingPg = process.env.ENABLE_STAGING_PG_ADAPTER === 'true' && process.env.NODE_ENV !== 'production';
    if (isStagingPg) {
      return this.pgEditorials;
    }
    return this.sqliteEditorials;
  }

  /**
   * Returns active IPlayersRepo implementation.
   */
  static getPlayersRepo(): IPlayersRepo {
    const isStagingPg = process.env.ENABLE_STAGING_PG_ADAPTER === 'true' && process.env.NODE_ENV !== 'production';
    if (isStagingPg) {
      return this.pgPlayers;
    }
    return this.sqlitePlayers;
  }

  /**
   * Returns active IMatchesRepo implementation.
   */
  static getMatchesRepo(): IMatchesRepo {
    const isStagingPg = process.env.ENABLE_STAGING_PG_ADAPTER === 'true' && process.env.NODE_ENV !== 'production';
    if (isStagingPg) {
      return this.pgMatches;
    }
    return this.sqliteMatches;
  }

  /**
   * Returns configuration descriptor for audit.
   */
  static getConfiguration() {
    return {
      primaryEngine: 'SQLITE',
      productionReads: 'SQLITE_ONLY',
      stagingShadowEnabled: process.env.ENABLE_STAGING_PG_SHADOW === 'true' && process.env.NODE_ENV !== 'production',
      stagingPgAdapterEnabled: process.env.ENABLE_STAGING_PG_ADAPTER === 'true' && process.env.NODE_ENV !== 'production',
      dualWriteAuthorized: false,
      productionCutover: 'PROHIBITED'
    };
  }
}
