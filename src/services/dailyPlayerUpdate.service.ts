import { db } from '../db/connection';
import { TrackedPlayerRepo, type TrackedPlayerRow } from '../db/repositories/trackedPlayer.repo';
import { PlayerMatchIndexRepo } from '../db/repositories/playerMatchIndex.repo';
import { Logger } from '../utils/logger';
import { mergeApiMetadataOntoCsvRows } from './historicalMatchMerge.service';
import {
  enrichPlayerApiGaps,
  fillMissingRanksForPlayer,
  listRankGaps,
} from './incrementalApiEnrichment.service';
import { fetchDailyEventsForTour } from './matchEnsure.service';
import { syncPlayerArchiveUnified } from './playerArchive.service';

export interface DailyPlayerUpdateOptions {
  lookbackDays?: number;
  maxPlayers?: number;
  maxApiCalls?: number;
  maxEventPages?: number;
}

export interface DailyPlayerUpdateResult {
  datesWarmed: string[];
  playersProcessed: number;
  playersSynced: number;
  matchesInserted: number;
  matchesUpdated: number;
  ranksMerged: number;
  ranksFilled: number;
  oddsFilled: number;
  apiCalls: number;
  skippedBudget: number;
}

const CALENDAR_WARM_DAYS = 7;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Recent calendar dates for live/upcoming match detection (small API footprint). */
function calendarDatesToWarm(): string[] {
  const out = new Set<string>();
  const today = new Date();
  for (let offset = -CALENDAR_WARM_DAYS; offset <= 1; offset++) {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    out.add(isoDate(d));
  }
  return [...out].sort();
}

function playersNeedingUpdate(sinceDate: string, limit: number): TrackedPlayerRow[] {
  return db
    .prepare(
      `
    SELECT tp.*
    FROM tracked_players tp
    WHERE tp.is_active = 1
    ORDER BY
      CASE WHEN tp.tour = 'WTA' THEN 0 ELSE 1 END,
      (
        SELECT COUNT(*)
        FROM player_match_index pmi
        JOIN historical_matches h ON h.id = pmi.historical_match_id
        WHERE pmi.tracked_player_id = tp.id
          AND pmi.match_date >= @sinceDate
          AND pmi.has_csv_stats = 1
          AND COALESCE(h.winner_rank, 0) = 0
          AND COALESCE(h.loser_rank, 0) = 0
      ) DESC,
      tp.current_rank ASC
    LIMIT @limit
  `,
    )
    .all({ sinceDate, limit }) as TrackedPlayerRow[];
}

function playerInDailyEvents(player: TrackedPlayerRow, events: any[]): boolean {
  return events.some(
    (ev) =>
      Number(ev?.homeTeam?.id) === player.rapid_player_id ||
      Number(ev?.awayTeam?.id) === player.rapid_player_id,
  );
}

function playerNeedsRecentSync(player: TrackedPlayerRow, playingSoon: boolean): boolean {
  if (playingSoon) return true;
  if (!player.last_match_date) return true;
  const staleCutoff = isoDate(new Date(Date.now() - 4 * 24 * 60 * 60 * 1000));
  return player.last_match_date < staleCutoff;
}

/** Low-call daily refresh for upcoming/recent matches and WTA rank gaps. */
export async function runDailyPlayerUpdate(
  options?: DailyPlayerUpdateOptions,
): Promise<DailyPlayerUpdateResult> {
  const lookbackDays = options?.lookbackDays ?? 21;
  const maxPlayers = options?.maxPlayers ?? 40;
  const maxApiCalls = options?.maxApiCalls ?? 120;
  const maxEventPages = Math.min(options?.maxEventPages ?? 1, 2);

  const sinceDate = isoDate(new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000));
  const datesWarmed = calendarDatesToWarm();
  const calendarBudget = datesWarmed.length * 2;
  const syncBudgetLimit = Math.floor(maxApiCalls * 0.35);

  let apiCalls = 0;
  let ranksMerged = 0;
  let ranksFilled = 0;
  let oddsFilled = 0;
  let matchesInserted = 0;
  let matchesUpdated = 0;
  let playersSynced = 0;
  let skippedBudget = 0;

  const dailyByTour: Record<'ATP' | 'WTA', Map<string, any[]>> = {
    ATP: new Map(),
    WTA: new Map(),
  };

  for (const date of datesWarmed) {
    if (apiCalls >= calendarBudget) break;
    for (const tour of ['ATP', 'WTA'] as const) {
      if (apiCalls >= calendarBudget) break;
      const events = await fetchDailyEventsForTour(date, tour);
      dailyByTour[tour].set(date, events);
      apiCalls += 1;
    }
  }

  const players = playersNeedingUpdate(sinceDate, maxPlayers);
  let playersProcessed = 0;

  for (const player of players) {
    if (apiCalls >= maxApiCalls) {
      skippedBudget += 1;
      continue;
    }

    const playingSoon = datesWarmed.some((date) =>
      playerInDailyEvents(player, dailyByTour[player.tour].get(date) || []),
    );
    const rankGaps = listRankGaps(player.id, sinceDate).length;
    const needsSync = playerNeedsRecentSync(player, playingSoon);

    if (!needsSync && rankGaps === 0) continue;

    playersProcessed += 1;
    ranksMerged += mergeApiMetadataOntoCsvRows(player.id, sinceDate);

    // Only fetch new matches for active/stale players — 1 page is enough for catch-up.
    if (needsSync && apiCalls < syncBudgetLimit && apiCalls < maxApiCalls) {
      const sync = await syncPlayerArchiveUnified(player.id, {
        sinceDate,
        linkCsv: false,
        maxPages: maxEventPages,
        fetchAllPages: false,
        refreshEventPages: true,
        fetchBundles: false,
        enrichCsvStats: false,
      });
      apiCalls += sync.pagesFetched;
      matchesInserted += sync.inserted;
      matchesUpdated += sync.updated;
      playersSynced += 1;
      ranksMerged += mergeApiMetadataOntoCsvRows(player.id, sinceDate);
    }

    if (apiCalls < maxApiCalls && listRankGaps(player.id, sinceDate).length > 0) {
      const rankPages = player.tour === 'WTA' ? 4 : 2;
      const rankResult = await fillMissingRanksForPlayer(
        player.id,
        player.rapid_player_id,
        player.full_name,
        sinceDate,
        { maxPages: rankPages, maxDetailFallbacks: 2 },
      );
      apiCalls += rankResult.apiCalls;
      ranksFilled += rankResult.rankFilled;
      if (apiCalls >= maxApiCalls) {
        skippedBudget += 1;
      }
    }

    if (apiCalls < maxApiCalls) {
      const enrich = await enrichPlayerApiGaps(player.id, sinceDate, {
        maxOddsDates: Math.min(lookbackDays, 7),
        maxPerMatchOddsFallbacks: 1,
        maxStatsFetches: 0,
      });
      apiCalls += enrich.apiCalls;
      oddsFilled += enrich.oddsMatchesFilled;
    }

    const summary = PlayerMatchIndexRepo.summaryForPlayer(player.id);
    TrackedPlayerRepo.setSyncStatus(player.id, {
      matches_in_db: summary.total,
      matches_with_stats: summary.withCsvStats + summary.withApiStatistics,
      last_sync_at: new Date().toISOString(),
    });
  }

  Logger.info(
    `[DailyUpdate] players=${playersProcessed} synced=${playersSynced} inserted=${matchesInserted} updated=${matchesUpdated} merged=${ranksMerged} ranks=${ranksFilled} odds=${oddsFilled} calls=${apiCalls} skipped=${skippedBudget}`,
  );

  return {
    datesWarmed,
    playersProcessed,
    playersSynced,
    matchesInserted,
    matchesUpdated,
    ranksMerged,
    ranksFilled,
    oddsFilled,
    apiCalls,
    skippedBudget,
  };
}
