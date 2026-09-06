import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'database.sqlite');
const db = new Database(DB_PATH, { readonly: true });

console.log('--- DATABASE INSPECTION ---');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;").all() as any[];
console.log('Tables found:', tables.map(t => t.name).join(', '));

for (const t of tables) {
  try {
    const row = db.prepare("SELECT COUNT(*) as c FROM " + t.name).get() as any;
    console.log(`  Table: ${t.name} -> ${row.c} rows`);
  } catch (e: any) {
    console.log(`  Table: ${t.name} -> error: ${e.message}`);
  }
}

// Inspect canonical_matches schema
console.log('\n--- CANONICAL_MATCHES PRAGMA TABLE_INFO ---');
const cols = db.prepare("PRAGMA table_info(canonical_matches);").all() as any[];
console.table(cols.map(c => ({ cid: c.cid, name: c.name, type: c.type, notnull: c.notnull, pk: c.pk })));

// Inspect player_matches_validated / historical_matches / player_match_index schema if they exist
for (const checkTable of ['historical_matches', 'player_matches_validated', 'player_match_index']) {
  if (tables.some(t => t.name === checkTable)) {
    console.log(`\n--- ${checkTable.toUpperCase()} PRAGMA TABLE_INFO ---`);
    const tCols = db.prepare(`PRAGMA table_info(${checkTable});`).all() as any[];
    console.table(tCols.slice(0, 15).map(c => ({ cid: c.cid, name: c.name, type: c.type })));
  }
}

db.close();
