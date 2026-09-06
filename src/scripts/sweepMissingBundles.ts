/**
 * Targeted sweep to recover missing statistics and point-by-point data
 * for matches that previously failed due to transient API/network timeouts.
 *
 * Run: npx tsx src/scripts/sweepMissingBundles.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { ENV } from '../config/env';
import {
  BulkBundleStore,
  RateLimitedTennisClient,
  type BulkEventManifest,
  type BulkFetchEventRow,
} from '../services/bulkMatchBundleFetch.service';
import { listEventsFromPlayerHistory } from '../services/bulkPlayerHistoryFetch.service';
import { Logger } from '../utils/logger';

const ROOT_DIR = path.resolve('data/bulk-match-bundles');
const HISTORY_DIR = path.resolve('data/bulk-player-history');
const EVENTS_DIR = path.join(ROOT_DIR, 'events');
const REQ_PER_SEC = 8;

interface MissingEventInfo {
  eventId: number;
  dir: string;
  manifestPath: string;
  statsPath: string;
  pbpPath: string;
  detailsPath: string;
  missingStats: boolean;
  missingPbp: boolean;
  missingDetails: boolean;
  manifest: BulkEventManifest | null;
}

function atomicWriteJson(filePath: string, payload: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

async function main(): Promise<void> {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(' BULK MATCH BUNDLES — TARGETED MISSING DATA SWEEP');
  console.log('══════════════════════════════════════════════════════════════\n');

  if (!fs.existsSync(EVENTS_DIR)) {
    console.error('Events directory not found:', EVENTS_DIR);
    process.exit(1);
  }

  const ids = fs.readdirSync(EVENTS_DIR).filter((n) => /^\d+$/.test(n));
  const queue: MissingEventInfo[] = [];

  for (const idStr of ids) {
    const eventId = Number(idStr);
    const dir = path.join(EVENTS_DIR, idStr);
    const statsPath = path.join(dir, 'statistics.json');
    const pbpPath = path.join(dir, 'point_by_point.json');
    const detailsPath = path.join(dir, 'event_details.json');
    const manifestPath = path.join(dir, 'manifest.json');

    const missingStats = !fs.existsSync(statsPath);
    const missingPbp = !fs.existsSync(pbpPath);
    const missingDetails = !fs.existsSync(detailsPath);

    if (missingStats || missingPbp || missingDetails) {
      let manifest: BulkEventManifest | null = null;
      if (fs.existsSync(manifestPath)) {
        try {
          manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch {}
      }
      queue.push({
        eventId,
        dir,
        manifestPath,
        statsPath,
        pbpPath,
        detailsPath,
        missingStats,
        missingPbp,
        missingDetails,
        manifest,
      });
    }
  }

  console.log(`Total events checked: ${ids.length}`);
  console.log(`Events needing sweep: ${queue.length}`);
  console.log(`Rate limit: ${REQ_PER_SEC} requests/second`);
  console.log(`Estimated time: ~${Math.ceil((queue.length * 2) / REQ_PER_SEC / 60)} minutes\n`);

  if (queue.length === 0) {
    console.log('✅ All matches already have complete data!');
    return;
  }

  const client = new RateLimitedTennisClient(REQ_PER_SEC);
  let processed = 0;
  let recoveredStats = 0;
  let recoveredPbp = 0;
  let recoveredDetails = 0;
  let apiCalls = 0;
  const startedAt = Date.now();

  const concurrency = Math.max(2, Math.min(REQ_PER_SEC, 8));
  let nextIdx = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const idx = nextIdx++;
      if (idx >= queue.length) return;

      const item = queue[idx];
      let { manifest } = item;
      let manifestDirty = false;

      // 1. Fetch missing Details
      if (item.missingDetails) {
        apiCalls++;
        const details = await client.getEventDetails(item.eventId);
        if (details && (details as { event?: { id?: number } })?.event?.id) {
          atomicWriteJson(item.detailsPath, details);
          recoveredDetails++;
          manifestDirty = true;
        }
      }

      // 2. Fetch missing Statistics
      if (item.missingStats) {
        apiCalls++;
        const stats = await client.getEventStatistics(item.eventId);
        const hasStats =
          Boolean(stats) &&
          Array.isArray((stats as { statistics?: unknown[] })?.statistics) &&
          (stats as { statistics?: unknown[] })!.statistics!.length > 0;

        if (hasStats) {
          atomicWriteJson(item.statsPath, stats);
          recoveredStats++;
          manifestDirty = true;
        }
      }

      // 3. Fetch missing PBP
      if (item.missingPbp) {
        apiCalls++;
        const pbp = await client.getEventPointByPoint(item.eventId);
        const hasPbp =
          Boolean(pbp) &&
          Array.isArray((pbp as { pointByPoint?: unknown[] })?.pointByPoint) &&
          (pbp as { pointByPoint?: unknown[] })!.pointByPoint!.length > 0;

        if (hasPbp) {
          atomicWriteJson(item.pbpPath, pbp);
          recoveredPbp++;
          manifestDirty = true;
        }
      }

      // 4. Update manifest if any new file was saved
      if (manifestDirty && manifest) {
        const statsBytes = fs.existsSync(item.statsPath) ? fs.statSync(item.statsPath).size : 0;
        const pbpBytes = fs.existsSync(item.pbpPath) ? fs.statSync(item.pbpPath).size : 0;
        const detailsBytes = fs.existsSync(item.detailsPath) ? fs.statSync(item.detailsPath).size : 0;

        manifest.statistics_status = statsBytes > 0 ? 'ok' : 'empty';
        manifest.pbp_status = pbpBytes > 0 ? 'ok' : 'empty';
        manifest.details_status = detailsBytes > 0 ? 'ok' : 'empty';
        manifest.statistics_bytes = statsBytes;
        manifest.pbp_bytes = pbpBytes;
        manifest.details_bytes = detailsBytes;
        manifest.fetched_at = new Date().toISOString();

        atomicWriteJson(item.manifestPath, manifest);
      }

      processed++;

      if (processed % 50 === 0 || processed === queue.length) {
        const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
        const rate = (apiCalls / ((Date.now() - startedAt) / 1000)).toFixed(1);
        console.log(
          `[Sweep] ${processed}/${queue.length} | Recovered: Stats=+${recoveredStats}, PBP=+${recoveredPbp}, Details=+${recoveredDetails} | API Calls: ${apiCalls} (${rate} req/s) | ${elapsedMin}m`,
        );
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(' SWEEP COMPLETE — REBUILDING INDEXES');
  console.log('══════════════════════════════════════════════════════════════\n');

  console.log(`Recovered Statistics: +${recoveredStats}`);
  console.log(`Recovered Point-by-Point: +${recoveredPbp}`);
  console.log(`Recovered Details: +${recoveredDetails}`);
  console.log(`Total API Calls Made: ${apiCalls}`);

  // Rebuild global indexes
  const store = new BulkBundleStore(ROOT_DIR);
  const allEvents = listEventsFromPlayerHistory(HISTORY_DIR);
  store.rebuildPlayerIndex(allEvents);

  // Update job control progress with refreshed counts
  const jobControlPath = path.join(HISTORY_DIR, 'job-control.json');
  if (fs.existsSync(jobControlPath)) {
    try {
      const jobState = JSON.parse(fs.readFileSync(jobControlPath, 'utf8'));
      const statsOkCount = ids.filter((id) => fs.existsSync(path.join(EVENTS_DIR, id, 'statistics.json'))).length;
      const pbpOkCount = ids.filter((id) => fs.existsSync(path.join(EVENTS_DIR, id, 'point_by_point.json'))).length;

      jobState.progress.bundlesStatsOk = statsOkCount;
      jobState.progress.bundlesPbpOk = pbpOkCount;
      jobState.progress.apiCalls = (jobState.progress.apiCalls || 0) + apiCalls;
      jobState.progress.updatedAt = new Date().toISOString();

      atomicWriteJson(jobControlPath, jobState);
      console.log(`Updated job-control.json: Stats=${statsOkCount}, PBP=${pbpOkCount}`);
    } catch {}
  }

  console.log('\n✅ All indexes refreshed successfully!');
}

main().catch((err) => {
  console.error('Sweep failed:', err);
  process.exit(1);
});
