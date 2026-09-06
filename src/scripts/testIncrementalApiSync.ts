/**
 * Tests incremental API sync (3-phase plan):
 * 1) events/previous pages — rank + match list
 * 2) bulk odds by date — one request per day
 * 3) statistics only for serve gaps (no PBP)
 *
 * Usage:
 *   npx tsx src/scripts/testIncrementalApiSync.ts Sinner
 *   npx tsx src/scripts/testIncrementalApiSync.ts Sinner --live
 *   npx tsx src/scripts/testIncrementalApiSync.ts Sinner --live --with-pages
 */
import { db } from '../db/connection';
import { initSchema } from '../db/schema';
import { ENV } from '../config/env';
import { TrackedPlayerRepo } from '../db/repositories/trackedPlayer.repo';
import {
  enrichPlayerApiGaps,
  listPlayerDataGaps,
  planApiEnrichment,
} from '../services/incrementalApiEnrichment.service';
import { syncPlayerArchiveUnified } from '../services/playerArchive.service';

initSchema();

const SINCE = '2024-01-01';
const playerQuery = process.argv[2] || 'Sinner';
const live = process.argv.includes('--live');
const withPages = process.argv.includes('--with-pages');

function findPlayer(name: string) {
  return TrackedPlayerRepo.list({ activeOnly: true, limit: 500 }).find((p) =>
    p.full_name.toLowerCase().includes(name.toLowerCase()),
  );
}

function localCoverage(trackedPlayerId: number, sinceDate: string) {
  return db
    .prepare(
      `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN COALESCE(h.w_serve_won_pct,0) > 0 OR COALESCE(h.l_serve_won_pct,0) > 0 THEN 1 ELSE 0 END) AS with_serve,
      SUM(CASE WHEN COALESCE(h.w_odds_match,0) > 0 OR COALESCE(h.l_odds_match,0) > 0 THEN 1 ELSE 0 END) AS with_odds,
      SUM(CASE WHEN COALESCE(h.winner_rank,0) > 0 OR COALESCE(h.loser_rank,0) > 0 THEN 1 ELSE 0 END) AS with_rank
    FROM player_match_index pmi
    JOIN historical_matches h ON h.id = pmi.historical_match_id
    WHERE pmi.tracked_player_id = ? AND pmi.match_date >= ? AND pmi.has_csv_stats = 1
  `,
    )
    .get(trackedPlayerId, sinceDate) as { total: number; with_serve: number; with_odds: number; with_rank: number };
}

async function main(): Promise<void> {
  const player = findPlayer(playerQuery);
  if (!player) {
    console.error('Player not found:', playerQuery);
    process.exit(1);
  }

  console.log(`\n=== INCREMENTAL SYNC TEST: ${player.full_name} (since ${SINCE}) ===\n`);

  const before = localCoverage(player.id, SINCE);
  const gaps = listPlayerDataGaps(player.id, SINCE);
  const plan = planApiEnrichment(gaps, Math.max(1, Math.ceil(before.total / 30)));
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

  console.log('LOCAL TABLE (CSV rows, before API):');
  console.log(`  matches: ${before.total}`);
  console.log(`  serve:   ${before.with_serve}/${before.total} (${pct(before.with_serve, before.total)}%)`);
  console.log(`  odds:    ${before.with_odds}/${before.total} (${pct(before.with_odds, before.total)}%)`);
  console.log(`  rank:    ${before.with_rank}/${before.total} (${pct(before.with_rank, before.total)}%)`);
  console.log(`  gaps: ${gaps.length} (serve=${plan.serveGaps.length}, odds=${plan.oddsGaps.length}, rank=${plan.rankGaps.length})`);

  if (gaps.length) {
    console.log('\nSample gaps:');
    for (const g of gaps.slice(0, 5)) {
      const miss = [g.missingServe ? 'serve' : '', g.missingOdds ? 'odds' : '', g.missingRank ? 'rank' : '']
        .filter(Boolean)
        .join(', ');
      console.log(`  ${g.matchDate} vs event ${g.rapidEventId} | missing: ${miss}`);
    }
  }

  console.log('\nAPI PLAN:');
  console.log(`  Phase 1 - events/previous: ~${Math.max(1, Math.ceil(before.total / 30))} page(s) (optional)`);
  console.log(`  Phase 2 - bulk odds: ${plan.oddsDates.length} date(s)`);
  console.log(`  Phase 3 - statistics: ${plan.serveGaps.length} match(es)`);
  console.log(`  Total estimate: ~${plan.estimatedApiCalls} requests`);

  if (!live) {
    console.log('\nDry-run only. Re-run with --live to enrich gaps.\n');
    return;
  }

  if (!ENV.RAPIDAPI_KEY) {
    console.error('\nRAPIDAPI_KEY missing — cannot run live test.');
    process.exit(1);
  }

  if (withPages) {
    console.log('\n--- LIVE: Phase 1 (event pages for rank) ---');
    const phase1 = await syncPlayerArchiveUnified(player.id, {
      sinceDate: SINCE,
      csvOnly: false,
      linkCsv: true,
      fetchBundles: false,
      refreshEventPages: true,
      fetchAllPages: true,
    });
    console.log(`  pages=${phase1.pagesFetched} events=${phase1.eventsSeen}`);
  }

  console.log('\n--- LIVE: Phase 2+3 (bulk odds + serve stats) ---');
  const phase23 = await enrichPlayerApiGaps(player.id, SINCE);
  console.log(
    `  odds dates=${phase23.oddsDatesFetched} odds filled=${phase23.oddsMatchesFilled} stats filled=${phase23.statsMatchesFilled} api calls=${phase23.apiCalls}`,
  );

  const after = localCoverage(player.id, SINCE);
  const gapsAfter = listPlayerDataGaps(player.id, SINCE).length;
  console.log('\nLOCAL TABLE (after API):');
  console.log(`  serve: ${after.with_serve}/${after.total} (${pct(after.with_serve, after.total)}%)`);
  console.log(`  odds:  ${after.with_odds}/${after.total} (${pct(after.with_odds, after.total)}%)`);
  console.log(`  rank:  ${after.with_rank}/${after.total} (${pct(after.with_rank, after.total)}%)`);
  console.log(`  remaining gaps: ${gapsAfter}`);
  console.log('\n✅ Live incremental sync test finished.\n');
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
