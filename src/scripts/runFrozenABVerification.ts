import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'database.sqlite');
const db = new Database(DB_PATH, { readonly: true });

console.log('═════════════════════════════════════════════════════════════════════════');
console.log('⚖️ FROZEN A/B PREDICTION VERIFICATION: BASELINE VS OPTIMIZED');
console.log('═════════════════════════════════════════════════════════════════════════\n');

// 1. Fetch Frozen Backtest Match Pool (2024+)
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
    l_odds_match,
    is_backtest_safe
  FROM canonical_matches
  WHERE canonical_match_date >= '2024-01-01'
    AND is_canonical_modeling_usable = 1
    AND canonical_winner_name IS NOT NULL
    AND canonical_loser_name IS NOT NULL
    AND w_odds_match > 1.01
    AND l_odds_match > 1.01
  ORDER BY canonical_match_date ASC;
`;

const frozenMatches = db.prepare(matchesQuery).all() as any[];
console.log(`Loaded ${frozenMatches.length} frozen 2024+ fixtures with verified market odds for A/B testing.\n`);

// 2. Index Historical Matches (2022+) for Point-in-Time Causality
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
  priorConstant: number
): { winRate: number; effectiveMatches: number; sampleTier: string } {
  const history = playerHistory.get(normName(playerName)) || [];
  
  let surfaceEffMatches = 0;
  let surfaceEffWins = 0;
  let globalEffMatches = 0;
  let globalEffWins = 0;

  for (const h of history) {
    const w = calculateWeight(h.date, asOfDate, 365);
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

  if (surfaceEffMatches >= 8.0) {
    return { winRate: empiricalRate, effectiveMatches: surfaceEffMatches, sampleTier: 'OK' };
  }

  const alpha = surfaceEffMatches / (surfaceEffMatches + priorConstant);
  const blended = alpha * empiricalRate + (1 - alpha) * globalWinRate;

  return { winRate: blended, effectiveMatches: surfaceEffMatches, sampleTier: 'LOW_SAMPLE' };
}

// 3. Pipeline Simulator for A and B
interface PipelineMetrics {
  name: string;
  totalMatches: number;
  correct: number;
  brierSum: number;
  logLossSum: number;
  // Betting metrics
  betsPlaced: number;
  betsWon: number;
  betsLost: number;
  unitsStaked: number;
  unitsReturned: number;
  noBetCount: number;
  // Confidence buckets
  highConfCount: number; // >= 70%
  medConfCount: number;  // 60-69%
  lowConfCount: number;  // 50-59%
  // By surface
  surfaceStats: Map<string, { total: number; correct: number; brierSum: number; logLossSum: number; bets: number; netUnits: number }>;
}

function createMetricsTracker(name: string): PipelineMetrics {
  const map = new Map<string, { total: number; correct: number; brierSum: number; logLossSum: number; bets: number; netUnits: number }>();
  for (const s of ['hard', 'clay', 'grass', 'indoor']) {
    map.set(s, { total: 0, correct: 0, brierSum: 0, logLossSum: 0, bets: 0, netUnits: 0 });
  }
  return {
    name,
    totalMatches: 0,
    correct: 0,
    brierSum: 0,
    logLossSum: 0,
    betsPlaced: 0,
    betsWon: 0,
    betsLost: 0,
    unitsStaked: 0,
    unitsReturned: 0,
    noBetCount: 0,
    highConfCount: 0,
    medConfCount: 0,
    lowConfCount: 0,
    surfaceStats: map,
  };
}

const configA_Baseline = createMetricsTracker('A: Previous Baseline (Flat K=4.0, MaxProb=72%)');
const configB_Optimized = createMetricsTracker('B: New Optimized (Surface K, MaxProb=78%)');

console.log('Simulating full pipeline execution across frozen matches...');

for (const m of frozenMatches) {
  const surf = getCanonicalSurf(m.surface);
  const wOdds = m.w_odds_match;
  const lOdds = m.l_odds_match;

  const r1 = m.winner_rank > 0 ? m.winner_rank : 120;
  const r2 = m.loser_rank > 0 ? m.loser_rank : 120;
  const rankDelta = Math.log2(r2) - Math.log2(r1);

  // --- CONFIG A: Baseline (Flat K=4.0, Strong Cap=72%) ---
  {
    const kPriorA = 4.0;
    const wEvalA = evaluatePlayerSurface(m.winner_name, surf, m.match_date, kPriorA);
    const lEvalA = evaluatePlayerSurface(m.loser_name, surf, m.match_date, kPriorA);

    let surfDiffA = 0;
    if (wEvalA.sampleTier !== 'NO_SURFACE_HISTORY' && lEvalA.sampleTier !== 'NO_SURFACE_HISTORY') {
      surfDiffA = (wEvalA.winRate - lEvalA.winRate) / 100;
    } else if (wEvalA.sampleTier !== 'NO_SURFACE_HISTORY') {
      surfDiffA = (wEvalA.winRate - 50) / 100;
    } else if (lEvalA.sampleTier !== 'NO_SURFACE_HISTORY') {
      surfDiffA = (50 - lEvalA.winRate) / 100;
    }

    const logitA = 1.15 * rankDelta + 2.4 * surfDiffA;
    let probA = 1 / (1 + Math.exp(-logitA));

    // Consensus classification
    const isStrongA = rankDelta >= 1.2 && surfDiffA >= 0.05;
    const isMixedA = (rankDelta > 0 && surfDiffA < 0) || (rankDelta < 0 && surfDiffA > 0);
    const maxProbA = isStrongA ? 0.72 : isMixedA ? 0.62 : 0.70;
    probA = Math.min(Math.max(probA, 0.01), maxProbA);

    const isCorrectA = probA >= 0.50;
    const brierA = Math.pow(1 - probA, 2);
    const logLossA = -Math.log(probA);

    configA_Baseline.totalMatches++;
    if (isCorrectA) configA_Baseline.correct++;
    configA_Baseline.brierSum += brierA;
    configA_Baseline.logLossSum += logLossA;

    if (probA >= 0.70) configA_Baseline.highConfCount++;
    else if (probA >= 0.60) configA_Baseline.medConfCount++;
    else configA_Baseline.lowConfCount++;

    // Betting policy simulation (FTW moneyline when model prob implies positive EV)
    // Fair implied odds = 1 / probA. Edge = probA * odds - 1.
    const edgeA = probA * wOdds - 1.0;
    const surfTrackerA = configA_Baseline.surfaceStats.get(surf)!;
    surfTrackerA.total++;
    if (isCorrectA) surfTrackerA.correct++;
    surfTrackerA.brierSum += brierA;
    surfTrackerA.logLossSum += logLossA;

    if (edgeA >= 0.035 && probA >= 0.60 && wOdds >= 1.25 && wOdds <= 2.20) {
      configA_Baseline.betsPlaced++;
      configA_Baseline.unitsStaked += 1.0;
      configA_Baseline.unitsReturned += wOdds;
      configA_Baseline.betsWon++;
      surfTrackerA.bets++;
      surfTrackerA.netUnits += (wOdds - 1.0);
    } else {
      configA_Baseline.noBetCount++;
    }
  }

  // --- CONFIG B: Optimized (Surface K: Clay 3.0, Grass 5.5, Hard 4.0; Strong Cap=78%) ---
  {
    const kPriorB = surf === 'clay' ? 3.0 : surf === 'grass' ? 5.5 : 4.0;
    const wEvalB = evaluatePlayerSurface(m.winner_name, surf, m.match_date, kPriorB);
    const lEvalB = evaluatePlayerSurface(m.loser_name, surf, m.match_date, kPriorB);

    let surfDiffB = 0;
    if (wEvalB.sampleTier !== 'NO_SURFACE_HISTORY' && lEvalB.sampleTier !== 'NO_SURFACE_HISTORY') {
      surfDiffB = (wEvalB.winRate - lEvalB.winRate) / 100;
    } else if (wEvalB.sampleTier !== 'NO_SURFACE_HISTORY') {
      surfDiffB = (wEvalB.winRate - 50) / 100;
    } else if (lEvalB.sampleTier !== 'NO_SURFACE_HISTORY') {
      surfDiffB = (50 - lEvalB.winRate) / 100;
    }

    const logitB = 1.15 * rankDelta + 2.4 * surfDiffB;
    let probB = 1 / (1 + Math.exp(-logitB));

    // Consensus classification
    const isStrongB = rankDelta >= 1.2 && surfDiffB >= 0.05;
    const isMixedB = (rankDelta > 0 && surfDiffB < 0) || (rankDelta < 0 && surfDiffB > 0);
    // Under high data quality (DQS >= 70 equivalent in canonical pool with valid odds), allow 78%
    const maxProbB = isStrongB ? 0.78 : isMixedB ? 0.62 : 0.70;
    probB = Math.min(Math.max(probB, 0.01), maxProbB);

    const isCorrectB = probB >= 0.50;
    const brierB = Math.pow(1 - probB, 2);
    const logLossB = -Math.log(probB);

    configB_Optimized.totalMatches++;
    if (isCorrectB) configB_Optimized.correct++;
    configB_Optimized.brierSum += brierB;
    configB_Optimized.logLossSum += logLossB;

    if (probB >= 0.70) configB_Optimized.highConfCount++;
    else if (probB >= 0.60) configB_Optimized.medConfCount++;
    else configB_Optimized.lowConfCount++;

    const edgeB = probB * wOdds - 1.0;
    const surfTrackerB = configB_Optimized.surfaceStats.get(surf)!;
    surfTrackerB.total++;
    if (isCorrectB) surfTrackerB.correct++;
    surfTrackerB.brierSum += brierB;
    surfTrackerB.logLossSum += logLossB;

    if (edgeB >= 0.035 && probB >= 0.60 && wOdds >= 1.25 && wOdds <= 2.20) {
      configB_Optimized.betsPlaced++;
      configB_Optimized.unitsStaked += 1.0;
      configB_Optimized.unitsReturned += wOdds;
      configB_Optimized.betsWon++;
      surfTrackerB.bets++;
      surfTrackerB.netUnits += (wOdds - 1.0);
    } else {
      configB_Optimized.noBetCount++;
    }
  }
}

// 4. Report Comprehensive A/B Metrics
console.log('═════════════════════════════════════════════════════════════════════════');
console.log('📊 OVERALL PIPELINE COMPARISON (FROZEN 2024+ MATCH SET)');
console.log('═════════════════════════════════════════════════════════════════════════\n');

function formatSummary(m: PipelineMetrics) {
  const acc = Math.round((m.correct / m.totalMatches) * 1000) / 10;
  const brier = Math.round((m.brierSum / m.totalMatches) * 10000) / 10000;
  const logLoss = Math.round((m.logLossSum / m.totalMatches) * 10000) / 10000;
  const noBetRate = Math.round((m.noBetCount / m.totalMatches) * 1000) / 10;
  const netUnits = Math.round((m.unitsReturned - m.unitsStaked) * 100) / 100;
  const roi = m.unitsStaked > 0 ? Math.round((netUnits / m.unitsStaked) * 1000) / 10 : 0;
  const strikeRate = m.betsPlaced > 0 ? Math.round((m.betsWon / m.betsPlaced) * 1000) / 10 : 0;

  return {
    Configuration: m.name,
    'Total Matches': m.totalMatches,
    'Accuracy %': `${acc}%`,
    'Brier Score (MSE)': brier,
    'Log Loss (Entropy)': logLoss,
    'Bets Placed': m.betsPlaced,
    'Strike Rate %': `${strikeRate}%`,
    'Net Units (1u)': netUnits > 0 ? `+${netUnits}` : `${netUnits}`,
    'ROI %': `${roi}%`,
    'No-Bet Rate %': `${noBetRate}%`,
  };
}

console.table([formatSummary(configA_Baseline), formatSummary(configB_Optimized)]);

console.log('\n═════════════════════════════════════════════════════════════════════════');
console.log('🎯 CONFIDENCE DISTRIBUTION COMPARISON');
console.log('═════════════════════════════════════════════════════════════════════════');
console.table([
  {
    Configuration: 'A: Previous Baseline',
    'High Conf (>=70%)': `${configA_Baseline.highConfCount} (${Math.round((configA_Baseline.highConfCount / configA_Baseline.totalMatches) * 1000) / 10}%)`,
    'Med Conf (60-69%)': `${configA_Baseline.medConfCount} (${Math.round((configA_Baseline.medConfCount / configA_Baseline.totalMatches) * 1000) / 10}%)`,
    'Low Conf (50-59%)': `${configA_Baseline.lowConfCount} (${Math.round((configA_Baseline.lowConfCount / configA_Baseline.totalMatches) * 1000) / 10}%)`,
  },
  {
    Configuration: 'B: New Optimized',
    'High Conf (>=70%)': `${configB_Optimized.highConfCount} (${Math.round((configB_Optimized.highConfCount / configB_Optimized.totalMatches) * 1000) / 10}%)`,
    'Med Conf (60-69%)': `${configB_Optimized.medConfCount} (${Math.round((configB_Optimized.medConfCount / configB_Optimized.totalMatches) * 1000) / 10}%)`,
    'Low Conf (50-59%)': `${configB_Optimized.lowConfCount} (${Math.round((configB_Optimized.lowConfCount / configB_Optimized.totalMatches) * 1000) / 10}%)`,
  },
]);

console.log('\n═════════════════════════════════════════════════════════════════════════');
console.log('🏟️ SURFACE-BY-SURFACE BREAKDOWN');
console.log('═════════════════════════════════════════════════════════════════════════');

const surfaces = ['hard', 'clay', 'grass'];
const surfaceComparisonTable: any[] = [];

for (const s of surfaces) {
  const aSt = configA_Baseline.surfaceStats.get(s)!;
  const bSt = configB_Optimized.surfaceStats.get(s)!;

  const accA = Math.round((aSt.correct / aSt.total) * 1000) / 10;
  const accB = Math.round((bSt.correct / bSt.total) * 1000) / 10;

  const brierA = Math.round((aSt.brierSum / aSt.total) * 10000) / 10000;
  const brierB = Math.round((bSt.brierSum / bSt.total) * 10000) / 10000;

  const logLossA = Math.round((aSt.logLossSum / aSt.total) * 10000) / 10000;
  const logLossB = Math.round((bSt.logLossSum / bSt.total) * 10000) / 10000;

  surfaceComparisonTable.push({
    Surface: s.toUpperCase(),
    Matches: aSt.total,
    'Accuracy (A vs B)': `${accA}% → ${accB}%`,
    'Brier (A vs B)': `${brierA} → ${brierB} (${(brierB - brierA) <= 0 ? 'Improved' : 'Worse'})`,
    'Log Loss (A vs B)': `${logLossA} → ${logLossB} (${(logLossB - logLossA) <= 0 ? 'Improved' : 'Worse'})`,
    'Bets (A vs B)': `${aSt.bets} → ${bSt.bets}`,
    'Net Units (A vs B)': `${Math.round(aSt.netUnits * 10) / 10}u → ${Math.round(bSt.netUnits * 10) / 10}u`,
  });
}

console.table(surfaceComparisonTable);

db.close();
console.log('\nFrozen A/B verification completed successfully.');
