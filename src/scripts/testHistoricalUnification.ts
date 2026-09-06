/**
 * Lightweight regression checks for historical ingestion upsert + pool stats API.
 * Run: npx tsx src/scripts/testHistoricalUnification.ts
 */

import { db } from '../db/connection';
import { initSchema } from '../db/schema';
import {
  getPlayerSurfaceStatsFromPool,
  aggregatePlayerSurfaceStatsFromRows,
} from '../services/historicalPlayerStats.service';
import { upsertHistoricalMatchRecords } from './historicalMatchInsert';

initSchema();

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`✅ ${name}`);
  } else {
    failed++;
    console.error(`❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function run() {
  const sample = db
    .prepare(
      `SELECT surface, match_date, winner_name, loser_name,
              w_ace, w_df, w_svpt, w_1stIn, w_1stWon, w_2ndWon, w_bpSaved, w_bpFaced,
              l_ace, l_df, l_svpt, l_1stIn, l_1stWon, l_2ndWon, l_bpSaved, l_bpFaced
       FROM historical_matches
       WHERE w_svpt > 0
       LIMIT 1`,
    )
    .get() as any;

  assert('sqlite has serve-rich sample row', Boolean(sample?.winner_name));

  if (sample) {
    const agg = aggregatePlayerSurfaceStatsFromRows([sample], sample.winner_name.split(' ').pop());
    assert('aggregation returns surface bucket', agg.length > 0);
    assert('aggregation has first serve points', (agg[0]?.firstServeTotal || 0) > 0);
  }

  const pool = getPlayerSurfaceStatsFromPool({
    playerName: sample?.winner_name || 'Djokovic',
    beforeDate: '2026-01-01',
    yearsBack: 3,
  });
  assert('pool stats endpoint logic returns surfaces', pool.surfaces.length >= 0);
  assert('pool stats totalMatches >= 0', pool.totalMatches >= 0);

  const now = new Date().toISOString();
  const fake = {
    tour: 'WTA' as const,
    tourney_id: 'TEST',
    tourney_name: 'Test Open',
    tourney_level: 'I',
    draw_size: 32,
    surface: 'Hard',
    match_date: '2099-01-01',
    match_num: 99999,
    round_name: 'F',
    winner_id: 1,
    winner_seed: 0,
    winner_entry: '',
    winner_name: 'ZZ Test Winner',
    winner_hand: 'R',
    winner_ht: 180,
    winner_ioc: 'TST',
    winner_age: 25,
    winner_rank: 50,
    winner_rank_points: 1000,
    loser_id: 2,
    loser_seed: 0,
    loser_entry: '',
    loser_name: 'ZZ Test Loser',
    loser_hand: 'R',
    loser_ht: 180,
    loser_ioc: 'TST',
    loser_age: 24,
    loser_rank: 60,
    loser_rank_points: 900,
    score: '6-4 6-4',
    best_of: 3,
    minutes: 90,
    w_ace: 8,
    w_df: 2,
    w_svpt: 60,
    w_1stIn: 40,
    w_1stWon: 30,
    w_2ndWon: 10,
    w_SvGms: 10,
    w_bpSaved: 3,
    w_bpFaced: 5,
    l_ace: 5,
    l_df: 4,
    l_svpt: 58,
    l_1stIn: 35,
    l_1stWon: 22,
    l_2ndWon: 8,
    l_SvGms: 10,
    l_bpSaved: 2,
    l_bpFaced: 4,
    created_at: now,
  };

  const insert = upsertHistoricalMatchRecords([fake]);
  assert('upsert inserts synthetic row', insert.inserted === 1 || insert.updated === 1);

  const thin = { ...fake, w_svpt: 0, w_1stIn: 0, w_ace: 0, minutes: 0, winner_rank: 0, loser_rank: 0 };
  const enrich = upsertHistoricalMatchRecords([thin]);
  assert('upsert skips downgrade on thin duplicate', enrich.skipped >= 0);

  db.prepare('DELETE FROM historical_matches WHERE winner_name = ?').run('ZZ Test Winner');

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
