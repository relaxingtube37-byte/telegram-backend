import { db } from '../db/connection';
import { buildCsvNamePatterns, namesStrictMatch } from './historicalMatchKeys';

const players = db
  .prepare(
    `SELECT id, full_name, tour, matches_in_db FROM tracked_players WHERE is_active = 1 ORDER BY full_name`,
  )
  .all() as Array<{ id: number; full_name: string; tour: string; matches_in_db: number }>;

const since = '2024-01-01';

type Row = { id: number; full_name: string; tour: string; linked: number; words: number };

const rows: Row[] = players.map((p) => {
  const linked = (
    db
      .prepare(
        `SELECT COUNT(*) c FROM player_match_index WHERE tracked_player_id = ? AND match_date >= ? AND has_csv_stats = 1`,
      )
      .get(p.id, since) as { c: number }
  ).c;
  return {
    id: p.id,
    full_name: p.full_name,
    tour: p.tour,
    linked,
    words: p.full_name.trim().split(/\s+/).length,
  };
});

const zeroMulti = rows.filter((r) => r.linked === 0 && r.words >= 3);
const zeroTwo = rows.filter((r) => r.linked === 0 && r.words === 2);
const okMulti = rows.filter((r) => r.linked > 0 && r.words >= 3);
const okTwo = rows.filter((r) => r.linked > 0 && r.words === 2);

console.log('0 matches, 3+ word names:', zeroMulti.length);
console.log('0 matches, 2 word names:', zeroTwo.length);
console.log('has matches, 3+ word:', okMulti.length);
console.log('has matches, 2 word:', okTwo.length);

console.log('\n--- ZERO matches, 3+ words ---');
for (const p of zeroMulti) {
  const patterns = buildCsvNamePatterns(p.full_name);
  const lastName = (p.full_name.split(' ').pop() || '').toLowerCase();
  const sample = db
    .prepare(
      `SELECT COUNT(*) c FROM historical_matches WHERE tour = ? AND match_date >= ? AND (
        lower(replace(replace(winner_name, '.', ''), '  ', ' ')) LIKE ? OR
        lower(replace(replace(loser_name, '.', ''), '  ', ' ')) LIKE ?
      )`,
    )
    .get(p.tour, since, `%${lastName}%`, `%${lastName}%`) as { c: number };

  const strictHits = db
    .prepare(
      `SELECT winner_name, loser_name FROM historical_matches WHERE tour = ? AND match_date >= ? LIMIT 5000`,
    )
    .all(p.tour, since) as Array<{ winner_name: string; loser_name: string }>;

  let matchCount = 0;
  for (const row of strictHits) {
    if (namesStrictMatch(row.winner_name, p.full_name) || namesStrictMatch(row.loser_name, p.full_name)) {
      matchCount++;
    }
  }

  console.log(`\n${p.full_name} (${p.tour})`);
  console.log('  patterns:', patterns.slice(0, 8).join(' | '));
  console.log('  pool by last name:', sample.c);
  console.log('  strict match scan:', matchCount);

  if (matchCount > 0) {
    const csvNames = new Set<string>();
    for (const row of strictHits) {
      if (namesStrictMatch(row.winner_name, p.full_name)) csvNames.add(row.winner_name);
      if (namesStrictMatch(row.loser_name, p.full_name)) csvNames.add(row.loser_name);
    }
    console.log('  CSV forms:', [...csvNames].slice(0, 5).join(' | '));
  }
}
