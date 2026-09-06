/**
 * Bulk fetch: top-200 ATP + WTA from live rankings, then paginated match history per player.
 * Saves to disk for later DB import (correct rapid_event_id from API).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { BulkFetchEventRow } from './bulkMatchBundleFetch.service';
import { eventLooksFinished, formatEventScore } from './rapidEventMapper';
import { RateLimitedTennisClient } from './bulkMatchBundleFetch.service';

export interface RankedPlayer {
  rapid_player_id: number;
  full_name: string;
  short_name: string | null;
  country_code: string | null;
  tour: 'ATP' | 'WTA';
  gender: 'M' | 'F';
  current_rank: number;
  ranking_points: number | null;
}

export interface CompactPlayerEvent {
  rapid_event_id: number;
  rapid_player_id: number;
  player_name: string;
  tour: 'ATP' | 'WTA';
  match_date: string;
  start_timestamp: number | null;
  start_utc: string | null;
  home_name: string;
  away_name: string;
  home_id: number | null;
  away_id: number | null;
  winner_code: number | null;
  score: string;
  tournament_name: string | null;
  tournament_id: string | null;
  round_name: string | null;
  surface: string | null;
  status: string | null;
  player_side: 'home' | 'away' | null;
  player_won: boolean | null;
  opponent_name: string | null;
}

export interface PlayerHistoryManifest {
  schema_version: 1;
  rapid_player_id: number;
  full_name: string;
  tour: 'ATP' | 'WTA';
  current_rank: number;
  from_date: string;
  to_date: string;
  pages_fetched: number;
  events_in_window: number;
  oldest_match_date: string | null;
  newest_match_date: string | null;
  fetched_at: string | null;
  api_calls: number;
  stopped_reason: 'has_next_false' | 'empty_page' | 'before_from_date' | 'max_pages' | 'api_error' | 'user_stop' | null;
}

function atomicWriteJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function appendNdjson(filePath: string, line: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(line)}\n`, 'utf8');
}

function parseRankingRow(raw: Record<string, unknown>, tour: 'ATP' | 'WTA'): RankedPlayer | null {
  const team = (raw.team || raw.player || raw) as Record<string, unknown>;
  const rapid_player_id = Number(team.id || raw.id || 0);
  const full_name = String(team.name || raw.name || '').trim();
  if (!rapid_player_id || !full_name) return null;

  return {
    rapid_player_id,
    full_name,
    short_name: String(team.shortName || '').trim() || null,
    country_code: String((team.country as { alpha2?: string })?.alpha2 || '').trim() || null,
    tour,
    gender: tour === 'WTA' ? 'F' : 'M',
    current_rank: Number(raw.ranking || team.ranking || 0),
    ranking_points: Number(raw.points || raw.rankingPoints || 0) || null,
  };
}

export async function fetchTopRankedPlayers(
  client: RateLimitedTennisClient,
  limitPerTour: number,
): Promise<{ atp: RankedPlayer[]; wta: RankedPlayer[]; apiCalls: number }> {
  let apiCalls = 0;
  const out: { atp: RankedPlayer[]; wta: RankedPlayer[] } = { atp: [], wta: [] };

  for (const tour of ['atp', 'wta'] as const) {
    const payload = await client.getRankings(tour);
    apiCalls++;
    const rows = (payload as { rankings?: Record<string, unknown>[] })?.rankings || [];
    const mapped = rows
      .slice(0, limitPerTour)
      .map((row) => parseRankingRow(row, tour === 'atp' ? 'ATP' : 'WTA'))
      .filter((p): p is RankedPlayer => Boolean(p));
    out[tour] = mapped;
  }

  return { ...out, apiCalls };
}

function compactEvent(ev: Record<string, unknown>, player: RankedPlayer): CompactPlayerEvent | null {
  if (!ev?.id || !eventLooksFinished(ev)) return null;

  const homeName = String((ev.homeTeam as { name?: string })?.name || (ev.home as { name?: string })?.name || '').trim();
  const awayName = String((ev.awayTeam as { name?: string })?.name || (ev.away as { name?: string })?.name || '').trim();
  if (!homeName || !awayName) return null;

  const homeId = Number((ev.homeTeam as { id?: number })?.id || (ev.home as { id?: number })?.id || 0) || null;
  const awayId = Number((ev.awayTeam as { id?: number })?.id || (ev.away as { id?: number })?.id || 0) || null;
  const startTs = Number(ev.startTimestamp || 0) || null;
  const matchDate = startTs ? new Date(startTs * 1000).toISOString().slice(0, 10) : '';

  let playerSide: 'home' | 'away' | null = null;
  if (player.rapid_player_id === homeId) playerSide = 'home';
  else if (player.rapid_player_id === awayId) playerSide = 'away';

  const winnerCode = Number(ev.winnerCode || 0) || null;
  let playerWon: boolean | null = null;
  if (playerSide === 'home' && winnerCode) playerWon = winnerCode === 1;
  if (playerSide === 'away' && winnerCode) playerWon = winnerCode === 2;

  const opponentName = playerSide === 'home' ? awayName : playerSide === 'away' ? homeName : null;

  return {
    rapid_event_id: Number(ev.id),
    rapid_player_id: player.rapid_player_id,
    player_name: player.full_name,
    tour: player.tour,
    match_date: matchDate,
    start_timestamp: startTs,
    start_utc: startTs ? new Date(startTs * 1000).toISOString() : null,
    home_name: homeName,
    away_name: awayName,
    home_id: homeId,
    away_id: awayId,
    winner_code: winnerCode,
    score: formatEventScore(ev),
    tournament_name: String(
      (ev.tournament as { name?: string })?.name ||
        (ev.tournament as { uniqueTournament?: { name?: string } })?.uniqueTournament?.name ||
        '',
    ) || null,
    tournament_id: String(
      (ev.tournament as { uniqueTournament?: { id?: number } })?.uniqueTournament?.id ||
        (ev.tournament as { id?: number })?.id ||
        '',
    ) || null,
    round_name: String((ev.roundInfo as { name?: string })?.name || '') || null,
    surface: String(ev.groundType || (ev.tournament as { uniqueTournament?: { groundType?: string } })?.uniqueTournament?.groundType || '') || null,
    status: String((ev.status as { type?: string })?.type || '') || null,
    player_side: playerSide,
    player_won: playerWon,
    opponent_name: opponentName,
  };
}

export interface FetchPlayerHistoryOptions {
  fromDate: string;
  toDate: string;
  maxPages?: number;
  saveRawPages?: boolean;
  shouldStop?: () => boolean;
}

export interface FetchPlayerHistoryResult {
  manifest: PlayerHistoryManifest;
  events: CompactPlayerEvent[];
  rawPages: Array<{ page: number; payload: unknown }>;
  apiCalls: number;
}

export async function fetchPlayerMatchHistory(
  client: RateLimitedTennisClient,
  player: RankedPlayer,
  options: FetchPlayerHistoryOptions,
): Promise<FetchPlayerHistoryResult> {
  const events: CompactPlayerEvent[] = [];
  const rawPages: Array<{ page: number; payload: unknown }> = [];
  let apiCalls = 0;
  let page = 0;
  let stopped_reason: PlayerHistoryManifest['stopped_reason'] = null;
  const maxPages = options.maxPages ?? 200;
  let pagesFetched = 0;

  while (page < maxPages) {
    if (options.shouldStop?.()) {
      stopped_reason = 'user_stop';
      break;
    }

    const payload = await client.getPlayerPreviousEvents(player.rapid_player_id, page);
    apiCalls++;

    if (!payload) {
      stopped_reason = 'api_error';
      break;
    }

    pagesFetched++;
    if (options.saveRawPages) rawPages.push({ page, payload });

    const rawEvents = (payload as { events?: Record<string, unknown>[] }).events || [];
    if (!rawEvents.length) {
      stopped_reason = 'empty_page';
      break;
    }

    let oldestOnPage = '';
    for (const ev of rawEvents) {
      const compact = compactEvent(ev, player);
      if (!compact || !compact.match_date) continue;
      oldestOnPage = compact.match_date;
      if (compact.match_date < options.fromDate) continue;
      if (compact.match_date > options.toDate) continue;
      events.push(compact);
    }

    const hasNext = Boolean((payload as { hasNextPage?: boolean }).hasNextPage);
    if (!hasNext) {
      stopped_reason = 'has_next_false';
      break;
    }

    if (oldestOnPage && oldestOnPage < options.fromDate) {
      stopped_reason = 'before_from_date';
      break;
    }

    page++;
  }

  if (page >= maxPages && stopped_reason === null) stopped_reason = 'max_pages';

  const dates = events.map((e) => e.match_date).sort();

  const manifest: PlayerHistoryManifest = {
    schema_version: 1,
    rapid_player_id: player.rapid_player_id,
    full_name: player.full_name,
    tour: player.tour,
    current_rank: player.current_rank,
    from_date: options.fromDate,
    to_date: options.toDate,
    pages_fetched: pagesFetched,
    events_in_window: events.length,
    oldest_match_date: dates[0] || null,
    newest_match_date: dates[dates.length - 1] || null,
    fetched_at: new Date().toISOString(),
    api_calls: apiCalls,
    stopped_reason,
  };

  return { manifest, events, rawPages, apiCalls };
}

export class BulkPlayerHistoryStore {
  constructor(private readonly rootDir: string) {
    fs.mkdirSync(rootDir, { recursive: true });
  }

  rankingsPath(tour: 'atp' | 'wta'): string {
    return path.join(this.rootDir, 'rankings', `${tour}-top200.json`);
  }

  playerDir(rapidPlayerId: number): string {
    return path.join(this.rootDir, 'players', String(rapidPlayerId));
  }

  saveRankings(tour: 'atp' | 'wta', players: RankedPlayer[]): void {
    atomicWriteJson(this.rankingsPath(tour), {
      fetched_at: new Date().toISOString(),
      tour: tour.toUpperCase(),
      count: players.length,
      players,
    });
  }

  savePlayerBundle(
    player: RankedPlayer,
    manifest: PlayerHistoryManifest,
    events: CompactPlayerEvent[],
    rawPages?: Array<{ page: number; payload: unknown }>,
  ): void {
    const dir = this.playerDir(player.rapid_player_id);
    fs.mkdirSync(dir, { recursive: true });
    atomicWriteJson(path.join(dir, 'manifest.json'), manifest);

    const eventsPath = path.join(dir, 'events.jsonl');
    fs.writeFileSync(eventsPath, '', 'utf8');
    for (const ev of events) appendNdjson(eventsPath, ev);

    if (rawPages?.length) {
      const pagesDir = path.join(dir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      for (const row of rawPages) {
        atomicWriteJson(path.join(pagesDir, `page-${String(row.page).padStart(3, '0')}.raw.json`), row.payload);
      }
    }
  }

  isPlayerComplete(rapidPlayerId: number): boolean {
    const manifestPath = path.join(this.playerDir(rapidPlayerId), 'manifest.json');
    return fs.existsSync(manifestPath);
  }

  loadCompletedPlayerIds(): Set<number> {
    const done = new Set<number>();
    const playersRoot = path.join(this.rootDir, 'players');
    if (!fs.existsSync(playersRoot)) return done;
    for (const name of fs.readdirSync(playersRoot)) {
      const id = Number(name);
      if (Number.isFinite(id) && this.isPlayerComplete(id)) done.add(id);
    }
    return done;
  }

  appendProgress(line: Record<string, unknown>): void {
    appendNdjson(path.join(this.rootDir, 'progress.ndjson'), line);
  }

  writeRunManifest(payload: Record<string, unknown>): void {
    atomicWriteJson(path.join(this.rootDir, 'run-manifest.json'), payload);
  }

  rebuildGlobalEventIndex(players: RankedPlayer[]): void {
    const byEvent = new Map<number, CompactPlayerEvent & { linked_players: Array<{ rapid_player_id: number; full_name: string }> }>();

    for (const player of players) {
      const eventsPath = path.join(this.playerDir(player.rapid_player_id), 'events.jsonl');
      if (!fs.existsSync(eventsPath)) continue;
      const lines = fs.readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        const ev = JSON.parse(line) as CompactPlayerEvent;
        const existing = byEvent.get(ev.rapid_event_id);
        if (!existing) {
          byEvent.set(ev.rapid_event_id, {
            ...ev,
            linked_players: [{ rapid_player_id: player.rapid_player_id, full_name: player.full_name }],
          });
          continue;
        }
        if (!existing.linked_players.some((p) => p.rapid_player_id === player.rapid_player_id)) {
          existing.linked_players.push({ rapid_player_id: player.rapid_player_id, full_name: player.full_name });
        }
      }
    }

    const events = [...byEvent.values()].sort((a, b) =>
      a.match_date === b.match_date ? a.rapid_event_id - b.rapid_event_id : a.match_date.localeCompare(b.match_date),
    );

    atomicWriteJson(path.join(this.rootDir, 'indexes', 'all-events.json'), {
      generated_at: new Date().toISOString(),
      distinct_events: events.length,
      events,
    });
  }
}

export function estimateHistoryFetch(players: RankedPlayer[], avgPagesPerPlayer = 9): Record<string, number | string> {
  const apiCalls = 2 + players.length * avgPagesPerPlayer;
  return {
    players: players.length,
    estimated_pages_total: players.length * avgPagesPerPlayer,
    estimated_api_calls: apiCalls,
    estimated_minutes_at_8_per_sec: Math.ceil(apiCalls / 8 / 60),
  };
}

/** Fast read of distinct_events from index header (avoids parsing the full JSON). */
export function readDistinctEventCount(historyDir: string): number {
  const indexPath = path.join(historyDir, 'indexes', 'all-events.json');
  if (!fs.existsSync(indexPath)) return 0;
  const fd = fs.openSync(indexPath, 'r');
  try {
    const buf = Buffer.alloc(512);
    const bytes = fs.readSync(fd, buf, 0, 512, 0);
    const match = buf.subarray(0, bytes).toString('utf8').match(/"distinct_events"\s*:\s*(\d+)/);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  } finally {
    fs.closeSync(fd);
  }
}

/** Load deduped events saved during phase 1 (player history). */
export function listEventsFromPlayerHistory(historyDir: string): BulkFetchEventRow[] {
  const byEvent = new Map<number, BulkFetchEventRow>();

  const ingest = (ev: CompactPlayerEvent & { linked_players?: Array<{ rapid_player_id: number; full_name: string }> }) => {
    if (!ev.rapid_event_id) return;
    const players = (ev.linked_players || [{ rapid_player_id: ev.rapid_player_id, full_name: ev.player_name }]).map(
      (p) => ({
        tracked_player_id: p.rapid_player_id,
        rapid_player_id: p.rapid_player_id,
        full_name: p.full_name,
        current_rank: null,
        tour: ev.tour,
        historical_match_id: null,
        pmi_id: 0,
        opponent_name: ev.opponent_name || '',
        won: ev.player_won ?? false,
        match_fingerprint: `${ev.rapid_event_id}:${p.rapid_player_id}`,
      }),
    );

    const row: BulkFetchEventRow = {
      rapid_event_id: ev.rapid_event_id,
      match_date: ev.match_date,
      tourney_name: ev.tournament_name,
      surface: ev.surface,
      score: ev.score,
      winner_name: ev.player_won === true ? ev.player_name : ev.opponent_name,
      loser_name: ev.player_won === false ? ev.player_name : ev.opponent_name,
      players,
    };

    const existing = byEvent.get(ev.rapid_event_id);
    if (!existing) {
      byEvent.set(ev.rapid_event_id, row);
      return;
    }
    for (const p of players) {
      if (!existing.players.some((x) => x.tracked_player_id === p.tracked_player_id)) {
        existing.players.push(p);
      }
    }
  };

  const playersRoot = path.join(historyDir, 'players');
  if (fs.existsSync(playersRoot)) {
    for (const name of fs.readdirSync(playersRoot)) {
      if (!/^\d+$/.test(name)) continue;
      const eventsPath = path.join(playersRoot, name, 'events.jsonl');
      if (!fs.existsSync(eventsPath)) continue;
      for (const line of fs.readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean)) {
        ingest(JSON.parse(line) as CompactPlayerEvent);
      }
    }
  } else {
    const indexPath = path.join(historyDir, 'indexes', 'all-events.json');
    if (!fs.existsSync(indexPath)) return [];
    const data = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as {
      events?: Array<CompactPlayerEvent & { linked_players?: Array<{ rapid_player_id: number; full_name: string }> }>;
    };
    for (const ev of data.events || []) ingest(ev);
  }

  return [...byEvent.values()].sort((a, b) =>
    a.match_date === b.match_date ? a.rapid_event_id - b.rapid_event_id : a.match_date.localeCompare(b.match_date),
  );
}

export function defaultBundlesDir(historyDir: string): string {
  return path.join(path.dirname(historyDir), 'bulk-match-bundles');
}
