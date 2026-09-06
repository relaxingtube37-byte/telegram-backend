import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'database.sqlite');
const db = new Database(DB_PATH, { readonly: true });

console.log('--- GAP ANALYSIS: 57,977 GOLD DATASET ---');

// 1. Inspect top scores for RETIREMENT_OR_WALKOVER
const retScores = db.prepare(`
  SELECT score, count(*) as cnt 
  FROM gold_matches_validated 
  WHERE final_status = 'RETIREMENT_OR_WALKOVER' 
  GROUP BY score 
  ORDER BY cnt DESC 
  LIMIT 15
`).all();
console.log('Top scores in RETIREMENT_OR_WALKOVER:');
console.table(retScores);

// 2. What about matches with odds vs matches without odds?
const oddsStats = db.prepare(`
  SELECT 
    COUNT(*) as total_ready,
    SUM(CASE WHEN has_odds = 1 THEN 1 ELSE 0 END) as with_odds,
    SUM(CASE WHEN has_odds = 0 THEN 1 ELSE 0 END) as without_odds
  FROM gold_matches_ready_view
`).get() as { total_ready: number; with_odds: number; without_odds: number };
console.log('\nReady matches odds coverage:', oddsStats);

// 3. What about serve statistics completeness in READY?
const serveStats = db.prepare(`
  SELECT 
    COUNT(*) as total_ready,
    SUM(CASE WHEN w_svpt > 0 AND l_svpt > 0 THEN 1 ELSE 0 END) as full_serve_stats,
    SUM(CASE WHEN w_svpt IS NULL OR w_svpt = 0 THEN 1 ELSE 0 END) as missing_serve_stats
  FROM gold_matches_ready_view
`).get() as { total_ready: number; full_serve_stats: number; missing_serve_stats: number };
console.log('\nReady matches serve stats coverage:', serveStats);

// 4. Distribution across years
const yearDist = db.prepare(`
  SELECT 
    substr(match_date, 1, 4) as yr,
    COUNT(*) as total_ingested,
    SUM(CASE WHEN final_status = 'READY' THEN 1 ELSE 0 END) as ready_count,
    SUM(CASE WHEN final_status = 'READY' AND has_odds = 1 THEN 1 ELSE 0 END) as ready_with_odds
  FROM gold_matches_validated
  GROUP BY yr
  ORDER BY yr ASC
`).all();
console.log('\nYear distribution:');
console.table(yearDist);

// 5. Distribution across tours
const tourDist = db.prepare(`
  SELECT 
    tour,
    COUNT(*) as total_ingested,
    SUM(CASE WHEN final_status = 'READY' THEN 1 ELSE 0 END) as ready_count,
    SUM(CASE WHEN final_status = 'READY' AND has_odds = 1 THEN 1 ELSE 0 END) as ready_with_odds
  FROM gold_matches_validated
  GROUP BY tour
`).all();
console.log('\nTour distribution:');
console.table(tourDist);

// 6. Surface breakdown in READY
const surfDist = db.prepare(`
  SELECT 
    surface,
    COUNT(*) as ready_count,
    SUM(CASE WHEN has_odds = 1 THEN 1 ELSE 0 END) as ready_with_odds
  FROM gold_matches_ready_view
  GROUP BY surface
`).all();
console.log('\nSurface breakdown in READY:');
console.table(surfDist);

// 7. Inspect sample retirement row with '6-3 6-2'
const sampleRet = db.prepare(`
  SELECT rapid_event_id, canonical_match_id, match_date, tourney_name, score, winner_name, loser_name, is_retirement_or_wo, final_status, exclusion_reason
  FROM gold_matches_validated
  WHERE score = '6-3 6-2' AND final_status = 'RETIREMENT_OR_WALKOVER'
  LIMIT 2
`).all();
console.log('\nSample 6-3 6-2 retirement row in gold_matches_validated:');
console.log(sampleRet);

const sampleCm = db.prepare(`
  SELECT canonical_match_id, score, is_retirement_or_wo, source_presence, canonical_status_reason
  FROM canonical_matches
  WHERE canonical_match_id = ?
`).get((sampleRet[0] as any)?.canonical_match_id);
console.log('Corresponding canonical_matches row:', sampleCm);

db.close();
