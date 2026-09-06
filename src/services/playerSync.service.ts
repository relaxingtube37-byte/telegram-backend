import { BackendTennisApi } from '../dataPool/dataPool.tennisApi';
import {
  TrackedPlayerRepo,
  type TrackedPlayerRow,
  type TrackedPlayerTour,
} from '../db/repositories/trackedPlayer.repo';
import { Logger } from '../utils/logger';
import {
  getPlayerArchive,
  getPlayerMatchBundle,
  linkCsvMatchesForPlayer,
  reindexAllTrackedPlayersFromHistorical,
  syncPlayerArchiveUnified,
  type UnifiedSyncOptions,
} from './playerArchive.service';
import { PlayerMatchIndexRepo } from '../db/repositories/playerMatchIndex.repo';

export interface PlayerSearchHit {
  rapidPlayerId: number;
  fullName: string;
  shortName?: string;
  countryCode?: string;
  tour: TrackedPlayerTour;
  gender: string;
  ranking?: number;
}

export interface SyncPlayerOptions extends UnifiedSyncOptions {
  fetchStats?: boolean;
  maxStatsFetches?: number;
}

export interface SyncPlayerResult {
  playerId: number;
  rapidPlayerId: number;
  pagesFetched: number;
  eventsSeen: number;
  inserted: number;
  updated: number;
  skipped: number;
  statsEnriched: number;
  csvLinked: number;
  bundlesFetched: number;
  bundlesSkippedCached: number;
  hasMorePages: boolean;
  indexSummary: ReturnType<typeof PlayerMatchIndexRepo.summaryForPlayer>;
  lastMatchDate: string | null;
}

function inferTourFromRankingEntry(entry: any): TrackedPlayerTour {
  const type = String(entry?.type || entry?.team?.sport?.slug || '').toLowerCase();
  const gender = String(entry?.team?.gender || entry?.gender || '').toLowerCase();
  if (type.includes('wta') || gender === 'f') return 'WTA';
  return 'ATP';
}

function mapSearchHit(raw: any): PlayerSearchHit | null {
  const team = raw?.team || raw?.player || raw;
  const rapidPlayerId = Number(team?.id || raw?.id || 0);
  const fullName = String(team?.name || raw?.name || '').trim();
  if (!rapidPlayerId || !fullName) return null;

  const tour = inferTourFromRankingEntry(raw);
  const gender = tour === 'WTA' ? 'F' : 'M';

  return {
    rapidPlayerId,
    fullName,
    shortName: String(team?.shortName || raw?.shortName || '').trim() || undefined,
    countryCode: String(team?.country?.alpha2 || raw?.country?.alpha2 || '').trim() || undefined,
    tour,
    gender,
    ranking: Number(raw?.ranking || team?.ranking || 0) || undefined,
  };
}

export async function searchPlayersByName(query: string): Promise<PlayerSearchHit[]> {
  const data = await BackendTennisApi.searchPlayers(query);
  const items = Array.isArray(data?.players)
    ? data.players
    : Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data)
        ? data
        : [];

  return items.map(mapSearchHit).filter((hit: PlayerSearchHit | null): hit is PlayerSearchHit => Boolean(hit));
}

export async function registerPlayer(input: {
  rapidPlayerId?: number;
  name?: string;
  tour?: TrackedPlayerTour;
  pickIndex?: number;
  addedBy?: string;
}): Promise<{ player: TrackedPlayerRow; searchHits?: PlayerSearchHit[] }> {
  if (input.rapidPlayerId) {
    const profile = await BackendTennisApi.getPlayerProfile(input.rapidPlayerId);
    const team = (profile as any)?.player || (profile as any)?.team || profile;
    const fullName = String(team?.name || input.name || '').trim();
    if (!fullName) throw new Error('Could not resolve player profile from API');

    const tour =
      input.tour ||
      (String(team?.gender || '').toLowerCase() === 'f' ? 'WTA' : inferTourFromRankingEntry(team));

    const player = TrackedPlayerRepo.upsert({
      rapid_player_id: input.rapidPlayerId,
      tour,
      full_name: fullName,
      short_name: team?.shortName,
      country_code: team?.country?.alpha2,
      current_rank: Number(team?.ranking || 0) || undefined,
      gender: tour === 'WTA' ? 'F' : 'M',
      added_by: input.addedBy || 'manual',
    });
    return { player };
  }

  const query = String(input.name || '').trim();
  if (!query) throw new Error('Provide name or rapidPlayerId');

  const hits = await searchPlayersByName(query);
  if (!hits.length) throw new Error(`No player found for "${query}"`);

  const filtered = input.tour ? hits.filter((h) => h.tour === input.tour) : hits;
  const pool = filtered.length ? filtered : hits;

  if (pool.length > 1 && input.pickIndex === undefined) {
    return { player: undefined as unknown as TrackedPlayerRow, searchHits: pool.slice(0, 8) };
  }

  const pick = pool[input.pickIndex ?? 0];
  const player = TrackedPlayerRepo.upsert({
    rapid_player_id: pick.rapidPlayerId,
    tour: input.tour || pick.tour,
    full_name: pick.fullName,
    short_name: pick.shortName,
    country_code: pick.countryCode,
    current_rank: pick.ranking,
    gender: pick.gender,
    added_by: input.addedBy || 'search',
  });

  return { player };
}

export async function syncTrackedPlayer(
  trackedPlayerId: number,
  options?: SyncPlayerOptions,
): Promise<SyncPlayerResult> {
  const unified = await syncPlayerArchiveUnified(trackedPlayerId, {
    sinceDate: options?.sinceDate,
    maxPages: options?.maxPages,
    linkCsv: options?.linkCsv,
    fetchBundles: options?.fetchBundles ?? options?.fetchStats !== false,
    maxBundleFetches: options?.maxBundleFetches ?? options?.maxStatsFetches ?? 0,
    enrichCsvStats: options?.enrichCsvStats ?? options?.fetchStats !== false,
    bundlesOnly: options?.bundlesOnly,
    fetchAllPages: options?.fetchAllPages,
    refreshEventPages: options?.refreshEventPages,
    csvOnly: options?.csvOnly,
  });

  return {
    playerId: unified.playerId,
    rapidPlayerId: unified.rapidPlayerId,
    pagesFetched: unified.pagesFetched,
    eventsSeen: unified.eventsSeen,
    inserted: unified.inserted,
    updated: unified.updated,
    skipped: unified.skipped,
    statsEnriched: unified.statsEnriched,
    csvLinked: unified.csvLinked,
    bundlesFetched: unified.bundlesFetched,
    bundlesSkippedCached: unified.bundlesSkippedCached,
    hasMorePages: unified.hasMorePages,
    indexSummary: unified.indexSummary,
    lastMatchDate: unified.lastMatchDate,
  };
}

export { getPlayerArchive, getPlayerMatchBundle, linkCsvMatchesForPlayer, reindexAllTrackedPlayersFromHistorical };

export async function bootstrapTopRankedPlayers(options?: {
  limitPerTour?: number;
  autoSync?: boolean;
}): Promise<{ atp: number; wta: number; synced: number }> {
  const limit = Math.min(Math.max(options?.limitPerTour ?? 200, 1), 300);
  let atp = 0;
  let wta = 0;
  let synced = 0;

  for (const tour of ['atp', 'wta'] as const) {
    const data = await BackendTennisApi.getRankings(tour);
    const rows = Array.isArray(data?.rankings) ? data.rankings : Array.isArray(data) ? data : [];
    const slice = rows.slice(0, limit);

    for (const row of slice) {
      const hit = mapSearchHit(row);
      if (!hit) continue;

      const player = TrackedPlayerRepo.upsert({
        rapid_player_id: hit.rapidPlayerId,
        tour: hit.tour,
        full_name: hit.fullName,
        short_name: hit.shortName,
        country_code: hit.countryCode,
        current_rank: hit.ranking,
        gender: hit.gender,
        added_by: 'rankings_bootstrap',
      });

      if (hit.tour === 'ATP') atp++;
      else wta++;

      if (options?.autoSync) {
        try {
          await syncTrackedPlayer(player.id, { maxPages: 8, maxStatsFetches: 15 });
          synced++;
        } catch (err: any) {
          Logger.warn(`Bootstrap sync failed for ${hit.fullName}: ${err.message}`);
        }
      }
    }
  }

  return { atp, wta, synced };
}

export async function syncAllTrackedPlayers(options?: SyncPlayerOptions & { maxPlayers?: number }): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
  results: SyncPlayerResult[];
}> {
  const players = TrackedPlayerRepo.list({ activeOnly: true, limit: options?.maxPlayers || 100 });
  const results: SyncPlayerResult[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const player of players) {
    try {
      const result = await syncTrackedPlayer(player.id, options);
      results.push(result);
      succeeded++;
    } catch (err: any) {
      failed++;
      Logger.warn(`Sync failed for ${player.full_name}: ${err.message}`);
    }
  }

  return { attempted: players.length, succeeded, failed, results };
}

export function getTrackedPlayerStatus(trackedPlayerId: number) {
  const player = TrackedPlayerRepo.getById(trackedPlayerId);
  if (!player) return null;

  const summary = PlayerMatchIndexRepo.summaryForPlayer(trackedPlayerId);
  const matches = PlayerMatchIndexRepo.listForPlayer(trackedPlayerId, 1);

  return {
    ...player,
    coverage: {
      matchesInDb: summary.total,
      matchesWithStats: summary.withCsvStats + summary.withApiStatistics,
      statsCoveragePct: summary.total
        ? Math.round(((summary.withCsvStats + summary.withApiStatistics) / summary.total) * 1000) / 10
        : 0,
      csvStatsPct: summary.total
        ? Math.round((summary.withCsvStats / summary.total) * 1000) / 10
        : 0,
      fullBundlePct: summary.total ? Math.round((summary.full / summary.total) * 1000) / 10 : 0,
      pbpPct: summary.total ? Math.round((summary.withApiPbp / summary.total) * 1000) / 10 : 0,
      lastMatchDate: matches[0]?.match_date || player.last_match_date,
      indexSummary: summary,
    },
  };
}

const PERIOD_FILE_SINCE = '2021-01-01';
const PERIOD_API_SINCE = '2024-01-01';

type PlayerSummaryRow = {
  total: number;
  csv_only: number;
  api_basic: number;
  stats: number;
  full: number;
  withCsvStats: number;
  withApiStatistics: number;
  withApiPbp: number;
  withOdds: number;
  withRank: number;
  withServePct: number;
  lastMatchDate: string | null;
};

function emptyPlayerSummary(): PlayerSummaryRow {
  return {
    total: 0,
    csv_only: 0,
    api_basic: 0,
    stats: 0,
    full: 0,
    withCsvStats: 0,
    withApiStatistics: 0,
    withApiPbp: 0,
    withOdds: 0,
    withRank: 0,
    withServePct: 0,
    lastMatchDate: null,
  };
}

function mapPeriodCoverage(summary: PlayerSummaryRow, sinceDate: string) {
  const total = summary.total || 0;
  const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  return {
    sinceDate,
    matchesInDb: total,
    servePct: pct(summary.withServePct),
    oddsPct: pct(summary.withOdds),
    rankPct: pct(summary.withRank),
  };
}

export function listTrackedPlayersWithCoverage(_sinceDate?: string) {
  const summariesFile = PlayerMatchIndexRepo.summariesForAllPlayers(PERIOD_FILE_SINCE);
  const summariesApi = PlayerMatchIndexRepo.summariesForAllPlayers(PERIOD_API_SINCE);

  return TrackedPlayerRepo.list().map((player) => {
    const fileSummary = summariesFile.get(player.id) || emptyPlayerSummary();
    const apiSummary = summariesApi.get(player.id) || emptyPlayerSummary();
    return {
      ...player,
      coverageFile: mapPeriodCoverage(fileSummary, PERIOD_FILE_SINCE),
      coverageApi: mapPeriodCoverage(apiSummary, PERIOD_API_SINCE),
      coverage: {
        matchesInDb: apiSummary.total,
        matchesWithStats: apiSummary.withCsvStats + apiSummary.withApiStatistics,
        statsCoveragePct: apiSummary.total
          ? Math.round(((apiSummary.withCsvStats + apiSummary.withApiStatistics) / apiSummary.total) * 1000) / 10
          : 0,
        csvStatsPct: apiSummary.total
          ? Math.round((apiSummary.withCsvStats / apiSummary.total) * 1000) / 10
          : 0,
        servePct: mapPeriodCoverage(apiSummary, PERIOD_API_SINCE).servePct,
        oddsPct: mapPeriodCoverage(apiSummary, PERIOD_API_SINCE).oddsPct,
        rankPct: mapPeriodCoverage(apiSummary, PERIOD_API_SINCE).rankPct,
        fullBundlePct: apiSummary.total ? Math.round((apiSummary.full / apiSummary.total) * 1000) / 10 : 0,
        pbpPct: apiSummary.total ? Math.round((apiSummary.withApiPbp / apiSummary.total) * 1000) / 10 : 0,
        lastMatchDate: apiSummary.lastMatchDate || player.last_match_date,
        indexSummary: apiSummary,
      },
    };
  });
}
