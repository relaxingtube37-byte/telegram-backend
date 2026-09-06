import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.resolve('data/database.sqlite');
const db = new Database(DB_PATH, { readonly: true });

console.log('--- CHECKING PLAYER HISTORY LAYERS FOR BACKTEST ---');

// 1. Check player_matches_validated
try {
  const pmiCount = db.prepare('SELECT count(*) as c FROM player_match_index').get() as { c: number };
  const pmvCount = db.prepare('SELECT count(*) as c FROM player_matches_validated').get() as { c: number };
  console.log('player_match_index count:', pmiCount.c);
  console.log('player_matches_validated view count:', pmvCount.c);

  const samplePmv = db.prepare('SELECT * FROM player_matches_validated LIMIT 1').get();
  console.log('Sample player_matches_validated keys:', Object.keys(samplePmv as any));
} catch (e: any) {
  console.log('player_matches_validated error:', e.message);
}

// 2. Check gold_player_history_3y
try {
  const g3yCount = db.prepare('SELECT count(*) as c FROM gold_player_history_3y').get() as { c: number };
  const g3yHistOnly = db.prepare('SELECT count(*) as c FROM gold_player_history_3y WHERE is_history_only = 1').get() as { c: number };
  const g3yTarget = db.prepare('SELECT count(*) as c FROM gold_player_history_3y WHERE is_gold_target_match = 1').get() as { c: number };
  console.log('\ngold_player_history_3y count:', g3yCount.c);
  console.log('  • Prior History (2021-2023):', g3yHistOnly.c);
  console.log('  • Gold Target Matches (2024-2026):', g3yTarget.c);
} catch (e: any) {
  console.log('gold_player_history_3y error:', e.message);
}

// 3. Check backtest candidate matches query
try {
  const gmReadyCount = db.prepare('SELECT count(*) as c FROM gold_matches_ready_view').get() as { c: number };
  console.log('\ngold_matches_ready_view (Backtest Candidates):', gmReadyCount.c);
} catch (e: any) {
  console.log('gold_matches_ready_view error:', e.message);
}

db.close();
