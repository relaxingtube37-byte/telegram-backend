import { BackendTennisApi } from '../dataPool/dataPool.tennisApi';
import { db } from '../db/connection';
import { namesLikelyMatch } from '../scripts/historicalMatchKeys';
import { enrichSparseHistoricalMatchesFromRapidApi } from '../scripts/rapidApiHistoricalEnrichment';
import { getPlayerSurfaceStatsFromPool } from './historicalPlayerStats.service';
import { isEventFinishedPayload, PersistentPoolService } from './persistentPool.service';

export type EnsureResource =
  | 'details'
  | 'statistics'
  | 'odds'
  | 'pbp'
  | 'duel'
  | 'home_surface'
  | 'away_surface';

export interface EnsureMatchInput {
  eventId?: number | string;
  matchDate?: string;
  homeName?: string;
  awayName?: string;
  tour?: 'ATP' | 'WTA';
  source?: 'live' | 'archive';
  resources?: EnsureResource[];
  forceRefresh?: boolean;
}

export interface EnsureMatchResult {
  eventId: number | null;
  rapidEventId: number | null;
  resolvedFrom: 'event_id' | 'daily_api' | 'historical_only' | 'none';
  fromCache: string[];
  fetched: string[];
  missing: string[];
  data: {
    details?: unknown;
    statistics?: unknown;
    odds?: unknown;
    pbp?: unknown;
    duel?: unknown;
    homeSurfaceStats?: unknown;
    awaySurfaceStats?: unknown;
    historicalRowId?: number | null;
  };
}

const DEFAULT_RESOURCES: EnsureResource[] = [
  'details',
  'statistics',
  'odds',
  'duel',
  'home_surface',
  'away_surface',
];

const LIVE_TTL = 45 * 1000;
const ODDS_TTL = 3 * 60 * 1000;

export async function fetchDailyEventsForTour(matchDate: string, tour: 'ATP' | 'WTA'): Promise<any[]> {
  const cacheKey = PersistentPoolService.buildKey('daily_events', [matchDate, tour]);
  const cached = await PersistentPoolService.getOrFetch(
    cacheKey,
    'daily_events',
    () => BackendTennisApi.getDailyEvents(matchDate),
    { ttlMs: 24 * 60 * 60 * 1000 },
  );

  const events = Array.isArray((cached.data as any)?.events) ? (cached.data as any).events : [];
  const wantedCategory = tour === 'WTA' ? 6 : 3;
  return events.filter((ev: any) => {
    const catId = Number(ev?.tournament?.category?.id || 0);
    return !wantedCategory || !catId || catId === wantedCategory;
  });
}

async function resolveRapidEventId(input: EnsureMatchInput): Promise<{
  rapidEventId: number | null;
  resolvedFrom: EnsureMatchResult['resolvedFrom'];
}> {
  if (input.source === 'live' && input.eventId && Number(input.eventId) > 0) {
    return { rapidEventId: Number(input.eventId), resolvedFrom: 'event_id' };
  }

  const matchDate = input.matchDate;
  const homeName = input.homeName;
  const awayName = input.awayName;
  if (!matchDate || !homeName || !awayName) {
    return { rapidEventId: null, resolvedFrom: 'none' };
  }

  const tour = input.tour || 'ATP';
  const daily = await fetchDailyEventsForTour(matchDate, tour);
  const candidate = daily.find((ev: any) => {
    const home = String(ev?.homeTeam?.name || ev?.home?.name || '');
    const away = String(ev?.awayTeam?.name || ev?.away?.name || '');
    const homeWin = namesLikelyMatch(homeName, home) && namesLikelyMatch(awayName, away);
    const awayWin = namesLikelyMatch(homeName, away) && namesLikelyMatch(awayName, home);
    return homeWin || awayWin;
  });

  if (candidate?.id) {
    return { rapidEventId: Number(candidate.id), resolvedFrom: 'daily_api' };
  }

  return { rapidEventId: null, resolvedFrom: 'historical_only' };
}

function lookupHistoricalRowId(matchDate: string, homeName: string, awayName: string): number | null {
  const row = db
    .prepare(
      `
    SELECT id FROM historical_matches
    WHERE match_date = @matchDate
      AND (
        (lower(trim(winner_name)) = lower(trim(@homeName)) AND lower(trim(loser_name)) = lower(trim(@awayName)))
        OR (lower(trim(winner_name)) = lower(trim(@awayName)) AND lower(trim(loser_name)) = lower(trim(@homeName)))
      )
    ORDER BY (w_svpt + l_svpt) DESC, id ASC
    LIMIT 1
  `,
    )
    .get({ matchDate, homeName, awayName }) as { id: number } | undefined;
  return row?.id ?? null;
}

async function ensureHistoricalServeStats(
  matchDate: string,
  homeName: string,
  awayName: string,
): Promise<number | null> {
  const rowId = lookupHistoricalRowId(matchDate, homeName, awayName);
  if (!rowId) return null;

  const row = db.prepare('SELECT w_svpt FROM historical_matches WHERE id = @id').get({ id: rowId }) as
    | { w_svpt: number }
    | undefined;
  if ((row?.w_svpt || 0) > 0) return rowId;

  await enrichSparseHistoricalMatchesFromRapidApi({
    maxRows: 5,
    sinceDate: matchDate,
  });

  return rowId;
}

export async function ensureMatchData(input: EnsureMatchInput): Promise<EnsureMatchResult> {
  const resources = input.resources && input.resources.length > 0 ? input.resources : DEFAULT_RESOURCES;
  const fromCache: string[] = [];
  const fetched: string[] = [];
  const missing: string[] = [];
  const data: EnsureMatchResult['data'] = {};

  if (input.matchDate && input.homeName && input.awayName) {
    data.historicalRowId = await ensureHistoricalServeStats(
      input.matchDate,
      input.homeName,
      input.awayName,
    );
  }

  const { rapidEventId, resolvedFrom } = await resolveRapidEventId(input);
  const eventId = rapidEventId ?? (input.eventId ? Number(input.eventId) : null);

  if (resources.includes('home_surface') && input.homeName) {
    data.homeSurfaceStats = getPlayerSurfaceStatsFromPool({
      playerName: input.homeName,
      beforeDate: input.matchDate,
    });
    fromCache.push('home_surface');
  }

  if (resources.includes('away_surface') && input.awayName) {
    data.awaySurfaceStats = getPlayerSurfaceStatsFromPool({
      playerName: input.awayName,
      beforeDate: input.matchDate,
    });
    fromCache.push('away_surface');
  }

  if (!rapidEventId) {
    for (const resource of resources) {
      if (resource !== 'home_surface' && resource !== 'away_surface') {
        missing.push(resource);
      }
    }
    return {
      eventId,
      rapidEventId: null,
      resolvedFrom: data.historicalRowId ? 'historical_only' : resolvedFrom,
      fromCache,
      fetched,
      missing,
      data,
    };
  }

  let finished = Boolean(input.matchDate && input.matchDate < new Date().toISOString().slice(0, 10));

  if (resources.includes('details')) {
    const key = PersistentPoolService.buildKey('event_details', [rapidEventId]);
    const result = await PersistentPoolService.getOrFetch(
      key,
      'event_details',
      () => BackendTennisApi.getEventDetails(rapidEventId),
      { forceRefresh: input.forceRefresh, ttlMs: LIVE_TTL },
    );
    if (result.data) {
      data.details = result.data;
      (result.fromCache ? fromCache : fetched).push('details');
      finished = finished || isEventFinishedPayload(result.data);
      if (finished) {
        PersistentPoolService.set(key, 'event_details', result.data, { permanent: true });
      }
    } else {
      missing.push('details');
    }
  }

  const eventOpts = finished
    ? { permanent: true as const, forceRefresh: input.forceRefresh }
    : { ttlMs: LIVE_TTL, forceRefresh: input.forceRefresh };

  const fetchEventResource = async (
    resource: 'statistics' | 'odds' | 'pbp' | 'duel',
    namespace: 'event_statistics' | 'event_odds' | 'event_pbp' | 'event_duel',
    fetcher: () => Promise<unknown>,
    ttlMs = LIVE_TTL,
  ) => {
    if (!resources.includes(resource)) return;
    const key = PersistentPoolService.buildKey(namespace, [rapidEventId]);
    const result = await PersistentPoolService.getOrFetch(key, namespace, fetcher, {
      ...eventOpts,
      ttlMs: finished ? undefined : ttlMs,
    });
    if (result.data) {
      (data as any)[resource] = result.data;
      (result.fromCache ? fromCache : fetched).push(resource);
      if (finished) {
        PersistentPoolService.set(key, namespace, result.data, { permanent: true });
      }
    } else {
      missing.push(resource);
    }
  };

  await fetchEventResource('statistics', 'event_statistics', () =>
    BackendTennisApi.getEventStatistics(rapidEventId),
  );
  await fetchEventResource('odds', 'event_odds', () => BackendTennisApi.getEventOdds(rapidEventId), ODDS_TTL);
  await fetchEventResource('pbp', 'event_pbp', () => BackendTennisApi.getEventPointByPoint(rapidEventId));
  await fetchEventResource('duel', 'event_duel', () => BackendTennisApi.getEventDuel(rapidEventId));

  return {
    eventId,
    rapidEventId,
    resolvedFrom,
    fromCache,
    fetched,
    missing,
    data,
  };
}
