import { db } from '../db/connection';

const suspects = db
  .prepare(
    `SELECT tp.id, tp.full_name, tp.tour,
      (SELECT COUNT(*) FROM player_match_index pmi WHERE pmi.tracked_player_id=tp.id AND pmi.match_date>='2024-01-01') as matches,
      (SELECT COUNT(*) FROM player_match_index pmi JOIN historical_matches h ON h.id=pmi.historical_match_id
       WHERE pmi.tracked_player_id=tp.id AND pmi.match_date>='2024-01-01' AND COALESCE(h.w_svpt,0)>0) as with_serve,
      (SELECT COUNT(*) FROM player_match_index pmi JOIN historical_matches h ON h.id=pmi.historical_match_id
       WHERE pmi.tracked_player_id=tp.id AND pmi.match_date>='2024-01-01' AND pmi.has_csv_stats=1) as csv_linked
     FROM tracked_players tp
     WHERE tp.is_active=1
     HAVING matches > 0 AND with_serve = 0
     ORDER BY matches DESC`,
  )
  .all();

console.log('Players with matches but ZERO serve stats:');
console.log(suspects);

for (const p of suspects as Array<{ id: number; full_name: string }>) {
  const sample = db
    .prepare(
      `SELECT pmi.match_date, pmi.opponent_name, pmi.has_csv_stats, h.winner_name, h.loser_name, h.w_svpt, h.source
       FROM player_match_index pmi JOIN historical_matches h ON h.id=pmi.historical_match_id
       WHERE pmi.tracked_player_id=? ORDER BY pmi.match_date DESC LIMIT 3`,
    )
    .all(p.id);
  console.log(`\n${p.full_name} samples:`, sample);
}
