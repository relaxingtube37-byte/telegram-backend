import { Logger } from '../utils/logger';
import { upsertHistoricalMatchRecords, type HistoricalMatchRecord } from './historicalMatchInsert';

const WTA_API_BASE = 'https://api.wtatennis.com/tennis';

interface WtaTournamentEntry {
  tournamentGroup: { id: number; name: string; level: string };
  year: number;
  title: string;
  startDate: string;
  surface: string;
  singlesDrawSize: number;
}

interface WtaApiMatch {
  DrawLevelType: string;
  DrawMatchType: string;
  MatchState: string;
  MatchID: string;
  MatchTimeStamp?: string;
  NumSets?: number;
  PlayerIDA?: string;
  PlayerIDB?: string;
  PlayerNameFirstA?: string;
  PlayerNameLastA?: string;
  PlayerNameFirstB?: string;
  PlayerNameLastB?: string;
  PlayerCountryA?: string;
  PlayerCountryB?: string;
  SeedA?: string;
  SeedB?: string;
  ScoreString?: string;
  ResultString?: string;
  Winner?: string;
  DateSeq?: number;
  EventID?: string;
}

async function fetchWtaJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'telegram-backend/1.0',
    },
  });
  if (!response.ok) {
    throw new Error(`WTA API ${response.status} for ${url}`);
  }
  return response.json() as Promise<T>;
}

async function listWtaTournaments(year: number): Promise<WtaTournamentEntry[]> {
  const tournaments: WtaTournamentEntry[] = [];
  let page = 0;

  while (true) {
    const url = `${WTA_API_BASE}/tournaments/?page=${page}&pageSize=100&excludeLevels=ITF&from=${year}-01-01&to=${year}-12-31`;
    const data = await fetchWtaJson<{
      pageInfo: { page: number; numPages: number };
      content: WtaTournamentEntry[];
    }>(url);

    tournaments.push(...(data.content || []));
    if (page + 1 >= data.pageInfo.numPages) break;
    page++;
  }

  return tournaments;
}

function playerFullName(first?: string, last?: string): string {
  return [first, last].filter(Boolean).join(' ').trim();
}

function parseSeed(raw?: string): number {
  const n = parseInt(String(raw || ''), 10);
  return Number.isNaN(n) ? 0 : n;
}

function parseMatchDate(raw?: string, fallback?: string): string {
  if (raw) return raw.slice(0, 10);
  if (fallback) return fallback.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function mapTourneyLevel(level?: string): string {
  const value = String(level || '').toUpperCase();
  if (value.includes('GRAND SLAM')) return 'G';
  if (value.includes('1000')) return 'W';
  if (value.includes('500')) return 'P';
  if (value.includes('250')) return 'I';
  if (value.includes('125')) return '125';
  return 'A';
}

function mapApiMatchToRecord(
  match: WtaApiMatch,
  tournament: WtaTournamentEntry,
  matchIndex: number
): HistoricalMatchRecord | null {
  if (match.DrawMatchType !== 'S' || match.MatchState !== 'F' || match.DrawLevelType !== 'M') {
    return null;
  }

  const playerA = playerFullName(match.PlayerNameFirstA, match.PlayerNameLastA);
  const playerB = playerFullName(match.PlayerNameFirstB, match.PlayerNameLastB);
  if (!playerA || !playerB) return null;

  const winnerIsB = match.Winner === '3';
  const winnerName = winnerIsB ? playerB : playerA;
  const loserName = winnerIsB ? playerA : playerB;
  const winnerId = parseInt(winnerIsB ? match.PlayerIDB || '0' : match.PlayerIDA || '0', 10) || 0;
  const loserId = parseInt(winnerIsB ? match.PlayerIDA || '0' : match.PlayerIDB || '0', 10) || 0;
  const winnerSeed = parseSeed(winnerIsB ? match.SeedB : match.SeedA);
  const loserSeed = parseSeed(winnerIsB ? match.SeedA : match.SeedB);
  const winnerIoc = winnerIsB ? match.PlayerCountryB || '' : match.PlayerCountryA || '';
  const loserIoc = winnerIsB ? match.PlayerCountryA || '' : match.PlayerCountryB || '';
  const score = match.ScoreString || match.ResultString || 'W/O';
  const now = new Date().toISOString();

  return {
    tour: 'WTA',
    tourney_id: String(match.EventID || tournament.tournamentGroup.id),
    tourney_name: tournament.title || tournament.tournamentGroup.name,
    tourney_level: mapTourneyLevel(tournament.tournamentGroup.level),
    draw_size: tournament.singlesDrawSize || 0,
    surface: tournament.surface || 'Hard',
    match_date: parseMatchDate(match.MatchTimeStamp, tournament.startDate),
    match_num: match.DateSeq || matchIndex + 1,
    round_name: 'R32',
    winner_id: winnerId,
    winner_seed: winnerSeed,
    winner_entry: '',
    winner_name: winnerName,
    winner_hand: 'R',
    winner_ht: 0,
    winner_ioc: winnerIoc,
    winner_age: 0,
    winner_rank: 0,
    winner_rank_points: 0,
    loser_id: loserId,
    loser_seed: loserSeed,
    loser_entry: '',
    loser_name: loserName,
    loser_hand: 'R',
    loser_ht: 0,
    loser_ioc: loserIoc,
    loser_age: 0,
    loser_rank: 0,
    loser_rank_points: 0,
    score,
    best_of: match.NumSets || 3,
    minutes: 0,
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
  };
}

export async function importWtaYearFromApi(year: number): Promise<number> {
  Logger.info(`📡 Fetching WTA Tour ${year} from official api.wtatennis.com...`);

  const tournaments = await listWtaTournaments(year);
  const records: HistoricalMatchRecord[] = [];

  for (const tournament of tournaments) {
    const groupId = tournament.tournamentGroup.id;
    const url = `${WTA_API_BASE}/tournaments/${groupId}/${tournament.year}/matches`;

    try {
      const data = await fetchWtaJson<{ matches?: WtaApiMatch[] }>(url);
      const matches = data.matches || [];

      matches.forEach((match, index) => {
        const record = mapApiMatchToRecord(match, tournament, index);
        if (record) records.push(record);
      });
    } catch (err: any) {
      Logger.warn(`⚠️ Skipped WTA tournament ${groupId}/${tournament.year}: ${err.message}`);
    }
  }

  const summary = upsertHistoricalMatchRecords(records);
  Logger.success(
    `✅ WTA API ${year}: inserted ${summary.inserted}, updated ${summary.updated}, skipped ${summary.skipped}`,
  );
  return summary.inserted + summary.updated;
}
