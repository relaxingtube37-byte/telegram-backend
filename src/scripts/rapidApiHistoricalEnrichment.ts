import { BackendTennisApi } from '../dataPool/dataPool.tennisApi';
import { Logger } from '../utils/logger';
import { namesLikelyMatch } from './historicalMatchKeys';
import { listSparseHistoricalMatches, patchHistoricalMatchStats } from './historicalMatchInsert';

type StatBucket = {
  aces?: number;
  doubleFaults?: number;
  firstServePoints?: number;
  firstServePointsWon?: number;
  secondServePointsWon?: number;
  breakPointsSaved?: number;
  breakPointsFaced?: number;
  serviceGames?: number;
  servePoints?: number;
};

function toNum(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function pickStatGroup(raw: any, keys: string[]): any {
  if (!raw || typeof raw !== 'object') return null;
  for (const key of keys) {
    if (raw[key]) return raw[key];
  }
  return null;
}

function extractBucket(group: any): StatBucket {
  if (!group || typeof group !== 'object') return {};

  const periods = Array.isArray(group.periods) ? group.periods : [];
  const all = periods.find((p: any) => String(p?.period || '').toUpperCase() === 'ALL') || periods[0] || group;

  return {
    aces: toNum(all.aces ?? all.Aces ?? group.aces),
    doubleFaults: toNum(all.doubleFaults ?? all.double_faults ?? group.doubleFaults),
    firstServePoints: toNum(all.firstServePoints ?? all.first_serve_points ?? all.firstServeTotal),
    firstServePointsWon: toNum(all.firstServePointsWon ?? all.first_serve_points_won),
    secondServePointsWon: toNum(all.secondServePointsWon ?? all.second_serve_points_won),
    breakPointsSaved: toNum(all.breakPointsSaved ?? all.break_points_saved),
    breakPointsFaced: toNum(all.breakPointsFaced ?? all.break_points_faced),
    serviceGames: toNum(all.serviceGames ?? all.service_games),
    servePoints: toNum(all.servePoints ?? all.service_points ?? all.totalServePoints),
  };
}

export function mapStatisticsToWinnerLoser(
  stats: any,
  winnerName: string,
  loserName: string,
  homeName: string,
  awayName: string,
): { winner: StatBucket; loser: StatBucket } | null {
  const homeGroup = pickStatGroup(stats, ['home', 'homeTeam', 'player1', 'team1']);
  const awayGroup = pickStatGroup(stats, ['away', 'awayTeam', 'player2', 'team2']);
  if (!homeGroup || !awayGroup) return null;

  const homeBucket = extractBucket(homeGroup);
  const awayBucket = extractBucket(awayGroup);

  const winnerIsHome = namesLikelyMatch(winnerName, homeName) || namesLikelyMatch(loserName, awayName);
  const winnerIsAway = namesLikelyMatch(winnerName, awayName) || namesLikelyMatch(loserName, homeName);

  if (winnerIsHome && !winnerIsAway) return { winner: homeBucket, loser: awayBucket };
  if (winnerIsAway && !winnerIsHome) return { winner: awayBucket, loser: homeBucket };
  return null;
}

export function bucketToPatch(side: 'w' | 'l', bucket: StatBucket) {
  const firstIn = bucket.firstServePoints || 0;
  const secondWon = bucket.secondServePointsWon || 0;
  const svpt = bucket.servePoints || firstIn + secondWon;

  return {
    [`${side}_ace`]: bucket.aces || 0,
    [`${side}_df`]: bucket.doubleFaults || 0,
    [`${side}_svpt`]: svpt,
    [`${side}_1stIn`]: firstIn,
    [`${side}_1stWon`]: bucket.firstServePointsWon || 0,
    [`${side}_2ndWon`]: secondWon,
    [`${side}_SvGms`]: bucket.serviceGames || 0,
    [`${side}_bpSaved`]: bucket.breakPointsSaved || 0,
    [`${side}_bpFaced`]: bucket.breakPointsFaced || 0,
  };
}

function eventLooksFinished(ev: any): boolean {
  const status = String(ev?.status?.type || ev?.status?.description || '').toLowerCase();
  return status.includes('finished') || status.includes('ended') || status === 'ft';
}

export function eventPlayers(ev: any): { home: string; away: string; categoryId: number } {
  return {
    home: String(ev?.homeTeam?.name || ev?.home?.name || ''),
    away: String(ev?.awayTeam?.name || ev?.away?.name || ''),
    categoryId: Number(ev?.tournament?.category?.id || 0),
  };
}

export async function enrichSparseHistoricalMatchesFromRapidApi(options?: {
  maxRows?: number;
  sinceDate?: string;
}): Promise<{ attempted: number; enriched: number }> {
  const sparseRows = listSparseHistoricalMatches({
    sinceDate: options?.sinceDate || '2024-01-01',
    limit: options?.maxRows || 120,
  });

  const dailyCache = new Map<string, any[]>();
  let enriched = 0;

  for (const row of sparseRows) {
    const daily = dailyCache.get(row.match_date) || (await loadDailyEvents(row.match_date));
    dailyCache.set(row.match_date, daily);

    const wantedCategory = row.tour === 'WTA' ? 6 : 3;
    const candidate = daily.find((ev) => {
      if (!eventLooksFinished(ev)) return false;
      const players = eventPlayers(ev);
      if (wantedCategory && players.categoryId && players.categoryId !== wantedCategory) return false;
      const homeWin =
        namesLikelyMatch(row.winner_name, players.home) && namesLikelyMatch(row.loser_name, players.away);
      const awayWin =
        namesLikelyMatch(row.winner_name, players.away) && namesLikelyMatch(row.loser_name, players.home);
      return homeWin || awayWin;
    });

    if (!candidate?.id) continue;

    const stats = await BackendTennisApi.getEventStatistics(candidate.id);
    const players = eventPlayers(candidate);
    const mapped = mapStatisticsToWinnerLoser(stats, row.winner_name, row.loser_name, players.home, players.away);
    if (!mapped || mapped.winner.servePoints === 0 && mapped.winner.firstServePoints === 0) continue;

    const patch = {
      ...bucketToPatch('w', mapped.winner),
      ...bucketToPatch('l', mapped.loser),
    };

    if (patchHistoricalMatchStats(row.id, patch)) {
      enriched++;
      Logger.info(`Enriched match #${row.id} via RapidAPI event ${candidate.id}`);
    }
  }

  return { attempted: sparseRows.length, enriched };
}

async function loadDailyEvents(dateStr: string): Promise<any[]> {
  const daily = await BackendTennisApi.getDailyEvents(dateStr);
  return Array.isArray(daily?.events) ? daily.events : [];
}
