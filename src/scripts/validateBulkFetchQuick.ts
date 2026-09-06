import fs from 'node:fs';
import path from 'node:path';

const H = path.resolve('data/bulk-player-history');
const B = path.resolve('data/bulk-match-bundles');

const playerDirs = fs.readdirSync(path.join(H, 'players')).filter((n) => /^\d+$/.test(n));
let lines = 0;
let badJson = 0;
for (const d of playerDirs.slice(0, 30)) {
  const p = path.join(H, 'players', d, 'events.jsonl');
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)) {
    lines++;
    try {
      JSON.parse(line);
    } catch {
      badJson++;
    }
  }
}

const idx = JSON.parse(fs.readFileSync(path.join(H, 'indexes', 'all-events.json'), 'utf8'));
const dates = (idx.events as { match_date: string }[]).map((e) => e.match_date).sort();
const bundleDirs = fs.existsSync(path.join(B, 'events'))
  ? fs.readdirSync(path.join(B, 'events')).filter((n) => /^\d+$/.test(n))
  : [];

const historyIds = new Set((idx.events as { rapid_event_id: number }[]).map((e) => e.rapid_event_id));
let bundleOk = 0;
let bundleLinked = 0;
let realServe = 0;
for (const id of bundleDirs) {
  const dir = path.join(B, 'events', id);
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  if (m.statistics_status === 'ok' && m.pbp_status === 'ok' && m.details_status === 'ok') bundleOk++;
  if (historyIds.has(Number(id))) bundleLinked++;
  const stats = JSON.parse(fs.readFileSync(path.join(dir, 'statistics.json'), 'utf8'));
  const all = (stats.statistics || []).find((p: { period: string }) => p.period === 'ALL');
  const item = all?.groups?.flatMap((g: { statisticsItems: unknown[] }) => g.statisticsItems || []).find(
    (i: { key?: string }) => i.key === 'firstServeAccuracy',
  ) as { homeValue?: number } | undefined;
  if (item && Number(item.homeValue) > 0) realServe++;
}

console.log(
  JSON.stringify(
    {
      player_folders: playerDirs.length,
      jsonl_lines_sampled: lines,
      bad_json_lines: badJson,
      distinct_events: idx.distinct_events,
      date_range: [dates[0], dates[dates.length - 1]],
      bundle_folders: bundleDirs.length,
      bundles_all_ok: bundleOk,
      bundles_in_history_index: bundleLinked,
      bundles_real_serve_sample: realServe,
      verdict:
        badJson === 0 && bundleOk === bundleDirs.length && bundleLinked === bundleDirs.length
          ? 'LOOKS_GOOD'
          : 'CHECK_WARNINGS',
    },
    null,
    2,
  ),
);
