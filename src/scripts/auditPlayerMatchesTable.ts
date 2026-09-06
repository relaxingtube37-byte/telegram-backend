/**
 * Read-only audit of the logical player_matches dataset:
 * player_match_index JOIN historical_matches (tracked players only).
 *
 * Run: npx tsx src/scripts/auditPlayerMatchesTable.ts [sinceDate]
 */

import { db } from '../db/connection';
import { initSchema } from '../db/schema';
import { orientSetsForWinner } from '../utils/matchScoreOrientation';

initSchema();

const SINCE = process.argv[2] || '2024-01-01';

type Status = 'PASS' | 'WARNING' | 'FAIL';

interface CheckResult {
  id: string;
  name: string;
  status: Status;
  detail: string;
}

const checks: CheckResult[] = [];

function add(id: string, name: string, status: Status, detail: string) {
  checks.push({ id, name, status, detail });
}

// ─── Note: no physical `player_matches` table ─────────────────────────────
const tables = db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
  .all() as Array<{ name: string }>;
const hasPlayerMatches = tables.some((t) => t.name === 'player_matches');

// ─── Build audit view columns ─────────────────────────────────────────────
const PMI_COLS = db.prepare(`PRAGMA table_info(player_match_index)`).all() as Array<{ name: string; type: string }>;
const HM_COLS = db.prepare(`PRAGMA table_info(historical_matches)`).all() as Array<{ name: string; type: string }>;

console.log('\n══════════════════════════════════════════════════════════════');
console.log(' PLAYER_MATCHES TABLE AUDIT (read-only)');
console.log('══════════════════════════════════════════════════════════════');
console.log(`Physical table "player_matches" exists: ${hasPlayerMatches}`);
console.log(`Audited logical dataset: player_match_index ⨝ historical_matches`);
console.log(`Date window: match_date >= ${SINCE}`);
console.log(`\nplayer_match_index columns (${PMI_COLS.length}): ${PMI_COLS.map((c) => c.name).join(', ')}`);
console.log(`historical_matches columns (${HM_COLS.length}): ${HM_COLS.map((c) => c.name).join(', ')}`);

// ─── Coverage stats ───────────────────────────────────────────────────────
const overview = db.prepare(`
  SELECT
    COUNT(*) AS pmi_rows,
    COUNT(DISTINCT pmi.tracked_player_id) AS tracked_players,
    COUNT(DISTINCT pmi.historical_match_id) AS distinct_hist_matches,
    COUNT(DISTINCT pmi.match_fingerprint) AS distinct_fingerprints,
    MIN(pmi.match_date) AS min_date,
    MAX(pmi.match_date) AS max_date,
    SUM(CASE WHEN pmi.historical_match_id IS NULL THEN 1 ELSE 0 END) AS pmi_without_hist,
    SUM(CASE WHEN pmi.historical_match_id IS NOT NULL THEN 1 ELSE 0 END) AS pmi_with_hist
  FROM player_match_index pmi
  JOIN tracked_players tp ON tp.id = pmi.tracked_player_id AND tp.is_active = 1
  WHERE pmi.match_date >= @since
`).get({ since: SINCE }) as Record<string, number | string>;

const pmiRows = Number(overview.pmi_rows || 0);
const distinctHist = Number(overview.distinct_hist_matches || 0);

console.log('\n── Overview ──');
console.log(overview);

// Grain: one row per (tracked_player_id, match_fingerprint)
add(
  'A1',
  'Row grain',
  'PASS',
  `One row per tracked player per match fingerprint. PMI rows=${pmiRows}, distinct historical_match_id=${distinctHist}, player-perspective duplication expected (~2x per bilateral match).`,
);

// PK integrity
const dupFingerprint = db.prepare(`
  SELECT tracked_player_id, match_fingerprint, COUNT(*) c
  FROM player_match_index
  WHERE match_date >= @since
  GROUP BY tracked_player_id, match_fingerprint
  HAVING c > 1
  LIMIT 5
`).all({ since: SINCE }) as Array<{ c: number }>;
add(
  'A2',
  'Primary key (tracked_player_id + match_fingerprint)',
  dupFingerprint.length === 0 ? 'PASS' : 'FAIL',
  dupFingerprint.length === 0 ? 'No duplicate fingerprints per player.' : `${dupFingerprint.length}+ duplicate fingerprint groups found.`,
);

const orphanPmi = Number(overview.pmi_without_hist || 0);
add(
  'A3',
  'PMI rows linked to historical_matches',
  orphanPmi === 0 ? 'PASS' : orphanPmi / pmiRows < 0.01 ? 'WARNING' : 'FAIL',
  `${orphanPmi} PMI rows (${((orphanPmi / pmiRows) * 100).toFixed(2)}%) have NULL historical_match_id.`,
);

// Duplicate logical matches (same hist match, same player twice via different fingerprints)
const dupHistPerPlayer = db.prepare(`
  SELECT pmi.tracked_player_id, pmi.historical_match_id, COUNT(*) c
  FROM player_match_index pmi
  WHERE pmi.match_date >= @since AND pmi.historical_match_id IS NOT NULL
  GROUP BY pmi.tracked_player_id, pmi.historical_match_id
  HAVING c > 1
  LIMIT 10
`).all({ since: SINCE });
add(
  'A4',
  'Duplicate historical_match_id per player',
  dupHistPerPlayer.length === 0 ? 'PASS' : 'WARNING',
  dupHistPerPlayer.length === 0 ? 'None' : `${dupHistPerPlayer.length}+ player/hist pairs appear more than once.`,
);

// ─── Required fields completeness (joined) ────────────────────────────────
const completeness = db.prepare(`
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN pmi.historical_match_id IS NOT NULL THEN 1 ELSE 0 END) AS match_id,
    SUM(CASE WHEN pmi.tracked_player_id IS NOT NULL THEN 1 ELSE 0 END) AS player_id,
    SUM(CASE WHEN pmi.opponent_name IS NOT NULL AND pmi.opponent_name != '' THEN 1 ELSE 0 END) AS opponent,
    SUM(CASE WHEN pmi.match_date IS NOT NULL AND pmi.match_date != '' THEN 1 ELSE 0 END) AS match_date,
    SUM(CASE WHEN COALESCE(h.tour, pmi.tour) IS NOT NULL THEN 1 ELSE 0 END) AS tour,
    SUM(CASE WHEN COALESCE(h.surface, pmi.surface) IS NOT NULL AND COALESCE(h.surface, pmi.surface) != '' THEN 1 ELSE 0 END) AS surface,
    SUM(CASE WHEN COALESCE(h.score, pmi.score) IS NOT NULL AND COALESCE(h.score, pmi.score) NOT IN ('', 'W/O') THEN 1 ELSE 0 END) AS score,
    SUM(CASE WHEN pmi.won IN (0, 1) THEN 1 ELSE 0 END) AS result_wl,
    SUM(CASE WHEN COALESCE(h.winner_rank,0) > 0 OR COALESCE(h.loser_rank,0) > 0 THEN 1 ELSE 0 END) AS rank_any,
    SUM(CASE WHEN COALESCE(h.w_odds_match,0) > 0 OR COALESCE(h.l_odds_match,0) > 0 THEN 1 ELSE 0 END) AS odds_any,
    SUM(CASE WHEN COALESCE(h.w_svpt,0) > 0 OR COALESCE(h.l_svpt,0) > 0 THEN 1 ELSE 0 END) AS serve_flag,
    SUM(CASE WHEN COALESCE(h.w_1stIn,0) > 0 THEN 1 ELSE 0 END) AS first_serve_raw,
    SUM(CASE WHEN COALESCE(h.w_serve_won_pct,0) > 0 OR COALESCE(h.l_serve_won_pct,0) > 0 THEN 1 ELSE 0 END) AS serve_pct,
    SUM(CASE WHEN COALESCE(h.w_bpFaced,0) > 0 OR COALESCE(h.l_bpFaced,0) > 0 THEN 1 ELSE 0 END) AS bp_raw,
    SUM(CASE WHEN COALESCE(h.w_bp_won_pct,0) > 0 OR COALESCE(h.l_bp_won_pct,0) > 0 THEN 1 ELSE 0 END) AS bp_pct
  FROM player_match_index pmi
  LEFT JOIN historical_matches h ON h.id = pmi.historical_match_id
  JOIN tracked_players tp ON tp.id = pmi.tracked_player_id AND tp.is_active = 1
  WHERE pmi.match_date >= @since
`).get({ since: SINCE }) as Record<string, number>;

const total = completeness.total || 1;
const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;

console.log('\n── Required field coverage ──');
const fieldRows = [
  ['match_id (historical_match_id)', completeness.match_id],
  ['player_id (tracked_player_id)', completeness.player_id],
  ['opponent_name', completeness.opponent],
  ['match_date', completeness.match_date],
  ['tour', completeness.tour],
  ['surface', completeness.surface],
  ['score', completeness.score],
  ['result (won 0/1)', completeness.result_wl],
  ['ranking (either side)', completeness.rank_any],
  ['odds (either side)', completeness.odds_any],
  ['serve flag (svpt>0)', completeness.serve_flag],
  ['first serve raw (w_1stIn>0)', completeness.first_serve_raw],
  ['serve % columns', completeness.serve_pct],
  ['break point raw counts', completeness.bp_raw],
  ['break point % columns', completeness.bp_pct],
];
for (const [label, n] of fieldRows) {
  console.log(`  ${String(label).padEnd(32)} ${pct(Number(n))} (${n}/${total})`);
}

add('B1', 'Core match fields (id, date, opponent, result, score)', Number(completeness.score) / total >= 0.95 ? 'PASS' : 'WARNING', `Score ${pct(completeness.score)}`);
add('B2', 'Ranking coverage', Number(completeness.rank_any) / total >= 0.85 ? 'PASS' : 'WARNING', `Rank ${pct(completeness.rank_any)}`);
add('B3', 'Odds coverage', Number(completeness.odds_any) / total >= 0.5 ? 'PASS' : 'WARNING', `Odds ${pct(completeness.odds_any)}`);
add('B4', 'Raw first-serve counts', Number(completeness.first_serve_raw) / total >= 0.5 ? 'PASS' : 'FAIL', `w_1stIn>0 only ${pct(completeness.first_serve_raw)} — mostly placeholder svpt=100 + % columns`);
add('B5', 'Raw break-point counts', Number(completeness.bp_raw) / total >= 0.1 ? 'PASS' : 'FAIL', `bp raw ${pct(completeness.bp_raw)}`);

// ─── Tennis logic ─────────────────────────────────────────────────────────
const selfPlay = db.prepare(`
  SELECT COUNT(*) c FROM historical_matches h
  JOIN player_match_index pmi ON pmi.historical_match_id = h.id
  WHERE pmi.match_date >= @since
    AND (
      LOWER(h.winner_name) = LOWER(h.loser_name)
      OR LOWER(pmi.opponent_name) = (SELECT full_name FROM tracked_players WHERE id = pmi.tracked_player_id)
    )
`).get({ since: SINCE }) as { c: number };
add('C1', 'Player vs self', Number(selfPlay.c) === 0 ? 'PASS' : 'FAIL', `${selfPlay.c} suspicious self-play rows`);

// Won flag vs winner_name consistency
const wonMismatch = db.prepare(`
  SELECT COUNT(*) c
  FROM player_match_index pmi
  JOIN historical_matches h ON h.id = pmi.historical_match_id
  JOIN tracked_players tp ON tp.id = pmi.tracked_player_id
  WHERE pmi.match_date >= @since
    AND (
      (pmi.won = 1 AND LOWER(h.winner_name) NOT LIKE '%' || LOWER(SUBSTR(tp.full_name, INSTR(tp.full_name, ' ') + 1)) || '%'
           AND LOWER(h.winner_name) NOT LIKE '%' || LOWER(tp.full_name) || '%')
      OR
      (pmi.won = 0 AND LOWER(h.loser_name) NOT LIKE '%' || LOWER(SUBSTR(tp.full_name, INSTR(tp.full_name, ' ') + 1)) || '%'
           AND LOWER(h.loser_name) NOT LIKE '%' || LOWER(tp.full_name) || '%')
    )
`).get({ since: SINCE }) as { c: number };
add(
  'C2',
  'won flag vs winner/loser names',
  Number(wonMismatch.c) / pmiRows < 0.05 ? 'WARNING' : 'FAIL',
  `${wonMismatch.c} rows (${((Number(wonMismatch.c) / pmiRows) * 100).toFixed(1)}%) — name token matching is fuzzy; review sample`,
);

// Score vs winner (oriented)
const histRows = db.prepare(`
  SELECT h.id, h.winner_name, h.loser_name, h.score
  FROM historical_matches h
  WHERE h.id IN (
    SELECT DISTINCT historical_match_id FROM player_match_index WHERE match_date >= @since AND historical_match_id IS NOT NULL
  )
  AND h.score IS NOT NULL AND h.score != '' AND h.score != 'W/O'
  LIMIT 50000
`).all({ since: SINCE }) as Array<{ winner_name: string; loser_name: string; score: string }>;

let scoreChecked = 0;
let scoreMismatch = 0;
for (const row of histRows) {
  const oriented = orientSetsForWinner(row.score);
  if (!oriented.length) continue;
  scoreChecked += 1;
  let w = 0;
  let l = 0;
  for (const s of oriented) {
    if (s.winnerGames > s.loserGames) w += 1;
    else if (s.loserGames > s.winnerGames) l += 1;
  }
  if (w <= l) scoreMismatch += 1;
}
const scoreMismatchPct = scoreChecked ? (scoreMismatch / scoreChecked) * 100 : 0;
add(
  'C3',
  'Score agrees with winner (oriented sets)',
  scoreMismatchPct < 10 ? 'PASS' : scoreMismatchPct < 25 ? 'WARNING' : 'FAIL',
  `${scoreMismatchPct.toFixed(1)}% of ${scoreChecked} scored matches still mismatch after orientation (retirements/WO/ bad source rows)`,
);

// Invalid percentages
const badPct = db.prepare(`
  SELECT COUNT(*) c FROM historical_matches h
  WHERE h.id IN (SELECT DISTINCT historical_match_id FROM player_match_index WHERE match_date >= @since)
    AND (
      (h.w_serve_won_pct IS NOT NULL AND (h.w_serve_won_pct < 0 OR h.w_serve_won_pct > 100))
      OR (h.l_serve_won_pct IS NOT NULL AND (h.l_serve_won_pct < 0 OR h.l_serve_won_pct > 100))
      OR (h.w_bp_won_pct IS NOT NULL AND (h.w_bp_won_pct < 0 OR h.w_bp_won_pct > 100))
    )
`).get({ since: SINCE }) as { c: number };
add('C4', 'Percentage bounds 0-100', Number(badPct.c) === 0 ? 'PASS' : 'FAIL', `${badPct.c} rows with out-of-range %`);

// Suspicious ranks
const badRank = db.prepare(`
  SELECT COUNT(*) c FROM historical_matches h
  WHERE h.id IN (SELECT DISTINCT historical_match_id FROM player_match_index WHERE match_date >= @since)
    AND (
      (COALESCE(h.winner_rank,0) > 2000 OR COALESCE(h.loser_rank,0) > 2000)
      OR (COALESCE(h.winner_rank,0) < 0 OR COALESCE(h.loser_rank,0) < 0)
    )
`).get({ since: SINCE }) as { c: number };
add('C5', 'Ranking range sanity', Number(badRank.c) === 0 ? 'PASS' : 'WARNING', `${badRank.c} rows with rank >2000 or negative`);

// Placeholder serve
const placeholderSvpt = db.prepare(`
  SELECT COUNT(*) c FROM historical_matches h
  WHERE h.id IN (SELECT DISTINCT historical_match_id FROM player_match_index WHERE match_date >= @since)
    AND h.w_svpt = 100 AND COALESCE(h.w_1stIn,0) = 0
`).get({ since: SINCE }) as { c: number };
const distinctMatches = distinctHist || 1;
add(
  'C6',
  'Serve placeholder pattern (svpt=100, 1stIn=0)',
  Number(placeholderSvpt.c) / distinctMatches < 0.1 ? 'PASS' : 'WARNING',
  `${placeholderSvpt.c}/${distinctMatches} distinct matches (${((Number(placeholderSvpt.c) / distinctMatches) * 100).toFixed(1)}%) use placeholder serve rows`,
);

// ─── Point-in-time ────────────────────────────────────────────────────────
add(
  'D1',
  'Post-match fields present in same row',
  'WARNING',
  'historical_matches stores winner, score, serve stats, minutes in same row as pre-match ranks/odds. Safe ONLY if consumers filter match_date < asOf and exclude settlement fields from features.',
);
add(
  'D2',
  'PMI duplicates bilateral perspective',
  'PASS',
  'Expected: two PMI rows per match (one per player). Not leakage if features built per-player with cutoff.',
);

// Future dates
const futureDates = db.prepare(`
  SELECT COUNT(*) c FROM player_match_index WHERE match_date > date('now', '+1 day')
`).get() as { c: number };
add('D3', 'Future match dates', Number(futureDates.c) === 0 ? 'PASS' : 'WARNING', `${futureDates.c} PMI rows dated in the future`);

// ─── Top-100 rule ─────────────────────────────────────────────────────────
const top100Both = db.prepare(`
  SELECT COUNT(*) c
  FROM historical_matches h
  WHERE h.id IN (SELECT DISTINCT historical_match_id FROM player_match_index WHERE match_date >= @since)
    AND COALESCE(h.winner_rank, 9999) <= 100
    AND COALESCE(h.loser_rank, 9999) <= 100
`).get({ since: SINCE }) as { c: number };
const rank101Either = db.prepare(`
  SELECT COUNT(*) c
  FROM historical_matches h
  WHERE h.id IN (SELECT DISTINCT historical_match_id FROM player_match_index WHERE match_date >= @since)
    AND (COALESCE(h.winner_rank, 9999) = 101 OR COALESCE(h.loser_rank, 9999) = 101)
`).get({ since: SINCE }) as { c: number };
add(
  'E1',
  'Top-100 both-players filter enforced in table',
  'FAIL',
  `NOT ENFORCED in schema or PMI. Distinct matches with both ranks ≤100: ${top100Both.c}/${distinctHist}. Rows with rank 101 present: ${rank101Either.c}. Table includes challengers, qualies, and partial ranks.`,
);

// ─── Tour / surface coverage ──────────────────────────────────────────────
const tourBreakdown = db.prepare(`
  SELECT COALESCE(h.tour, pmi.tour, 'unknown') AS tour_name, COUNT(*) c
  FROM player_match_index pmi
  LEFT JOIN historical_matches h ON h.id = pmi.historical_match_id
  WHERE pmi.match_date >= @since
  GROUP BY tour_name ORDER BY c DESC
`).all({ since: SINCE });
console.log('\n── Tour coverage ──');
tourBreakdown.forEach((r: { tour_name: string; c: number }) => console.log(`  ${r.tour_name}: ${r.c}`));

const surfaceBreakdown = db.prepare(`
  SELECT COALESCE(h.surface, pmi.surface, 'unknown') AS surface_name, COUNT(*) c
  FROM player_match_index pmi
  LEFT JOIN historical_matches h ON h.id = pmi.historical_match_id
  WHERE pmi.match_date >= @since
  GROUP BY surface_name ORDER BY c DESC LIMIT 10
`).all({ since: SINCE });
console.log('\n── Surface coverage (top 10) ──');
surfaceBreakdown.forEach((r: { surface_name: string; c: number }) => console.log(`  ${r.surface_name}: ${r.c}`));

// High-count name pollution
const polluted = db.prepare(`
  SELECT tp.full_name, COUNT(*) c
  FROM player_match_index pmi
  JOIN tracked_players tp ON tp.id = pmi.tracked_player_id
  WHERE pmi.match_date >= @since
  GROUP BY tp.id
  HAVING c > 400
  ORDER BY c DESC LIMIT 10
`).all({ since: SINCE });
console.log('\n── Players with >400 PMI rows since window ──');
polluted.forEach((r: { full_name: string; c: number }) => console.log(`  ${r.full_name}: ${r.c}`));

// ─── Summary ──────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════');
console.log(' VALIDATION SUMMARY');
console.log('══════════════════════════════════════════════════════════════');
for (const c of checks) {
  const icon = c.status === 'PASS' ? '✅' : c.status === 'WARNING' ? '⚠️' : '❌';
  console.log(`${icon} [${c.id}] ${c.name}: ${c.detail}`);
}

const failCount = checks.filter((c) => c.status === 'FAIL').length;
const warnCount = checks.filter((c) => c.status === 'WARNING').length;

let decision: string;
if (failCount >= 3) decision = 'NOT USABLE';
else if (failCount >= 1 || warnCount >= 4) decision = 'USABLE WITH LIMITATIONS';
else if (warnCount > 0) decision = 'READY FOR BASELINE BACKTEST';
else decision = 'READY FOR FULL FEATURE PIPELINE';

console.log(`\n── FINAL DECISION: ${decision} ──`);
console.log(`Fails: ${failCount}, Warnings: ${warnCount}`);

console.log('\n── Usability gates ──');
console.log(`  Baseline backtest (W/L + rank + date): ${Number(completeness.result_wl) / total >= 0.99 && Number(completeness.rank_any) / total >= 0.8 ? 'YES' : 'LIMITED'}`);
console.log(`  Advanced serve features: ${Number(completeness.serve_pct) / total >= 0.5 && Number(completeness.first_serve_raw) / total < 0.1 ? 'LIMITED (estimates required)' : 'NO'}`);
console.log(`  Odds-based ROI: ${Number(completeness.odds_any) / total >= 0.5 ? 'PARTIAL' : 'NO'}`);

console.log('\nDone.\n');
