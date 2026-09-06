import { db } from '../db/connection';
import { initSchema } from '../db/schema';
import { buildCsvNamePatterns, namesStrictMatch } from './historicalMatchKeys';

initSchema();

const since = '2024-01-01';

const rows = db
  .prepare(
    `
    SELECT tp.id, tp.full_name, tp.tour,
      (SELECT COUNT(*) FROM player_match_index pmi
        WHERE pmi.tracked_player_id = tp.id AND pmi.match_date >= @since AND pmi.has_csv_stats = 1) AS csv,
      (SELECT COUNT(*) FROM player_match_index pmi
        WHERE pmi.tracked_player_id = tp.id AND pmi.match_date >= @since) AS total
    FROM tracked_players tp
    WHERE tp.is_active = 1
    ORDER BY tp.full_name
  `,
  )
  .all({ since }) as Array<{
  id: number;
  full_name: string;
  tour: string;
  csv: number;
  total: number;
}>;

const zero = rows.filter((r) => r.csv === 0);
console.log('Players with zero CSV stats (2024+):', zero.length);
for (const p of zero) {
  const words = p.full_name.trim().split(/\s+/).length;
  console.log(`\n${p.full_name} (${p.tour}) | words=${words} | index rows=${p.total}`);

  const patterns = buildCsvNamePatterns(p.full_name);
  console.log('  patterns:', patterns.slice(0, 6).join(' | '));

  const strictHits = db
    .prepare(
      `SELECT winner_name, loser_name FROM historical_matches WHERE tour = ? AND match_date >= ? LIMIT 8000`,
    )
    .all(p.tour, since) as Array<{ winner_name: string; loser_name: string }>;

  const csvNames = new Set<string>();
  let matchCount = 0;
  for (const row of strictHits) {
    if (namesStrictMatch(row.winner_name, p.full_name) || namesStrictMatch(row.loser_name, p.full_name)) {
      matchCount++;
      if (namesStrictMatch(row.winner_name, p.full_name)) csvNames.add(row.winner_name);
      if (namesStrictMatch(row.loser_name, p.full_name)) csvNames.add(row.loser_name);
    }
  }
  console.log('  strict pool matches:', matchCount);
  if (csvNames.size) console.log('  CSV name forms:', [...csvNames].slice(0, 8).join(' | '));

  if (p.total > 0) {
    const sample = db
      .prepare(
        `
        SELECT pmi.has_csv_stats, h.winner_name, h.loser_name,
          h.w_svpt, h.l_svpt, h.w_serve_won_pct, h.l_serve_won_pct
        FROM player_match_index pmi
        JOIN historical_matches h ON h.id = pmi.historical_match_id
        WHERE pmi.tracked_player_id = ? AND pmi.match_date >= ?
        LIMIT 3
      `,
      )
      .all(p.id, since);
    console.log('  sample rows:', JSON.stringify(sample));
  }
}
