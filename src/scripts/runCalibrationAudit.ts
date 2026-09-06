import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'database.sqlite');
const db = new Database(DB_PATH, { readonly: true });

console.log('═════════════════════════════════════════════════════════════════════════');
console.log('🎾 TENNIS SURFACE-SEASON POLICY: PARAMETER CALIBRATION AUDIT');
console.log('═════════════════════════════════════════════════════════════════════════\n');

// 1. Inspect Match Counts by Surface (2024+)
const surfaceCountsQuery = `
  SELECT 
    CASE 
      WHEN LOWER(surface) LIKE '%clay%' THEN 'clay'
      WHEN LOWER(surface) LIKE '%grass%' THEN 'grass'
      WHEN LOWER(surface) LIKE '%indoor%' OR LOWER(surface) LIKE '%carpet%' THEN 'indoor'
      ELSE 'hard'
    END as canonical_surface,
    COUNT(*) as total_matches,
    SUM(CASE WHEN is_canonical_modeling_usable = 1 THEN 1 ELSE 0 END) as usable_matches,
    SUM(CASE WHEN is_backtest_safe = 1 THEN 1 ELSE 0 END) as backtest_safe
  FROM canonical_matches
  WHERE canonical_match_date >= '2024-01-01'
  GROUP BY canonical_surface
  ORDER BY usable_matches DESC;
`;

const surfaceDist = db.prepare(surfaceCountsQuery).all() as any[];
console.log('📊 2024+ MATCH DISTRIBUTION BY CANONICAL SURFACE:');
console.table(surfaceDist);

// 2. Fetch Backtest Matches (2024+)
const matchesQuery = `
  SELECT 
    canonical_match_id,
    canonical_match_date as match_date,
    surface,
    canonical_winner_name as winner_name,
    canonical_loser_name as loser_name,
    winner_rank,
    loser_rank,
    w_odds_match,
    l_odds_match
  FROM canonical_matches
  WHERE canonical_match_date >= '2024-01-01'
    AND is_canonical_modeling_usable = 1
    AND canonical_winner_name IS NOT NULL
    AND canonical_loser_name IS NOT NULL
  ORDER BY canonical_match_date ASC;
`;

const matches = db.prepare(matchesQuery).all() as any[];
console.log(`\nLoaded ${matches.length} candidate modeling matches from 2024+ for calibration.\n`);

// 3. Prepare All-Time Match History Index for Fast Point-in-Time Queries
console.log('Indexing point-in-time player match histories from 2022+...');
const historyQuery = `
  SELECT 
    canonical_match_date as match_date,
    surface,
    canonical_winner_name as winner_name,
    canonical_loser_name as loser_name
  FROM canonical_matches
  WHERE canonical_match_date >= '2022-01-01'
  ORDER BY canonical_match_date ASC;
`;

const allHistoricalRows = db.prepare(historyQuery).all() as any[];

const playerHistory = new Map<string, Array<{ date: string; surface: string; won: boolean }>>();

function normName(n: string): string {
  return (n || '').toLowerCase().replace(/[^a-z]/g, '');
}

function getCanonicalSurf(s?: string): string {
  const combined = (s || '').toLowerCase();
  if (combined.includes('clay')) return 'clay';
  if (combined.includes('grass')) return 'grass';
  if (combined.includes('indoor') || combined.includes('carpet')) return 'indoor';
  return 'hard';
}

for (const row of allHistoricalRows) {
  const surf = getCanonicalSurf(row.surface);
  const w = normName(row.winner_name);
  const l = normName(row.loser_name);

  if (!playerHistory.has(w)) playerHistory.set(w, []);
  if (!playerHistory.has(l)) playerHistory.set(l, []);

  playerHistory.get(w)!.push({ date: row.match_date, surface: surf, won: true });
  playerHistory.get(l)!.push({ date: row.match_date, surface: surf, won: false });
}

console.log(`Indexed history for ${playerHistory.size} unique players.\n`);

// 4. Calibration Simulation Engine
interface CalibrationConfig {
  name: string;
  decayHalfLifeDays: number;
  stableThreshold: number;
  priorConstant: number;
}

const candidateConfigs: CalibrationConfig[] = [
  // A. Baseline
  { name: 'Baseline (365d, N=8, K=4)', decayHalfLifeDays: 365, stableThreshold: 8.0, priorConstant: 4.0 },
  
  // B. Half-Life Sensitivity (180d, 270d, 540d, 730d)
  { name: 'Fast Decay (180d, N=8, K=4)', decayHalfLifeDays: 180, stableThreshold: 8.0, priorConstant: 4.0 },
  { name: 'Medium Decay (270d, N=8, K=4)', decayHalfLifeDays: 270, stableThreshold: 8.0, priorConstant: 4.0 },
  { name: 'Slow Decay (540d, N=8, K=4)', decayHalfLifeDays: 540, stableThreshold: 8.0, priorConstant: 4.0 },
  { name: 'Long Decay (730d, N=8, K=4)', decayHalfLifeDays: 730, stableThreshold: 8.0, priorConstant: 4.0 },

  // C. Threshold Sensitivity (N=5, N=10, N=12)
  { name: 'Low Threshold (365d, N=5, K=4)', decayHalfLifeDays: 365, stableThreshold: 5.0, priorConstant: 4.0 },
  { name: 'High Threshold (365d, N=10, K=4)', decayHalfLifeDays: 365, stableThreshold: 10.0, priorConstant: 4.0 },
  { name: 'Strict Threshold (365d, N=12, K=4)', decayHalfLifeDays: 365, stableThreshold: 12.0, priorConstant: 4.0 },

  // D. Prior Constant Sensitivity (K=2, K=6, K=8)
  { name: 'Weak Prior (365d, N=8, K=2)', decayHalfLifeDays: 365, stableThreshold: 8.0, priorConstant: 2.0 },
  { name: 'Strong Prior (365d, N=8, K=6)', decayHalfLifeDays: 365, stableThreshold: 8.0, priorConstant: 6.0 },
  { name: 'Very Strong Prior (365d, N=8, K=8)', decayHalfLifeDays: 365, stableThreshold: 8.0, priorConstant: 8.0 },
];

function calculateWeight(matchDate: string, asOfDate: string, halfLifeDays: number): number {
  const mTime = new Date(matchDate.slice(0, 10)).getTime();
  const aTime = new Date(asOfDate.slice(0, 10)).getTime();
  if (isNaN(mTime) || isNaN(aTime) || mTime >= aTime) return 0;
  const elapsedDays = (aTime - mTime) / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, elapsedDays / halfLifeDays);
}

function evaluatePlayerSurface(
  playerName: string,
  targetSurface: string,
  asOfDate: string,
  cfg: CalibrationConfig
): { winRate: number; effectiveMatches: number; sampleTier: string } {
  const history = playerHistory.get(normName(playerName)) || [];
  
  let surfaceEffMatches = 0;
  let surfaceEffWins = 0;
  let globalEffMatches = 0;
  let globalEffWins = 0;

  for (const h of history) {
    const w = calculateWeight(h.date, asOfDate, cfg.decayHalfLifeDays);
    if (w <= 0) continue;

    globalEffMatches += w;
    if (h.won) globalEffWins += w;

    if (h.surface === targetSurface) {
      surfaceEffMatches += w;
      if (h.won) surfaceEffWins += w;
    }
  }

  const globalWinRate = globalEffMatches > 0 ? (globalEffWins / globalEffMatches) * 100 : 50;

  if (surfaceEffMatches <= 0.05) {
    return { winRate: 50, effectiveMatches: 0, sampleTier: 'NO_SURFACE_HISTORY' };
  }

  const empiricalRate = (surfaceEffWins / surfaceEffMatches) * 100;

  if (surfaceEffMatches >= cfg.stableThreshold) {
    return { winRate: empiricalRate, effectiveMatches: surfaceEffMatches, sampleTier: 'OK' };
  }

  // Blended with weak global prior
  const alpha = surfaceEffMatches / (surfaceEffMatches + cfg.priorConstant);
  const blended = alpha * empiricalRate + (1 - alpha) * globalWinRate;

  return { winRate: blended, effectiveMatches: surfaceEffMatches, sampleTier: 'LOW_SAMPLE' };
}

// Logistic probability from win rate delta + ranking delta
function predictWinnerProb(
  p1WinRate: number,
  p2WinRate: number,
  p1Rank: number,
  p2Rank: number,
  p1NoHistory: boolean,
  p2NoHistory: boolean
): number {
  const r1 = p1Rank > 0 ? p1Rank : 120;
  const r2 = p2Rank > 0 ? p2Rank : 120;
  const rankDelta = Math.log2(r2) - Math.log2(r1);

  let surfaceDiff = 0;
  if (!p1NoHistory && !p2NoHistory) {
    surfaceDiff = (p1WinRate - p2WinRate) / 100;
  } else if (!p1NoHistory && p2NoHistory) {
    surfaceDiff = (p1WinRate - 50) / 100;
  } else if (p1NoHistory && !p2NoHistory) {
    surfaceDiff = (50 - p2WinRate) / 100;
  }

  const logit = 1.15 * rankDelta + 2.4 * surfaceDiff;
  return 1 / (1 + Math.exp(-logit));
}

// 5. Run Calibration Grid
interface ResultMetrics {
  config: string;
  surface: string;
  totalEvaluated: number;
  accuracyPct: number;
  brierScore: number;
  logLoss: number;
  lowSamplePct: number;
  noHistoryPct: number;
}

const results: ResultMetrics[] = [];

for (const cfg of candidateConfigs) {
  const surfaceStatsMap = new Map<string, { total: number; correct: number; brierSum: number; logLossSum: number; lowSampleCount: number; noHistCount: number }>();

  for (const surf of ['hard', 'clay', 'grass', 'indoor', 'ALL']) {
    surfaceStatsMap.set(surf, { total: 0, correct: 0, brierSum: 0, logLossSum: 0, lowSampleCount: 0, noHistCount: 0 });
  }

  for (const m of matches) {
    const surf = getCanonicalSurf(m.surface);
    const wName = m.winner_name;
    const lName = m.loser_name;
    const wRank = m.winner_rank || 0;
    const lRank = m.loser_rank || 0;

    const wEval = evaluatePlayerSurface(wName, surf, m.match_date, cfg);
    const lEval = evaluatePlayerSurface(lName, surf, m.match_date, cfg);

    const wNoHist = wEval.sampleTier === 'NO_SURFACE_HISTORY';
    const lNoHist = lEval.sampleTier === 'NO_SURFACE_HISTORY';

    const pW = predictWinnerProb(wEval.winRate, lEval.winRate, wRank, lRank, wNoHist, lNoHist);
    const clampedP = Math.min(Math.max(pW, 0.01), 0.99);

    const isCorrect = clampedP >= 0.50;
    const brier = Math.pow(1 - clampedP, 2);
    const logLoss = -Math.log(clampedP);

    const isLowSample = wEval.sampleTier === 'LOW_SAMPLE' || lEval.sampleTier === 'LOW_SAMPLE';
    const isNoHist = wNoHist || lNoHist;

    for (const targetKey of [surf, 'ALL']) {
      const entry = surfaceStatsMap.get(targetKey)!;
      entry.total += 1;
      if (isCorrect) entry.correct += 1;
      entry.brierSum += brier;
      entry.logLossSum += logLoss;
      if (isLowSample) entry.lowSampleCount += 1;
      if (isNoHist) entry.noHistCount += 1;
    }
  }

  for (const [surf, s] of surfaceStatsMap.entries()) {
    if (s.total === 0) continue;
    results.push({
      config: cfg.name,
      surface: surf,
      totalEvaluated: s.total,
      accuracyPct: Math.round((s.correct / s.total) * 1000) / 10,
      brierScore: Math.round((s.brierSum / s.total) * 10000) / 10000,
      logLoss: Math.round((s.logLossSum / s.total) * 10000) / 10000,
      lowSamplePct: Math.round((s.lowSampleCount / s.total) * 1000) / 10,
      noHistoryPct: Math.round((s.noHistCount / s.total) * 1000) / 10,
    });
  }
}

// 6. Present Results
console.log('═════════════════════════════════════════════════════════════════════════');
console.log('🏆 CALIBRATION AUDIT RESULTS (OVERALL ACROSS ALL SURFACES):');
console.log('═════════════════════════════════════════════════════════════════════════');
const overallResults = results.filter(r => r.surface === 'ALL');
console.table(overallResults.map(r => ({
  Config: r.config,
  Matches: r.totalEvaluated,
  'Accuracy %': `${r.accuracyPct}%`,
  'Brier Score (lower=better)': r.brierScore,
  'Log Loss (lower=better)': r.logLoss,
  'Low Sample %': `${r.lowSamplePct}%`,
  'Zero History %': `${r.noHistoryPct}%`,
})));

for (const s of ['clay', 'hard', 'grass', 'indoor']) {
  console.log(`\n═════════════════════════════════════════════════════════════════════════`);
  console.log(`🏟️ SURFACE BREAKDOWN: ${s.toUpperCase()}`);
  console.log(`═════════════════════════════════════════════════════════════════════════`);
  const sResults = results.filter(r => r.surface === s);
  console.table(sResults.map(r => ({
    Config: r.config,
    Matches: r.totalEvaluated,
    'Accuracy %': `${r.accuracyPct}%`,
    'Brier Score': r.brierScore,
    'Log Loss': r.logLoss,
    'Low Sample %': `${r.lowSamplePct}%`,
    'Zero History %': `${r.noHistoryPct}%`,
  })));
}

db.close();
console.log('\nAudit completed successfully.');
