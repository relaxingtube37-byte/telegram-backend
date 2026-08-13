"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const dbPath = process.env.DB_PATH || './data/telegram.db';
const dir = path_1.default.dirname(dbPath);
if (!fs_1.default.existsSync(dir)) {
    fs_1.default.mkdirSync(dir, { recursive: true });
}
exports.db = new better_sqlite3_1.default(dbPath);
// Enable WAL mode for high performance concurrency
exports.db.pragma('journal_mode = WAL');
// Initialize database schema
exports.db.exec(`
  CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fixture_id INTEGER,
    match_title TEXT NOT NULL,
    tournament_name TEXT,
    surface TEXT,
    round_name TEXT,
    home_name TEXT NOT NULL,
    away_name TEXT NOT NULL,
    home_odds TEXT,
    away_odds TEXT,
    predicted_winner TEXT NOT NULL,
    predicted_score TEXT,
    win_probability INTEGER,
    confidence TEXT,
    key_factors TEXT,          -- JSON array of strings
    best_bet_market TEXT,
    best_bet_selection TEXT,
    best_bet_rationale TEXT,
    best_bet_ev TEXT,
    alt_bet_market TEXT,
    alt_bet_selection TEXT,
    alt_bet_rationale TEXT,
    alt_bet_risk TEXT,
    ai_summary TEXT,
    status TEXT DEFAULT 'UPCOMING', -- UPCOMING, LIVE, WON, LOST, VOID
    result_score TEXT,
    published_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS referral_sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    postback_key TEXT UNIQUE NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    subid TEXT UNIQUE,
    is_verified INTEGER DEFAULT 0,
    registered_site_id INTEGER,
    created_at TEXT NOT NULL,
    verified_at TEXT
  );

  CREATE TABLE IF NOT EXISTS channel_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prediction_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    channel_id TEXT NOT NULL,
    posted_at TEXT NOT NULL,
    FOREIGN KEY(prediction_id) REFERENCES predictions(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);
console.log('✅ SQLite Database initialized at:', dbPath);
