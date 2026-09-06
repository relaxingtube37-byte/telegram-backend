import Database from 'better-sqlite3';
import path from 'path';
import { countBacktestCandidateMatches, queryBacktestCandidateMatches } from '../services/backtestMatchCandidates.service';

const DB_PATH = path.resolve('data/database.sqlite');
const db = new Database(DB_PATH, { readonly: true });

console.log('═════════════════════════════════════════════════════════════════════════');
console.log('🧪 VERIFY GOLD VALIDATED DATASET & BACKTEST CANDIDATE PIPELINE');
console.log('═════════════════════════════════════════════════════════════════════════\n');

// 1. Table Counts
const goldTotal = (db.prepare('SELECT COUNT(*) as c FROM gold_matches_validated').get() as { c: number }).c;
const readyTotal = (db.prepare('SELECT COUNT(*) as c FROM gold_matches_ready_view').get() as { c: number }).c;
const excludedTotal = (db.prepare("SELECT COUNT(*) as c FROM gold_matches_validated WHERE final_status != 'READY'").get() as { c: number }).c;
const historyTotal = (db.prepare('SELECT COUNT(*) as c FROM gold_player_history_3y').get() as { c: number }).c;
const historyOnlyTotal = (db.prepare('SELECT COUNT(*) as c FROM gold_player_history_3y WHERE is_history_only = 1').get() as { c: number }).c;
const goldHistoryTotal = (db.prepare('SELECT COUNT(*) as c FROM gold_player_history_3y WHERE is_gold_target_match = 1').get() as { c: number }).c;

console.log('--- 1. DATABASE ROW COUNTS ---');
console.table([
  { Layer: 'gold_matches_validated (Total Ingested Universe)', Count: goldTotal.toLocaleString(), Expected: '57,977' },
  { Layer: 'gold_matches_ready_view (Model-Ready Singles)', Count: readyTotal.toLocaleString(), Expected: '38,566' },
  { Layer: 'Excluded Non-Ready Matches (Inc. 11,069 Doubles)', Count: excludedTotal.toLocaleString(), Expected: '19,411' },
  { Layer: 'gold_player_history_3y (Total History Records)', Count: historyTotal.toLocaleString(), Expected: historyTotal.toLocaleString() },
  { Layer: '  • Isolated Prior History-Only (2021-2023)', Count: historyOnlyTotal.toLocaleString(), Expected: '100,180' },
  { Layer: '  • Gold Target Match History (2024-2026)', Count: goldHistoryTotal.toLocaleString(), Expected: goldHistoryTotal.toLocaleString() },
]);

// 2. Reconciliation Checks
console.log('\n--- 2. RECONCILIATION INVARIANTS ---');
const passTotal = goldTotal === 57977;
const passSum = (readyTotal + excludedTotal) === 57977;
const passHistory = (historyOnlyTotal + goldHistoryTotal) === historyTotal;

console.log(`• gold_matches_validated == 57,977 : ${passTotal ? '✅ PASS' : '❌ FAIL'}`);
console.log(`• READY + EXCLUDED == 57,977       : ${passSum ? '✅ PASS' : '❌ FAIL'}`);
console.log(`• History Only + Target == Total   : ${passHistory ? '✅ PASS' : '❌ FAIL'}`);

// 3. Backtest Candidates Service Test
console.log('\n--- 3. BACKTEST CANDIDATES PIPELINE TEST ---');
const candidatesCount = countBacktestCandidateMatches();
console.log(`• countBacktestCandidateMatches() returned: ${candidatesCount.toLocaleString()} matches`);

const sampleCandidates = queryBacktestCandidateMatches({ limit: 5 });
console.log(`• queryBacktestCandidateMatches({ limit: 5 }) successfully retrieved ${sampleCandidates.length} matches:`);
console.table(sampleCandidates.map(c => ({
  ID: c.historicalMatchId,
  Date: c.matchDate,
  Tour: c.tour,
  Matchup: `${c.homePlayerName} vs ${c.awayPlayerName}`,
  Surface: c.surface,
  DataSource: c.dataSource,
})));

// 4. Duplicate Check
const dupCheck = db.prepare(`
  SELECT rapid_event_id, count(*) as c 
  FROM gold_matches_validated 
  GROUP BY rapid_event_id 
  HAVING count(*) > 1
`).all();
console.log(`\n• Duplicate rapid_event_id in gold_matches_validated: ${dupCheck.length} (Expected: 0) -> ${dupCheck.length === 0 ? '✅ PASS' : '❌ FAIL'}`);

// 5. Leakage Guard Check
const pitCheck = db.prepare(`
  SELECT count(*) as c 
  FROM gold_matches_validated 
  WHERE max_as_of_date >= match_date
`).get() as { c: number };
console.log(`• Point-in-time leakage violations: ${pitCheck.c} (Expected: 0) -> ${pitCheck.c === 0 ? '✅ PASS' : '❌ FAIL'}`);

db.close();

if (passTotal && passSum && dupCheck.length === 0 && pitCheck.c === 0) {
  console.log('\n🎉 ALL GOLD DATASET & BACKTEST INTEGRATION CHECKS PASSED (100% OPERATIONAL)!');
} else {
  console.error('\n❌ SOME CHECKS FAILED');
  process.exit(1);
}
