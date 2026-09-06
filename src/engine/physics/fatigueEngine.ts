import type { HistoricalMatchItem } from '../types';
import type { RecentRetirementMetrics } from '../tactical/tacticalIntelligence';
import type { TournamentTransitionMetrics } from '../dynamics/tournamentTransitions';

export interface EnergyTankMetrics {
  levelPct: number;
  status: 'Full' | 'Good' | 'Moderate' | 'Fatigued' | 'Critical';
  color: string;
  badgeBg: string;
  icon: string;
  restStr: string;
  durationStr: string;
}

export interface PlayerFatigueMetrics {
  tournamentFatigueLoad: number;
  recentMatchesCount: number;
  recentTotalGames: number;
  totalCourtTimeMinutes: number;
  lastMatchDurationMinutes: number;
  avgMatchDurationMinutes: number;
  daysSinceLastMatch: number;
  restHoursSinceLastMatch?: number;
  restQuality: number;
  energyTankPct?: number;
  energyTankLabel?: string;
  compositeFatigueIndex: number; // Unified 0.0 (fresh) to 1.0 (exhausted) continuous fatigue index
  emaRecentFormScore: number;
}

export const parseToEpochMs = (rawDateOrTimestamp?: any): number => {
  if (!rawDateOrTimestamp) return Date.now();
  if (typeof rawDateOrTimestamp === 'number') {
    return rawDateOrTimestamp > 1e11 ? rawDateOrTimestamp : rawDateOrTimestamp * 1000;
  }
  if (typeof rawDateOrTimestamp === 'string') {
    const trimmed = rawDateOrTimestamp.trim();
    if (/^\d{10,13}$/.test(trimmed)) {
      const num = Number(trimmed);
      return num > 1e11 ? num : num * 1000;
    }
    const ms = new Date(trimmed).getTime();
    if (!isNaN(ms)) return ms;
  }
  if (rawDateOrTimestamp instanceof Date) {
    return rawDateOrTimestamp.getTime();
  }
  return Date.now();
};

export const calculateEnergyTank = (
  fatigue?: PlayerFatigueMetrics,
  extraModifiers?: {
    recentRetirement?: RecentRetirementMetrics;
    tournamentTransition?: TournamentTransitionMetrics;
  }
): EnergyTankMetrics => {
  if (!fatigue || fatigue.daysSinceLastMatch >= 14) {
    const retPenalty = extraModifiers?.recentRetirement?.hasRecentRetirement ? extraModifiers.recentRetirement.penaltyPct : 0;
    const hangPenalty = extraModifiers?.tournamentTransition?.isDeepRunHangover ? extraModifiers.tournamentTransition.hangoverFatiguePenalty : 0;
    const basePct = Math.max(20, 100 - retPenalty - hangPenalty);
    return {
      levelPct: basePct,
      status: basePct >= 85 ? 'Full' : basePct >= 70 ? 'Good' : basePct >= 50 ? 'Moderate' : 'Fatigued',
      color: basePct >= 85 ? '#22c55e' : basePct >= 70 ? '#38bdf8' : basePct >= 50 ? '#fbbf24' : '#f97316',
      badgeBg: basePct >= 85 ? 'rgba(34, 197, 94, 0.15)' : basePct >= 70 ? 'rgba(56, 189, 248, 0.15)' : 'rgba(251, 191, 36, 0.15)',
      icon: basePct >= 70 ? '🔋' : '🪫',
      restStr: fatigue ? (fatigue.daysSinceLastMatch > 21 ? 'Well Rested (>3w)' : `${Math.round(fatigue.daysSinceLastMatch)}d break`) : 'Well Rested',
      durationStr: 'Fresh / Fully Recovered',
    };
  }

  const restHours = fatigue.restHoursSinceLastMatch !== undefined
    ? fatigue.restHoursSinceLastMatch
    : (fatigue.daysSinceLastMatch * 24);
  const days = restHours / 24;
  const lastDur = fatigue.lastMatchDurationMinutes || 0;
  const wfl = fatigue.tournamentFatigueLoad || 0;

  // 1. Single Match Strain
  const durHours = lastDur / 60;
  const matchStrain = Math.pow(Math.max(durHours, 0.5), 1.3) * 16.0;

  // 2. Continuous Exponential Saturation
  const recoveryFraction = Math.min(1.0, 1.0 - Math.exp(-0.040 * restHours));
  const unrecoveredMatchStrain = matchStrain * (1.0 - recoveryFraction);

  // 3. Cumulative Tournament Fatigue (WFL) Drain
  const cumulativeWflDrain = Math.min(22, wfl * 0.18) * (1.0 - recoveryFraction * 0.70);

  // 4. Acute Short-Rest Deficit (<24h penalty)
  const acuteRestDeficit = restHours < 24 ? Math.pow((24 - restHours) / 24, 1.2) * 14.0 : 0;

  // 5. Base Depletion for Recent Match (<48h)
  const baselineDepletion = restHours < 48 ? Math.max(0, 10 * (1 - restHours / 48)) : 0;

  // 6. Extra Physical Penalties
  const retirementPenalty = extraModifiers?.recentRetirement?.hasRecentRetirement
    ? extraModifiers.recentRetirement.penaltyPct
    : 0;
  const deepRunPenalty = extraModifiers?.tournamentTransition?.isDeepRunHangover
    ? extraModifiers.tournamentTransition.hangoverFatiguePenalty
    : 0;

  // 7. Compute Final Battery Level
  const rawLevel = 100 - unrecoveredMatchStrain - cumulativeWflDrain - acuteRestDeficit - baselineDepletion - retirementPenalty - deepRunPenalty;
  const levelPct = Math.max(15, Math.min(100, Math.round(rawLevel)));

  let status: 'Full' | 'Good' | 'Moderate' | 'Fatigued' | 'Critical' = 'Full';
  let color = '#22c55e';
  let badgeBg = 'rgba(34, 197, 94, 0.15)';
  let icon = '🔋';

  if (levelPct >= 85) {
    status = 'Full';
    color = '#22c55e';
    badgeBg = 'rgba(34, 197, 94, 0.15)';
    icon = '🔋';
  } else if (levelPct >= 70) {
    status = 'Good';
    color = '#38bdf8';
    badgeBg = 'rgba(56, 189, 248, 0.15)';
    icon = '🔋';
  } else if (levelPct >= 50) {
    status = 'Moderate';
    color = '#fbbf24';
    badgeBg = 'rgba(251, 191, 36, 0.15)';
    icon = '🪫';
  } else if (levelPct >= 30) {
    status = 'Fatigued';
    color = '#f97316';
    badgeBg = 'rgba(249, 115, 22, 0.15)';
    icon = '🪫';
  } else {
    status = 'Critical';
    color = '#f43f5e';
    badgeBg = 'rgba(244, 63, 94, 0.15)';
    icon = '⚠️';
  }

  let restStr: string;
  if (restHours < 1) {
    restStr = 'Just played (<1h ago)';
  } else if (restHours < 12) {
    restStr = `Played Today (${Math.round(restHours)}h ago)`;
  } else if (restHours < 18) {
    restStr = `${Math.round(restHours)}h rest (<1d)`;
  } else if (restHours < 30) {
    restStr = `1 day rest (~${Math.round(restHours)}h)`;
  } else if (restHours < 48) {
    restStr = `${Math.round(restHours)}h rest (~1.5d)`;
  } else if (days <= 7) {
    restStr = `${Math.round(days)} days rest`;
  } else if (days <= 21) {
    restStr = `${Math.round(days)}d break`;
  } else {
    restStr = 'Well Rested (>3w)';
  }

  let durationStr: string;
  if (days > 14) {
    durationStr = 'Fresh / Fully Recovered';
  } else if (lastDur > 0) {
    const hrs = Math.floor(lastDur / 60);
    const mins = lastDur % 60;
    const durFormatted = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
    durationStr = `${durFormatted} last match`;
  } else {
    durationStr = 'Standard load';
  }

  return { levelPct, status, color, badgeBg, icon, restStr, durationStr };
};

export const calculateWeightedFatigueLoad = (
  lastMatches: HistoricalMatchItem[],
  playerId?: number,
  referenceDate?: string
): PlayerFatigueMetrics => {
  const LAMBDA = 0.12;
  const ALPHA = 0.25;
  const refTimeMs = parseToEpochMs(referenceDate);
  let wfl = 0;
  let totalGames = 0;
  let totalCourtTimeMinutes = 0;
  let lastMatchDurationMinutes = 0;
  let daysSinceLastMatch = 999;
  let restHoursSinceLastMatch = 999 * 24;
  let emaForm = 50;

  const priorMatches = (lastMatches || [])
    .filter(m => {
      const raw = m.date;
      if (!raw) return false;
      const mStartMs = parseToEpochMs(raw);
      return mStartMs < (refTimeMs - 1800000);
    })
    .sort((a, b) => parseToEpochMs(b.date) - parseToEpochMs(a.date));

  if (priorMatches.length === 0) {
    return {
      tournamentFatigueLoad: 0,
      recentMatchesCount: 0,
      recentTotalGames: 0,
      totalCourtTimeMinutes: 0,
      lastMatchDurationMinutes: 0,
      avgMatchDurationMinutes: 0,
      daysSinceLastMatch: 999,
      restHoursSinceLastMatch: 999 * 24,
      restQuality: 1.0,
      energyTankPct: 100,
      energyTankLabel: 'Full (100%)',
      compositeFatigueIndex: 0.0,
      emaRecentFormScore: 50,
    };
  }

  const chronological = [...priorMatches].reverse();
  for (let i = 0; i < chronological.length; i++) {
    const m = chronological[i];
    const isHome = playerId ? m.homePlayer?.id === playerId : true;
    const isWin = isHome ? !!m.winnerHome : !m.winnerHome;
    const matchScore = isWin ? 100 : 0;
    emaForm = ALPHA * matchScore + (1 - ALPHA) * emaForm;
  }

  const mostRecent = priorMatches[0];
  const mostRecentMs = parseToEpochMs(mostRecent.date);
  const rawDiffHours = (refTimeMs - mostRecentMs) / (1000 * 60 * 60);
  restHoursSinceLastMatch = Math.max(0.5, rawDiffHours);
  daysSinceLastMatch = restHoursSinceLastMatch / 24;

  lastMatchDurationMinutes = mostRecent.durationMinutes || 105;

  priorMatches.forEach((m, idx) => {
    const matchMs = parseToEpochMs(m.date);
    const hoursAgo = Math.max(0, (refTimeMs - matchMs) / (1000 * 60 * 60));
    const daysAgo = hoursAgo / 24;

    let mGames = 0;
    if (m.sets && Array.isArray(m.sets)) {
      m.sets.forEach(s => {
        mGames += (s.homeScore || 0) + (s.awayScore || 0);
      });
    }
    if (mGames === 0) mGames = 22;

    const dur = m.durationMinutes || (mGames * 4.5);
    totalGames += mGames;
    totalCourtTimeMinutes += dur;

    const weight = Math.exp(-LAMBDA * daysAgo);
    wfl += (mGames * 1.0 + (dur / 60) * 8.0) * weight;
  });

  const avgMatchDuration = priorMatches.length > 0
    ? Math.round(totalCourtTimeMinutes / priorMatches.length)
    : 0;

  const energy = calculateEnergyTank({
    tournamentFatigueLoad: Math.round(wfl * 10) / 10,
    recentMatchesCount: priorMatches.length,
    recentTotalGames: totalGames,
    totalCourtTimeMinutes,
    lastMatchDurationMinutes,
    avgMatchDurationMinutes: avgMatchDuration,
    daysSinceLastMatch,
    restHoursSinceLastMatch,
    restQuality: 1.0,
    compositeFatigueIndex: 0,
    emaRecentFormScore: Math.round(emaForm),
  });

  const compositeFatigueIndex = Math.round((100 - energy.levelPct) / 100 * 1000) / 1000;

  return {
    tournamentFatigueLoad: Math.round(wfl * 10) / 10,
    recentMatchesCount: priorMatches.length,
    recentTotalGames: totalGames,
    totalCourtTimeMinutes,
    lastMatchDurationMinutes,
    avgMatchDurationMinutes: avgMatchDuration,
    daysSinceLastMatch: Math.round(daysSinceLastMatch * 10) / 10,
    restHoursSinceLastMatch: Math.round(restHoursSinceLastMatch * 10) / 10,
    restQuality: 1.0,
    energyTankPct: energy.levelPct,
    energyTankLabel: `${energy.status} Recovery`,
    compositeFatigueIndex,
    emaRecentFormScore: Math.round(emaForm),
  };
};
