import type { PlayerYearSurfaceStats, PlayerEnrichedProfile } from '../types';

export interface HoldBreakSynergy {
  holdPct: number;
  breakPct: number;
  totalSynergyIndex: number;
  dominanceRatio: number;
  synergyTier: 'ELITE_CONTENDER' | 'SOLID_TOUR_PRO' | 'VULNERABLE';
  badgeColor: string;
  label: string;
  sampleMatches: number;
}

export const calculateHoldBreakSynergy = (
  stat?: PlayerYearSurfaceStats | null,
  enriched?: PlayerEnrichedProfile | null,
  ranking?: number,
  isWTA?: boolean
): HoldBreakSynergy => {
  const isWtaTour = !!isWTA;
  const playerRank = ranking ?? enriched?.ranking ?? 90;

  // Bayesian priors
  let baselineHold = isWtaTour ? 67.5 : 79.0;
  let baselineBreak = isWtaTour ? 34.0 : 21.5;

  if (isWtaTour) {
    if (playerRank <= 10) { baselineHold = 76.5; baselineBreak = 39.0; }
    else if (playerRank <= 30) { baselineHold = 72.5; baselineBreak = 36.5; }
    else if (playerRank <= 75) { baselineHold = 69.0; baselineBreak = 34.5; }
    else { baselineHold = 65.5; baselineBreak = 32.0; }
  } else {
    if (playerRank <= 10) { baselineHold = 86.5; baselineBreak = 26.5; }
    else if (playerRank <= 30) { baselineHold = 83.5; baselineBreak = 24.5; }
    else if (playerRank <= 75) { baselineHold = 81.0; baselineBreak = 22.5; }
    else if (playerRank <= 150) { baselineHold = 78.5; baselineBreak = 20.5; }
    else { baselineHold = 76.0; baselineBreak = 19.5; }
  }

  if (!stat || stat.matches === 0) {
    const total = Math.round((baselineHold + baselineBreak) * 10) / 10;
    const estServePtsWon = isWtaTour ? 0.57 : 0.64;
    const estReturnPtsWon = isWtaTour ? 0.43 : 0.36;
    const dr = Math.round((estReturnPtsWon / (1 - estServePtsWon)) * 100) / 100;
    return {
      holdPct: Math.round(baselineHold * 10) / 10,
      breakPct: Math.round(baselineBreak * 10) / 10,
      totalSynergyIndex: total,
      dominanceRatio: dr,
      synergyTier: total >= 105 ? 'ELITE_CONTENDER' : total >= 98 ? 'SOLID_TOUR_PRO' : 'VULNERABLE',
      badgeColor: total >= 105 ? '#22c55e' : total >= 98 ? '#38bdf8' : '#f43f5e',
      label: total >= 105 ? 'Elite Contender 🏆' : total >= 98 ? 'Solid Tour Level 🎾' : 'Vulnerable ⚠️',
      sampleMatches: 0,
    };
  }

  const matches = Math.max(1, stat.matches);
  const rawWinRate = stat.wins / matches;

  let caliberDamping = 1.0;
  if (playerRank > 200) caliberDamping = 0.55;
  else if (playerRank > 120) caliberDamping = 0.70;
  else if (playerRank > 75) caliberDamping = 0.82;
  else if (playerRank > 30) caliberDamping = 0.92;

  const winRate = 0.50 + (rawWinRate - 0.50) * caliberDamping;

  const firstTotal = stat.firstServeTotal || 0;
  const firstWon = stat.firstServePointsScored || 0;
  const firstWonRate = firstTotal > 0 ? Math.min(0.88, Math.max(0.55, firstWon / firstTotal)) : (isWtaTour ? 0.65 : 0.73);
  const secondWonRate = isWtaTour ? 0.46 : 0.52;

  const estHold = Math.min(96, Math.max(50, Math.round((0.62 * firstWonRate + 0.38 * secondWonRate) * 1.35 * 100)));
  const estBreak = Math.min(48, Math.max(10, Math.round((winRate * (isWtaTour ? 44 : 32)))));

  const total = Math.round((estHold + estBreak) * 10) / 10;
  const estServePtsWon = 0.62 * firstWonRate + 0.38 * secondWonRate;
  const estReturnPtsWon = 0.28 + (winRate - 0.50) * 0.16;
  const dr = Math.round((estReturnPtsWon / Math.max(0.08, 1 - estServePtsWon)) * 100) / 100;

  return {
    holdPct: estHold,
    breakPct: estBreak,
    totalSynergyIndex: total,
    dominanceRatio: dr,
    synergyTier: total >= 105 ? 'ELITE_CONTENDER' : total >= 98 ? 'SOLID_TOUR_PRO' : 'VULNERABLE',
    badgeColor: total >= 105 ? '#22c55e' : total >= 98 ? '#38bdf8' : '#f43f5e',
    label: total >= 105 ? 'Elite Contender 🏆' : total >= 98 ? 'Solid Tour Level 🎾' : 'Vulnerable ⚠️',
    sampleMatches: matches,
  };
};
