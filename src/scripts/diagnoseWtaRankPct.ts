import { db } from '../db/connection';
import { listTrackedPlayersWithCoverage } from '../services/playerSync.service';

const since = '2024-01-01';
const top = listTrackedPlayersWithCoverage()
  .filter((p) => p.tour === 'WTA')
  .sort((a, b) => (a.current_rank || 999) - (b.current_rank || 999))
  .slice(0, 15);

for (const p of top) {
  console.log(
    `${p.full_name}: rank ${p.coverageApi?.rankPct ?? 0}% | serve ${p.coverageApi?.servePct ?? 0}% | matches ${p.coverageApi?.matchesInDb ?? 0}`,
  );
}

const avg = db
  .prepare(
    `
    SELECT
      ROUND(AVG(rank_pct), 1) AS avg_rank_pct
    FROM (
      SELECT
        tp.id,
        CASE WHEN COUNT(*) = 0 THEN 0
          ELSE 100.0 * SUM(CASE WHEN COALESCE(h.winner_rank,0)>0 OR COALESCE(h.loser_rank,0)>0 THEN 1 ELSE 0 END) / COUNT(*)
        END AS rank_pct
      FROM tracked_players tp
      JOIN player_match_index pmi ON pmi.tracked_player_id = tp.id AND pmi.match_date >= ? AND pmi.has_csv_stats = 1
      JOIN historical_matches h ON h.id = pmi.historical_match_id
      WHERE tp.tour = 'WTA' AND tp.is_active = 1
      GROUP BY tp.id
    )
  `,
  )
  .get(since) as { avg_rank_pct: number };

console.log('\nWTA average rank %:', avg.avg_rank_pct);
