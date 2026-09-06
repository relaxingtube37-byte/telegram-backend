import { parseCSVLine } from './csvMatchParser';
import type { HistoricalMatchRecord } from './historicalMatchInsert';

const MONTH_MAP: Record<string, string> = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};

function toInt(val: string, defaultVal = 0): number {
  const n = parseInt(val, 10);
  return Number.isNaN(n) ? defaultVal : n;
}

function toFloatOrNull(val: string): number | null {
  if (!val?.trim()) return null;
  const n = parseFloat(val);
  return Number.isNaN(n) || n <= 0 ? null : n;
}

function toIntOrNull(val: string): number | null {
  if (!val?.trim()) return null;
  const n = parseInt(val, 10);
  return Number.isNaN(n) || n <= 0 ? null : n;
}

function parseHumanDate(raw: string): string {
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 3) return new Date().toISOString().slice(0, 10);
  const [day, mon, year] = parts;
  const mm = MONTH_MAP[mon] || '01';
  return `${year}-${mm}-${day.padStart(2, '0')}`;
}

function buildScore(row: Record<string, string>, homeWon: boolean): string {
  const sets: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const h = row[`home_set_${i}_score`]?.trim();
    const a = row[`away_set_${i}_score`]?.trim();
    if (!h && !a) break;
    if (!h && !a) continue;
    const homeGames = Number(h || 0);
    const awayGames = Number(a || 0);
    if (homeWon) {
      sets.push(`${homeGames}-${awayGames}`);
    } else {
      sets.push(`${awayGames}-${homeGames}`);
    }
  }
  return sets.length ? sets.join(' ') : 'W/O';
}

function pickSide<T>(homeWon: boolean, homeVal: T, awayVal: T): { winner: T; loser: T } {
  return homeWon ? { winner: homeVal, loser: awayVal } : { winner: awayVal, loser: homeVal };
}

export function parseSeasonCsvTextToMatchRecords(csvText: string, tour: 'ATP' | 'WTA'): HistoricalMatchRecord[] {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return [];

  const headers = parseCSVLine(lines[0]);
  const now = new Date().toISOString();
  const records: HistoricalMatchRecord[] = [];

  for (const line of lines.slice(1)) {
    const cols = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (cols[idx] || '').replace(/^"|"$/g, '').trim();
    });

    if (row.status_extra !== 'FINISHED') continue;
    if (!row.home_name || !row.away_name) continue;
    if (!row.home_set_score?.trim() && !row.home_set_1_score?.trim()) continue;

    const homeWon = row.winner_code === '1';
    const winnerName = homeWon ? row.home_name : row.away_name;
    const loserName = homeWon ? row.away_name : row.home_name;

    const ranks = pickSide(homeWon, toIntOrNull(row.home_rank), toIntOrNull(row.away_rank));
    const points = pickSide(homeWon, toIntOrNull(row.home_points), toIntOrNull(row.away_points));
    const ids = pickSide(homeWon, toIntOrNull(row.home_id), toIntOrNull(row.away_id));
    const oddsMatch = pickSide(
      homeWon,
      toFloatOrNull(row.home_odds_match_winner),
      toFloatOrNull(row.away_odds_match_winner),
    );
    const oddsSet1 = pickSide(
      homeWon,
      toFloatOrNull(row.home_odds_first_set_winner),
      toFloatOrNull(row.away_odds_first_set_winner),
    );
    const servePct = pickSide(
      homeWon,
      toFloatOrNull(row.home_service_points_won_perc),
      toFloatOrNull(row.away_service_points_won_perc),
    );
    const returnPct = pickSide(
      homeWon,
      toFloatOrNull(row.home_return_points_won_perc),
      toFloatOrNull(row.away_return_points_won_perc),
    );
    const bpWonPct = pickSide(
      homeWon,
      toFloatOrNull(row.home_break_points_won_perc),
      toFloatOrNull(row.away_break_points_won_perc),
    );
    const bpSavedPct = pickSide(
      homeWon,
      toFloatOrNull(row.home_break_points_saved_perc),
      toFloatOrNull(row.away_break_points_saved_perc),
    );
    const aces = pickSide(homeWon, toInt(row.home_aces), toInt(row.away_aces));
    const dfs = pickSide(homeWon, toInt(row.home_double_faults), toInt(row.away_double_faults));
    const hasServe = servePct.winner != null || servePct.loser != null;

    records.push({
      tour,
      tourney_id: row.match_id || '',
      tourney_name: row.tournament || 'Tour Event',
      tourney_level: row.tournament?.toLowerCase().includes('chall') ? 'C' : 'A',
      draw_size: 0,
      surface: (row.surface || 'hard').replace(/^./, (c) => c.toUpperCase()),
      match_date: parseHumanDate(row.date_human || ''),
      match_num: 0,
      round_name: row.round || 'R32',
      winner_id: ids.winner ?? 0,
      winner_seed: 0,
      winner_entry: '',
      winner_name: winnerName,
      winner_hand: 'R',
      winner_ht: 0,
      winner_ioc: '',
      winner_age: 0,
      winner_rank: ranks.winner ?? 0,
      winner_rank_points: points.winner ?? 0,
      loser_id: ids.loser ?? 0,
      loser_seed: 0,
      loser_entry: '',
      loser_name: loserName,
      loser_hand: 'R',
      loser_ht: 0,
      loser_ioc: '',
      loser_age: 0,
      loser_rank: ranks.loser ?? 0,
      loser_rank_points: points.loser ?? 0,
      score: buildScore(row, homeWon),
      best_of: 3,
      minutes: 0,
      w_ace: aces.winner,
      w_df: dfs.winner,
      w_svpt: hasServe ? 100 : 0,
      w_1stIn: 0,
      w_1stWon: 0,
      w_2ndWon: 0,
      w_SvGms: 0,
      w_bpSaved: 0,
      w_bpFaced: 0,
      l_ace: aces.loser,
      l_df: dfs.loser,
      l_svpt: hasServe ? 100 : 0,
      l_1stIn: 0,
      l_1stWon: 0,
      l_2ndWon: 0,
      l_SvGms: 0,
      l_bpSaved: 0,
      l_bpFaced: 0,
      w_odds_match: oddsMatch.winner,
      l_odds_match: oddsMatch.loser,
      w_odds_set1: oddsSet1.winner,
      l_odds_set1: oddsSet1.loser,
      w_serve_won_pct: servePct.winner,
      l_serve_won_pct: servePct.loser,
      w_return_won_pct: returnPct.winner,
      l_return_won_pct: returnPct.loser,
      w_bp_won_pct: bpWonPct.winner,
      l_bp_won_pct: bpWonPct.loser,
      w_bp_saved_pct: bpSavedPct.winner,
      l_bp_saved_pct: bpSavedPct.loser,
      created_at: now,
      rapid_event_id: toInt(row.match_id) || undefined,
    });
  }

  return records;
}
