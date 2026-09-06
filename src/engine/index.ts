import type { MatchAnalyticsInput, MatchAnalyticsResult } from './types';
import { calculateWeightedFatigueLoad } from './physics/fatigueEngine';
import { calculateEnvironmentalDeltas } from './physics/environmentalDeltas';
import { calculateMatchSessionConditions } from './physics/sessionConditions';
import { calculateSurfaceKpis } from './surface/surfaceModel';
import { calculateSurfaceEloRating } from './surface/surfaceElo';
import { calculateHoldBreakSynergy } from './dynamics/holdBreakSynergy';
import { calculateSetConversionDynamics } from './dynamics/setDynamics';
import { calculateHandednessAdvantage } from './dynamics/handednessDynamics';
import { calculateRankingPointsDefense } from './dynamics/pointsDefense';
import { classifyTournamentTier, calculateTournamentTransition } from './dynamics/tournamentTransitions';
import {
  getPlayerTacticalProfile,
  calculateRecentRetirements,
  detectKryptoniteMatchup,
  calculateTiltRiskLevel,
  calculateMatchupPressureProfile,
} from './tactical/tacticalIntelligence';
import { calculateBarnettClarkeMatchPricing } from './odds/markovEngine';
import { evaluateDataQualityFlags } from './diagnostics/predictionDiagnostics';

export * from './types';
export * from './physics/fatigueEngine';
export * from './physics/environmentalDeltas';
export * from './physics/sessionConditions';
export * from './surface/surfaceModel';
export * from './surface/surfaceElo';
export * from './dynamics/holdBreakSynergy';
export * from './dynamics/setDynamics';
export * from './dynamics/handednessDynamics';
export * from './dynamics/pointsDefense';
export * from './dynamics/tournamentTransitions';
export * from './tactical/tacticalIntelligence';
export * from './odds/markovEngine';
export * from './odds/universalMath';
export * from './venue/tournamentVenueData';
export * from './diagnostics/predictionDiagnostics';

export const computeFullMatchAnalytics = (input: MatchAnalyticsInput): MatchAnalyticsResult => {
  const isWTA = !!input.isWTA;
  const surface = input.surface || 'hard';
  const tourneyTier = classifyTournamentTier(input.tournamentName, isWTA);

  // 1. Fatigue & Bio
  const homeFatigue = calculateWeightedFatigueLoad(input.homeRecentMatches || [], input.homePlayer?.id, input.matchDate);
  const awayFatigue = calculateWeightedFatigueLoad(input.awayRecentMatches || [], input.awayPlayer?.id, input.matchDate);

  // 2. Environmental
  const envContext = {
    tournamentName: input.tournamentName,
    tournamentCountry: undefined,
    matchDate: input.matchDate,
    currentSurface: surface,
    weather: input.weather || undefined,
  };
  const homeEnvDeltas = calculateEnvironmentalDeltas(envContext, homeFatigue, input.homePlayer?.country, 26);
  const awayEnvDeltas = calculateEnvironmentalDeltas(envContext, awayFatigue, input.awayPlayer?.country, 26);
  const sessionCond = calculateMatchSessionConditions(input.weather);

  // 3. Surface & ELO
  const homeSurfaceKpis = calculateSurfaceKpis(input.homeSurfaceStats, surface);
  const awaySurfaceKpis = calculateSurfaceKpis(input.awaySurfaceStats, surface);
  const homeSurfaceElo = calculateSurfaceEloRating(input.homePlayer?.ranking || 100, homeSurfaceKpis.winRatePct, homeSurfaceKpis.matches);
  const awaySurfaceElo = calculateSurfaceEloRating(input.awayPlayer?.ranking || 100, awaySurfaceKpis.winRatePct, awaySurfaceKpis.matches);

  // 4. Synergy & Sets
  const homeSynergy = calculateHoldBreakSynergy(input.homeSurfaceStats, input.homeProfile, input.homePlayer?.ranking, isWTA);
  const awaySynergy = calculateHoldBreakSynergy(input.awaySurfaceStats, input.awayProfile, input.awayPlayer?.ranking, isWTA);
  const homeSetDyn = calculateSetConversionDynamics(input.homeRecentMatches || [], input.homePlayer?.id);
  const awaySetDyn = calculateSetConversionDynamics(input.awayRecentMatches || [], input.awayPlayer?.id);

  // 5. Tactical & Dynamics
  const homeTactical = getPlayerTacticalProfile(input.homePlayer?.name || '');
  const awayTactical = getPlayerTacticalProfile(input.awayPlayer?.name || '');
  const handedness = calculateHandednessAdvantage(input.homePlayer?.name || '', input.awayPlayer?.name || '', homeTactical.hand, awayTactical.hand, surface);
  const homePtsDefense = calculateRankingPointsDefense(input.homePlayer?.ranking || 80, input.roundName, tourneyTier);
  const awayPtsDefense = calculateRankingPointsDefense(input.awayPlayer?.ranking || 80, input.roundName, tourneyTier);
  const homeTourneyTrans = calculateTournamentTransition(homeFatigue.daysSinceLastMatch, 'ATP 250', tourneyTier);
  const awayTourneyTrans = calculateTournamentTransition(awayFatigue.daysSinceLastMatch, 'ATP 250', tourneyTier);
  const kryptonite = detectKryptoniteMatchup(input.homePlayer?.name || '', input.awayPlayer?.name || '', input.h2hSummary ? { homeWins: input.h2hSummary.homeWins, awayWins: input.h2hSummary.awayWins } : null);

  const homeTilt = calculateTiltRiskLevel(homeSetDyn.firstSetLostComebackRate, homeSetDyn.decidingSetWinRate, homeSurfaceKpis.doubleFaultRate);
  const awayTilt = calculateTiltRiskLevel(awaySetDyn.firstSetLostComebackRate, awaySetDyn.decidingSetWinRate, awaySurfaceKpis.doubleFaultRate);

  const homePressure = calculateMatchupPressureProfile(input.homePlayer?.ranking || 50, input.awayPlayer?.ranking || 50, homeSurfaceKpis.winRatePct);
  const awayPressure = calculateMatchupPressureProfile(input.awayPlayer?.ranking || 50, input.homePlayer?.ranking || 50, awaySurfaceKpis.winRatePct);

  // 6. Markov Odds
  // Derive point win probabilities based on serve % and ELO delta
  const eloDelta = homeSurfaceElo - awaySurfaceElo;
  const pA_base = (homeSurfaceKpis.firstServeWonPct ? homeSurfaceKpis.firstServeWonPct / 100 * 0.9 : 0.64) + (eloDelta / 4000);
  const pB_base = (awaySurfaceKpis.firstServeWonPct ? awaySurfaceKpis.firstServeWonPct / 100 * 0.9 : 0.63) - (eloDelta / 4000);
  const pA = Math.min(0.85, Math.max(0.45, Math.round(pA_base * 1000) / 1000));
  const pB = Math.min(0.85, Math.max(0.45, Math.round(pB_base * 1000) / 1000));

  const isGrandSlamMen = !isWTA && tourneyTier === 'Grand Slam';
  const markovPricing = calculateBarnettClarkeMatchPricing(pA, pB, isGrandSlamMen);

  // 7. Layer 6 Diagnostics
  const diagnostics = evaluateDataQualityFlags(input);

  return {
    fixtureId: input.fixtureId,
    tournamentName: input.tournamentName,
    matchDate: input.matchDate,
    homeName: input.homePlayer?.name || 'Player 1',
    awayName: input.awayPlayer?.name || 'Player 2',
    surface,
    computedAt: new Date().toISOString(),
    energy: {
      home: homeFatigue,
      away: awayFatigue,
      diffTankPct: (homeFatigue.energyTankPct || 100) - (awayFatigue.energyTankPct || 100),
    },
    environmental: {
      deltas: homeEnvDeltas,
      homeDeltas: homeEnvDeltas,
      awayDeltas: awayEnvDeltas,
      session: sessionCond,
    },
    surfaceKpis: {
      cpi: homeSurfaceKpis.cpiIndex,
      homeKpis: homeSurfaceKpis,
      awayKpis: awaySurfaceKpis,
      homeSurfaceElo,
      awaySurfaceElo,
    },
    synergy: {
      homeSynergy,
      awaySynergy,
      homeSetDynamics: homeSetDyn,
      awaySetDynamics: awaySetDyn,
    },
    tactical: {
      homeTactical,
      awayTactical,
      handedness,
      homePointsDefense: homePtsDefense,
      awayPointsDefense: awayPtsDefense,
      homeTournamentTransition: homeTourneyTrans,
      awayTournamentTransition: awayTourneyTrans,
      kryptoniteHomeAdvantage: kryptonite.homeKryptonite,
      kryptoniteAwayAdvantage: kryptonite.awayKryptonite,
      homeTilt,
      awayTilt,
      homePressureProfile: homePressure,
      awayPressureProfile: awayPressure,
    },
    markovOdds: markovPricing,
    diagnostics,
  };
};
