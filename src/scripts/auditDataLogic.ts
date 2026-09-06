/**
 * Sanity check: are aggregated stats and match rows logically consistent?
 * Run: npx tsx src/scripts/auditDataLogic.ts
 */

import { db } from '../db/connection';
import { orientSetsForWinner } from '../utils/matchScoreOrientation';

function setsFromScore(score: string | null): { w: number; l: number } | null {
  const oriented = orientSetsForWinner(score);
  if (!oriented.length) return null;
  let w = 0;
  let l = 0;
  for (const set of oriented) {
    if (set.winnerGames > set.loserGames) w += 1;
    else if (set.loserGames > set.winnerGames) l += 1;
  }
  if (w + l === 0) return null;
  return { w, l };
}

function auditPlayer(cleanToken: string, label: string) {
  const rows = db
    .prepare(
      `
    SELECT id, surface, match_date, winner_name, loser_name, score, winner_rank, loser_rank,
           w_ace, w_svpt, l_ace, l_svpt
    FROM historical_matches
    WHERE (winner_name LIKE @p OR loser_name LIKE @p)
      AND match_date < '2026-08-31'
      AND match_date >= '2023-09-01'
  `,
    )
    .all({ p: `%${cleanToken}%` }) as Array<{
    id: number;
    surface: string;
    match_date: string;
    winner_name: string;
    loser_name: string;
    score: string | null;
    winner_rank: number | null;
    loser_rank: number | null;
    w_ace: number | null;
    w_svpt: number | null;
    l_ace: number | null;
    l_svpt: number | null;
  }>;

  let wins = 0;
  let losses = 0;
  let scoreMismatch = 0;
  let scoreChecked = 0;
  const mismatchSamples: object[] = [];

  for (const r of rows) {
    const won = (r.winner_name || '').toLowerCase().includes(cleanToken.toLowerCase());
    if (won) wins += 1;
    else losses += 1;

    const sw = setsFromScore(r.score);
    if (sw) {
      scoreChecked += 1;
      const winnerWonMoreSets = sw.w > sw.l;
      if (won !== winnerWonMoreSets) {
        scoreMismatch += 1;
        if (mismatchSamples.length < 3) {
          mismatchSamples.push({
            date: r.match_date,
            winner: r.winner_name,
            loser: r.loser_name,
            score: r.score,
            sets: sw,
          });
        }
      }
    }
  }

  const ids = new Set<number>();
  const dupKeys = new Map<string, number>();
  for (const r of rows) {
    ids.add(r.id);
    const key = `${r.match_date}|${r.winner_name}|${r.loser_name}`;
    dupKeys.set(key, (dupKeys.get(key) || 0) + 1);
  }
  const duplicateEvents = [...dupKeys.values()].filter((n) => n > 1).length;

  const withServe = rows.filter((r) => (r.w_svpt || 0) > 0 || (r.l_svpt || 0) > 0).length;

  console.log(`\n── ${label} ──`);
  console.log({
    matches: rows.length,
    wins,
    losses,
    balanceOk: wins + losses === rows.length,
    winRatePct: rows.length ? Math.round((100 * wins) / rows.length) : 0,
    scoreChecked,
    scoreMismatch,
    scoreMismatchPct: scoreChecked ? Math.round((100 * scoreMismatch) / scoreChecked) : 0,
    duplicateEventKeys: duplicateEvents,
    serveStatsPct: rows.length ? Math.round((100 * withServe) / rows.length) : 0,
  });
  if (mismatchSamples.length) {
    console.log('  score mismatch samples:', mismatchSamples);
  }
}

console.log('DATA LOGIC AUDIT');
console.log('================');

auditPlayer('Djokovic', 'Novak Djokovic (3yr)');
auditPlayer('Sinner', 'Jannik Sinner (3yr)');
auditPlayer('Navone', 'Mariano Navone (3yr)');
auditPlayer('Ku', 'Yeonwoo Ku (3yr)');

const tracked = db.prepare('SELECT COUNT(*) AS c FROM tracked_players').get() as { c: number };
const withMatches = db
  .prepare('SELECT COUNT(DISTINCT tracked_player_id) AS c FROM player_match_index')
  .get() as { c: number };
const totalMatches = db
  .prepare("SELECT COUNT(*) AS c FROM historical_matches WHERE match_date >= '2024-01-01'")
  .get() as { c: number };

console.log('\n── Database coverage ──');
console.log({ trackedPlayers: tracked.c, playersWithMatches: withMatches.c, matchesSince2024: totalMatches.c });

const bpZero = db
  .prepare(
    `
  SELECT COUNT(*) AS c FROM historical_matches
  WHERE match_date >= '2024-01-01'
    AND (COALESCE(w_bpFaced,0) > 0 OR COALESCE(l_bpFaced,0) > 0)
`,
  )
  .get() as { c: number };
const totalSince2024 = totalMatches.c;
console.log({
  matchesWithBreakPointData: bpZero.c,
  bpDataPct: totalSince2024 ? Math.round((100 * bpZero.c) / totalSince2024) : 0,
});
