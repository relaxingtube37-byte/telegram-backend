/**
 * Extended read-only data logic audit (no fixes).
 * Run: npx tsx src/scripts/auditDataLogicExtended.ts [sinceDate]
 */
import { db } from '../db/connection';
import { initSchema } from '../db/schema';

initSchema();
const SINCE = process.argv[2] || '2024-01-01';
const PMI_HIST = `SELECT DISTINCT historical_match_id FROM player_match_index WHERE match_date >= '${SINCE}' AND historical_match_id IS NOT NULL`;

function run(label: string, sql: string) {
  console.log(`\n── ${label} ──`);
  try {
    const stmt = sql.trim().toUpperCase().startsWith('SELECT') && !sql.includes('LIMIT')
      ? db.prepare(sql)
      : db.prepare(sql);
    const rows = stmt.all();
    if (rows.length === 1 && Object.keys(rows[0] as object).length <= 6) {
      console.log(rows[0]);
    } else {
      console.log(JSON.stringify(rows.slice(0, 8), null, 2));
      if (rows.length > 8) console.log(`  ... +${rows.length - 8} more`);
    }
  } catch (e: unknown) {
    console.log('ERROR:', (e as Error).message);
  }
}

console.log(`EXTENDED DATA LOGIC AUDIT since ${SINCE}`);

run('Odds bounds', `
  SELECT
    SUM(CASE WHEN w_odds_match > 0 AND w_odds_match < 1.01 THEN 1 ELSE 0 END) as w_odds_too_low,
    SUM(CASE WHEN w_odds_match > 100 THEN 1 ELSE 0 END) as w_odds_too_high,
    SUM(CASE WHEN COALESCE(w_odds_match,0)=0 THEN 1 ELSE 0 END) as w_odds_missing,
    SUM(CASE WHEN l_odds_match > 0 AND l_odds_match < 1.01 THEN 1 ELSE 0 END) as l_odds_too_low,
    COUNT(*) as total
  FROM historical_matches h WHERE h.id IN (${PMI_HIST})
`);

run('Odds both sides valid (>1.01)', `
  SELECT
    SUM(CASE WHEN COALESCE(w_odds_match,0)>1.01 AND COALESCE(l_odds_match,0)>1.01 THEN 1 ELSE 0 END) as both_ok,
    COUNT(*) as total
  FROM historical_matches h WHERE h.id IN (${PMI_HIST})
`);

run('Rank missing both sides', `
  SELECT COUNT(*) c FROM historical_matches h
  WHERE h.id IN (${PMI_HIST}) AND COALESCE(winner_rank,0)=0 AND COALESCE(loser_rank,0)=0
`);

run('Top-100 both ranks', `
  SELECT COUNT(*) c FROM historical_matches h
  WHERE h.id IN (${PMI_HIST})
    AND winner_rank BETWEEN 1 AND 100 AND loser_rank BETWEEN 1 AND 100
`);

run('Rank 101 present', `
  SELECT COUNT(*) c FROM historical_matches h
  WHERE h.id IN (${PMI_HIST})
    AND (winner_rank = 101 OR loser_rank = 101)
`);

run('Impossible minutes (>600)', `
  SELECT COUNT(*) c FROM historical_matches h
  WHERE h.id IN (${PMI_HIST}) AND minutes > 600
`);

run('Extreme aces (>80)', `
  SELECT COUNT(*) c FROM historical_matches h
  WHERE h.id IN (${PMI_HIST}) AND (w_ace > 80 OR l_ace > 80)
`);

run('Surface distribution', `
  SELECT COALESCE(surface,'null') s, COUNT(*) c FROM historical_matches h
  WHERE h.id IN (${PMI_HIST}) GROUP BY s ORDER BY c DESC LIMIT 12
`);

run('Score abnormals', `
  SELECT
    SUM(CASE WHEN score IN ('W/O','DEF','RET','') OR score IS NULL THEN 1 ELSE 0 END) as abnormal_score,
    SUM(CASE WHEN score LIKE '%-%' THEN 1 ELSE 0 END) as has_set_dash,
    COUNT(*) as total
  FROM historical_matches h WHERE h.id IN (${PMI_HIST})
`);

run('Won-flag mismatch samples (won=1 but not winner name token)', `
  SELECT pmi.match_date, tp.full_name, pmi.opponent_name, pmi.won, h.winner_name, h.loser_name
  FROM player_match_index pmi
  JOIN historical_matches h ON h.id=pmi.historical_match_id
  JOIN tracked_players tp ON tp.id=pmi.tracked_player_id
  WHERE pmi.match_date >= '${SINCE}' AND pmi.won=1
    AND h.winner_name NOT LIKE '%' || SUBSTR(tp.full_name, INSTR(tp.full_name,' ')+1) || '%'
    AND h.winner_name NOT LIKE '%' || tp.full_name || '%'
  LIMIT 5
`);

run('Serve pct without svpt', `
  SELECT COUNT(*) c FROM historical_matches h
  WHERE h.id IN (${PMI_HIST}) AND COALESCE(w_serve_won_pct,0)>0 AND COALESCE(w_svpt,0)=0
`);

run('Placeholder vs real serve pattern', `
  SELECT
    SUM(CASE WHEN w_svpt=100 AND COALESCE(w_1stIn,0)=0 THEN 1 ELSE 0 END) as placeholder,
    SUM(CASE WHEN COALESCE(w_1stIn,0)>0 THEN 1 ELSE 0 END) as real_first_in,
    SUM(CASE WHEN COALESCE(w_svpt,0)=0 THEN 1 ELSE 0 END) as no_serve,
    COUNT(*) as total
  FROM historical_matches h WHERE h.id IN (${PMI_HIST})
`);

run('Duplicate same date+players', `
  SELECT match_date, winner_name, loser_name, COUNT(*) c
  FROM historical_matches h WHERE h.id IN (${PMI_HIST})
  GROUP BY match_date, winner_name, loser_name HAVING c>1 LIMIT 5
`);

run('PMI opponent vs hist mismatch sample', `
  SELECT pmi.match_date, tp.full_name as player, pmi.opponent_name as pmi_opp,
    CASE WHEN pmi.won=1 THEN h.loser_name ELSE h.winner_name END as hist_opp
  FROM player_match_index pmi
  JOIN historical_matches h ON h.id=pmi.historical_match_id
  JOIN tracked_players tp ON tp.id=pmi.tracked_player_id
  WHERE pmi.match_date >= '${SINCE}'
    AND LOWER(pmi.opponent_name) != LOWER(CASE WHEN pmi.won=1 THEN h.loser_name ELSE h.winner_name END)
  LIMIT 5
`);

run('Return won pct bounds violations', `
  SELECT COUNT(*) c FROM historical_matches h
  WHERE h.id IN (${PMI_HIST})
    AND ((w_return_won_pct < 0 OR w_return_won_pct > 100)
      OR (l_return_won_pct < 0 OR l_return_won_pct > 100))
`);

console.log('\nDone.\n');
