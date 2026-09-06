/**
 * List matches for bulk stats+PBP fetch (top-ranked tracked players only).
 *
 * Run: npx tsx src/scripts/listBulkFetchCohort.ts
 *      npx tsx src/scripts/listBulkFetchCohort.ts --from 2024-01-01 --to 2026-12-31 --rank-max 200
 */

import { db } from '../db/connection';
import {
  listTopRankedTrackedEvents,
  summarizeBulkCohort,
} from '../services/bulkMatchBundleFetch.service';

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const fromDate = arg('--from', '2024-01-01');
const toDate = arg('--to', '2026-12-31');
const rankMax = Number(arg('--rank-max', '200'));
const sample = Number(arg('--sample', '5'));

const events = listTopRankedTrackedEvents({ fromDate, toDate, rankMax });
const summary = summarizeBulkCohort(events);

console.log('\n══════════════════════════════════════════════════════════════');
console.log(' BULK FETCH COHORT (tracked players, ranked ≤ rank-max)');
console.log('══════════════════════════════════════════════════════════════\n');
console.log({ fromDate, toDate, rankMax, ...summary });

console.log('\n── Sample events ──');
for (const ev of events.slice(0, sample)) {
  console.log({
    rapid_event_id: ev.rapid_event_id,
    match_date: ev.match_date,
    tourney_name: ev.tourney_name,
    players: ev.players.map((p) => `${p.full_name} (id=${p.tracked_player_id}, rank=${p.current_rank})`),
  });
}

const missingEventId = db
  .prepare(
    `
    SELECT COUNT(*) c
    FROM player_match_index pmi
    JOIN tracked_players tp ON tp.id = pmi.tracked_player_id
    WHERE tp.is_active = 1 AND tp.current_rank <= ?
      AND pmi.match_date >= ? AND pmi.match_date <= ?
      AND pmi.rapid_event_id IS NULL
  `,
  )
  .get(rankMax, fromDate, toDate) as { c: number };

console.log('\n── Skipped (no rapid_event_id) ──');
console.log({ pmi_rows_without_event_id: missingEventId.c });
console.log('\nOutput folder suggestion: data/bulk-match-bundles');
console.log('Run fetch: npm run bulk:fetch-match-bundles\n');
