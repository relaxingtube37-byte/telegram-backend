import type { HistoricalMatchRecord } from './historicalMatchInsert';

export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseDateStr(raw: string): string {
  if (!raw || raw.length < 8) return new Date().toISOString().slice(0, 10);
  const y = raw.slice(0, 4);
  const m = raw.slice(4, 6);
  const d = raw.slice(6, 8);
  return `${y}-${m}-${d}`;
}

function toInt(val: unknown, defaultVal = 0): number {
  const n = parseInt(String(val || ''), 10);
  return Number.isNaN(n) ? defaultVal : n;
}

function toFloat(val: unknown, defaultVal = 0): number {
  const n = parseFloat(String(val || ''));
  return Number.isNaN(n) ? defaultVal : n;
}

export function parseCsvTextToMatchRecords(csvText: string, tour: 'ATP' | 'WTA'): HistoricalMatchRecord[] {
  if (csvText.startsWith('version https://git-lfs')) {
    return [];
  }

  const lines = csvText.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return [];

  const headers = parseCSVLine(lines[0]);
  const headerMap: Record<string, number> = {};
  headers.forEach((h, idx) => {
    headerMap[h.trim()] = idx;
  });

  const getCol = (row: string[], name: string): string => {
    const idx = headerMap[name];
    return idx !== undefined && row[idx] !== undefined ? row[idx].replace(/^"|"$/g, '').trim() : '';
  };

  const now = new Date().toISOString();
  const records: HistoricalMatchRecord[] = [];

  for (const r of lines.slice(1).map(parseCSVLine)) {
    const winnerName = getCol(r, 'winner_name');
    const loserName = getCol(r, 'loser_name');
    if (!winnerName || !loserName) continue;

    records.push({
      tour,
      tourney_id: getCol(r, 'tourney_id'),
      tourney_name: getCol(r, 'tourney_name') || 'Tour Event',
      tourney_level: getCol(r, 'tourney_level') || 'A',
      draw_size: toInt(getCol(r, 'draw_size')),
      surface: getCol(r, 'surface') || 'Hard',
      match_date: parseDateStr(getCol(r, 'tourney_date')),
      match_num: toInt(getCol(r, 'match_num')),
      round_name: getCol(r, 'round') || 'R32',
      winner_id: toInt(getCol(r, 'winner_id')),
      winner_seed: toInt(getCol(r, 'winner_seed')),
      winner_entry: getCol(r, 'winner_entry') || '',
      winner_name: winnerName,
      winner_hand: getCol(r, 'winner_hand') || 'R',
      winner_ht: toInt(getCol(r, 'winner_ht')),
      winner_ioc: getCol(r, 'winner_ioc') || '',
      winner_age: toFloat(getCol(r, 'winner_age')),
      winner_rank: toInt(getCol(r, 'winner_rank')),
      winner_rank_points: toInt(getCol(r, 'winner_rank_points')),
      loser_id: toInt(getCol(r, 'loser_id')),
      loser_seed: toInt(getCol(r, 'loser_seed')),
      loser_entry: getCol(r, 'loser_entry') || '',
      loser_name: loserName,
      loser_hand: getCol(r, 'loser_hand') || 'R',
      loser_ht: toInt(getCol(r, 'loser_ht')),
      loser_ioc: getCol(r, 'loser_ioc') || '',
      loser_age: toFloat(getCol(r, 'loser_age')),
      loser_rank: toInt(getCol(r, 'loser_rank')),
      loser_rank_points: toInt(getCol(r, 'loser_rank_points')),
      score: getCol(r, 'score') || 'W/O',
      best_of: toInt(getCol(r, 'best_of'), 3),
      minutes: toInt(getCol(r, 'minutes')),
      w_ace: toInt(getCol(r, 'w_ace')),
      w_df: toInt(getCol(r, 'w_df')),
      w_svpt: toInt(getCol(r, 'w_svpt')),
      w_1stIn: toInt(getCol(r, 'w_1stIn')),
      w_1stWon: toInt(getCol(r, 'w_1stWon')),
      w_2ndWon: toInt(getCol(r, 'w_2ndWon')),
      w_SvGms: toInt(getCol(r, 'w_SvGms')),
      w_bpSaved: toInt(getCol(r, 'w_bpSaved')),
      w_bpFaced: toInt(getCol(r, 'w_bpFaced')),
      l_ace: toInt(getCol(r, 'l_ace')),
      l_df: toInt(getCol(r, 'l_df')),
      l_svpt: toInt(getCol(r, 'l_svpt')),
      l_1stIn: toInt(getCol(r, 'l_1stIn')),
      l_1stWon: toInt(getCol(r, 'l_1stWon')),
      l_2ndWon: toInt(getCol(r, 'l_2ndWon')),
      l_SvGms: toInt(getCol(r, 'l_SvGms')),
      l_bpSaved: toInt(getCol(r, 'l_bpSaved')),
      l_bpFaced: toInt(getCol(r, 'l_bpFaced')),
      created_at: now,
    });
  }

  return records;
}
