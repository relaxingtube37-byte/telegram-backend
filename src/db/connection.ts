import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { ENV } from '../config/env';
import { Logger } from '../utils/logger';

function resolveDatabaseFile(): string {
  const targetFile = ENV.DATABASE_FILE;
  const targetDir = path.dirname(targetFile);

  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    fs.accessSync(targetDir, fs.constants.W_OK);
    return targetFile;
  } catch (err: any) {
    const fallbackDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(fallbackDir)) {
      fs.mkdirSync(fallbackDir, { recursive: true });
    }
    const fallbackFile = path.join(fallbackDir, 'database.sqlite');
    Logger.warn(
      `⚠️ Cannot write to database directory "${targetDir}" (${err.message}). ` +
      `If using Render Persistent Disk, ensure the Disk is attached with Mount Path "${targetDir}". ` +
      `Falling back to local application directory: ${fallbackFile}`
    );
    ENV.DATABASE_FILE = fallbackFile;
    ENV.BACKUP_DIR = path.join(fallbackDir, 'backups');
    return fallbackFile;
  }
}

const activeDbFile = resolveDatabaseFile();
export const db: Database.Database = new Database(activeDbFile);

// Set PRAGMA for high performance and durability
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

Logger.success(`SQLite Database connected at: ${activeDbFile}`);

// Schema must exist before any module prepares SQL against historical_matches.
import { initSchema } from './schema';
import { runMigrations } from './migrations';
initSchema();
runMigrations();
