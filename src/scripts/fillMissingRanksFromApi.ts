/**
 * Fill missing match ranks from Tennis API events/previous pages.
 * Works for ATP and WTA — only patches empty rank fields on CSV-linked matches.
 *
 * Usage:
 *   npx tsx src/scripts/fillMissingRanksFromApi.ts Sinner
 *   npx tsx src/scripts/fillMissingRanksFromApi.ts Sabalenka
 *   npx tsx src/scripts/fillMissingRanksFromApi.ts --all
 *   npx tsx src/scripts/fillMissingRanksFromApi.ts --wta
 *   npx tsx src/scripts/fillMissingRanksFromApi.ts --atp
 *   npx tsx src/scripts/fillMissingRanksFromApi.ts --since=2024-01-01
 */
import { db } from '../db/connection';
import { ENV } from '../config/env';
import { TrackedPlayerRepo, type TrackedPlayerTour } from '../db/repositories/trackedPlayer.repo';

void db;

const SINCE_DEFAULT = '2024-01-01';
const sinceArg = process.argv.find((a) => a.startsWith('--since='))?.split('=')[1];
const sinceDate = sinceArg || SINCE_DEFAULT;
const allPlayers = process.argv.includes('--all');
const wtaOnly = process.argv.includes('--wta');
const atpOnly = process.argv.includes('--atp');
const nameQuery = process.argv.find(
  (a, i) => i >= 2 && !a.startsWith('--') && !a.includes('tsx') && !a.includes('fillMissingRanksFromApi'),
);

function tourFilter(): TrackedPlayerTour | undefined {
  if (wtaOnly) return 'WTA';
  if (atpOnly) return 'ATP';
  return undefined;
}

async function runForPlayer(
  playerId: number,
  rapidPlayerId: number,
  name: string,
  tour: TrackedPlayerTour,
  enrichment: typeof import('../services/incrementalApiEnrichment.service'),
) {
  const before = enrichment.listRankGaps(playerId, sinceDate);
  console.log(`\n--- ${name} (${tour}) ---`);
  console.log(`  rank gaps before: ${before.length}`);
  for (const g of before.slice(0, 3)) {
    console.log(`    ${g.matchDate} event ${g.rapidEventId}`);
  }

  if (before.length === 0) {
    console.log('  nothing to fill');
    return { filled: 0, remaining: 0 };
  }

  const result = await enrichment.fillMissingRanksForPlayer(playerId, rapidPlayerId, name, sinceDate);
  console.log(
    `  API pages: ${result.pagesFetched} | filled: ${result.rankFilled} | remaining: ${result.rankGapsAfter}`,
  );
  return { filled: result.rankFilled, remaining: result.rankGapsAfter };
}

async function main(): Promise<void> {
  if (!ENV.RAPIDAPI_KEY) {
    console.error('RAPIDAPI_KEY missing');
    process.exit(1);
  }

  const enrichment = await import('../services/incrementalApiEnrichment.service');
  const tour = tourFilter();

  console.log(`\n=== FILL MISSING RANKS (since ${sinceDate}${tour ? `, ${tour} only` : ', ATP+WTA'}) ===`);

  if (allPlayers || wtaOnly || atpOnly) {
    const players = TrackedPlayerRepo.list({ activeOnly: true, tour, limit: 500 });
    let totalFilled = 0;
    let atpFilled = 0;
    let wtaFilled = 0;
    let withGaps = 0;

    for (const p of players) {
      const gaps = enrichment.listRankGaps(p.id, sinceDate).length;
      if (gaps === 0) continue;
      withGaps++;
      const result = await enrichment.fillMissingRanksForPlayer(p.id, p.rapid_player_id, p.full_name, sinceDate);
      totalFilled += result.rankFilled;
      if (p.tour === 'WTA') wtaFilled += result.rankFilled;
      else atpFilled += result.rankFilled;
      if (result.rankFilled > 0) {
        console.log(`[${p.tour}] ${p.full_name}: filled ${result.rankFilled}, remaining ${result.rankGapsAfter}`);
      }
    }

    console.log(`\nPlayers with rank gaps: ${withGaps}`);
    console.log(`ATP ranks filled: ${atpFilled}`);
    console.log(`WTA ranks filled: ${wtaFilled}`);
    console.log(`Total ranks filled: ${totalFilled}\n`);
    return;
  }

  const player = nameQuery
    ? TrackedPlayerRepo.list({ activeOnly: true, limit: 500 }).find((p) =>
        p.full_name.toLowerCase().includes(nameQuery.toLowerCase()),
      )
    : undefined;

  if (!player) {
    console.error('Player not found:', nameQuery || '(provide a name, --all, --wta, or --atp)');
    process.exit(1);
  }

  await runForPlayer(player.id, player.rapid_player_id, player.full_name, player.tour, enrichment);
  console.log('');
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
