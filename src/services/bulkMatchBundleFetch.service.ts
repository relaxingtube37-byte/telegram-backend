/**
 * Bulk fetch cohort + on-disk bundle store for RapidAPI statistics + PBP.
 * One API call per resource per match (deduped by rapid_event_id).
 */

import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/connection';
import { ENV } from '../config/env';
import { Logger } from '../utils/logger';
import { PersistentPoolService } from './persistentPool.service';

const RAPID_HOST = 'tennisapi1.p.rapidapi.com';

export interface BulkFetchPlayerLink {
  tracked_player_id: number;
  rapid_player_id: number | null;
  full_name: string;
  current_rank: number | null;
  tour: string | null;
  historical_match_id: number | null;
  pmi_id: number;
  opponent_name: string;
  won: boolean;
  match_fingerprint: string;
}

export interface BulkFetchEventRow {
  rapid_event_id: number;
  match_date: string;
  tourney_name: string | null;
  surface: string | null;
  score: string | null;
  winner_name: string | null;
  loser_name: string | null;
  players: BulkFetchPlayerLink[];
}

export interface BulkFetchCohortOptions {
  fromDate?: string;
  toDate?: string;
  rankMax?: number;
  activeOnly?: boolean;
}

export interface BulkEventManifest {
  schema_version: 1;
  rapid_event_id: number;
  match_date: string;
  tourney_name: string | null;
  surface: string | null;
  score: string | null;
  winner_name: string | null;
  loser_name: string | null;
  tracked_players: BulkFetchPlayerLink[];
  fetched_at: string | null;
  statistics_status: 'pending' | 'ok' | 'empty' | 'error' | 'cached';
  pbp_status: 'pending' | 'ok' | 'empty' | 'error' | 'cached';
  details_status: 'pending' | 'ok' | 'empty' | 'error' | 'cached';
  statistics_bytes: number;
  pbp_bytes: number;
  details_bytes: number;
  api_periods: string[];
  pbp_set_count: number;
  start_timestamp: number | null;
  start_utc: string | null;
  tournament_name_api: string | null;
  round_name_api: string | null;
  errors: string[];
}

export interface BulkFetchProgressLine {
  rapid_event_id: number;
  at: string;
  statistics_status: BulkEventManifest['statistics_status'];
  pbp_status: BulkEventManifest['pbp_status'];
  api_calls: number;
}

export function listTopRankedTrackedEvents(options?: BulkFetchCohortOptions): BulkFetchEventRow[] {
  const fromDate = options?.fromDate ?? '2024-01-01';
  const toDate = options?.toDate ?? '2026-12-31';
  const rankMax = options?.rankMax ?? 200;
  const activeOnly = options?.activeOnly !== false;

  const rows = db
    .prepare(
      `
    SELECT
      pmi.id AS pmi_id,
      pmi.tracked_player_id,
      pmi.historical_match_id,
      pmi.match_fingerprint,
      pmi.match_date,
      pmi.opponent_name,
      pmi.won,
      pmi.tourney_name,
      pmi.surface,
      pmi.score,
      COALESCE(pmi.rapid_event_id, h.rapid_event_id) AS rapid_event_id,
      tp.full_name,
      tp.current_rank,
      tp.rapid_player_id,
      tp.tour,
      h.winner_name,
      h.loser_name
    FROM player_match_index pmi
    INNER JOIN tracked_players tp ON tp.id = pmi.tracked_player_id
    LEFT JOIN historical_matches h ON h.id = pmi.historical_match_id
    WHERE pmi.match_date >= @fromDate
      AND pmi.match_date <= @toDate
      AND tp.current_rank IS NOT NULL
      AND tp.current_rank <= @rankMax
      ${activeOnly ? 'AND tp.is_active = 1' : ''}
      AND COALESCE(pmi.rapid_event_id, h.rapid_event_id) IS NOT NULL
    ORDER BY pmi.match_date ASC, rapid_event_id ASC
  `,
    )
    .all({ fromDate, toDate, rankMax }) as Array<{
    pmi_id: number;
    tracked_player_id: number;
    historical_match_id: number | null;
    match_fingerprint: string;
    match_date: string;
    opponent_name: string;
    won: number;
    tourney_name: string | null;
    surface: string | null;
    score: string | null;
    rapid_event_id: number;
    full_name: string;
    current_rank: number | null;
    rapid_player_id: number | null;
    tour: string | null;
    winner_name: string | null;
    loser_name: string | null;
  }>;

  const byEvent = new Map<number, BulkFetchEventRow>();

  for (const row of rows) {
    const link: BulkFetchPlayerLink = {
      tracked_player_id: row.tracked_player_id,
      rapid_player_id: row.rapid_player_id,
      full_name: row.full_name,
      current_rank: row.current_rank,
      tour: row.tour,
      historical_match_id: row.historical_match_id,
      pmi_id: row.pmi_id,
      opponent_name: row.opponent_name,
      won: row.won === 1,
      match_fingerprint: row.match_fingerprint,
    };

    const existing = byEvent.get(row.rapid_event_id);
    if (!existing) {
      byEvent.set(row.rapid_event_id, {
        rapid_event_id: row.rapid_event_id,
        match_date: row.match_date,
        tourney_name: row.tourney_name,
        surface: row.surface,
        score: row.score,
        winner_name: row.winner_name,
        loser_name: row.loser_name,
        players: [link],
      });
      continue;
    }

    const already = existing.players.some(
      (p) => p.tracked_player_id === link.tracked_player_id && p.match_fingerprint === link.match_fingerprint,
    );
    if (!already) existing.players.push(link);
  }

  return [...byEvent.values()].sort((a, b) =>
    a.match_date === b.match_date ? a.rapid_event_id - b.rapid_event_id : a.match_date.localeCompare(b.match_date),
  );
}

export function summarizeBulkCohort(events: BulkFetchEventRow[]) {
  const playerIds = new Set<number>();
  let playerLinks = 0;
  for (const ev of events) {
    playerLinks += ev.players.length;
    for (const p of ev.players) playerIds.add(p.tracked_player_id);
  }
  return {
    distinctEvents: events.length,
    playerLinks,
    distinctTrackedPlayers: playerIds.size,
    apiCallsNeeded: events.length * 3,
    estimatedMinutesAt8PerSec: Math.ceil((events.length * 3) / 8 / 60),
  };
}

function atomicWriteJson(filePath: string, payload: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function appendNdjson(filePath: string, line: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(line)}\n`, 'utf8');
}

export class BulkBundleStore {
  constructor(private readonly rootDir: string) {
    fs.mkdirSync(rootDir, { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'events'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'indexes'), { recursive: true });
  }

  eventDir(eventId: number): string {
    return path.join(this.rootDir, 'events', String(eventId));
  }

  manifestPath(eventId: number): string {
    return path.join(this.eventDir(eventId), 'manifest.json');
  }

  statisticsPath(eventId: number): string {
    return path.join(this.eventDir(eventId), 'statistics.json');
  }

  pbpPath(eventId: number): string {
    return path.join(this.eventDir(eventId), 'point_by_point.json');
  }

  detailsPath(eventId: number): string {
    return path.join(this.eventDir(eventId), 'event_details.json');
  }

  readManifest(eventId: number): BulkEventManifest | null {
    const p = this.manifestPath(eventId);
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')) as BulkEventManifest;
    } catch {
      return null;
    }
  }

  /** True only when statistics.json or point_by_point.json actually exists on disk. */
  isComplete(eventId: number): boolean {
    const dir = this.eventDir(eventId);
    return (
      fs.existsSync(path.join(dir, 'statistics.json')) ||
      fs.existsSync(path.join(dir, 'point_by_point.json'))
    );
  }

  /**
   * Returns event IDs that have real statistics or PBP files on disk.
   * Super fast because it uses fs.existsSync without reading/parsing JSON.
   */
  loadCompletedEventIds(): Set<number> {
    const done = new Set<number>();
    const eventsRoot = path.join(this.rootDir, 'events');
    if (!fs.existsSync(eventsRoot)) return done;
    for (const name of fs.readdirSync(eventsRoot)) {
      const id = Number(name);
      if (!Number.isFinite(id)) continue;
      const dir = path.join(eventsRoot, name);
      if (
        fs.existsSync(path.join(dir, 'statistics.json')) ||
        fs.existsSync(path.join(dir, 'point_by_point.json'))
      ) {
        done.add(id);
      }
    }
    return done;
  }

  writeSeedManifest(event: BulkFetchEventRow): BulkEventManifest {
    const manifest: BulkEventManifest = {
      schema_version: 1,
      rapid_event_id: event.rapid_event_id,
      match_date: event.match_date,
      tourney_name: event.tourney_name,
      surface: event.surface,
      score: event.score,
      winner_name: event.winner_name,
      loser_name: event.loser_name,
      tracked_players: event.players,
      fetched_at: null,
      statistics_status: 'pending',
      pbp_status: 'pending',
      details_status: 'pending',
      statistics_bytes: 0,
      pbp_bytes: 0,
      details_bytes: 0,
      api_periods: [],
      pbp_set_count: 0,
      start_timestamp: null,
      start_utc: null,
      tournament_name_api: null,
      round_name_api: null,
      errors: [],
    };
    atomicWriteJson(this.manifestPath(event.rapid_event_id), manifest);
    return manifest;
  }

  saveBundle(
    event: BulkFetchEventRow,
    statistics: unknown | null,
    pbp: unknown | null,
    details: unknown | null,
    meta: {
      statistics_status: BulkEventManifest['statistics_status'];
      pbp_status: BulkEventManifest['pbp_status'];
      details_status: BulkEventManifest['details_status'];
      errors?: string[];
    },
  ): BulkEventManifest {
    const dir = this.eventDir(event.rapid_event_id);
    fs.mkdirSync(dir, { recursive: true });

    let statisticsBytes = 0;
    let pbpBytes = 0;
    let detailsBytes = 0;

    if (statistics !== null && statistics !== undefined) {
      const statsPath = this.statisticsPath(event.rapid_event_id);
      atomicWriteJson(statsPath, statistics);
      statisticsBytes = fs.statSync(statsPath).size;
    }

    if (pbp !== null && pbp !== undefined) {
      const pbpFile = this.pbpPath(event.rapid_event_id);
      atomicWriteJson(pbpFile, pbp);
      pbpBytes = fs.statSync(pbpFile).size;
    }

    if (details !== null && details !== undefined) {
      const detailsFile = this.detailsPath(event.rapid_event_id);
      atomicWriteJson(detailsFile, details);
      detailsBytes = fs.statSync(detailsFile).size;
    }

    const apiPeriods =
      (statistics as { statistics?: Array<{ period?: string }> })?.statistics?.map((p) => p.period || '').filter(Boolean) ||
      [];
    const pbpSetCount = (pbp as { pointByPoint?: unknown[] })?.pointByPoint?.length || 0;
    const ev = (details as { event?: { startTimestamp?: number; tournament?: { name?: string }; roundInfo?: { name?: string } } })
      ?.event;
    const startTs = ev?.startTimestamp ?? null;

    const manifest: BulkEventManifest = {
      schema_version: 1,
      rapid_event_id: event.rapid_event_id,
      match_date: event.match_date,
      tourney_name: event.tourney_name,
      surface: event.surface,
      score: event.score,
      winner_name: event.winner_name,
      loser_name: event.loser_name,
      tracked_players: event.players,
      fetched_at: new Date().toISOString(),
      statistics_status: meta.statistics_status,
      pbp_status: meta.pbp_status,
      details_status: meta.details_status,
      statistics_bytes: statisticsBytes,
      pbp_bytes: pbpBytes,
      details_bytes: detailsBytes,
      api_periods: apiPeriods,
      pbp_set_count: pbpSetCount,
      start_timestamp: startTs,
      start_utc: startTs ? new Date(startTs * 1000).toISOString() : null,
      tournament_name_api: ev?.tournament?.name ?? null,
      round_name_api: ev?.roundInfo?.name ?? null,
      errors: meta.errors ?? [],
    };

    atomicWriteJson(this.manifestPath(event.rapid_event_id), manifest);
    return manifest;
  }

  appendProgress(line: BulkFetchProgressLine): void {
    appendNdjson(path.join(this.rootDir, 'progress.ndjson'), line);
  }

  writeRunManifest(payload: Record<string, unknown>): void {
    atomicWriteJson(path.join(this.rootDir, 'run-manifest.json'), payload);
  }

  rebuildPlayerIndex(events: BulkFetchEventRow[]): void {
    const byPlayer = new Map<number, { full_name: string; current_rank: number | null; tour: string | null; events: number[] }>();

    for (const ev of events) {
      for (const p of ev.players) {
        const cur = byPlayer.get(p.tracked_player_id) ?? {
          full_name: p.full_name,
          current_rank: p.current_rank,
          tour: p.tour,
          events: [],
        };
        if (!cur.events.includes(ev.rapid_event_id)) cur.events.push(ev.rapid_event_id);
        byPlayer.set(p.tracked_player_id, cur);
      }
    }

    const playersDir = path.join(this.rootDir, 'indexes', 'by-player');
    fs.mkdirSync(playersDir, { recursive: true });

    for (const [playerId, info] of byPlayer) {
      atomicWriteJson(path.join(playersDir, `${playerId}.json`), {
        tracked_player_id: playerId,
        full_name: info.full_name,
        current_rank: info.current_rank,
        tour: info.tour,
        rapid_event_ids: info.events.sort((a, b) => a - b),
        event_count: info.events.length,
      });
    }

    atomicWriteJson(path.join(this.rootDir, 'indexes', 'events-index.json'), {
      generated_at: new Date().toISOString(),
      event_count: events.length,
      events: events.map((e) => ({
        rapid_event_id: e.rapid_event_id,
        match_date: e.match_date,
        tracked_player_ids: e.players.map((p) => p.tracked_player_id),
        manifest: `events/${e.rapid_event_id}/manifest.json`,
      })),
    });
  }
}

export class RateLimitedTennisClient {
  private readonly timestamps: number[] = [];

  constructor(private readonly maxPerSec: number) {}

  /** Rolling 1-second window — up to maxPerSec request starts even when responses overlap. */
  private async reserveSlot(): Promise<void> {
    while (true) {
      const now = Date.now();
      while (this.timestamps.length > 0 && now - this.timestamps[0] >= 1000) {
        this.timestamps.shift();
      }
      if (this.timestamps.length < this.maxPerSec) {
        this.timestamps.push(now);
        return;
      }
      const wait = 1000 - (now - this.timestamps[0]) + 5;
      await new Promise((r) => setTimeout(r, Math.max(wait, 10)));
    }
  }

  private async request<T>(endpoint: string, maxRetries = 3): Promise<T | null> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await this.reserveSlot();
      try {
        const url = `https://${RAPID_HOST}${endpoint}`;
        const res = await fetch(url, {
          headers: {
            'x-rapidapi-key': ENV.RAPIDAPI_KEY,
            'x-rapidapi-host': RAPID_HOST,
          },
          signal: AbortSignal.timeout(15_000),
        });

        if (res.status === 429) {
          // Rate limited — exponential backoff
          const backoff = 1500 * Math.pow(2, attempt);
          Logger.warn(`[BulkFetch] 429 on ${endpoint} — backoff ${backoff}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }

        if (res.status === 204) return null;
        if (!res.ok) {
          if (attempt < maxRetries) {
            const backoff = 600 * Math.pow(2, attempt);
            Logger.warn(`[BulkFetch] HTTP ${res.status} on ${endpoint} — retry in ${backoff}ms`);
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }
          Logger.warn(`[BulkFetch] HTTP ${res.status} on ${endpoint} — giving up`);
          return null;
        }

        const text = await res.text();
        if (!text.trim()) return null;
        return JSON.parse(text) as T;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt < maxRetries) {
          const backoff = 600 * Math.pow(2, attempt);
          Logger.warn(`[BulkFetch] error on ${endpoint}: ${msg} — retry in ${backoff}ms`);
          await new Promise((r) => setTimeout(r, backoff));
        } else {
          Logger.warn(`[BulkFetch] failed ${endpoint} after ${maxRetries + 1} attempts: ${msg}`);
        }
      }
    }
    return null;
  }

  getEventStatistics(eventId: number): Promise<unknown | null> {
    return this.request(`/api/tennis/event/${eventId}/statistics`);
  }

  getEventPointByPoint(eventId: number): Promise<unknown | null> {
    return this.request(`/api/tennis/event/${eventId}/point-by-point`);
  }

  getEventDetails(eventId: number): Promise<unknown | null> {
    return this.request(`/api/tennis/event/${eventId}`);
  }

  getRankings(tour: 'atp' | 'wta'): Promise<unknown | null> {
    return this.request(`/api/tennis/rankings/${tour}`);
  }

  getPlayerPreviousEvents(playerId: number, page: number): Promise<unknown | null> {
    return this.request(`/api/tennis/player/${playerId}/events/previous/${page}`);
  }
}

export function readPoolStatistics(eventId: number): unknown | null {
  return PersistentPoolService.get(PersistentPoolService.buildKey('event_statistics', [eventId]));
}

export function readPoolPbp(eventId: number): unknown | null {
  return PersistentPoolService.get(PersistentPoolService.buildKey('event_pbp', [eventId]));
}

export async function fetchEventBundle(
  client: RateLimitedTennisClient,
  store: BulkBundleStore,
  event: BulkFetchEventRow,
  options?: { shouldStop?: () => boolean; usePoolCache?: boolean },
): Promise<{ apiCalls: number; statistics_status: string; pbp_status: string; details_status: string }> {
  if (options?.shouldStop?.()) {
    return { apiCalls: 0, statistics_status: 'pending', pbp_status: 'pending', details_status: 'pending' };
  }

  const errors: string[] = [];
  let apiCalls = 0;

  const statsPath = store.statisticsPath(event.rapid_event_id);
  const pbpPath = store.pbpPath(event.rapid_event_id);
  const detailsPath = store.detailsPath(event.rapid_event_id);

  let statistics: unknown | null = null;
  let pbp: unknown | null = null;
  let details: unknown | null = null;
  let statistics_status: BulkEventManifest['statistics_status'] = 'empty';
  let pbp_status: BulkEventManifest['pbp_status'] = 'empty';
  let details_status: BulkEventManifest['details_status'] = 'empty';

  // Load from disk if files actually exist
  if (fs.existsSync(statsPath)) {
    try {
      statistics = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
      statistics_status = 'ok';
    } catch { /* ignore */ }
  }
  if (fs.existsSync(pbpPath)) {
    try {
      pbp = JSON.parse(fs.readFileSync(pbpPath, 'utf8'));
      pbp_status = 'ok';
    } catch { /* ignore */ }
  }
  if (fs.existsSync(detailsPath)) {
    try {
      details = JSON.parse(fs.readFileSync(detailsPath, 'utf8'));
      details_status = 'ok';
    } catch { /* ignore */ }
  }

  if (options?.usePoolCache) {
    if (!statistics) {
      statistics = readPoolStatistics(event.rapid_event_id);
      if (statistics) statistics_status = 'cached';
    }
    if (!pbp) {
      pbp = readPoolPbp(event.rapid_event_id);
      if (pbp) pbp_status = 'cached';
    }
  }

  if (!options?.shouldStop?.()) {
    const fetches: Promise<void>[] = [];

    if (!details) {
      fetches.push(
        (async () => {
          details = await client.getEventDetails(event.rapid_event_id);
          apiCalls++;
          details_status = (details as { event?: { id?: number } })?.event?.id ? 'ok' : 'empty';
          if (details_status === 'empty') errors.push('details_empty');
        })(),
      );
    }

    if (!statistics) {
      fetches.push(
        (async () => {
          statistics = await client.getEventStatistics(event.rapid_event_id);
          apiCalls++;
          statistics_status = statistics ? 'ok' : 'empty';
          if (!statistics) errors.push('statistics_empty');
        })(),
      );
    }

    if (!pbp) {
      fetches.push(
        (async () => {
          pbp = await client.getEventPointByPoint(event.rapid_event_id);
          apiCalls++;
          pbp_status = pbp ? 'ok' : 'empty';
          if (!pbp) errors.push('pbp_empty');
        })(),
      );
    }

    if (fetches.length > 0) await Promise.all(fetches);
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

  return { apiCalls, statistics_status, pbp_status, details_status };
}
