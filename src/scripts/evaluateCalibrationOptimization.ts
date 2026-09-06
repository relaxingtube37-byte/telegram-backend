import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'database.sqlite');
const db = new Database(DB_PATH, { readonly: true });

console.log('═════════════════════════════════════════════════════════════════════════');
console.log('🔬 TENNIS PREDICTION OPTIMIZATION & CALIBRATION AUDIT');
console.log('═════════════════════════════════════════════════════════════════════════\n');

// 1. Fetch Backtest Matches (2024+)
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
console.log(`Loaded ${matches.length} matches for calibration optimization.\n`);

// 2. Load Historical Matches (2022+)
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
  halfLifeDays: number,
  stableThreshold: number,
  priorConstant: number
): { winRate: number; effectiveMatches: number; sampleTier: string } {
  const history = playerHistory.get(normName(playerName)) || [];
  
  let surfaceEffMatches = 0;
  let surfaceEffWins = 0;
  let globalEffMatches = 0;
  let globalEffWins = 0;

  for (const h of history) {
    const w = calculateWeight(h.date, asOfDate, halfLifeDays);
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

  if (surfaceEffMatches >= stableThreshold) {
    return { winRate: empiricalRate, effectiveMatches: surfaceEffMatches, sampleTier: 'OK' };
  }

  const alpha = surfaceEffMatches / (surfaceEffMatches + priorConstant);
  const blended = alpha * empiricalRate + (1 - alpha) * globalWinRate;

  return { winRate: blended, effectiveMatches: surfaceEffMatches, sampleTier: 'LOW_SAMPLE' };
}

// Optimization Experiment Definitions
interface Experiment {
  name: string;
  getPriorConstant: (surf: string) => number;
  rankWeight: number;
  surfaceWeight: (surf: string) => number;
  strongCap: number;
}

const experiments: Experiment[] = [
  // 1. Current Baseline
  {
    name: '1. Current Baseline (Flat K=4, MaxProb=72%, SurfWt=2.4)',
    getPriorConstant: () => 4.0,
    rankWeight: 1.15,
    surfaceWeight: () => 2.4,
    strongCap: 72,
  },
  // 2. Expanded Probability Ceiling (76% Cap on Strong Favorites)
  {
    name: '2. Expanded Strong Cap (76% vs 72%)',
    getPriorConstant: () => 4.0,
    rankWeight: 1.15,
    surfaceWeight: () => 2.4,
    strongCap: 76,
  },
  // 3. Expanded Probability Ceiling (78% Cap on Strong Favorites)
  {
    name: '3. Expanded Strong Cap (78% vs 72%)',
    getPriorConstant: () => 4.0,
    rankWeight: 1.15,
    surfaceWeight: () => 2.4,
    strongCap: 78,
  },
  // 4. Surface-Aware Prior Regularization (K_clay=3.0, K_hard=4.0, K_grass=5.5)
  {
    name: '4. Surface-Aware Prior (Clay K=3.0, Grass K=5.5, Hard K=4.0)',
    getPriorConstant: (s) => s === 'clay' ? 3.0 : s === 'grass' ? 5.5 : 4.0,
    rankWeight: 1.15,
    surfaceWeight: () => 2.4,
    strongCap: 72,
  },
  // 5. Surface-Specific Feature Weighting (Clay SurfWt=2.8, Grass SurfWt=2.1, Hard SurfWt=2.4)
  {
    name: '5. Surface-Specific Feature Weighting (Clay Wt=2.8, Grass Wt=2.1)',
    getPriorConstant: () => 4.0,
    rankWeight: 1.15,
    surfaceWeight: (s) => s === 'clay' ? 2.8 : s === 'grass' ? 2.1 : 2.4,
    strongCap: 72,
  },
  // 6. Combined Optimal Tuning (Surface Prior + Surf Weighting + 76% Cap)
  {
    name: '6. Combined Optimal Tuning (Surface Prior + Tuned Wts + 76% Cap)',
    getPriorConstant: (s) => s === 'clay' ? 3.0 : s === 'grass' ? 5.5 : 4.0,
    rankWeight: 1.15,
    surfaceWeight: (s) => s === 'clay' ? 2.8 : s === 'grass' ? 2.1 : 2.4,
    strongCap: 76,
  },
];

console.log(`Running simulation across ${experiments.length} optimization candidates...\n`);

for (const exp of experiments) {
  let totalMatches = 0;
  let correct = 0;
  let brierSum = 0;
  let logLossSum = 0;

  const surfaceStats = new Map<string, { total: number; correct: number; brierSum: number; logLossSum: number }>();
  for (const s of ['hard', 'clay', 'grass']) {
    surfaceStats.set(s, { total: 0, correct: 0, brierSum: 0, logLossSum: 0 });
  }

  for (const m of matches) {
    const surf = getCanonicalSurf(m.surface);
    const kPrior = exp.getPriorConstant(surf);
    const surfWt = exp.surfaceWeight(surf);

    const wEval = evaluatePlayerSurface(m.winner_name, surf, m.match_date, 365, 8.0, kPrior);
    const lEval = evaluatePlayerSurface(m.loser_name, surf, m.match_date, 365, 8.0, kPrior);

    const wNoHist = wEval.sampleTier === 'NO_SURFACE_HISTORY';
    const lNoHist = lEval.sampleTier === 'NO_SURFACE_HISTORY';

    // Rank delta
    const r1 = m.winner_rank > 0 ? m.winner_rank : 120;
    const r2 = m.loser_rank > 0 ? m.loser_rank : 120;
    const rankDelta = Math.log2(r2) - Math.log2(r1);

    // Surface delta
    let surfaceDiff = 0;
    if (!wNoHist && !lNoHist) {
      surfaceDiff = (wEval.winRate - lEval.winRate) / 100;
    } else if (!wNoHist && lNoHist) {
      surfaceDiff = (wEval.winRate - 50) / 100;
    } else if (wNoHist && !lNoHist) {
      surfaceDiff = (50 - lEval.winRate) / 100;
    }

    const logit = exp.rankWeight * rankDelta + surfWt * surfaceDiff;
    let prob = 1 / (1 + Math.exp(-logit));

    // Simulate Quality Gate Consensus Capping
    // If both rank and surface agree strongly (rankDelta > 1.5 and surfaceDiff > 0.10), consensus is STRONG
    const isStrongConsensus = rankDelta >= 1.2 && surfaceDiff >= 0.05;
    const isMixedConsensus = (rankDelta > 0 && surfaceDiff < 0) || (rankDelta < 0 && surfaceDiff > 0);

    const maxProbDecimal = isStrongConsensus ? exp.strongCap / 100 : isMixedConsensus ? 0.62 : 0.70;
    prob = Math.min(Math.max(prob, 0.01), maxProbDecimal);

    const isCorrect = prob >= 0.50;
    const brier = Math.pow(1 - prob, 2);
    const logLoss = -Math.log(prob);

    totalMatches++;
    if (isCorrect) correct++;
    brierSum += brier;
    logLossSum += logLoss;

    if (surfaceStats.has(surf)) {
      const st = surfaceStats.get(surf)!;
      st.total++;
      if (isCorrect) st.correct++;
      st.brierSum += brier;
      st.logLossSum += logLoss;
    }
  }

  const overallAcc = Math.round((correct / totalMatches) * 1000) / 10;
  const overallBrier = Math.round((brierSum / totalMatches) * 10000) / 10000;
  const overallLogLoss = Math.round((logLossSum / totalMatches) * 10000) / 10000;

  console.log(`\n-------------------------------------------------------------------------`);
  console.log(`📊 EXPERIMENT: ${exp.name}`);
  console.log(`OVERALL (32,492 matches): Accuracy: ${overallAcc}% | Brier Score: ${overallBrier} | Log Loss: ${overallLogLoss}`);
  
  const surfaceSummary: any[] = [];
  for (const [surf, st] of surfaceStats.entries()) {
    surfaceSummary.push({
      Surface: surf.toUpperCase(),
      Matches: st.total,
      Accuracy: `${Math.round((st.correct / st.total) * 1000) / 10}%`,
      Brier: Math.round((st.brierSum / st.total) * 10000) / 10000,
      LogLoss: Math.round((st.logLossSum / st.total) * 10000) / 10000,
    });
  }
  console.table(surfaceSummary);
}

db.close();
console.log('\nOptimization audit completed.');
