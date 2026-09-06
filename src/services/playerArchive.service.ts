import { BackendTennisApi } from '../dataPool/dataPool.tennisApi';
import { db } from '../db/connection';
import {
  PlayerMatchIndexRepo,
  type PlayerMatchIndexRow,
} from '../db/repositories/playerMatchIndex.repo';
import { TrackedPlayerRepo, type TrackedPlayerRow } from '../db/repositories/trackedPlayer.repo';
import {
  patchHistoricalMatchStats,
  upsertHistoricalMatchRecords,
  type HistoricalMatchRecord,
  type HistoricalMatchRow,
} from '../scripts/historicalMatchInsert';
import { buildMatchFingerprint, namesLikelyMatch, namesStrictMatch, normalizePlayerName, buildCsvNamePatterns, matchRichnessScore } from '../scripts/historicalMatchKeys';
import {
  bucketToPatch,
  eventPlayers,
  mapStatisticsToWinnerLoser,
} from '../scripts/rapidApiHistoricalEnrichment';
import { Logger } from '../utils/logger';
import {
  eventInvolvesPlayer,
  eventLooksFinished,
  mapRapidEventToHistoricalMatch,
} from './rapidEventMapper';
import { PersistentPoolService } from './persistentPool.service';
import {
  applyRankFromEventRecord,
  cacheEventListItem,
  enrichPlayerApiGaps,
  fillMissingRanksForPlayer,
  listPlayerDataGaps,
} from './incrementalApiEnrichment.service';
import { mergeApiMetadataOntoCsvRows } from './historicalMatchMerge.service';

export interface UnifiedSyncOptions {
  /** Default 2024-01-01 — API match history is reliable from ~2024 */
  sinceDate?: string;
  /** Max pages of events/previous (30 matches/page). 0 = until hasNextPage=false */
  maxPages?: number;
  linkCsv?: boolean;
  fetchBundles?: boolean;
  /** Max matches to fetch stats+PBP for. 0 = all incomplete */
  maxBundleFetches?: number;
  enrichCsvStats?: boolean;
  fetchAllPages?: boolean;
  /** Skip all API calls — link local CSV data to player tables only */
  csvOnly?: boolean;
  /** Skip events/previous pagination — only download missing stats+PBP (faster re-sync) */
  bundlesOnly?: boolean;
  /** Force re-scan all event pages even if previously completed */
  refreshEventPages?: boolean;
}

export interface UnifiedSyncResult {
  playerId: number;
  rapidPlayerId: number;
  pagesFetched: number;
  hasMorePages: boolean;
  eventsSeen: number;
  inserted: number;
  updated: number;
  skipped: number;
  csvLinked: number;
  bundlesFetched: number;
  bundlesSkippedCached: number;
  statsEnriched: number;
  indexSummary: ReturnType<typeof PlayerMatchIndexRepo.summaryForPlayer>;
  lastMatchDate: string | null;
}

function playerMatchesHistoricalRow(player: TrackedPlayerRow, row: HistoricalMatchRow): boolean {
  if (row.winner_id === player.rapid_player_id || row.loser_id === player.rapid_player_id) return true;
  return (
    namesStrictMatch(row.winner_name, player.full_name) || namesStrictMatch(row.loser_name, player.full_name)
  );
}

function buildCsvLinkSql(player: TrackedPlayerRow, sinceDate: string): { sql: string; params: Record<string, unknown> } {
  const normFull = normalizePlayerName(player.full_name);
  const lastName = normFull.split(' ').pop() || '';
  const patterns = buildCsvNamePatterns(player.full_name);
  const nameClauses: string[] = [];
  const params: Record<string, unknown> = {
    sinceDate,
    tour: player.tour,
    pid: player.rapid_player_id,
  };

  patterns.forEach((pattern, idx) => {
    const wKey = `wname${idx}`;
    const lKey = `lname${idx}`;
    nameClauses.push(
      `lower(replace(replace(winner_name, '.', ''), '  ', ' ')) = @${wKey}`,
      `lower(replace(replace(loser_name, '.', ''), '  ', ' ')) = @${lKey}`,
    );
    params[wKey] = pattern;
    params[lKey] = pattern;
  });

  // Unique longer last names can use a bounded LIKE prefilter (e.g. Sabalenka)
  if (lastName.length >= 5) {
    nameClauses.push(
      `lower(replace(replace(winner_name, '.', ''), '  ', ' ')) LIKE @likeLast`,
      `lower(replace(replace(loser_name, '.', ''), '  ', ' ')) LIKE @likeLast`,
    );
    params.likeLast = `%${lastName}%`;
  }

  const nameWhere = nameClauses.length ? `OR (${nameClauses.join(' OR ')})` : '';

  return {
    sql: `
    SELECT * FROM historical_matches
    WHERE match_date >= @sinceDate
      AND tour = @tour
      AND (
        winner_id = @pid OR loser_id = @pid
        ${nameWhere}
      )
    ORDER BY match_date DESC
  `,
    params,
  };
}

function findHistoricalRowId(record: HistoricalMatchRecord): number | null {
  if (record.rapid_event_id) {
    const byEvent = db
      .prepare('SELECT id FROM historical_matches WHERE rapid_event_id = ? LIMIT 1')
      .get(record.rapid_event_id) as { id: number } | undefined;
    if (byEvent?.id) return byEvent.id;
  }

  const row = db
    .prepare(
      `
    SELECT id FROM historical_matches
    WHERE tour = ? AND match_date = ? AND winner_name = ? AND loser_name = ?
    LIMIT 1
  `,
    )
    .get(record.tour, record.match_date, record.winner_name, record.loser_name) as { id: number } | undefined;

  return row?.id ?? null;
}

function poolHas(namespace: 'event_details' | 'event_statistics' | 'event_pbp', eventId: number): boolean {
  const key = PersistentPoolService.buildKey(namespace, [eventId]);
  return PersistentPoolService.get(key) !== null;
}

function eventsPagesCompleteKey(rapidPlayerId: number): string {
  return `tracked_player_events_complete_${rapidPlayerId}`;
}

function readEventsPagesComplete(rapidPlayerId: number): boolean {
  const row = db
    .prepare('SELECT value FROM ingestion_sync_state WHERE key = ?')
    .get(eventsPagesCompleteKey(rapidPlayerId)) as { value: string } | undefined;
  return row?.value === 'true';
}

function writeEventsPagesComplete(rapidPlayerId: number, complete: boolean): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO ingestion_sync_state (key, value, updated_at)
    VALUES (@key, @value, @updated_at)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `,
  ).run({
    key: eventsPagesCompleteKey(rapidPlayerId),
    value: complete ? 'true' : 'false',
    updated_at: now,
  });
}

export async function ensureEventStatsAndPbp(
  rapidEventId: number,
  options?: { forceRefresh?: boolean },
): Promise<{ hasStatistics: boolean; hasPbp: boolean; fromCache: boolean; fetched: boolean }> {
  let fromCache = true;
  let fetched = false;
  const flags = { hasStatistics: false, hasPbp: false };

  const tasks: Array<{
    namespace: 'event_statistics' | 'event_pbp';
    fetcher: () => Promise<unknown>;
    flag: keyof typeof flags;
  }> = [
    { namespace: 'event_statistics', fetcher: () => BackendTennisApi.getEventStatistics(rapidEventId), flag: 'hasStatistics' },
    { namespace: 'event_pbp', fetcher: () => BackendTennisApi.getEventPointByPoint(rapidEventId), flag: 'hasPbp' },
  ];

  for (const task of tasks) {
    const key = PersistentPoolService.buildKey(task.namespace, [rapidEventId]);
    const had = poolHas(task.namespace, rapidEventId);
    const result = await PersistentPoolService.getOrFetch(key, task.namespace, task.fetcher, {
      permanent: true,
      forceRefresh: options?.forceRefresh,
      cacheNullAsMiss: true,
    });
    if (result.data) flags[task.flag] = true;
    if (!had && result.fetched) {
      fromCache = false;
      fetched = true;
    }
  }

  return { ...flags, fromCache, fetched };
}

export async function ensureEventDataBundle(
  rapidEventId: number,
  options?: { forceRefresh?: boolean },
): Promise<{ hasDetails: boolean; hasStatistics: boolean; hasPbp: boolean; fromCache: string[]; fetched: string[] }> {
  const fromCache: string[] = [];
  const fetched: string[] = [];
  const flags = { hasDetails: false, hasStatistics: false, hasPbp: false };

  const tasks: Array<{
    label: string;
    namespace: 'event_details' | 'event_statistics' | 'event_pbp';
    fetcher: () => Promise<unknown>;
    flag: keyof typeof flags;
  }> = [
    {
      label: 'details',
      namespace: 'event_details',
      fetcher: () => BackendTennisApi.getEventDetails(rapidEventId),
      flag: 'hasDetails',
    },
    {
      label: 'statistics',
      namespace: 'event_statistics',
      fetcher: () => BackendTennisApi.getEventStatistics(rapidEventId),
      flag: 'hasStatistics',
    },
    {
      label: 'pbp',
      namespace: 'event_pbp',
      fetcher: () => BackendTennisApi.getEventPointByPoint(rapidEventId),
      flag: 'hasPbp',
    },
  ];

  for (const task of tasks) {
    const key = PersistentPoolService.buildKey(task.namespace, [rapidEventId]);
    const before = poolHas(task.namespace, rapidEventId);
    const result = await PersistentPoolService.getOrFetch(key, task.namespace, task.fetcher, {
      permanent: true,
      forceRefresh: options?.forceRefresh,
      cacheNullAsMiss: true,
    });
    if (result.data) {
      flags[task.flag] = true;
    }
    if (before || result.fromCache) fromCache.push(task.label);
    else if (result.data) fetched.push(task.label);
  }

  return { ...flags, fromCache, fetched };
}

function recordHasCsvStats(
  player: TrackedPlayerRow,
  record: HistoricalMatchRecord,
): boolean {
  const won =
    namesLikelyMatch(record.winner_name, player.full_name) || record.winner_id === player.rapid_player_id;
  if (won) {
    return (record.w_serve_won_pct ?? 0) > 0 || (record.w_svpt || 0) > 0;
  }
  return (record.l_serve_won_pct ?? 0) > 0 || (record.l_svpt || 0) > 0;
}

function upsertIndexFromRecord(
  player: TrackedPlayerRow,
  record: HistoricalMatchRecord,
  historicalMatchId: number | null,
): PlayerMatchIndexRow {
  const won =
    namesLikelyMatch(record.winner_name, player.full_name) || record.winner_id === player.rapid_player_id;
  const opponent = won ? record.loser_name : record.winner_name;
  const rapidEventId = record.rapid_event_id ?? null;

  return PlayerMatchIndexRepo.upsert({
    tracked_player_id: player.id,
    historical_match_id: historicalMatchId,
    rapid_event_id: rapidEventId,
    match_fingerprint: buildMatchFingerprint(record),
    match_date: record.match_date,
    opponent_name: opponent,
    won,
    tour: record.tour,
    tourney_name: record.tourney_name,
    surface: record.surface,
    score: record.score,
    has_csv_stats: recordHasCsvStats(player, record),
    has_api_details: rapidEventId ? poolHas('event_details', rapidEventId) : false,
    has_api_statistics: rapidEventId ? poolHas('event_statistics', rapidEventId) : false,
    has_api_pbp: rapidEventId ? poolHas('event_pbp', rapidEventId) : false,
  });
}

export function linkCsvMatchesForPlayer(
  trackedPlayerId: number,
  sinceDate = '2018-01-01',
): { linked: number; merged: number; pruned: number } {
  const player = TrackedPlayerRepo.getById(trackedPlayerId);
  if (!player) throw new Error('Tracked player not found');

  const pruned =
    db
      .prepare('DELETE FROM player_match_index WHERE tracked_player_id = ? AND match_date < ?')
      .run(trackedPlayerId, sinceDate).changes ?? 0;

  // Drop stale CSV links in the active window — re-link with strict name matching
  db.prepare(
    'DELETE FROM player_match_index WHERE tracked_player_id = ? AND match_date >= ? AND historical_match_id IS NOT NULL',
  ).run(trackedPlayerId, sinceDate);

  const { sql, params } = buildCsvLinkSql(player, sinceDate);
  const rows = db.prepare(sql).all(params) as HistoricalMatchRow[];

  const bestByDate = new Map<string, HistoricalMatchRow>();
  for (const row of rows) {
    if (!playerMatchesHistoricalRow(player, row)) continue;
    const prev = bestByDate.get(row.match_date);
    if (!prev || matchRichnessScore(row) > matchRichnessScore(prev)) {
      bestByDate.set(row.match_date, row);
    }
  }

  let linked = 0;
  let merged = 0;

  for (const row of bestByDate.values()) {
    const existing = PlayerMatchIndexRepo.listForPlayer(player.id, 5000).find(
      (m) => m.historical_match_id === row.id || m.match_fingerprint === buildMatchFingerprint(row),
    );

    upsertIndexFromRecord(player, row, row.id);
    if (existing) merged++;
    else linked++;
  }

  const indexSummary = PlayerMatchIndexRepo.summaryForPlayer(player.id);
  TrackedPlayerRepo.setSyncStatus(player.id, {
    matches_in_db: indexSummary.total,
    matches_with_stats: indexSummary.withCsvStats + indexSummary.withApiStatistics,
  });

  return { linked, merged, pruned };
}

async function enrichHistoricalFromEvent(
  historicalMatchId: number,
  record: HistoricalMatchRecord,
  eventId: number,
  homeName: string,
  awayName: string,
): Promise<boolean> {
  const statsKey = PersistentPoolService.buildKey('event_statistics', [eventId]);
  const statsResult = await PersistentPoolService.getOrFetch(
    statsKey,
    'event_statistics',
    () => BackendTennisApi.getEventStatistics(eventId),
    { permanent: true, cacheNullAsMiss: true },
  );
  const stats = statsResult.data;
  const mapped = mapStatisticsToWinnerLoser(stats, record.winner_name, record.loser_name, homeName, awayName);
  if (!mapped) return false;
  if (mapped.winner.servePoints === 0 && mapped.winner.firstServePoints === 0) return false;

  const patch = {
    ...bucketToPatch('w', mapped.winner),
    ...bucketToPatch('l', mapped.loser),
    rapid_event_id: eventId,
  };

  return patchHistoricalMatchStats(historicalMatchId, patch);
}

async function ingestPlayerEventsPage(
  player: TrackedPlayerRow,
  page: number,
  sinceDate: string,
  enrichCsvStats: boolean,
): Promise<{
  eventsOnPage: number;
  inserted: number;
  updated: number;
  skipped: number;
  statsEnriched: number;
  oldestDate: string | null;
  hasNextPage: boolean;
  apiFailed: boolean;
}> {
  const payload = await BackendTennisApi.getPlayerPreviousEvents(player.rapid_player_id, page);
  if (!payload) {
    return {
      eventsOnPage: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      statsEnriched: 0,
      oldestDate: null,
      hasNextPage: false,
      apiFailed: true,
    };
  }

  const events = Array.isArray(payload?.events) ? payload.events : [];
  const hasNextPage = Boolean((payload as { hasNextPage?: boolean })?.hasNextPage);

  const records: HistoricalMatchRecord[] = [];
  let statsEnriched = 0;

  for (const ev of events) {
    if (!eventLooksFinished(ev)) continue;
    if (!eventInvolvesPlayer(ev, player.full_name, player.rapid_player_id)) continue;

    const record = mapRapidEventToHistoricalMatch(ev);
    if (!record || record.match_date < sinceDate) continue;
    records.push(record);
  }

  const summary = upsertHistoricalMatchRecords(records);

  for (const record of records) {
    const histId = findHistoricalRowId(record);
    const ev = events.find((e: { id?: number }) => Number(e.id) === record.rapid_event_id);

    if (ev && record.rapid_event_id) {
      cacheEventListItem(record.rapid_event_id, ev);
      if (histId && (record.winner_rank > 0 || record.loser_rank > 0)) {
        applyRankFromEventRecord(histId, record);
      }
    }

    const playerHasCsv = Boolean(
      db
        .prepare(
          'SELECT 1 FROM player_match_index WHERE tracked_player_id = ? AND has_csv_stats = 1 LIMIT 1',
        )
        .get(player.id),
    );

    const alreadyLinked = histId
      ? Boolean(
          db
            .prepare(
              'SELECT 1 FROM player_match_index WHERE tracked_player_id = ? AND historical_match_id = ? LIMIT 1',
            )
            .get(player.id, histId),
        )
      : false;

    if (alreadyLinked) {
      upsertIndexFromRecord(player, record, histId);
    } else if (!playerHasCsv && histId) {
      upsertIndexFromRecord(player, record, histId);
    }

    if (enrichCsvStats && histId && (record.w_svpt || 0) === 0 && record.rapid_event_id && ev) {
        const players = eventPlayers(ev);
        const ok = await enrichHistoricalFromEvent(
          histId,
          record,
          record.rapid_event_id,
          players.home,
          players.away,
        );
        if (ok) statsEnriched++;
    }
  }

  const oldestDate =
    records.length > 0
      ? records.reduce((min, r) => (r.match_date < min ? r.match_date : min), records[0].match_date)
      : null;

  return {
    eventsOnPage: records.length,
    inserted: summary.inserted,
    updated: summary.updated,
    skipped: summary.skipped,
    statsEnriched,
    oldestDate,
    hasNextPage,
    apiFailed: false,
  };
}

async function enrichPlayerDataGaps(
  playerId: number,
  sinceDate: string,
  maxFetches: number,
): Promise<{ fetched: number; skippedCached: number }> {
  const result = await enrichPlayerApiGaps(playerId, sinceDate, {
    maxStatsFetches: maxFetches,
  });
  return { fetched: result.apiCalls, skippedCached: 0 };
}

export async function syncPlayerArchiveUnified(
  trackedPlayerId: number,
  options?: UnifiedSyncOptions,
): Promise<UnifiedSyncResult> {
  const player = TrackedPlayerRepo.getById(trackedPlayerId);
  if (!player) throw new Error('Tracked player not found');

  const sinceDate = options?.sinceDate || '2024-01-01';
  const fetchAllPages = options?.fetchAllPages !== false;
  const pageCap = fetchAllPages ? 200 : Math.min(Math.max(options?.maxPages ?? 12, 1), 200);
  const linkCsv = options?.linkCsv !== false;
  const csvOnly = options?.csvOnly === true;
  const fetchBundles = !csvOnly && options?.fetchBundles !== false;
  const maxBundleFetches = options?.maxBundleFetches ?? 0;
  const enrichCsvStats = !csvOnly && options?.enrichCsvStats !== false;
  const eventsAlreadyComplete = readEventsPagesComplete(player.rapid_player_id);
  const hasAnyApiEventId = Boolean(
    db
      .prepare(
        'SELECT 1 FROM player_match_index WHERE tracked_player_id = ? AND rapid_event_id IS NOT NULL LIMIT 1',
      )
      .get(player.id),
  );
  const forceEventPages = !csvOnly && (options?.refreshEventPages === true || !hasAnyApiEventId);
  const bundlesOnly = !csvOnly && options?.bundlesOnly === true && !forceEventPages && eventsAlreadyComplete;
  const shouldFetchEventPages = !csvOnly && !bundlesOnly && (forceEventPages || !eventsAlreadyComplete);

  TrackedPlayerRepo.setSyncStatus(player.id, { sync_status: 'syncing', sync_error: null });

  let pagesFetched = 0;
  let eventsSeen = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let bundlesFetched = 0;
  let bundlesSkippedCached = 0;
  let statsEnriched = 0;
  let lastMatchDate: string | null = null;
  let hasMorePages = false;

  try {
    if (linkCsv) {
      linkCsvMatchesForPlayer(player.id, sinceDate);
      mergeApiMetadataOntoCsvRows(player.id, sinceDate);
    }

    // Phase 1: GET /player/{id}/events/previous/{page} — paginated, NOT per year (~30/page)
    if (shouldFetchEventPages) {
      for (let page = 0; page < pageCap; page++) {
        const pageResult = await ingestPlayerEventsPage(player, page, sinceDate, enrichCsvStats);
        pagesFetched++;
        eventsSeen += pageResult.eventsOnPage;
        inserted += pageResult.inserted;
        updated += pageResult.updated;
        skipped += pageResult.skipped;
        statsEnriched += pageResult.statsEnriched;

        if (pageResult.apiFailed) {
          hasMorePages = true;
          throw new Error(`Tennis API failed while loading match history (page ${page})`);
        }

        if (!pageResult.hasNextPage || pageResult.eventsOnPage === 0) {
          hasMorePages = false;
          writeEventsPagesComplete(player.rapid_player_id, true);
          break;
        }

        if (pageResult.oldestDate && pageResult.oldestDate < sinceDate) {
          hasMorePages = pageResult.hasNextPage;
          writeEventsPagesComplete(player.rapid_player_id, !pageResult.hasNextPage);
          break;
        }

        hasMorePages = pageResult.hasNextPage;
      }
    } else {
      hasMorePages = false;
    }

    const newest = PlayerMatchIndexRepo.listForPlayer(player.id, 1)[0];
    lastMatchDate = newest?.match_date ?? lastMatchDate;

    // Phase 2+3: bulk odds by date, then serve stats only (no PBP)
    if (fetchBundles) {
      mergeApiMetadataOntoCsvRows(player.id, sinceDate);
      const rankResult = await fillMissingRanksForPlayer(
        player.id,
        player.rapid_player_id,
        player.full_name,
        sinceDate,
        { maxPages: player.tour === 'WTA' ? 25 : 12, maxDetailFallbacks: 8 },
      );
      if (rankResult.rankFilled > 0) {
        Logger.info(`[Sync] ${player.full_name}: filled ${rankResult.rankFilled} ranks from API`);
      }
      const bundleResult = await enrichPlayerDataGaps(player.id, sinceDate, maxBundleFetches);
      bundlesFetched = bundleResult.fetched;
      bundlesSkippedCached = bundleResult.skippedCached;
    }

    PlayerMatchIndexRepo.pruneApiOnlyRows(player.id);
    const indexSummary = PlayerMatchIndexRepo.summaryForPlayer(player.id);
    const incompleteBundles = csvOnly ? 0 : listPlayerDataGaps(player.id, sinceDate).length;
    const now = new Date().toISOString();
    const allDone = csvOnly ? indexSummary.total > 0 : !hasMorePages && incompleteBundles === 0;

    TrackedPlayerRepo.setSyncStatus(player.id, {
      sync_status: allDone ? 'done' : csvOnly ? 'pending' : 'syncing',
      sync_error: allDone
        ? null
        : csvOnly
          ? 'No local matches linked yet'
          : hasMorePages
            ? 'More API pages remain'
            : `${incompleteBundles} matches still need API fill (serve/odds/rank)`,
      last_sync_at: now,
      last_match_date: indexSummary.total ? PlayerMatchIndexRepo.listForPlayer(player.id, 1)[0]?.match_date : lastMatchDate,
      matches_in_db: indexSummary.total,
      matches_with_stats: indexSummary.withCsvStats + indexSummary.withApiStatistics,
      last_sync_pages: pagesFetched,
    });

    db.prepare(
      `
      INSERT INTO ingestion_sync_state (key, value, updated_at)
      VALUES (@key, @value, @updated_at)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `,
    ).run({
      key: `tracked_player_sync_${player.rapid_player_id}`,
      value: now,
      updated_at: now,
    });

    Logger.info(
      `[PlayerArchive] ${player.full_name}: pages=${pagesFetched} events=${eventsSeen} bundles=${bundlesFetched} incomplete_api=${indexSummary.api_basic + indexSummary.stats}`,
    );

    return {
      playerId: player.id,
      rapidPlayerId: player.rapid_player_id,
      pagesFetched,
      hasMorePages,
      eventsSeen,
      inserted,
      updated,
      skipped,
      csvLinked: 0,
      bundlesFetched,
      bundlesSkippedCached,
      statsEnriched,
      indexSummary,
      lastMatchDate,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    TrackedPlayerRepo.setSyncStatus(player.id, {
      sync_status: 'error',
      sync_error: message,
    });
    throw err;
  }
}

export function reindexAllTrackedPlayersFromHistorical(sinceDate = '2018-01-01'): {
  players: number;
  linked: number;
} {
  const players = TrackedPlayerRepo.list({ activeOnly: true, limit: 1000 });
  let linked = 0;
  for (const player of players) {
    const res = linkCsvMatchesForPlayer(player.id, sinceDate);
    linked += res.linked + res.merged;
    const indexSummary = PlayerMatchIndexRepo.summaryForPlayer(player.id);
    TrackedPlayerRepo.setSyncStatus(player.id, {
      sync_status: indexSummary.total > 0 ? 'done' : 'pending',
      sync_error: indexSummary.total > 0 ? null : 'No local matches linked yet',
      matches_in_db: indexSummary.total,
      matches_with_stats: indexSummary.withCsvStats,
    });
  }
  Logger.info(`Reindexed ${players.length} tracked players from historical CSV (${linked} match links)`);
  return { players: players.length, linked };
}

export function getPlayerArchive(trackedPlayerId: number) {
  const player = TrackedPlayerRepo.getById(trackedPlayerId);
  if (!player) return null;

  const matches = PlayerMatchIndexRepo.listForPlayer(trackedPlayerId, 10000);
  const summary = PlayerMatchIndexRepo.summaryForPlayer(trackedPlayerId);

  return {
    player,
    summary: {
      ...summary,
      fullCoveragePct: summary.total ? Math.round((summary.full / summary.total) * 1000) / 10 : 0,
      csvStatsPct: summary.total ? Math.round((summary.withCsvStats / summary.total) * 1000) / 10 : 0,
      apiStatsPct: summary.total ? Math.round((summary.withApiStatistics / summary.total) * 1000) / 10 : 0,
      pbpPct: summary.total ? Math.round((summary.withApiPbp / summary.total) * 1000) / 10 : 0,
    },
    matches: matches.map((m) => ({
      id: m.id,
      matchDate: m.match_date,
      opponent: m.opponent_name,
      won: m.won === 1,
      tourney: m.tourney_name,
      surface: m.surface,
      score: m.score,
      completeness: m.completeness,
      historicalMatchId: m.historical_match_id,
      rapidEventId: m.rapid_event_id,
      hasCsvStats: m.has_csv_stats === 1,
      hasApiStatistics: m.has_api_statistics === 1,
      hasApiPbp: m.has_api_pbp === 1,
      hasApiDetails: m.has_api_details === 1,
    })),
  };
}

export function getPlayerMatchBundle(trackedPlayerId: number, indexId: number) {
  const indexRow = PlayerMatchIndexRepo.getById(indexId);
  if (!indexRow || indexRow.tracked_player_id !== trackedPlayerId) return null;

  const historical = indexRow.historical_match_id
    ? (db.prepare('SELECT * FROM historical_matches WHERE id = ?').get(indexRow.historical_match_id) as HistoricalMatchRow)
    : null;

  const eventId = indexRow.rapid_event_id;
  const bundles = eventId
    ? {
        details: PersistentPoolService.get(PersistentPoolService.buildKey('event_details', [eventId])),
        statistics: PersistentPoolService.get(PersistentPoolService.buildKey('event_statistics', [eventId])),
        pointByPoint: PersistentPoolService.get(PersistentPoolService.buildKey('event_pbp', [eventId])),
      }
    : null;

  return {
    index: indexRow,
    historical,
    api: bundles,
  };
}
