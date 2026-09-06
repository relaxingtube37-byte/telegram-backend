import { db } from '../db/connection';

const since = '2024-01-01';

const wta = db
  .prepare(
    `
    SELECT tp.full_name,
      COUNT(*) total,
      SUM(CASE WHEN COALESCE(h.winner_rank,0)>0 OR COALESCE(h.loser_rank,0)>0 THEN 1 ELSE 0 END) with_rank,
      SUM(CASE WHEN h.rapid_event_id IS NOT NULL THEN 1 ELSE 0 END) with_event
    FROM tracked_players tp
    JOIN player_match_index pmi ON pmi.tracked_player_id = tp.id AND pmi.match_date >= ? AND pmi.has_csv_stats = 1
    JOIN historical_matches h ON h.id = pmi.historical_match_id
    WHERE tp.tour = 'WTA' AND tp.is_active = 1
    GROUP BY tp.id
    ORDER BY with_rank * 1.0 / total DESC
    LIMIT 10
  `,
  )
  .all(since);

const bottom = db
  .prepare(
    `
    SELECT tp.full_name,
      COUNT(*) total,
      SUM(CASE WHEN COALESCE(h.winner_rank,0)>0 OR COALESCE(h.loser_rank,0)>0 THEN 1 ELSE 0 END) with_rank
    FROM tracked_players tp
    JOIN player_match_index pmi ON pmi.tracked_player_id = tp.id AND pmi.match_date >= ? AND pmi.has_csv_stats = 1
    JOIN historical_matches h ON h.id = pmi.historical_match_id
    WHERE tp.tour = 'WTA' AND tp.is_active = 1
    GROUP BY tp.id
    HAVING with_rank = 0
    LIMIT 10
  `,
  )
  .all(since);

console.log('WTA top rank coverage:', wta);
console.log('\nWTA zero rank sample:', bottom);
console.log(
  '\nWTA players with any rank:',
  db
    .prepare(
      `SELECT COUNT(*) c FROM (
        SELECT tp.id FROM tracked_players tp
        JOIN player_match_index pmi ON pmi.tracked_player_id = tp.id AND pmi.match_date >= ? AND pmi.has_csv_stats = 1
        JOIN historical_matches h ON h.id = pmi.historical_match_id
        WHERE tp.tour='WTA' AND tp.is_active=1
        GROUP BY tp.id
        HAVING SUM(CASE WHEN COALESCE(h.winner_rank,0)>0 OR COALESCE(h.loser_rank,0)>0 THEN 1 ELSE 0 END) > 0
      )`,
    )
    .get(since),
);
