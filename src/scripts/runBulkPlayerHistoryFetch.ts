/**
 * Phase 1 bulk ingest: live rankings (ATP+WTA top 200) + paginated match history per player.
 * CLI wrapper — for UI use: npm run bulk:ui
 */

import { bulkPlayerHistoryJob } from '../services/bulkPlayerHistoryJob.service';

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

const result = bulkPlayerHistoryJob.start({
  fromDate: arg('--from', '2024-01-01'),
  toDate: arg('--to', '2026-12-31'),
  rankLimit: Number(arg('--rank-limit', '200')),
  reqPerSec: Math.min(Math.max(Number(arg('--req-per-sec', '8')), 1), 10),
  resume: hasFlag('--resume') || !hasFlag('--no-resume'),
  saveRawPages: hasFlag('--save-raw-pages'),
  maxPages: Number(arg('--max-pages', '120')),
});

console.log(result.message);

if (!result.ok) process.exit(1);

const wait = setInterval(() => {
  const s = bulkPlayerHistoryJob.getState();
  if (s.status !== 'running') {
    clearInterval(wait);
    console.log('Final status:', s.status);
    process.exit(s.status === 'error' ? 1 : 0);
  }
}, 1000);