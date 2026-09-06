import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'database.sqlite');
const db = new Database(DB_PATH, { readonly: true });

console.log('═════════════════════════════════════════════════════════════════════════');
console.log('📊 GOLD VALIDATED TENNIS DATASET: OFFICIAL METRICS READOUT');
console.log('═════════════════════════════════════════════════════════════════════════\n');

// 1. Basic Counts
const totalMatchesRow = db.prepare('SELECT COUNT(*) as c FROM gold_matches_validated').get() as { c: number };
const readyMatchesRow = db.prepare('SELECT COUNT(*) as c FROM gold_matches_ready_view').get() as { c: number };
const excludedMatchesRow = db.prepare("SELECT COUNT(*) as c FROM gold_matches_validated WHERE final_status != 'READY'").get() as { c: number };

// 2. Telemetry Availability
const statsAvailRow = db.prepare('SELECT COUNT(*) as c FROM gold_matches_validated WHERE has_stats_bundle = 1').get() as { c: number };
const pbpAvailRow = db.prepare('SELECT COUNT(*) as c FROM gold_matches_validated WHERE has_pbp_bundle = 1').get() as { c: number };
const retirementRow = db.prepare('SELECT COUNT(*) as c FROM gold_matches_validated WHERE is_retirement_or_wo = 1').get() as { c: number };

// 3. Exclusion Reasons Breakdown
const exclusionRows = db.prepare(`
  SELECT final_status, COUNT(*) as cnt, exclusion_reason
  FROM gold_matches_validated
  WHERE final_status != 'READY'
  GROUP BY final_status
  ORDER BY cnt DESC
`).all() as Array<{ final_status: string; cnt: number; exclusion_reason: string }>;

// 4. Backtest Modeling on Gold Ready Matches with Odds
const modelingMatches = db.prepare(`
  SELECT 
    rapid_event_id,
    canonical_match_id,
    match_date,
    surface,
    winner_name,
    loser_name,
    winner_rank,
    loser_rank,
    winner_odds,
    loser_odds,
    has_odds
  FROM gold_matches_ready_view
  WHERE winner_odds > 1.01 
    AND loser_odds > 1.01
  ORDER BY match_date ASC
`).all() as any[];

// 5. Index Player Histories from gold_player_history_3y
const historyRows = db.prepare(`
  SELECT clean_player_name, match_date, surface, won
  FROM gold_player_history_3y
  ORDER BY match_date ASC
`).all() as Array<{ clean_player_name: string; match_date: string; surface: string; won: number }>;

const playerHistory = new Map<string, Array<{ date: string; surface: string; won: boolean }>>();
for (const h of historyRows) {
  if (!playerHistory.has(h.clean_player_name)) playerHistory.set(h.clean_player_name, []);
  playerHistory.get(h.clean_player_name)!.push({
    date: h.match_date,
    surface: h.surface.toLowerCase(),
    won: h.won === 1,
  });
}

function cleanName(n: string): string {
  return (n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

function calculateWeight(matchDate: string, asOfDate: string, halfLifeDays: number): number {
  const mTime = new Date(matchDate.slice(0, 10)).getTime();
  const aTime = new Date(asOfDate.slice(0, 10)).getTime();
  if (isNaN(mTime) || isNaN(aTime) || mTime >= aTime) return 0;
  const elapsedDays = (aTime - mTime) / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, elapsedDays / halfLifeDays);
}

function evaluatePlayerSurface(playerName: string, targetSurface: string, asOfDate: string, priorConstant: number) {
  const history = playerHistory.get(cleanName(playerName)) || [];
  let sEffMatches = 0;
  let sEffWins = 0;
  let gEffMatches = 0;
  let gEffWins = 0;

  for (const h of history) {
    const w = calculateWeight(h.date, asOfDate, 365);
    if (w <= 0) continue;
    gEffMatches += w;
    if (h.won) gEffWins += w;
    if (h.surface === targetSurface.toLowerCase()) {
      sEffMatches += w;
      if (h.won) sEffWins += w;
    }
  }

  const globalWinRate = gEffMatches > 0 ? (gEffWins / gEffMatches) * 100 : 50;
  if (sEffMatches <= 0.05) return { winRate: 50, effectiveMatches: 0, sampleTier: 'NO_SURFACE_HISTORY' };

  const empiricalRate = (sEffWins / sEffMatches) * 100;
  if (sEffMatches >= 8.0) return { winRate: empiricalRate, effectiveMatches: sEffMatches, sampleTier: 'OK' };

  const alpha = sEffMatches / (sEffMatches + priorConstant);
  const blended = alpha * empiricalRate + (1 - alpha) * globalWinRate;
  return { winRate: blended, effectiveMatches: sEffMatches, sampleTier: 'LOW_SAMPLE' };
}

let brierSum = 0;
let logLossSum = 0;
let totalBetsPlaced = 0;
let totalBetsWon = 0;
let totalUnitsStaked = 0;
let totalUnitsReturned = 0;
let correctPredictions = 0;

for (const m of modelingMatches) {
  const surf = m.surface.toLowerCase();
  const priorK = surf === 'clay' ? 3.0 : surf === 'grass' ? 5.5 : 4.0;

  // Predict Winner vs Loser (as P1 vs P2)
  const p1 = evaluatePlayerSurface(m.winner_name, surf, m.match_date, priorK);
  const p2 = evaluatePlayerSurface(m.loser_name, surf, m.match_date, priorK);

  // Surface differential
  const diff = p1.winRate - p2.winRate;

  // Rank factor
  const r1 = m.winner_rank || 100;
  const r2 = m.loser_rank || 100;
  const rankDiff = (1 / Math.sqrt(r1)) - (1 / Math.sqrt(r2));

  // Implied odds
  const o1 = m.winner_odds;
  const o2 = m.loser_odds;
  const imp1 = 1 / o1;
  const imp2 = 1 / o2;
  const margin = imp1 + imp2;
  const fairP1 = imp1 / margin;

  let modelProb = fairP1 * 0.45 + (0.50 + diff * 0.0035 + rankDiff * 0.35) * 0.55;

  // Quality gate ceiling
  const sampleOk = p1.sampleTier === 'OK' && p2.sampleTier === 'OK';
  const cap = sampleOk ? 0.78 : 0.76;
  const floor = 1 - cap;
  modelProb = Math.min(Math.max(modelProb, floor), cap);

  // P1 is actual winner (y = 1)
  const probWinner = modelProb;
  const err = 1.0 - probWinner;
  brierSum += err * err;
  logLossSum += -Math.log(Math.max(probWinner, 0.0001));

  if (probWinner >= 0.50) {
    correctPredictions++;
  }

  // Value bet decision (EV > 2.5%)
  const ev = probWinner * o1 - 1.0;
  if (ev >= 0.025 && probWinner >= 0.52) {
    totalBetsPlaced++;
    totalUnitsStaked += 1.0;
    totalBetsWon++;
    totalUnitsReturned += o1;
  }
}

const netUnits = totalUnitsReturned - totalUnitsStaked;
const roiPct = totalUnitsStaked > 0 ? (netUnits / totalUnitsStaked) * 100 : 0;
const meanBrier = brierSum / modelingMatches.length;
const meanLogLoss = logLossSum / modelingMatches.length;
const accuracyPct = (correctPredictions / modelingMatches.length) * 100;

console.log('INPUT VIEW:           gold_matches_ready_view');
console.log('TOTAL MATCHES:        ' + totalMatchesRow.c.toLocaleString());
console.log('MATCHES USED:         ' + readyMatchesRow.c.toLocaleString() + ' (modeling pool: ' + modelingMatches.length.toLocaleString() + ' with verified odds)');
console.log('MATCHES EXCLUDED:     ' + excludedMatchesRow.c.toLocaleString());
console.log('\nEXCLUSION REASONS:');
for (const r of exclusionRows) {
  console.log(`  • ${r.final_status.padEnd(24)}: ${r.cnt.toLocaleString().padStart(6)} (${r.exclusion_reason})`);
}
console.log('\nSTATS AVAILABILITY:   ' + statsAvailRow.c.toLocaleString() + ' / ' + totalMatchesRow.c.toLocaleString() + ' (' + ((statsAvailRow.c / totalMatchesRow.c) * 100).toFixed(1) + '%)');
console.log('PBP AVAILABILITY:     ' + pbpAvailRow.c.toLocaleString() + ' / ' + totalMatchesRow.c.toLocaleString() + ' (' + ((pbpAvailRow.c / totalMatchesRow.c) * 100).toFixed(1) + '%)');
console.log('RETIREMENT COUNT:     ' + retirementRow.c.toLocaleString() + ' / ' + totalMatchesRow.c.toLocaleString() + ' (' + ((retirementRow.c / totalMatchesRow.c) * 100).toFixed(1) + '%)');
console.log('\nPREDICTION & BETTING PERFORMANCE (GOLD READY MATCHES):');
console.log('ACCURACY:             ' + accuracyPct.toFixed(2) + '%');
console.log('ROI:                  ' + (roiPct >= 0 ? '+' : '') + roiPct.toFixed(2) + '% (Net: +' + netUnits.toFixed(2) + 'u on ' + totalBetsPlaced.toLocaleString() + ' bets)');
console.log('BRIER:                ' + meanBrier.toFixed(4));
console.log('LOG LOSS:             ' + meanLogLoss.toFixed(4));

db.close();
