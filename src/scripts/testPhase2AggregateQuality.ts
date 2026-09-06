/**
 * Phase 2 — Unknown surface excluded from L2 aggregate buckets.
 * Run: npx tsx src/scripts/testPhase2AggregateQuality.ts
 */
import { aggregatePlayerSurfaceStatsFromRows } from '../services/historicalPlayerStats.service';

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean) {
  if (condition) {
    passed++;
    console.log(`✅ ${name}`);
  } else {
    failed++;
    console.error(`❌ ${name}`);
  }
}

const baseRow = {
  match_date: '2025-06-01',
  winner_name: 'Novak Djokovic',
  loser_name: 'Test Opponent',
  w_ace: 5,
  w_df: 2,
  w_svpt: 50,
  w_1stIn: 30,
  w_1stWon: 22,
  w_2ndWon: 8,
  w_bpSaved: 2,
  w_bpFaced: 4,
  l_ace: 3,
  l_df: 3,
  l_svpt: 48,
  l_1stIn: 28,
  l_1stWon: 18,
  l_2ndWon: 7,
  l_bpSaved: 1,
  l_bpFaced: 3,
  is_raw_serve_feature_usable: 1,
};

const unknownRow = { ...baseRow, surface: 'Unknown', surface_raw: 'unknown' };
const hardRow = { ...baseRow, surface: 'Hard', surface_raw: 'Hard' };

const aggUnknownOnly = aggregatePlayerSurfaceStatsFromRows([unknownRow], 'Djokovic');
assert('Unknown-only rows produce no surface buckets', aggUnknownOnly.length === 0);

const aggMixed = aggregatePlayerSurfaceStatsFromRows([unknownRow, hardRow], 'Djokovic');
assert('Mixed rows produce one Hard bucket', aggMixed.length === 1);
assert('Hard bucket surface label', aggMixed[0]?.surface === 'Hard');
assert('Only Hard row counted', aggMixed[0]?.matches === 1);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
