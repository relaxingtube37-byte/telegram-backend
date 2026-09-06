import { db } from '../db/connection';
import { BackendTennisApi } from '../dataPool/dataPool.tennisApi';
import {
  patchHistoricalMatchGaps,
  patchHistoricalMatchStats,
  type HistoricalMatchRecord,
} from '../scripts/historicalMatchInsert';
import {
  bucketToPatch,
  eventPlayers,
  mapStatisticsToWinnerLoser,
} from '../scripts/rapidApiHistoricalEnrichment';
import { PlayerMatchIndexRepo } from '../db/repositories/playerMatchIndex.repo';
import { mapOddsToWinnerLoser, resolveEventSides, type OddsMarket } from './apiOddsMapper';
import { PersistentPoolService } from './persistentPool.service';
import { Logger } from '../utils/logger';
import { namesLikelyMatch } from '../scripts/historicalMatchKeys';
import { eventInvolvesPlayer } from './rapidEventMapper';

export interface PlayerDataGap {
  historicalMatchId: number;
  rapidEventId: number;
  matchDate: string;
  opponentName: string;
  winnerName: string;
  loserName: string;
  missingServe: boolean;
  missingOdds: boolean;
  missingRank: boolean;
}

export interface EnrichmentPlan {
  serveGaps: PlayerDataGap[];
  oddsGaps: PlayerDataGap[];
  rankGaps: PlayerDataGap[];
  oddsDates: string[];
  estimatedApiCalls: number;
}

export interface EnrichmentOptions {
  maxStatsFetches?: number;
  maxOddsDates?: number;
  maxPerMatchOddsFallbacks?: number;
}

export interface EnrichmentResult {
  oddsDatesFetched: number;
  oddsMatchesFilled: number;
  statsFetched: number;
  statsMatchesFilled: number;
  rankFilled: number;
  apiCalls: number;
}

function parseIsoDate(dateStr: string): { day: number; month: number; year: number } {
  const [year, month, day] = dateStr.split('-').map(Number);
  return { day, month, year };
}

export function listPlayerDataGaps(trackedPlayerId: number, sinceDate: string): PlayerDataGap[] {
  const rows = db
    .prepare(
      `
    SELECT
      h.id AS historical_match_id,
      h.rapid_event_id,
      pmi.match_date,
      pmi.opponent_name,
      h.winner_name,
      h.loser_name,
      CASE
        WHEN COALESCE(h.w_serve_won_pct, 0) = 0 AND COALESCE(h.l_serve_won_pct, 0) = 0
          AND COALESCE(h.w_svpt, 0) = 0 AND COALESCE(h.l_svpt, 0) = 0
        THEN 1 ELSE 0
      END AS missing_serve,
      CASE WHEN COALESCE(h.w_odds_match, 0) = 0 AND COALESCE(h.l_odds_match, 0) = 0 THEN 1 ELSE 0 END AS missing_odds,
      CASE WHEN COALESCE(h.winner_rank, 0) = 0 AND COALESCE(h.loser_rank, 0) = 0 THEN 1 ELSE 0 END AS missing_rank
    FROM player_match_index pmi
    JOIN historical_matches h ON h.id = pmi.historical_match_id
    WHERE pmi.tracked_player_id = ?
      AND pmi.match_date >= ?
      AND h.rapid_event_id IS NOT NULL
      AND pmi.has_csv_stats = 1
      AND (
        (
          COALESCE(h.w_serve_won_pct, 0) = 0 AND COALESCE(h.l_serve_won_pct, 0) = 0
          AND COALESCE(h.w_svpt, 0) = 0 AND COALESCE(h.l_svpt, 0) = 0
        )
        OR (COALESCE(h.w_odds_match, 0) = 0 AND COALESCE(h.l_odds_match, 0) = 0)
        OR (COALESCE(h.winner_rank, 0) = 0 AND COALESCE(h.loser_rank, 0) = 0)
      )
    ORDER BY pmi.match_date DESC
  `,
    )
    .all(trackedPlayerId, sinceDate) as Array<{
    historical_match_id: number;
    rapid_event_id: number;
    match_date: string;
    opponent_name: string;
    winner_name: string;
    loser_name: string;
    missing_serve: number;
    missing_odds: number;
    missing_rank: number;
  }>;

  return rows.map((row) => ({
    historicalMatchId: row.historical_match_id,
    rapidEventId: row.rapid_event_id,
    matchDate: row.match_date,
    opponentName: row.opponent_name,
    winnerName: row.winner_name,
    loserName: row.loser_name,
    missingServe: row.missing_serve === 1,
    missingOdds: row.missing_odds === 1,
    missingRank: row.missing_rank === 1,
  }));
}

export function planApiEnrichment(gaps: PlayerDataGap[], pagesEstimate = 0): EnrichmentPlan {
  const serveGaps = gaps.filter((g) => g.missingServe);
  const oddsGaps = gaps.filter((g) => g.missingOdds);
  const rankGaps = gaps.filter((g) => g.missingRank);
  const oddsDates = [...new Set(oddsGaps.map((g) => g.matchDate))].sort();

  return {
    serveGaps,
    oddsGaps,
    rankGaps,
    oddsDates,
    estimatedApiCalls: pagesEstimate + oddsDates.length + serveGaps.length,
  };
}

export function cacheEventListItem(eventId: number, ev: unknown): void {
  const key = PersistentPoolService.buildKey('event_details', [eventId]);
  if (PersistentPoolService.get(key)) return;
  PersistentPoolService.set(key, 'event_details', { event: ev }, { permanent: true });
}

function getEventSidesFromCache(
  eventId: number,
  winnerName: string,
  loserName: string,
): { home: string; away: string } {
  const cached = PersistentPoolService.get<{ event?: Record<string, unknown> }>(
    PersistentPoolService.buildKey('event_details', [eventId]),
  );
  return resolveEventSides(cached, winnerName, loserName);
}

function mapOddsFlexible(
  oddsPayload: { markets?: OddsMarket[] } | null | undefined,
  winnerName: string,
  loserName: string,
  homeName: string,
  awayName: string,
) {
  return (
    mapOddsToWinnerLoser(oddsPayload, winnerName, loserName, homeName, awayName) ||
    mapOddsToWinnerLoser(oddsPayload, winnerName, loserName, awayName, homeName)
  );
}

async function applyOddsPayloadToGap(gap: PlayerDataGap, oddsPayload: unknown): Promise<boolean> {
  const sides = getEventSidesFromCache(gap.rapidEventId, gap.winnerName, gap.loserName);
  const mapped = mapOddsFlexible(
    oddsPayload as { markets?: OddsMarket[] },
    gap.winnerName,
    gap.loserName,
    sides.home,
    sides.away,
  );
  if (!mapped) return false;
  return patchHistoricalMatchGaps(gap.historicalMatchId, mapped);
}

async function fetchAndApplyBulkOddsForDate(
  dateStr: string,
  gaps: PlayerDataGap[],
): Promise<{ filled: number; apiCalls: number }> {
  const { day, month, year } = parseIsoDate(dateStr);
  const cacheKey = PersistentPoolService.buildKey('daily_odds', [`${year}-${month}-${day}`]);
  const result = await PersistentPoolService.getOrFetch(
    cacheKey,
    'daily_odds',
    () => BackendTennisApi.getEventsOddsByDate(day, month, year),
    { permanent: true, cacheNullAsMiss: true },
  );

  let filled = 0;
  if (!result.data) return { filled, apiCalls: result.fetched ? 1 : 0 };

  const oddsMap = (result.data as { odds?: Record<string, unknown> })?.odds || {};
  const gapsForDate = gaps.filter((g) => g.matchDate === dateStr);

  for (const gap of gapsForDate) {
    const payload = oddsMap[String(gap.rapidEventId)];
    if (!payload) continue;

    const perEventKey = PersistentPoolService.buildKey('event_odds', [gap.rapidEventId]);
    PersistentPoolService.set(perEventKey, 'event_odds', payload, { permanent: true });

    if (await applyOddsPayloadToGap(gap, payload)) filled++;
  }

  return { filled, apiCalls: result.fetched ? 1 : 0 };
}

async function fetchAndApplyPerMatchOdds(gap: PlayerDataGap): Promise<boolean> {
  const key = PersistentPoolService.buildKey('event_odds', [gap.rapidEventId]);
  const result = await PersistentPoolService.getOrFetch(
    key,
    'event_odds',
    () => BackendTennisApi.getEventOdds(gap.rapidEventId),
    { permanent: true, cacheNullAsMiss: true },
  );
  if (!result.data) return false;
  return applyOddsPayloadToGap(gap, result.data);
}

async function fetchAndApplyServeStats(gap: PlayerDataGap): Promise<boolean> {
  const key = PersistentPoolService.buildKey('event_statistics', [gap.rapidEventId]);
  const result = await PersistentPoolService.getOrFetch(
    key,
    'event_statistics',
    () => BackendTennisApi.getEventStatistics(gap.rapidEventId),
    { permanent: true, cacheNullAsMiss: true },
  );
  if (!result.data) return false;

  const sides = getEventSidesFromCache(gap.rapidEventId, gap.winnerName, gap.loserName);
  const mapped = mapStatisticsToWinnerLoser(
    result.data,
    gap.winnerName,
    gap.loserName,
    sides.home,
    sides.away,
  );
  if (!mapped || (mapped.winner.servePoints === 0 && mapped.winner.firstServePoints === 0)) return false;

  const patch = {
    ...bucketToPatch('w', mapped.winner),
    ...bucketToPatch('l', mapped.loser),
    rapid_event_id: gap.rapidEventId,
  };

  const ok = patchHistoricalMatchStats(gap.historicalMatchId, patch);
  if (ok) {
    const indexRows = db
      .prepare('SELECT id FROM player_match_index WHERE historical_match_id = ?')
      .all(gap.historicalMatchId) as Array<{ id: number }>;
    for (const row of indexRows) {
      PlayerMatchIndexRepo.updateBundleFlags(row.id, { has_api_statistics: 1 });
    }
  }
  return ok;
}

export async function enrichPlayerApiGaps(
  trackedPlayerId: number,
  sinceDate: string,
  options?: EnrichmentOptions,
): Promise<EnrichmentResult> {
  const gaps = listPlayerDataGaps(trackedPlayerId, sinceDate);
  const plan = planApiEnrichment(gaps);
  const maxStats = options?.maxStatsFetches ?? 0;
  const maxOddsDates = options?.maxOddsDates ?? 0;
  const maxOddsFallback = options?.maxPerMatchOddsFallbacks ?? 10;

  let apiCalls = 0;
  let oddsDatesFetched = 0;
  let oddsMatchesFilled = 0;
  let statsFetched = 0;
  let statsMatchesFilled = 0;

  const oddsDates = maxOddsDates > 0 ? plan.oddsDates.slice(0, maxOddsDates) : plan.oddsDates;
  const filledEventIds = new Set<number>();

  for (const dateStr of oddsDates) {
    const res = await fetchAndApplyBulkOddsForDate(dateStr, plan.oddsGaps);
    apiCalls += res.apiCalls;
    if (res.apiCalls > 0) oddsDatesFetched += 1;
    oddsMatchesFilled += res.filled;
    for (const gap of plan.oddsGaps.filter((g) => g.matchDate === dateStr)) {
      const row = db
        .prepare('SELECT w_odds_match, l_odds_match FROM historical_matches WHERE id = ?')
        .get(gap.historicalMatchId) as { w_odds_match: number | null; l_odds_match: number | null } | undefined;
      if (row && ((row.w_odds_match || 0) > 0 || (row.l_odds_match || 0) > 0)) {
        filledEventIds.add(gap.rapidEventId);
      }
    }
  }

  const leftoverOdds = plan.oddsGaps.filter((g) => !filledEventIds.has(g.rapidEventId)).slice(0, maxOddsFallback);
  for (const gap of leftoverOdds) {
    apiCalls += 1;
    if (await fetchAndApplyPerMatchOdds(gap)) oddsMatchesFilled++;
  }

  const serveGaps = maxStats > 0 ? plan.serveGaps.slice(0, maxStats) : plan.serveGaps;
  for (const gap of serveGaps) {
    apiCalls += 1;
    statsFetched += 1;
    if (await fetchAndApplyServeStats(gap)) statsMatchesFilled++;
  }

  Logger.info(
    `[ApiEnrichment] player=${trackedPlayerId} oddsDates=${oddsDatesFetched} oddsFilled=${oddsMatchesFilled} statsFilled=${statsMatchesFilled} calls=${apiCalls}`,
  );

  return {
    oddsDatesFetched,
    oddsMatchesFilled,
    statsFetched,
    statsMatchesFilled,
    rankFilled: 0,
    apiCalls,
  };
}

export function applyRankFromEventRecord(
  historicalMatchId: number,
  record: Pick<HistoricalMatchRecord, 'winner_rank' | 'loser_rank' | 'rapid_event_id'>,
  eventId?: number,
): boolean {
  const patch: Partial<HistoricalMatchRecord> = {
    winner_rank: record.winner_rank,
    loser_rank: record.loser_rank,
  };
  const rapidId = eventId || record.rapid_event_id;
  if (rapidId) patch.rapid_event_id = rapidId;
  return patchHistoricalMatchGaps(historicalMatchId, patch);
}

export function listRankGaps(trackedPlayerId: number, sinceDate: string): PlayerDataGap[] {
  const rows = db
    .prepare(
      `
    SELECT
      h.id AS historical_match_id,
      h.rapid_event_id,
      pmi.match_date,
      pmi.opponent_name,
      h.winner_name,
      h.loser_name
    FROM player_match_index pmi
    JOIN historical_matches h ON h.id = pmi.historical_match_id
    WHERE pmi.tracked_player_id = ?
      AND pmi.match_date >= ?
      AND pmi.has_csv_stats = 1
      AND COALESCE(h.winner_rank, 0) = 0
      AND COALESCE(h.loser_rank, 0) = 0
    ORDER BY pmi.match_date DESC
  `,
    )
    .all(trackedPlayerId, sinceDate) as Array<{
    historical_match_id: number;
    rapid_event_id: number | null;
    match_date: string;
    opponent_name: string;
    winner_name: string;
    loser_name: string;
  }>;

  return rows.map((row) => ({
    historicalMatchId: row.historical_match_id,
    rapidEventId: row.rapid_event_id || 0,
    matchDate: row.match_date,
    opponentName: row.opponent_name,
    winnerName: row.winner_name,
    loserName: row.loser_name,
    missingServe: false,
    missingOdds: false,
    missingRank: true,
  }));
}

export interface RankFillResult {
  pagesFetched: number;
  apiCalls: number;
  rankGapsBefore: number;
  rankFilled: number;
  rankGapsAfter: number;
}

/** Fill missing winner/loser rank from events/previous pages — no new index rows. */
export async function fillMissingRanksForPlayer(
  trackedPlayerId: number,
  rapidPlayerId: number,
  playerName: string,
  sinceDate: string,
  options?: { maxPages?: number; maxDetailFallbacks?: number },
): Promise<RankFillResult> {
  const rankGaps = listRankGaps(trackedPlayerId, sinceDate);
  const pending = new Map(rankGaps.map((g) => [g.historicalMatchId, g]));
  const maxPages = options?.maxPages ?? 200;
  const maxDetailFallbacks = options?.maxDetailFallbacks ?? 20;

  let pagesFetched = 0;
  let apiCalls = 0;
  let rankFilled = 0;
  const { mapRapidEventToHistoricalMatch } = await import('./rapidEventMapper');

  const tryFillGap = (gap: PlayerDataGap, ev: unknown, eventId: number): boolean => {
    const record = mapRapidEventToHistoricalMatch(ev);
    if (!record || record.match_date < sinceDate) return false;
    if (record.winner_rank <= 0 && record.loser_rank <= 0) return false;
    cacheEventListItem(eventId, ev);
    if (applyRankFromEventRecord(gap.historicalMatchId, record, eventId)) {
      rankFilled += 1;
      pending.delete(gap.historicalMatchId);
      if (eventId) {
        const indexRows = db
          .prepare('SELECT id FROM player_match_index WHERE historical_match_id = ?')
          .all(gap.historicalMatchId) as Array<{ id: number }>;
        for (const row of indexRows) {
          PlayerMatchIndexRepo.updateBundleFlags(row.id, { rapid_event_id: eventId });
        }
      }
      return true;
    }
    return false;
  };

  const eventMatchesGap = (ev: { id?: number; startTimestamp?: number; homeTeam?: { name?: string }; awayTeam?: { name?: string } }, gap: PlayerDataGap): boolean => {
    const eventId = Number(ev.id || 0);
    if (eventId && gap.rapidEventId && eventId === gap.rapidEventId) return true;
    const date = new Date((ev.startTimestamp || 0) * 1000).toISOString().slice(0, 10);
    if (date !== gap.matchDate) return false;
    if (!eventInvolvesPlayer(ev, playerName, rapidPlayerId)) return false;
    const home = String(ev.homeTeam?.name || '');
    const away = String(ev.awayTeam?.name || '');
    return (
      namesLikelyMatch(home, gap.opponentName) ||
      namesLikelyMatch(away, gap.opponentName) ||
      namesLikelyMatch(home, gap.winnerName) ||
      namesLikelyMatch(away, gap.winnerName) ||
      namesLikelyMatch(home, gap.loserName) ||
      namesLikelyMatch(away, gap.loserName)
    );
  };

  for (let page = 0; page < maxPages && pending.size > 0; page++) {
    const payload = await BackendTennisApi.getPlayerPreviousEvents(rapidPlayerId, page);
    apiCalls += 1;
    pagesFetched += 1;

    if (!payload) break;

    const events = Array.isArray((payload as { events?: unknown[] }).events)
      ? (payload as { events: unknown[] }).events
      : [];
    const hasNextPage = Boolean((payload as { hasNextPage?: boolean }).hasNextPage);

    let oldestOnPage: string | null = null;

    for (const ev of events) {
      const eventId = Number((ev as { id?: number }).id || 0);
      if (!eventId) continue;

      for (const gap of [...pending.values()]) {
        if (!eventMatchesGap(ev as { id?: number; startTimestamp?: number; homeTeam?: { name?: string }; awayTeam?: { name?: string } }, gap)) {
          continue;
        }
        tryFillGap(gap, ev, eventId);
      }

      const record = mapRapidEventToHistoricalMatch(ev);
      if (record?.match_date) {
        const matchDate = String(record.match_date);
        if (!oldestOnPage || matchDate < oldestOnPage) {
          oldestOnPage = matchDate;
        }
      }
    }

    if (!hasNextPage || events.length === 0) break;
    if (oldestOnPage && oldestOnPage < sinceDate) break;
  }

  let detailFallbacks = 0;
  for (const gap of [...pending.values()]) {
    if (!gap.rapidEventId) continue;
    if (detailFallbacks >= maxDetailFallbacks) break;
    apiCalls += 1;
    detailFallbacks += 1;
    const details = await BackendTennisApi.getEventDetails(gap.rapidEventId);
    if (!details) continue;
    cacheEventListItem(gap.rapidEventId, (details as { event?: unknown }).event || details);
    tryFillGap(gap, (details as { event?: unknown }).event || details, gap.rapidEventId);
  }

  const rankGapsAfter = listRankGaps(trackedPlayerId, sinceDate).length;

  Logger.info(
    `[RankFill] player=${trackedPlayerId} tour pages=${pagesFetched} filled=${rankFilled} remaining=${rankGapsAfter}`,
  );

  return {
    pagesFetched,
    apiCalls,
    rankGapsBefore: rankGaps.length,
    rankFilled,
    rankGapsAfter,
  };
}
