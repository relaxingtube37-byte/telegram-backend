import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { ENV } from '../config/env';
import { Logger } from '../utils/logger';

const dbDir = path.dirname(ENV.DATABASE_FILE);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db: Database.Database = new Database(ENV.DATABASE_FILE);

// Set PRAGMA for high performance and durability
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

Logger.success(`SQLite Database connected at: ${ENV.DATABASE_FILE}`);
