import { db } from '../db/connection';
import { initSchema } from '../db/schema';
import { getPlayerArchive, reindexAllTrackedPlayersFromHistorical } from '../services/playerArchive.service';

initSchema();

const SINCE = process.argv[2] || '2024-01-01';
const shouldReindex = process.argv.includes('--reindex');

if (shouldReindex) {
  const since = process.argv.includes('--all-years') ? '2021-01-01' : SINCE;
  const result = reindexAllTrackedPlayersFromHistorical(since);
  console.log(`\nReindexed ${result.players} players (${result.linked} links) since ${since}\n`);
}

type PlayerRow = {
  id: number;
  full_name: string;
  tour: string;
  rapid_player_id: number;
  sync_status: string;
  matches_in_db: number;
};

type FieldCheck = {
  label: string;
  ok: number;
  missing: number;
  pct: number;
};

function pct(ok: number, total: number): number {
  return total ? Math.round((ok / total) * 1000) / 10 : 0;
}

function auditJoinedFields(playerId: number, sinceDate: string): FieldCheck[] {
  const rows = db
    .prepare(
      `
    SELECT
      pmi.id,
      h.score,
      h.surface,
      h.tourney_name,
      h.round_name,
      h.winner_rank,
      h.loser_rank,
      h.w_ace,
      h.w_df,
      h.w_svpt,
      h.winner_id,
      h.loser_id,
      h.rapid_event_id
    FROM player_match_index pmi
    JOIN historical_matches h ON h.id = pmi.historical_match_id
    WHERE pmi.tracked_player_id = ? AND pmi.match_date >= ?
  `,
    )
    .all(playerId, sinceDate) as Array<Record<string, unknown>>;

  const total = rows.length;
  const count = (fn: (r: Record<string, unknown>) => boolean) => rows.filter(fn).length;

  return [
    { label: 'score', ok: count((r) => Boolean(String(r.score || '').trim() && r.score !== 'W/O')), missing: 0, pct: 0 },
    { label: 'surface', ok: count((r) => Boolean(String(r.surface || '').trim())), missing: 0, pct: 0 },
    { label: 'tournament', ok: count((r) => Boolean(String(r.tourney_name || '').trim())), missing: 0, pct: 0 },
    { label: 'round', ok: count((r) => Boolean(String(r.round_name || '').trim())), missing: 0, pct: 0 },
    { label: 'ranking', ok: count((r) => Number(r.winner_rank || 0) > 0 || Number(r.loser_rank || 0) > 0), missing: 0, pct: 0 },
    { label: 'player_id', ok: count((r) => Number(r.winner_id || 0) > 0 || Number(r.loser_id || 0) > 0), missing: 0, pct: 0 },
    { label: 'aces', ok: count((r) => Number(r.w_ace || 0) > 0 || Number(r.w_df || 0) > 0), missing: 0, pct: 0 },
    { label: 'serve_stats', ok: count((r) => Number(r.w_svpt || 0) > 0), missing: 0, pct: 0 },
    { label: 'event_id', ok: count((r) => Number(r.rapid_event_id || 0) > 0), missing: 0, pct: 0 },
  ].map((f) => ({
    ...f,
    missing: total - f.ok,
    pct: pct(f.ok, total),
  }));
}

const players = db
  .prepare(`SELECT id, full_name, tour, rapid_player_id, sync_status, matches_in_db FROM tracked_players WHERE is_active = 1 ORDER BY tour, current_rank`)
  .all() as PlayerRow[];

console.log(`\n========== PLAYER TABLE AUDIT (since ${SINCE}) ==========`);
console.log(`Tracked players: ${players.length}`);

const withMatches = players.filter((p) => {
  const n = db
    .prepare('SELECT COUNT(*) as c FROM player_match_index WHERE tracked_player_id = ? AND match_date >= ?')
    .get(p.id, SINCE) as { c: number };
  return n.c > 0;
});

const noMatches = players.filter((p) => !withMatches.find((x) => x.id === p.id));

console.log(`With matches (2024+): ${withMatches.length}`);
console.log(`No matches (2024+):     ${noMatches.length}`);

// Aggregate field coverage across all linked rows
const agg = db.prepare(
  `
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN h.score IS NOT NULL AND h.score != '' AND h.score != 'W/O' THEN 1 ELSE 0 END) AS with_score,
    SUM(CASE WHEN h.surface IS NOT NULL AND h.surface != '' THEN 1 ELSE 0 END) AS with_surface,
    SUM(CASE WHEN h.tourney_name IS NOT NULL AND h.tourney_name != '' THEN 1 ELSE 0 END) AS with_tourney,
    SUM(CASE WHEN h.round_name IS NOT NULL AND h.round_name != '' THEN 1 ELSE 0 END) AS with_round,
    SUM(CASE WHEN COALESCE(h.winner_rank,0) > 0 OR COALESCE(h.loser_rank,0) > 0 THEN 1 ELSE 0 END) AS with_rank,
    SUM(CASE WHEN COALESCE(h.winner_id,0) > 0 OR COALESCE(h.loser_id,0) > 0 THEN 1 ELSE 0 END) AS with_player_id,
    SUM(CASE WHEN COALESCE(h.w_ace,0) > 0 OR COALESCE(h.w_df,0) > 0 THEN 1 ELSE 0 END) AS with_aces,
    SUM(CASE WHEN COALESCE(h.w_svpt,0) > 0 THEN 1 ELSE 0 END) AS with_serve,
    SUM(CASE WHEN pmi.has_csv_stats = 1 THEN 1 ELSE 0 END) AS index_csv_flag,
    SUM(CASE WHEN pmi.opponent_name IS NOT NULL AND pmi.opponent_name != '' THEN 1 ELSE 0 END) AS with_opponent,
    SUM(CASE WHEN pmi.won IN (0,1) THEN 1 ELSE 0 END) AS with_result
  FROM player_match_index pmi
  JOIN historical_matches h ON h.id = pmi.historical_match_id
  WHERE pmi.match_date >= @since
`,
).get({ since: SINCE }) as Record<string, number>;

const totalRows = agg.total || 0;
console.log(`\n========== ALL PLAYER TABLES COMBINED (${totalRows.toLocaleString()} match rows) ==========`);
const fields = [
  ['Result (W/L)', agg.with_result],
  ['Opponent name', agg.with_opponent],
  ['Score', agg.with_score],
  ['Surface', agg.with_surface],
  ['Tournament', agg.with_tourney],
  ['Round', agg.with_round],
  ['Ranking', agg.with_rank],
  ['Player ID in match', agg.with_player_id],
  ['Aces / DF', agg.with_aces],
  ['Serve stats flag', agg.with_serve],
  ['CSV stats index flag', agg.index_csv_flag],
];
for (const [label, ok] of fields) {
  console.log(`  ${String(label).padEnd(22)} ${pct(ok, totalRows)}%  (${ok}/${totalRows})`);
}

// Per-tour breakdown
for (const tour of ['ATP', 'WTA']) {
  const tourAgg = db.prepare(
    `
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN COALESCE(h.w_svpt,0) > 0 THEN 1 ELSE 0 END) AS with_serve,
      SUM(CASE WHEN COALESCE(h.winner_rank,0) > 0 OR COALESCE(h.loser_rank,0) > 0 THEN 1 ELSE 0 END) AS with_rank
    FROM player_match_index pmi
    JOIN historical_matches h ON h.id = pmi.historical_match_id
    JOIN tracked_players tp ON tp.id = pmi.tracked_player_id
    WHERE pmi.match_date >= @since AND tp.tour = @tour
  `,
  ).get({ since: SINCE, tour }) as { total: number; with_serve: number; with_rank: number };
  console.log(`\n  ${tour}: ${tourAgg.total} rows | serve ${pct(tourAgg.with_serve, tourAgg.total)}% | rank ${pct(tourAgg.with_rank, tourAgg.total)}%`);
}

// Sample top players
const samples = [
  ...players.filter((p) => p.tour === 'ATP').slice(0, 5),
  ...players.filter((p) => p.tour === 'WTA').slice(0, 5),
];

console.log('\n========== SAMPLE PLAYERS (top 5 ATP + 5 WTA) ==========');
for (const p of samples) {
  const archive = getPlayerArchive(p.id);
  const s = archive?.summary;
  const matchCount = db
    .prepare('SELECT COUNT(*) as c FROM player_match_index WHERE tracked_player_id = ? AND match_date >= ?')
    .get(p.id, SINCE) as { c: number };
  const checks = auditJoinedFields(p.id, SINCE);
  const serve = checks.find((c) => c.label === 'serve_stats');
  const rank = checks.find((c) => c.label === 'ranking');
  console.log(
    `\n${p.full_name} (${p.tour}) | matches=${matchCount.c} | csvStats=${s?.csvStatsPct ?? 0}% | serve=${serve?.pct ?? 0}% | rank=${rank?.pct ?? 0}% | status=${p.sync_status}`,
  );
  if (matchCount.c === 0) {
    console.log('  ⚠️ NO MATCHES in window');
    continue;
  }
  const worst = checks.filter((c) => c.pct < 80 && c.label !== 'event_id');
  if (worst.length) {
    console.log('  gaps:', worst.map((c) => `${c.label} ${c.pct}%`).join(', '));
  } else {
    console.log('  ✅ core fields look good');
  }
}

// Suspicious players
const suspicious = db.prepare(
  `
  SELECT tp.full_name, tp.tour, COUNT(*) AS cnt
  FROM player_match_index pmi
  JOIN tracked_players tp ON tp.id = pmi.tracked_player_id
  WHERE pmi.match_date >= @since
  GROUP BY tp.id
  HAVING cnt > 500
  ORDER BY cnt DESC
  LIMIT 10
`,
).all({ since: SINCE }) as Array<{ full_name: string; tour: string; cnt: number }>;

console.log('\n========== SUSPICIOUS HIGH COUNTS (>500 matches since 2024) ==========');
if (!suspicious.length) console.log('  None — good');
else suspicious.forEach((r) => console.log(`  ${r.full_name} (${r.tour}): ${r.cnt}`));

console.log('\n========== PLAYERS WITH ZERO MATCHES (2024+) ==========');
console.log(`  ${noMatches.length} players`);
noMatches.slice(0, 15).forEach((p) => console.log(`  - ${p.full_name} (${p.tour})`));
if (noMatches.length > 15) console.log(`  ... and ${noMatches.length - 15} more`);

// What we need vs what we have
console.log('\n========== VERDICT (what you need) ==========');
const need = [
  { need: 'Match list per player', have: pct(withMatches.length, players.length), note: 'players with ≥1 match' },
  { need: 'Win/Loss result', have: pct(agg.with_result, totalRows), note: '' },
  { need: 'Opponent name', have: pct(agg.with_opponent, totalRows), note: '' },
  { need: 'Score', have: pct(agg.with_score, totalRows), note: '' },
  { need: 'Surface', have: pct(agg.with_surface, totalRows), note: '' },
  { need: 'Ranking', have: pct(agg.with_rank, totalRows), note: '' },
  { need: 'Serve stats (aces/%)', have: pct(agg.with_serve, totalRows), note: 'from local CSV' },
  { need: 'PBP (not needed)', have: pct(0, 1), note: 'skipped by design' },
];

for (const row of need) {
  const icon = row.need.includes('PBP') ? '—' : row.have >= 90 ? '✅' : row.have >= 70 ? '⚠️' : '❌';
  console.log(`  ${icon} ${row.need.padEnd(26)} ${row.have}% ${row.note}`);
}

console.log('\nDone.\n');
