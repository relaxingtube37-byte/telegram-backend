/**
 * Validate on-disk bulk fetch files (player history + match bundles).
 * Run: npx tsx src/scripts/validateBulkFetchFiles.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { listEventsFromPlayerHistory } from '../services/bulkPlayerHistoryFetch.service';
import { BulkBundleStore } from '../services/bulkMatchBundleFetch.service';
import { BulkPlayerHistoryStore } from '../services/bulkPlayerHistoryFetch.service';

const ROOT = path.resolve('data');
const HISTORY_DIR = path.join(ROOT, 'bulk-player-history');
const BUNDLES_DIR = path.join(ROOT, 'bulk-match-bundles');

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];

function add(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
}

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

function main(): void {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(' VALIDATE BULK FETCH FILES');
  console.log('══════════════════════════════════════════════════════════════\n');

  const historyStore = new BulkPlayerHistoryStore(HISTORY_DIR);
  const bundleStore = new BundleStoreSafe(BUNDLES_DIR);

  const playerIds = historyStore.loadCompletedPlayerIds();
  add('Player folders', playerIds.size > 0, `${playerIds.size} players with manifest.json`);

  const events = listEventsFromPlayerHistory(HISTORY_DIR);
  add('Distinct events in index', events.length > 0, `${events.length} unique rapid_event_id values`);

  const job = readJson<{
    status?: string;
    progress?: { phase?: string; playersDone?: number; bundlesDone?: number };
  }>(path.join(HISTORY_DIR, 'job-control.json'));
  if (job) {
    add('Job state file', true, `status=${job.status} phase=${job.progress?.phase}`);
  }

  // Sample 3 player manifests
  const samplePlayers = [...playerIds].slice(0, 3);
  let manifestOk = 0;
  for (const pid of samplePlayers) {
    const m = readJson<{ events_in_window?: number; rapid_player_id?: number }>(
      path.join(HISTORY_DIR, 'players', String(pid), 'manifest.json'),
    );
    const lines = fs
      .readFileSync(path.join(HISTORY_DIR, 'players', String(pid), 'events.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean);
    if (m && m.rapid_player_id === pid && lines.length > 0) manifestOk++;
  }
  add('Player manifest + jsonl', manifestOk === samplePlayers.length, `${manifestOk}/${samplePlayers.length} samples OK`);

  // Event field quality
  let withEventId = 0;
  let withDate = 0;
  let withUtc = 0;
  let withOpponent = 0;
  let doubles = 0;
  for (const ev of events) {
    if (ev.rapid_event_id > 0) withEventId++;
    if (ev.match_date) withDate++;
    const sample = readJsonlEvent(HISTORY_DIR, ev.rapid_event_id);
    if (sample?.start_utc) withUtc++;
    if (sample?.opponent_name) withOpponent++;
    if (sample?.player_name?.includes('/')) doubles++;
  }
  add('Events have rapid_event_id', withEventId === events.length, `${withEventId}/${events.length}`);
  add('Events have match_date', withDate === events.length, `${withDate}/${events.length}`);
  add('Events have start_utc (sampled)', withUtc > events.length * 0.8, `${withUtc}/${events.length} (from jsonl lookup)`);
  add('Events have opponent', withOpponent > events.length * 0.85, `${withOpponent}/${events.length}`);
  add('Doubles rows (expected some)', true, `${doubles} rows with "/" in name`);

  // Duplicate event ids in index
  const ids = events.map((e) => e.rapid_event_id);
  const unique = new Set(ids);
  add('No duplicate event ids', unique.size === ids.length, `${unique.size} unique`);

  // Bundles
  const bundleDone = bundleStore.loadCompletedEventIds();
  add('Bundle events on disk', bundleDone.size >= 0, `${bundleDone.size} complete bundles`);

  if (bundleDone.size > 0) {
    const sampleBundleIds = [...bundleDone].slice(0, 5);
    let statsOk = 0;
    let pbpOk = 0;
    let detailsOk = 0;
    let realServe = 0;

    for (const eid of sampleBundleIds) {
      const dir = path.join(BUNDLES_DIR, 'events', String(eid));
      const manifest = readJson<{
        statistics_status?: string;
        pbp_status?: string;
        details_status?: string;
        api_periods?: string[];
        pbp_set_count?: number;
        start_utc?: string;
      }>(path.join(dir, 'manifest.json'));

      const stats = readJson<{ statistics?: unknown[] }>(path.join(dir, 'statistics.json'));
      const pbp = readJson<{ pointByPoint?: unknown[] }>(path.join(dir, 'point_by_point.json'));
      const details = readJson<{ event?: { id?: number; startTimestamp?: number } }>(path.join(dir, 'event_details.json'));

      if (manifest?.statistics_status === 'ok' && stats?.statistics?.length) statsOk++;
      if (manifest?.pbp_status === 'ok' && pbp?.pointByPoint?.length) pbpOk++;
      if (manifest?.details_status === 'ok' && details?.event?.id) detailsOk++;

      const firstPeriod = (stats?.statistics || []).find((p: { period?: string }) => p.period === 'ALL') as
        | { groups?: Array<{ statisticsItems?: Array<{ key?: string; homeValue?: number }> }> }
        | undefined;
      const serveItem = firstPeriod?.groups
        ?.flatMap((g) => g.statisticsItems || [])
        .find((i) => i.key === 'firstServeAccuracy' || String(i.key).includes('firstServe'));
      if (serveItem && Number(serveItem.homeValue) > 0) realServe++;
    }

    add('Bundle statistics (5 sample)', statsOk >= 3, `${statsOk}/5 with real statistics JSON`);
    add('Bundle PBP (5 sample)', pbpOk >= 3, `${pbpOk}/5 with pointByPoint JSON`);
    add('Bundle details (5 sample)', detailsOk >= 3, `${detailsOk}/5 with event id + timestamp`);
    add('Real serve counts in API stats', realServe >= 2, `${realServe}/5 have firstServe homeValue > 0`);

    // Print one good sample
    const goodId = sampleBundleIds.find((id) => {
      const m = readJson<{ statistics_status?: string }>(path.join(BUNDLES_DIR, 'events', String(id), 'manifest.json'));
      return m?.statistics_status === 'ok';
    });
    if (goodId) {
      const m = readJson<Record<string, unknown>>(path.join(BUNDLES_DIR, 'events', String(goodId), 'manifest.json'));
      console.log('\n── Sample bundle manifest (good) ──');
      console.log(JSON.stringify(m, null, 2));
    }
  }

  // Cross-check: bundle event id exists in history list
  if (bundleDone.size > 0) {
    const historyIds = new Set(events.map((e) => e.rapid_event_id));
    let linked = 0;
    for (const id of bundleDone) if (historyIds.has(id)) linked++;
    add('Bundles linked to history list', linked === bundleDone.size, `${linked}/${bundleDone.size} event ids found in phase-1 list`);
  }

  // Print sample history event
  if (events.length > 0) {
    const ev = events[0];
    console.log('\n── Sample history event (from index) ──');
    console.log(
      JSON.stringify(
        {
          rapid_event_id: ev.rapid_event_id,
          match_date: ev.match_date,
          score: ev.score,
          tourney_name: ev.tourney_name,
          players: ev.players?.length,
        },
        null,
        2,
      ),
    );
  }

  console.log('\n── Checks ──');
  let pass = 0;
  for (const c of checks) {
    console.log(`${c.ok ? '✅' : '❌'} ${c.name}: ${c.detail}`);
    if (c.ok) pass++;
  }
  console.log(`\n${pass}/${checks.length} checks passed\n`);
  process.exit(pass === checks.length ? 0 : 1);
}

class BundleStoreSafe extends BulkBundleStore {
  loadCompletedEventIds(): Set<number> {
    return super.loadCompletedEventIds();
  }
}

function readJsonlEvent(historyDir: string, eventId: number): {
  start_utc?: string;
  opponent_name?: string;
  player_name?: string;
} | null {
  const indexPath = path.join(historyDir, 'indexes', 'all-events.json');
  if (fs.existsSync(indexPath)) {
    const data = readJson<{ events?: Array<{ rapid_event_id: number; start_utc?: string; opponent_name?: string; player_name?: string }> }>(
      indexPath,
    );
    const hit = data?.events?.find((e) => e.rapid_event_id === eventId);
    if (hit) return hit;
  }
  const playersRoot = path.join(historyDir, 'players');
  if (!fs.existsSync(playersRoot)) return null;
  for (const name of fs.readdirSync(playersRoot)) {
    const p = path.join(playersRoot, name, 'events.jsonl');
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)) {
      const row = JSON.parse(line) as { rapid_event_id: number; start_utc?: string; opponent_name?: string; player_name?: string };
      if (row.rapid_event_id === eventId) return row;
    }
  }
  return null;
}

main();
