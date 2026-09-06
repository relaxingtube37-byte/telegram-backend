/**
 * Probes RapidAPI tennis endpoints to document what each returns.
 * Usage: tsx src/scripts/probeTennisApiEndpoints.ts [playerId] [eventId]
 */
import { db } from '../db/connection';
import { BackendTennisApi } from '../dataPool/dataPool.tennisApi';
import { ENV } from '../config/env';

function summarize(obj: unknown, maxDepth = 2, depth = 0): unknown {
  if (obj === null || obj === undefined) return obj;
  if (depth >= maxDepth) {
    if (Array.isArray(obj)) return `[array len=${obj.length}]`;
    if (typeof obj === 'object') return `{keys:${Object.keys(obj as object).slice(0, 12).join(',')}}`;
    return obj;
  }
  if (Array.isArray(obj)) return obj.slice(0, 2).map((x) => summarize(x, maxDepth, depth + 1));
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>).slice(0, 20)) {
      out[k] = summarize(v, maxDepth, depth + 1);
    }
    return out;
  }
  return obj;
}

function payloadSize(obj: unknown): number {
  return JSON.stringify(obj ?? '').length;
}

async function main() {
  if (!ENV.RAPIDAPI_KEY) {
    console.error('RAPIDAPI_KEY missing — cannot probe live API');
    process.exit(1);
  }

  const playerId = Number(process.argv[2] || 0);
  const eventIdArg = Number(process.argv[3] || 0);

  console.log('=== POOL CACHE SAMPLES (already fetched) ===');
  const cached = db
    .prepare('SELECT namespace, cache_key, length(payload_json) as bytes FROM pool_cache ORDER BY updated_at DESC LIMIT 10')
    .all() as { namespace: string; cache_key: string; bytes: number }[];
  console.table(cached);

  for (const ns of ['event_statistics', 'event_pbp', 'event_details']) {
    const row = db.prepare('SELECT payload_json FROM pool_cache WHERE namespace = ? LIMIT 1').get(ns) as
      | { payload_json: string }
      | undefined;
    if (row) {
      const parsed = JSON.parse(row.payload_json);
      console.log(`\n--- cached ${ns} (${row.payload_json.length} bytes) ---`);
      console.log(JSON.stringify(summarize(parsed, 3), null, 2));
    }
  }

  let playerIdToUse = playerId;
  let eventIdToUse = eventIdArg;

  if (!playerIdToUse) {
    const rankings = await BackendTennisApi.getRankings('atp');
    const rows = (rankings as any)?.rankings || (Array.isArray(rankings) ? rankings : []);
    const top = rows[0];
    playerIdToUse = Number(top?.team?.id || top?.id || 0);
    console.log('\nRankings ATP #1 -> playerId', playerIdToUse, top?.team?.name || top?.name);
  }

  if (!eventIdToUse && playerIdToUse) {
    const prev = await BackendTennisApi.getPlayerPreviousEvents(playerIdToUse, 0);
    const events = (prev as any)?.events || [];
    const finished = events.find((e: any) => String(e?.status?.type || '').toLowerCase().includes('finished'));
    eventIdToUse = Number(finished?.id || events[0]?.id || 0);
    console.log('\nPlayer events/previous/0 ->', events.length, 'events, sample eventId', eventIdToUse);
    if (finished) {
      console.log('Event list item keys:', Object.keys(finished).join(', '));
      console.log('Has embedded statistics?', Boolean((finished as any).statistics));
      console.log('Has embedded pointByPoint?', Boolean((finished as any).pointByPoint || (finished as any).pointByPointSummary));
    }
  }

  if (!eventIdToUse) eventIdToUse = 16931538;

  console.log('\n=== LIVE API PROBE (1 call each) ===');
  const probes: { name: string; fn: () => Promise<unknown> }[] = [
    { name: 'event_details', fn: () => BackendTennisApi.getEventDetails(eventIdToUse) },
    { name: 'event_statistics', fn: () => BackendTennisApi.getEventStatistics(eventIdToUse) },
    { name: 'event_pbp', fn: () => BackendTennisApi.getEventPointByPoint(eventIdToUse) },
    { name: 'event_duel', fn: () => BackendTennisApi.getEventDuel(eventIdToUse) },
  ];

  if (playerIdToUse) {
    probes.push({
      name: 'player_events_previous_p0',
      fn: () => BackendTennisApi.getPlayerPreviousEvents(playerIdToUse, 0),
    });
  }

  for (const p of probes) {
    const data = await p.fn();
    const bytes = payloadSize(data);
    console.log(`\n--- ${p.name} (${bytes} bytes) ---`);
    console.log(JSON.stringify(summarize(data, 3), null, 2));
  }

  console.log('\n=== RECOMMENDATION (recodexapicodeexamples / tennis_openapi.yaml) ===');
  console.log('Match list: GET /api/tennis/player/{id}/events/previous/{page} — paginated (page 0,1,2…), NOT per year');
  console.log('Per match full data: GET /api/tennis/event/{id}/statistics + /point-by-point (2 calls, no batch endpoint)');
  console.log('204 No Content = no stats/PBP for that match — cache miss marker, do not retry');
  console.log('Re-sync speed: bundlesOnly=true skips event pages; pool_cache stores each eventId once globally');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
