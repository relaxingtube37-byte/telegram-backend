import { db } from '../db/connection';
import { getPlayerArchive } from '../services/playerArchive.service';

const archive = getPlayerArchive(1)!;
const matches = archive.matches;

let anyStats = 0;
let csvOnly = 0;
let apiOnly = 0;
let both = 0;
let neither = 0;

for (const row of matches) {
  const hasCsv = row.hasCsvStats;
  const hasApi = row.hasApiStatistics;
  if (hasCsv && hasApi) both++;
  else if (hasCsv) csvOnly++;
  else if (hasApi) apiOnly++;
  else neither++;
  if (hasCsv || hasApi) anyStats++;
}

console.log('=== ANY SERVE STATISTICS? ===');
console.log(`At least CSV or API stats: ${anyStats} / ${matches.length} (${((anyStats / matches.length) * 100).toFixed(1)}%)`);
console.log(`  CSV only:  ${csvOnly}`);
console.log(`  API only:  ${apiOnly}`);
console.log(`  Both:      ${both}`);
console.log(`  NEITHER:   ${neither}`);

const apiBasic = matches.filter((x) => x.completeness === 'api_basic');
const csvWith = matches.filter((x) => x.hasCsvStats);
const csvWithout = matches.filter((x) => !x.hasCsvStats && !x.hasApiStatistics);

console.log('\n=== BREAKDOWN ===');
console.log(`api_basic (score/tourney only, NO serve stats): ${apiBasic.length}`);
console.log(`Has CSV serve stats (ace, svpt, BP...):         ${csvWith.length}`);
console.log(`No stats at all:                                 ${csvWithout.length}`);

// Validate CSV stats look sane on random sample
const sample = db
  .prepare(
    `
  SELECT h.w_svpt, h.l_svpt, h.w_ace, h.w_df, h.score, h.match_date, pmi.opponent_name
  FROM player_match_index pmi
  JOIN historical_matches h ON h.id = pmi.historical_match_id
  WHERE pmi.tracked_player_id = 1 AND pmi.has_csv_stats = 1
  ORDER BY RANDOM() LIMIT 5
`,
  )
  .all() as Array<Record<string, unknown>>;

console.log('\n=== CSV STATS SAMPLE (sanity check) ===');
for (const r of sample) {
  console.log(r);
}

console.log('\n=== ANSWER ===');
if (neither === 0 && apiBasic.length === 0) {
  console.log('YES — every match has serve statistics.');
} else {
  console.log(`NO — ${neither + apiBasic.length} matches lack serve statistics (${neither} nothing, ${apiBasic.length} API list only).`);
  console.log(`${csvWith.length + apiOnly + both} matches DO have serve stats (mostly from CSV download).`);
}
