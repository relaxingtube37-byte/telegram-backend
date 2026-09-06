/**
 * Comprehensive Audit Script for STATE_FOOTBALL_METRICS_AND_INDICES.md
 * Audits every single metric across all 6 layers.
 */

const {
  computeFullMatchAnalytics,
  calculateEnergyTank,
  calculateWeightedFatigueLoad,
  calculateEnvironmentalDeltas,
  calculateMatchSessionConditions,
  calculateSurfaceKpis,
  calculateSurfaceEloRating,
  calculateHoldBreakSynergy,
  calculateSetConversionDynamics,
  calculateHandednessAdvantage,
  calculateRankingPointsDefense,
  classifyTournamentTier,
  calculateTournamentTransition,
  getPlayerTacticalProfile,
  calculateRecentRetirements,
  detectKryptoniteMatchup,
  calculateTiltRiskLevel,
  calculateMatchupPressureProfile,
  calculateMarkovGameProb,
  calculateMarkovTiebreakProb,
  calculateMarkovSetProbAndDist,
  calculateBarnettClarkeMatchPricing,
  calculateExpectedValue,
  evaluateDataQualityFlags,
  calculateBrierScore,
  calculateLogLoss,
} = require('../dist/engine/index.js');

console.log('========================================================================');
console.log('🎾 AUDITING ALL METRICS AGAINST STATE_FOOTBALL_METRICS_AND_INDICES.md');
console.log('========================================================================\n');

let passCount = 0;
let totalCount = 0;

function assertCheck(label, condition, details = '') {
  totalCount++;
  if (condition) {
    passCount++;
    console.log(`  ✅ [PASS] ${label} ${details ? `(${details})` : ''}`);
  } else {
    console.error(`  ❌ [FAIL] ${label} ${details ? `(${details})` : ''}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. LAYER 1: Physics & Bio-Fatigue Layer
// ─────────────────────────────────────────────────────────────────────────────
console.log('🔹 1. Checking Layer 1: Physics & Bio-Fatigue Layer...');

const sampleFatigue = {
  tournamentFatigueLoad: 12.5,
  recentMatchesCount: 3,
  recentTotalGames: 68,
  totalCourtTimeMinutes: 280,
  lastMatchDurationMinutes: 145,
  avgMatchDurationMinutes: 93,
  daysSinceLastMatch: 1.2,
  restHoursSinceLastMatch: 28.8,
  restQuality: 0.9,
  emaRecentFormScore: 85,
};

const energyRes = calculateEnergyTank(sampleFatigue);
assertCheck('EnergyTank % is within [0, 100]', energyRes.levelPct >= 0 && energyRes.levelPct <= 100, `Result: ${energyRes.levelPct}%, Status: ${energyRes.status}`);

const envDeltas = calculateEnvironmentalDeltas({
  tournamentName: 'US Open',
  tournamentCountry: 'US',
  currentSurface: 'hard',
  weather: { temperatureC: 29, humidityPct: 40, windSpeedKmh: 14 },
}, sampleFatigue, 'ES', 23);

assertCheck('Altitude Delta & Air Density calculated', envDeltas.airDensityKgm3 > 1.0 && envDeltas.airDensityKgm3 < 1.4, `Air Density: ${envDeltas.airDensityKgm3} kg/m³`);
assertCheck('Age Recovery Factor computed', envDeltas.ageRecoveryFactor > 0.5 && envDeltas.ageRecoveryFactor < 2.0, `Factor: ${envDeltas.ageRecoveryFactor}`);

const session = calculateMatchSessionConditions({ temperatureC: 30, humidityPct: 35, windSpeedKmh: 8 }, '14:00');
assertCheck('Ball Bounciness Modifier calculated for hot/dry day session', session.ballBouncinessModifier === 1.10, `Modifier: ${session.ballBouncinessModifier}, DewPoint: ${session.dewPointC}°C`);

// ─────────────────────────────────────────────────────────────────────────────
// 2. LAYER 2: Surface, CPI & Elo Dynamics
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n🔹 2. Checking Layer 2: Surface, CPI & Elo Dynamics...');

const surfaceKpi = calculateSurfaceKpis({
  matches: 12,
  wins: 9,
  losses: 3,
  firstServeTotal: 650,
  firstServePointsScored: 490,
  breakPointsFaced: 20,
  breakPointsSaved: 14,
  breakPointsTotal: 30,
  breakPointsConverted: 12,
}, 'Hard');

assertCheck('CPI Index for Hard court', surfaceKpi.cpiIndex === 37, `CPI: ${surfaceKpi.cpiIndex}`);
assertCheck('Surface Win Rate %', surfaceKpi.winRatePct === 75, `WinRate: ${surfaceKpi.winRatePct}%`);
assertCheck('Surface Compatibility Score computed', surfaceKpi.surfaceCompatibilityScore >= 0 && surfaceKpi.surfaceCompatibilityScore <= 100, `Score: ${surfaceKpi.surfaceCompatibilityScore}`);

const surfaceElo = calculateSurfaceEloRating(1, 85, 30);
assertCheck('Surface Elo calculated for Top Player', surfaceElo >= 2300, `Elo: ${surfaceElo}`);

// ─────────────────────────────────────────────────────────────────────────────
// 3. LAYER 3: Hold/Break Synergy & Set Dynamics
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n🔹 3. Checking Layer 3: Hold/Break Synergy & Set Dynamics...');

const synergy = calculateHoldBreakSynergy({
  matches: 15,
  wins: 12,
  losses: 3,
  firstServeTotal: 700,
  firstServePointsScored: 540,
}, null, 5, false);

assertCheck('Total Synergy Index (TSI)', synergy.totalSynergyIndex >= 100, `TSI: ${synergy.totalSynergyIndex} (${synergy.label})`);
assertCheck('Dominance Ratio (DR)', synergy.dominanceRatio > 1.0, `DR: ${synergy.dominanceRatio}`);

const setDyn = calculateSetConversionDynamics([
  { id: 1, date: '2026-08-20', winnerHome: true, homePlayer: { id: 10, name: 'P1' }, awayPlayer: { id: 20, name: 'P2' }, sets: [{ setNumber: 1, homeScore: 6, awayScore: 4 }, { setNumber: 2, homeScore: 6, awayScore: 3 }] },
  { id: 2, date: '2026-08-22', winnerHome: true, homePlayer: { id: 10, name: 'P1' }, awayPlayer: { id: 30, name: 'P3' }, sets: [{ setNumber: 1, homeScore: 4, awayScore: 6 }, { setNumber: 2, homeScore: 6, awayScore: 4 }, { setNumber: 3, homeScore: 7, awayScore: 6 }] },
], 10);

assertCheck('First Set Win Conversion Rate', setDyn.firstSetWinConversionRate > 60, `Rate: ${setDyn.firstSetWinConversionRate}%`);
assertCheck('Deciding Set Win Rate', setDyn.decidingSetWinRate > 40, `Decider WinRate: ${setDyn.decidingSetWinRate}%`);
assertCheck('Clutch Verdict', ['ELITE_CLOSER', 'SOLID_CLOSER', 'AVERAGE', 'CHOKER'].includes(setDyn.clutchVerdict), `Verdict: ${setDyn.clutchVerdict}`);

// ─────────────────────────────────────────────────────────────────────────────
// 4. LAYER 4: Tactical & Psychological Intelligence
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n🔹 4. Checking Layer 4: Tactical & Psychological Intelligence...');

const handedness = calculateHandednessAdvantage('Rafael Nadal', 'Novak Djokovic', 'L', 'R', 'grass');
assertCheck('Handedness Advantage (Lefty vs Righty on Grass)', handedness.isLeftyVsRighty && handedness.leftyAdvantageScore > 0, `Advantage: +${handedness.leftyAdvantageScore}%`);

const ptsDef = calculateRankingPointsDefense(8, 'SF', 'Grand Slam');
assertCheck('Points Defense Pressure', ptsDef.pointsDefending === 180, `Defending: ${ptsDef.pointsDefending} pts, Tier: ${ptsDef.defensePressureTier}`);

const tourneyTrans = calculateTournamentTransition(2, 'ATP 250', 'ATP 500', true);
assertCheck('Deep Run Hangover Risk Alert', tourneyTrans.isDeepRunHangover, `Penalty: -${tourneyTrans.hangoverFatiguePenalty}%`);

const tilt = calculateTiltRiskLevel(setDyn.firstSetLostComebackRate, setDyn.decidingSetWinRate, 2.5);
assertCheck('Tilt Risk Level', ['LOW', 'MODERATE', 'HIGH'].includes(tilt.tiltRiskLevel), `Tilt: ${tilt.tiltRiskLevel}`);

const pressure = calculateMatchupPressureProfile(5, 45, 78);
assertCheck('Matchup Pressure Profile (Favorite vs Underdog)', pressure.winRateAsFavorite > pressure.winRateAsUnderdog, `Fav WR: ${pressure.winRateAsFavorite}%, Dog WR: ${pressure.winRateAsUnderdog}%`);

// ─────────────────────────────────────────────────────────────────────────────
// 5. LAYER 5: Markov Odds & Probability Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n🔹 5. Checking Layer 5: Markov Odds & Probability Engine...');

const holdProb = calculateMarkovGameProb(0.65);
assertCheck('Markov Game Hold Probability g(p) from 0-0', holdProb > 0.75 && holdProb < 0.90, `g(0.65) = ${(holdProb * 100).toFixed(2)}%`);

const tiebreakProb = calculateMarkovTiebreakProb(0.65, 0.62);
assertCheck('Markov 7-point Tiebreak Probability', tiebreakProb > 0.50 && tiebreakProb < 0.70, `t(pA, pB) = ${(tiebreakProb * 100).toFixed(2)}%`);

const pricing = calculateBarnettClarkeMatchPricing(0.66, 0.62, false);
assertCheck('Barnett & Clarke Win Probabilities sum to 1.0', Math.abs(pricing.matchWinProbHome + pricing.matchWinProbAway - 1.0) < 0.005, `Home: ${pricing.matchWinProbHome}, Away: ${pricing.matchWinProbAway}`);
assertCheck('Synthetic Fair Odds calculated (1/P)', pricing.fairOddsHome === Math.round((1 / pricing.matchWinProbHome) * 100) / 100, `Fair Odds: @${pricing.fairOddsHome} / @${pricing.fairOddsAway}`);
assertCheck('Expected Total Games Line calculated', pricing.expectedTotalGames > 18 && pricing.expectedTotalGames < 30, `Expected Games: ${pricing.expectedTotalGames}`);
assertCheck('Exact Set Scores distribution calculated', pricing.setScores.twoZeroHome > 0 && pricing.setScores.twoOneHome > 0, `2-0: ${pricing.setScores.twoZeroHome}, 2-1: ${pricing.setScores.twoOneHome}`);

const ev = calculateExpectedValue(0.65, 1.80);
assertCheck('Expected Value (EV+) calculation', ev.evPct === 17.0 && ev.isValueBet, `EV: +${ev.evPct}%, Edge Tier: ${ev.edgeTier}`);

// ─────────────────────────────────────────────────────────────────────────────
// 6. LAYER 6: Data Quality & Diagnostics Layer
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n🔹 6. Checking Layer 6: Data Quality & Diagnostics Layer...');

const diagnostics = evaluateDataQualityFlags({
  fixtureId: 999,
  tournamentName: 'US Open',
  surface: 'hard',
  homePlayer: { id: 1, name: 'Player A', ranking: 10 },
  awayPlayer: { id: 2, name: 'Player B', ranking: 20 },
  homeSurfaceStats: { matches: 10, wins: 8, losses: 2 },
  awaySurfaceStats: { matches: 10, wins: 7, losses: 3 },
  homeRecentMatches: [{ id: 101, date: '2026-08-20', winnerHome: true, homePlayer: { name: 'Player A' }, awayPlayer: { name: 'X' } }],
  weather: { temperatureC: 25, humidityPct: 50 },
});
assertCheck('Data Quality Diagnostics Score', diagnostics.qualityScorePct === 100 && diagnostics.overallQuality === 'HIGH', `Score: ${diagnostics.qualityScorePct}%`);

const brier = calculateBrierScore([
  { predictedProb: 0.80, actualOutcomeWon: true },
  { predictedProb: 0.30, actualOutcomeWon: false },
]);
assertCheck('Brier Calibration Score calculation', brier < 0.10, `Brier Score: ${brier}`);

const logLoss = calculateLogLoss([
  { predictedProb: 0.80, actualOutcomeWon: true },
  { predictedProb: 0.30, actualOutcomeWon: false },
]);
assertCheck('Log Loss calculation', logLoss > 0 && logLoss < 0.40, `Log Loss: ${logLoss}`);

// ─────────────────────────────────────────────────────────────────────────────
// 7. END-TO-END MASTER AGGREGATOR
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n🔹 7. Checking Full End-to-End computeFullMatchAnalytics()...');

const fullMatch = computeFullMatchAnalytics({
  fixtureId: 123456,
  tournamentName: 'US Open, New York, USA',
  surface: 'hard',
  matchDate: '2026-08-27',
  homePlayer: { id: 10, name: 'Jannik Sinner', ranking: 1, country: 'IT' },
  awayPlayer: { id: 20, name: 'Carlos Alcaraz', ranking: 3, country: 'ES' },
  homeProfile: { name: 'Jannik Sinner', hand: 'R', backhand: '2H', playstyle: 'Aggressive Power Baseliner' },
  awayProfile: { name: 'Carlos Alcaraz', hand: 'R', backhand: '2H', playstyle: 'All-Court Aggressive Power' },
  homeSurfaceStats: { matches: 25, wins: 22, losses: 3, firstServeTotal: 1400, firstServePointsScored: 1080 },
  awaySurfaceStats: { matches: 24, wins: 20, losses: 4, firstServeTotal: 1350, firstServePointsScored: 1020 },
  homeRecentMatches: [
    { id: 1, date: '2026-08-25', winnerHome: true, homePlayer: { id: 10, name: 'Jannik Sinner' }, awayPlayer: { id: 99, name: 'Opponent' }, sets: [{ setNumber: 1, homeScore: 6, awayScore: 3 }, { setNumber: 2, homeScore: 6, awayScore: 2 }] }
  ],
  awayRecentMatches: [
    { id: 2, date: '2026-08-25', winnerHome: true, homePlayer: { id: 20, name: 'Carlos Alcaraz' }, awayPlayer: { id: 98, name: 'Opponent' }, sets: [{ setNumber: 1, homeScore: 7, awayScore: 6 }, { setNumber: 2, homeScore: 6, awayScore: 4 }] }
  ],
  h2hSummary: { homeWins: 4, awayWins: 5 },
  weather: { temperatureC: 28, humidityPct: 45, windSpeedKmh: 12 },
});

assertCheck('Full Match computedAt timestamp exists', !!fullMatch.computedAt);
assertCheck('Full Match Energy layer populated', fullMatch.energy.home.energyTankPct >= 0);
assertCheck('Full Match Environmental layer populated', fullMatch.environmental.deltas.airDensityKgm3 > 0);
assertCheck('Full Match Surface KPIs & Elo populated', fullMatch.surfaceKpis.homeSurfaceElo > 2000);
assertCheck('Full Match Synergy & Set Dynamics populated', fullMatch.synergy.homeSynergy.totalSynergyIndex > 0);
assertCheck('Full Match Tactical Matrix populated', !!fullMatch.tactical.handedness);
assertCheck('Full Match Markov Pricing populated', fullMatch.markovOdds.fairOddsHome > 1.0);
assertCheck('Full Match Diagnostics populated', fullMatch.diagnostics.qualityScorePct > 0);

console.log('\n========================================================================');
console.log(`🏁 AUDIT COMPLETE: ${passCount} / ${totalCount} CHECKS PASSED (${Math.round((passCount / totalCount) * 100)}%)`);
console.log('========================================================================\n');
