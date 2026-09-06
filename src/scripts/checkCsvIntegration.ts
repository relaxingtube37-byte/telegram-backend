import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'database.sqlite');
const db = new Database(DB_PATH, { readonly: true });

console.log('--- RELATIONSHIP: 2021-2026-DATA CSVs VS 57,977 GOLD DATASET ---');

// 1. Check source presence in gold_matches_validated
const sourcePresence = db.prepare(`
  SELECT source_presence, count(*) as cnt,
         SUM(CASE WHEN has_odds = 1 THEN 1 ELSE 0 END) as with_odds,
         SUM(CASE WHEN final_status = 'READY' THEN 1 ELSE 0 END) as ready_count
  FROM gold_matches_validated
  GROUP BY source_presence
`).all();
console.log('Source presence in gold_matches_validated:');
console.table(sourcePresence);

// 2. Check total matches in historical_matches (loaded from 2021-2026-data)
const histStats = db.prepare(`
  SELECT 
    COUNT(*) as total_historical,
    SUM(CASE WHEN match_date >= '2024-01-01' THEN 1 ELSE 0 END) as total_2024_plus,
    SUM(CASE WHEN match_date < '2024-01-01' THEN 1 ELSE 0 END) as pre_2024
  FROM historical_matches
`).get();
console.log('\nhistorical_matches table (from 2021-2026-data):', histStats);

// 3. Check the 644 READY matches without odds: are they SOURCE_B_ONLY?
const noOddsPresence = db.prepare(`
  SELECT source_presence, count(*) as cnt
  FROM gold_matches_ready_view
  WHERE has_odds = 0
  GROUP BY source_presence
`).all();
console.log('\nReady matches without odds by source presence:');
console.table(noOddsPresence);

db.close();
