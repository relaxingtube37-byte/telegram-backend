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

export { ShadowComparingPredictionsRepo } from './shadow/predictions.shadow';
export { ShadowComparingEditorialsRepo } from './shadow/editorials.shadow';
export { ShadowComparingPlayersRepo } from './shadow/players.shadow';
export { ShadowComparingMatchesRepo } from './shadow/matches.shadow';

import { ShadowComparingPredictionsRepo } from './shadow/predictions.shadow';
import { ShadowComparingEditorialsRepo } from './shadow/editorials.shadow';
import { ShadowComparingPlayersRepo } from './shadow/players.shadow';
import { ShadowComparingMatchesRepo } from './shadow/matches.shadow';

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
    const isStagingShadow = process.env.ENABLE_STAGING_PG_SHADOW === 'true' && process.env.NODE_ENV !== 'production';
    if (isStagingShadow) {
      return new ShadowComparingEditorialsRepo(this.sqliteEditorials, this.pgEditorials);
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
    const isStagingShadow = process.env.ENABLE_STAGING_PG_SHADOW === 'true' && process.env.NODE_ENV !== 'production';
    if (isStagingShadow) {
      return new ShadowComparingPlayersRepo(this.sqlitePlayers, this.pgPlayers);
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
    const isStagingShadow = process.env.ENABLE_STAGING_PG_SHADOW === 'true' && process.env.NODE_ENV !== 'production';
    if (isStagingShadow) {
      return new ShadowComparingMatchesRepo(this.sqliteMatches, this.pgMatches);
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
