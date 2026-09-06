import type { HistoricalMatchRecord } from '../scripts/historicalMatchInsert';
import { namesLikelyMatch } from '../scripts/historicalMatchKeys';

export function eventLooksFinished(ev: any): boolean {
  const status = String(ev?.status?.type || ev?.status?.description || '').toLowerCase();
  return status.includes('finished') || status.includes('ended') || status === 'ft';
}

export function detectTourFromEvent(ev: any): 'ATP' | 'WTA' {
  const catId = Number(ev?.tournament?.category?.id || 0);
  const catName = String(ev?.tournament?.category?.name || '').toUpperCase();
  if (catId === 6 || catName.includes('WTA')) return 'WTA';
  return 'ATP';
}

function parseDurationMinutes(ev: any): number {
  if (typeof ev?.time === 'number' && ev.time > 0) return Math.round(ev.time / 60);
  if (ev?.time?.played) return Math.round(Number(ev.time.played) / 60);
  if (ev?.timeMinutes) return Number(ev.timeMinutes);
  return 0;
}

function formatSetScore(home?: number, away?: number): string | null {
  if (home === undefined || away === undefined) return null;
  if (Number.isNaN(home) || Number.isNaN(away)) return null;
  return `${home}-${away}`;
}

export function formatEventScore(ev: any): string {
  const home = ev?.homeScore || {};
  const away = ev?.awayScore || {};
  const sets: string[] = [];

  for (let i = 1; i <= 5; i++) {
    const part = formatSetScore(home[`period${i}`], away[`period${i}`]);
    if (part) sets.push(part);
  }

  if (sets.length) return sets.join(' ');

  const h = home.display ?? home.current;
  const a = away.display ?? away.current;
  if (h !== undefined && a !== undefined) return `${h}-${a}`;
  return 'W/O';
}

function coalesceRank(team: any): number {
  const candidates = [team?.ranking, team?.playerTeamInfo?.ranking, team?.rank];
  for (const val of candidates) {
    const n = Number(val);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function winnerIsHome(ev: any): boolean {
  if (ev?.winnerCode === 1) return true;
  if (ev?.winnerCode === 2) return false;
  const h = Number(ev?.homeScore?.display ?? ev?.homeScore?.current ?? 0);
  const a = Number(ev?.awayScore?.display ?? ev?.awayScore?.current ?? 0);
  if (h > a) return true;
  if (a > h) return false;
  return false;
}

export function mapRapidEventToHistoricalMatch(ev: any): HistoricalMatchRecord | null {
  if (!ev?.id || !eventLooksFinished(ev)) return null;

  const homeName = String(ev?.homeTeam?.name || ev?.home?.name || '').trim();
  const awayName = String(ev?.awayTeam?.name || ev?.away?.name || '').trim();
  if (!homeName || !awayName) return null;

  const homeWon = winnerIsHome(ev);
  const winnerTeam = homeWon ? ev.homeTeam || ev.home : ev.awayTeam || ev.away;
  const loserTeam = homeWon ? ev.awayTeam || ev.away : ev.homeTeam || ev.home;
  const winnerName = homeWon ? homeName : awayName;
  const loserName = homeWon ? awayName : homeName;

  const dateObj = new Date((ev.startTimestamp || Date.now() / 1000) * 1000);
  const matchDate = dateObj.toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const tour = detectTourFromEvent(ev);
  const surface =
    String(ev?.groundType || ev?.tournament?.uniqueTournament?.groundType || 'Hard').replace(/_/g, ' ') || 'Hard';
  const roundName =
    ev?.roundInfo?.name || ev?.roundInfo?.slug || (ev?.roundInfo?.round ? `Round ${ev.roundInfo.round}` : 'R32');

  return {
    tour,
    tourney_id: String(ev?.tournament?.uniqueTournament?.id || ev?.tournament?.id || ''),
    tourney_name: String(ev?.tournament?.name || ev?.tournament?.uniqueTournament?.name || 'Tennis Tournament'),
    tourney_level: 'A',
    draw_size: 0,
    surface,
    match_date: matchDate,
    match_num: Number(ev?.roundInfo?.round || 0) || 0,
    round_name: String(roundName),
    winner_id: Number(winnerTeam?.id || 0),
    winner_seed: typeof winnerTeam?.seed === 'number' ? winnerTeam.seed : 0,
    winner_entry: '',
    winner_name: winnerName,
    winner_hand: 'R',
    winner_ht: 0,
    winner_ioc: String(winnerTeam?.country?.alpha2 || winnerTeam?.country?.alpha3 || ''),
    winner_age: 0,
    winner_rank: coalesceRank(winnerTeam),
    winner_rank_points: 0,
    loser_id: Number(loserTeam?.id || 0),
    loser_seed: typeof loserTeam?.seed === 'number' ? loserTeam.seed : 0,
    loser_entry: '',
    loser_name: loserName,
    loser_hand: 'R',
    loser_ht: 0,
    loser_ioc: String(loserTeam?.country?.alpha2 || loserTeam?.country?.alpha3 || ''),
    loser_age: 0,
    loser_rank: coalesceRank(loserTeam),
    loser_rank_points: 0,
    score: formatEventScore(ev),
    best_of: 3,
    minutes: parseDurationMinutes(ev),
    w_ace: 0,
    w_df: 0,
    w_svpt: 0,
    w_1stIn: 0,
    w_1stWon: 0,
    w_2ndWon: 0,
    w_SvGms: 0,
    w_bpSaved: 0,
    w_bpFaced: 0,
    l_ace: 0,
    l_df: 0,
    l_svpt: 0,
    l_1stIn: 0,
    l_1stWon: 0,
    l_2ndWon: 0,
    l_SvGms: 0,
    l_bpSaved: 0,
    l_bpFaced: 0,
    created_at: now,
    rapid_event_id: Number(ev.id),
  };
}

export function eventInvolvesPlayer(ev: any, playerName: string, rapidPlayerId?: number): boolean {
  const homeId = Number(ev?.homeTeam?.id || ev?.home?.id || 0);
  const awayId = Number(ev?.awayTeam?.id || ev?.away?.id || 0);
  if (rapidPlayerId && (homeId === rapidPlayerId || awayId === rapidPlayerId)) return true;

  const homeName = String(ev?.homeTeam?.name || ev?.home?.name || '');
  const awayName = String(ev?.awayTeam?.name || ev?.away?.name || '');
  return namesLikelyMatch(homeName, playerName) || namesLikelyMatch(awayName, playerName);
}
