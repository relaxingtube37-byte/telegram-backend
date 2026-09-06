import fs from 'node:fs';
import path from 'node:path';
import { parseCSVLine } from './csvMatchParser';

const dataDir = 'G:/state football/2021-2026-data';
const files = fs.readdirSync(dataDir).filter((f) => f.endsWith('-season.csv')).sort();

function pct(n: number, d: number) {
  return d ? Math.round((n / d) * 1000) / 10 : 0;
}

for (const file of files) {
  const text = fs.readFileSync(path.join(dataDir, file), 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCSVLine(lines[0]);
  const idx = (name: string) => headers.indexOf(name);

  let total = 0;
  let rank = 0;
  let points = 0;
  let odds = 0;
  let serve = 0;
  let aces = 0;

  for (const line of lines.slice(1)) {
    const cols = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (cols[i] || '').replace(/^"|"$/g, '').trim();
    });
    if (row.status_extra !== 'FINISHED') continue;
    total++;
    if (Number(row.home_rank) > 0 || Number(row.away_rank) > 0) rank++;
    if (Number(row.home_points) > 0 || Number(row.away_points) > 0) points++;
    if (Number(row.home_odds_match_winner) > 0 || Number(row.away_odds_match_winner) > 0) odds++;
    if (Number(row.home_service_points_won_perc) > 0 || Number(row.away_service_points_won_perc) > 0) serve++;
    if (Number(row.home_aces) > 0 || Number(row.away_aces) > 0 || Number(row.home_double_faults) > 0 || Number(row.away_double_faults) > 0) aces++;
  }

  console.log(
    `${file.padEnd(22)} rows=${String(total).padStart(5)} | rank ${pct(rank, total)}% | points ${pct(points, total)}% | odds ${pct(odds, total)}% | serve% ${pct(serve, total)}% | aces ${pct(aces, total)}%`,
  );
}
