import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.resolve('data/database.sqlite');
const db = new Database(DB_PATH, { readonly: true });

console.log('--- AUDIT: MATCHES THAT HAVE EVERYTHING EXCEPT POINT-BY-POINT ---');

// 1. Matches with final_status = 'MISSING_PBP'
const statusRow = db.prepare("SELECT count(*) as c FROM gold_matches_validated WHERE final_status = 'MISSING_PBP'").get() as { c: number };

const anyFinishedSinglesMissingPbp = db.prepare(`
  SELECT count(*) as c 
  FROM gold_matches_validated 
  WHERE is_non_singles = 0 
    AND is_retirement_or_wo = 0 
    AND has_stats_bundle = 1 
    AND has_pbp_bundle = 0
`).get() as { c: number };
console.log('Total finished singles with stats but no PBP (any status):', anyFinishedSinglesMissingPbp.c);

// 2. Breakdown of these MISSING_PBP matches
const detailedMissing = db.prepare(`
  SELECT 
    COUNT(*) as total_missing_pbp,
    SUM(CASE WHEN has_odds = 1 THEN 1 ELSE 0 END) as with_odds,
    SUM(CASE WHEN has_odds = 0 THEN 1 ELSE 0 END) as without_odds,
    SUM(CASE WHEN has_p1_history = 1 AND has_p2_history = 1 THEN 1 ELSE 0 END) as with_full_history,
    SUM(CASE WHEN w_svpt > 0 AND l_svpt > 0 THEN 1 ELSE 0 END) as with_full_serve_stats
  FROM gold_matches_validated
  WHERE final_status = 'MISSING_PBP'
`).get() as any;

console.log('Direct status MISSING_PBP:', statusRow.c);
console.log('Detailed metrics for these matches:');
console.table(detailedMissing);

// 3. Distribution across years
const yearDist = db.prepare(`
  SELECT 
    substr(match_date, 1, 4) as yr,
    tour,
    COUNT(*) as count,
    SUM(CASE WHEN has_odds = 1 THEN 1 ELSE 0 END) as with_odds
  FROM gold_matches_validated
  WHERE final_status = 'MISSING_PBP'
  GROUP BY yr, tour
  ORDER BY yr, tour
`).all();
console.log('\nDistribution by Year and Tour:');
console.table(yearDist);

// 4. Sample matches
const samples = db.prepare(`
  SELECT rapid_event_id, match_date, tour, tourney_name, winner_name, loser_name, score, has_odds
  FROM gold_matches_validated
  WHERE final_status = 'MISSING_PBP'
  LIMIT 5
`).all();
console.log('\nSample matches:');
console.table(samples);

db.close();
