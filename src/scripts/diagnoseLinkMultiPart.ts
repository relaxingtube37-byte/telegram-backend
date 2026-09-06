import { db } from '../db/connection';
import { buildCsvNamePatterns } from './historicalMatchKeys';
import { TrackedPlayerRepo } from '../db/repositories/trackedPlayer.repo';
import { linkCsvMatchesForPlayer } from '../services/playerArchive.service';

const names = [
  'Beatriz Haddad Maia',
  'Giovanni Mpetshi Perricard',
  'Jack Pinnington Jones',
  'David Jorda Sanchis',
  'Alejandro Davidovich Fokina',
];

for (const name of names) {
  const p = TrackedPlayerRepo.list({ activeOnly: true, limit: 500 }).find((x) => x.full_name === name);
  if (!p) {
    console.log('NOT FOUND:', name);
    continue;
  }

  const patterns = buildCsvNamePatterns(p.full_name);
  console.log(`\n=== ${name} (${p.tour}) id=${p.id} ===`);
  console.log('patterns:', patterns);

  for (const pat of patterns.slice(0, 3)) {
    const c = (
      db
        .prepare(
          `SELECT COUNT(*) c FROM historical_matches WHERE tour=? AND match_date>='2024-01-01' AND (
          lower(replace(replace(winner_name,'.',''),'  ',' '))=? OR
          lower(replace(replace(loser_name,'.',''),'  ',' '))=?)`,
        )
        .get(p.tour, pat, pat) as { c: number }
    ).c;
    console.log(`  SQL exact "${pat}": ${c}`);
  }

  const last = p.full_name.split(' ').pop()!;
  const samples = db
    .prepare(
      `SELECT winner_name, loser_name, match_date FROM historical_matches WHERE tour=? AND match_date>='2024-01-01' AND (winner_name LIKE ? OR loser_name LIKE ?) LIMIT 5`,
    )
    .all(p.tour, `%${last}%`, `%${last}%`) as Array<{ winner_name: string; loser_name: string; match_date: string }>;
  console.log('  CSV samples:', samples);

  const before = db.prepare('SELECT COUNT(*) c FROM player_match_index WHERE tracked_player_id=? AND match_date>=?').get(p.id, '2024-01-01') as { c: number };
  const linked = linkCsvMatchesForPlayer(p.id, '2024-01-01');
  const after = db.prepare('SELECT COUNT(*) c FROM player_match_index WHERE tracked_player_id=? AND match_date>=?').get(p.id, '2024-01-01') as { c: number };
  console.log(`  link: before=${before.c} after=${after.c} linked=${linked.linked} merged=${linked.merged}`);
}
