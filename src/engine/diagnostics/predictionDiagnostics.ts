import type { MatchAnalyticsInput, MatchAnalyticsResult } from '../types';

export interface DataQualityFlag {
  field: string;
  level: 'info' | 'warning' | 'critical';
  message: string;
}

export interface DataQualityDiagnostics {
  overallQuality: 'HIGH' | 'ACCEPTABLE' | 'DEGRADED';
  qualityScorePct: number;
  flags: DataQualityFlag[];
}

export const evaluateDataQualityFlags = (
  input: MatchAnalyticsInput,
  result?: Partial<MatchAnalyticsResult>
): DataQualityDiagnostics => {
  const flags: DataQualityFlag[] = [];
  let score = 100;

  // 1. Check Player Rankings
  if (!input.homePlayer?.ranking) {
    flags.push({
      field: 'homePlayer.ranking',
      level: 'warning',
      message: 'Home player ranking missing; default fallback prior applied.',
    });
    score -= 10;
  }
  if (!input.awayPlayer?.ranking) {
    flags.push({
      field: 'awayPlayer.ranking',
      level: 'warning',
      message: 'Away player ranking missing; default fallback prior applied.',
    });
    score -= 10;
  }

  // 2. Check Surface Stats Sample Size
  if (!input.homeSurfaceStats || input.homeSurfaceStats.matches < 3) {
    flags.push({
      field: 'homeSurfaceStats',
      level: 'info',
      message: 'Low surface match history for home player (<3 matches in current sample).',
    });
    score -= 8;
  }
  if (!input.awaySurfaceStats || input.awaySurfaceStats.matches < 3) {
    flags.push({
      field: 'awaySurfaceStats',
      level: 'info',
      message: 'Low surface match history for away player (<3 matches in current sample).',
    });
    score -= 8;
  }

  // 3. Check Recent Match Schedule
  if (!input.homeRecentMatches || input.homeRecentMatches.length === 0) {
    flags.push({
      field: 'homeRecentMatches',
      level: 'info',
      message: 'No recent match history found in past 30 days (default 100% freshness assumed).',
    });
    score -= 5;
  }

  // 4. Check Weather / Environmental completeness
  if (!input.weather) {
    flags.push({
      field: 'weather',
      level: 'info',
      message: 'Real-time match weather unavailable; baseline standard venue temperature used.',
    });
    score -= 5;
  }

  const qualityScorePct = Math.max(20, Math.min(100, score));
  const overallQuality = qualityScorePct >= 80 ? 'HIGH' : qualityScorePct >= 60 ? 'ACCEPTABLE' : 'DEGRADED';

  return {
    overallQuality,
    qualityScorePct,
    flags,
  };
};

/**
 * Calculates Brier Calibration Score: BS = (1/N) * sum((prob - actual)^2)
 * Perfect prediction = 0.0, Coin flip = 0.25, Completely wrong = 1.0
 */
export const calculateBrierScore = (
  predictions: Array<{ predictedProb: number; actualOutcomeWon: boolean }>
): number => {
  if (!predictions || predictions.length === 0) return 0;
  const sum = predictions.reduce((acc, item) => {
    const outcome = item.actualOutcomeWon ? 1 : 0;
    return acc + Math.pow(item.predictedProb - outcome, 2);
  }, 0);
  return Math.round((sum / predictions.length) * 1000) / 1000;
};

/**
 * Calculates Binary Log-Loss (Cross-Entropy): - (1/N) * sum(y*log(p) + (1-y)*log(1-p))
 */
export const calculateLogLoss = (
  predictions: Array<{ predictedProb: number; actualOutcomeWon: boolean }>
): number => {
  if (!predictions || predictions.length === 0) return 0;
  const eps = 1e-15;
  const sum = predictions.reduce((acc, item) => {
    const y = item.actualOutcomeWon ? 1 : 0;
    const p = Math.max(eps, Math.min(1 - eps, item.predictedProb));
    return acc + (y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }, 0);
  return Math.round((-sum / predictions.length) * 1000) / 1000;
};
