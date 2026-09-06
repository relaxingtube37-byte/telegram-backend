/**
 * Bulk download statistics + point-by-point for top-ranked tracked players (2024–2026).
 * Saves full JSON per event for later DB import.
 *
 * Run:
 *   npx tsx src/scripts/runBulkMatchBundleFetch.ts --dry-run
 *   npx tsx src/scripts/runBulkMatchBundleFetch.ts --out data/bulk-match-bundles --req-per-sec 8 --resume
 *   npx tsx src/scripts/runBulkMatchBundleFetch.ts --limit 20
 */

import path from 'node:path';
import {
  BulkBundleStore,
  listTopRankedTrackedEvents,
  RateLimitedTennisClient,
  readPoolPbp,
  readPoolStatistics,
  summarizeBulkCohort,
  type BulkFetchEventRow,
} from '../services/bulkMatchBundleFetch.service';
import { Logger } from '../utils/logger';

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

const fromDate = arg('--from', '2024-01-01');
const toDate = arg('--to', '2026-12-31');
const rankMax = Number(arg('--rank-max', '200'));
const outDir = path.resolve(arg('--out', 'data/bulk-match-bundles'));
const reqPerSec = Math.min(Math.max(Number(arg('--req-per-sec', '8')), 1), 10);
const limit = hasFlag('--limit') ? Number(arg('--limit', '0')) : 0;
const dryRun = hasFlag('--dry-run');
const resume = hasFlag('--resume');
const usePoolCache = hasFlag('--use-pool-cache');

async function fetchOneEvent(
  client: RateLimitedTennisClient,
  store: BulkBundleStore,
  event: BulkFetchEventRow,
): Promise<{ apiCalls: number; stats: BulkFetchEventRow extends never ? never : string; pbp: string }> {
  const errors: string[] = [];
  let apiCalls = 0;

  store.writeSeedManifest(event);

  let statistics: unknown | null = null;
  let pbp: unknown | null = null;
  let details: unknown | null = null;
  let statistics_status: 'ok' | 'empty' | 'error' | 'cached' = 'empty';
  let pbp_status: 'ok' | 'empty' | 'error' | 'cached' = 'empty';
  let details_status: 'ok' | 'empty' | 'error' | 'cached' = 'empty';

  if (usePoolCache) {
    statistics = readPoolStatistics(event.rapid_event_id);
    if (statistics) statistics_status = 'cached';
    pbp = readPoolPbp(event.rapid_event_id);
    if (pbp) pbp_status = 'cached';
  }

  if (!details) {
    details = await client.getEventDetails(event.rapid_event_id);
    apiCalls++;
    details_status = (details as { event?: { id?: number } })?.event?.id ? 'ok' : 'empty';
    if (details_status === 'empty') errors.push('details_empty');
  }

  if (!statistics) {
    statistics = await client.getEventStatistics(event.rapid_event_id);
    apiCalls++;
    statistics_status = statistics ? 'ok' : 'empty';
    if (!statistics) errors.push('statistics_empty');
  }

  if (!pbp) {
    pbp = await client.getEventPointByPoint(event.rapid_event_id);
    apiCalls++;
    pbp_status = pbp ? 'ok' : 'empty';
    if (!pbp) errors.push('pbp_empty');
  }

  store.saveBundle(event, statistics, pbp, details, {
    statistics_status,
    pbp_status,
    details_status,
    errors,
  });

  store.appendProgress({
    rapid_event_id: event.rapid_event_id,
    at: new Date().toISOString(),
    statistics_status,
    pbp_status,
    api_calls: apiCalls,
  });

  return { apiCalls, stats: statistics_status, pbp: pbp_status, details: details_status };
}

async function main(): Promise<void> {
  const allEvents = listTopRankedTrackedEvents({ fromDate, toDate, rankMax });
  const summary = summarizeBulkCohort(allEvents);

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(' BULK MATCH BUNDLE FETCH');
  console.log('══════════════════════════════════════════════════════════════\n');
  console.log({ fromDate, toDate, rankMax, outDir, reqPerSec, resume, usePoolCache, ...summary });

  if (dryRun) {
    console.log('\nDry run — no API calls.');
    return;
  }

  const store = new BulkBundleStore(outDir);
  const completed = resume ? store.loadCompletedEventIds() : new Set<number>();
  let queue = allEvents.filter((e) => !completed.has(e.rapid_event_id));
  if (limit > 0) queue = queue.slice(0, limit);

  console.log(`\nQueue: ${queue.length} events (${completed.size} already complete)`);

  store.writeRunManifest({
    started_at: new Date().toISOString(),
    fromDate,
    toDate,
    rankMax,
    reqPerSec,
    usePoolCache,
    cohort: summary,
    queue_events: queue.length,
    skipped_completed: completed.size,
  });

  const client = new RateLimitedTennisClient(reqPerSec);

  let done = 0;
  let apiCalls = 0;
  const startedAt = Date.now();

  for (const event of queue) {
    const result = await fetchOneEvent(client, store, event);
    apiCalls += result.apiCalls;
    done++;

    if (done % 25 === 0 || done === queue.length) {
      const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
      Logger.info(`[BulkFetch] ${done}/${queue.length} events | apiCalls=${apiCalls} | ${elapsedMin}m`);
    }
  }

  store.rebuildPlayerIndex(allEvents);

  store.writeRunManifest({
    finished_at: new Date().toISOString(),
    fromDate,
    toDate,
    rankMax,
    reqPerSec,
    usePoolCache,
    cohort: summary,
    fetched_events: done,
    api_calls: apiCalls,
    output_dir: outDir,
  });

  console.log(`\n✅ Done. ${done} events, ${apiCalls} API calls.`);
  console.log(`Files: ${outDir}`);
  console.log('Per event: events/{id}/manifest.json + statistics.json + point_by_point.json + event_details.json');
  console.log('Per player: indexes/by-player/{tracked_player_id}.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
