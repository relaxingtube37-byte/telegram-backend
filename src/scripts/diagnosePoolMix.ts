import { db } from '../db/connection';
import { initSchema } from '../db/schema';

initSchema();

const sinner = db.prepare(`SELECT id FROM tracked_players WHERE full_name LIKE '%Sinner%' LIMIT 1`).get() as { id: number };

const missing = db.prepare(`
  SELECT h.match_date, h.winner_name, h.loser_name, h.w_svpt, h.w_serve_won_pct, h.w_odds_match, h.rapid_event_id
  FROM player_match_index pmi
  JOIN historical_matches h ON h.id = pmi.historical_match_id
  WHERE pmi.tracked_player_id = ?
    AND pmi.match_date >= '2021-01-01'
    AND (COALESCE(h.w_serve_won_pct,0) = 0 AND COALESCE(h.l_serve_won_pct,0) = 0)
  LIMIT 15
`).all(sinner.id);

console.log('Sinner matches missing serve pct:', missing.length, 'sample:', missing);

const dupes = db.prepare(`
  SELECT match_date, winner_name, loser_name, COUNT(*) c
  FROM historical_matches h
  JOIN player_match_index pmi ON pmi.historical_match_id = h.id
  WHERE pmi.tracked_player_id = ?
  GROUP BY match_date, winner_name, loser_name
  HAVING c > 1
  LIMIT 10
`).all(sinner.id);

console.log('Duplicate links:', dupes);
