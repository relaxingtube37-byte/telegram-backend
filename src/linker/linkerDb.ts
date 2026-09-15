import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { configureLinkerConnection } from './schema';

let defaultLinkerDbInstance: Database.Database | null = null;

/**
 * Returns a dedicated connection to the linker SQLite database.
 * Defaults strictly to data/database.linker_dryrun.sqlite.
 * Enforces mandatory safety guards against live production and legacy copy DBs.
 */
export function getLinkerDryRunDb(customPath?: string): Database.Database {
  const targetPath = path.resolve(customPath || 'data/database.linker_dryrun.sqlite');
  const liveDbPath = path.resolve('data/database.sqlite');
  const legacyDryRunPath = path.resolve('data/database.dryrun.sqlite');

  // Hard guards: NEVER allow live production DB or legacy copy DB
  if (targetPath === liveDbPath) {
    throw new Error('SECURITY VIOLATION: Refusing to open live production database data/database.sqlite for linker operations');
  }
  if (targetPath === legacyDryRunPath) {
    throw new Error('SAFETY VIOLATION: Refusing to open legacy copy database data/database.dryrun.sqlite for linker operations');
  }

  if (customPath) {
    // If a custom test path is provided, create a separate isolated connection
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const db = new Database(targetPath);
    configureLinkerConnection(db);
    return db;
  }

  if (!defaultLinkerDbInstance || !defaultLinkerDbInstance.open) {
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    defaultLinkerDbInstance = new Database(targetPath);
    configureLinkerConnection(defaultLinkerDbInstance);
  }

  return defaultLinkerDbInstance;
}

/**
 * Closes default singleton connection (useful in test teardown).
 */
export function closeLinkerDryRunDb(): void {
  if (defaultLinkerDbInstance && defaultLinkerDbInstance.open) {
    defaultLinkerDbInstance.close();
    defaultLinkerDbInstance = null;
  }
}
