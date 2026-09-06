/**
 * Test phase 2 (match bundles) on events already collected in bulk-player-history.
 * Run: npx tsx src/scripts/testBulkBundlesPhase.ts --limit 5
 */

import path from 'node:path';
import { bulkPlayerHistoryJob } from '../services/bulkPlayerHistoryJob.service';
import { listEventsFromPlayerHistory } from '../services/bulkPlayerHistoryFetch.service';
import { BulkBundleStore } from '../services/bulkMatchBundleFetch.service';

const outDir = path.resolve('data/bulk-player-history');
const limitArg = process.argv.indexOf('--limit');
const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1] || 5) : 5;

const events = listEventsFromPlayerHistory(outDir);
console.log(`Events on disk: ${events.length} (from ${outDir})`);
if (!events.length) {
  console.error('No events — run player history phase first.');
  process.exit(1);
}

const result = bulkPlayerHistoryJob.start({
  outDir,
  bundlesOnly: true,
  bundleTestLimit: limit,
  resume: true,
  reqPerSec: 8,
});

console.log(result.message);

const wait = setInterval(() => {
  const s = bulkPlayerHistoryJob.getState();
  if (s.status !== 'running') {
    clearInterval(wait);
    const bundleStore = new BulkBundleStore(path.join(path.dirname(outDir), 'bulk-match-bundles'));
    const done = bundleStore.loadCompletedEventIds().size;
    console.log('\nResult:', {
      status: s.status,
      phase: s.progress.phase,
      bundlesDone: s.progress.bundlesDone,
      bundlesOnDisk: done,
      statsOk: s.progress.bundlesStatsOk,
      pbpOk: s.progress.bundlesPbpOk,
      apiCalls: s.progress.apiCalls,
      lastError: s.progress.lastError,
    });
    process.exit(s.status === 'error' ? 1 : 0);
  }
}, 1000);
