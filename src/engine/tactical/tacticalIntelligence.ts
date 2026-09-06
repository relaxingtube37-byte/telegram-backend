import type { HistoricalMatchItem, PlayerEnrichedProfile } from '../types';
import { parseToEpochMs } from '../physics/fatigueEngine';

export interface RecentRetirementMetrics {
  hasRecentRetirement: boolean;
  retirementDate?: string;
  retirementTournament?: string;
  retirementType?: 'RET' | 'WO' | 'DEFAULT';
  daysSinceRetirement?: number;
  injuryAlertWarning?: string;
  penaltyPct: number;
}

export interface MatchupPressureProfile {
  winRateAsFavorite: number;
  favoriteRecord: string;
  winRateAsUnderdog: number;
  underdogRecord: string;
  chokeRiskLevel: 'LOW' | 'MODERATE' | 'HIGH';
  upsetThreatLevel: 'HIGH_UPSET_THREAT' | 'SOLID' | 'LOW';
}

export const PLAYER_TACTICAL_LOOKUP: Record<string, { hand: 'L' | 'R'; backhand: '1H' | '2H'; playstyle: string }> = {
  'rafael nadal':        { hand: 'L', backhand: '2H', playstyle: 'Aggressive Clay King / Heavy Topspin' },
  'roger federer':       { hand: 'R', backhand: '1H', playstyle: 'All-Court Craftsman' },
  'novak djokovic':      { hand: 'R', backhand: '2H', playstyle: 'Counter-Puncher / Complete Baseliner' },
  'carlos alcaraz':      { hand: 'R', backhand: '2H', playstyle: 'All-Court Aggressive Power' },
  'jannik sinner':       { hand: 'R', backhand: '2H', playstyle: 'Aggressive Power Baseliner' },
  'daniil medvedev':     { hand: 'R', backhand: '2H', playstyle: 'Deep Defensive Counter-Puncher' },
  'alexander zverev':    { hand: 'R', backhand: '2H', playstyle: 'Power Baseliner / Big Server' },
  'stefanos tsitsipas':  { hand: 'R', backhand: '1H', playstyle: 'Aggressive All-Court Serve-and-Volley' },
  'casper ruud':         { hand: 'R', backhand: '2H', playstyle: 'Heavy Spin Clay Specialist' },
  'andrey rublev':       { hand: 'R', backhand: '2H', playstyle: 'Aggressive Flat Baseliner' },
  'grigor dimitrov':     { hand: 'R', backhand: '1H', playstyle: 'All-Court Shotmaker' },
  'alex de minaur':      { hand: 'R', backhand: '2H', playstyle: 'Speed Counter-Puncher / Retriever' },
  'ben shelton':         { hand: 'L', backhand: '2H', playstyle: 'Big Leftie Serve & Explosive Forehand' },
  'taylor fritz':        { hand: 'R', backhand: '2H', playstyle: 'Aggressive Flat Server' },
  'jack draper':         { hand: 'L', backhand: '2H', playstyle: 'Big Leftie Power Server / Baseliner' },
  'holger rune':         { hand: 'R', backhand: '2H', playstyle: 'Aggressive Competitor / Tactical' },
  'tommy paul':          { hand: 'R', backhand: '2H', playstyle: 'Consistent Flat Baseliner' },
  'ugo humbert':         { hand: 'L', backhand: '2H', playstyle: 'Leftie Aggressive Baseliner' },
  'cameron norrie':      { hand: 'L', backhand: '2H', playstyle: 'Leftie Consistent Baseliner' },
  'iga swiatek':         { hand: 'R', backhand: '2H', playstyle: 'Heavy Spin Clay Queen / All-Court' },
  'aryna sabalenka':     { hand: 'R', backhand: '2H', playstyle: 'Power Hitter / Aggressive Baseliner' },
  'elena rybakina':      { hand: 'R', backhand: '2H', playstyle: 'Big Serve Flat Hitter' },
  'coco gauff':          { hand: 'R', backhand: '2H', playstyle: 'Athletic Counter-Puncher / Returner' },
  'jessica pegula':      { hand: 'R', backhand: '2H', playstyle: 'Consistent Flat Hitter' },
  'zheng qinwen':        { hand: 'R', backhand: '2H', playstyle: 'Heavy Spin Power Player' },
  'marketa vondrousova': { hand: 'L', backhand: '2H', playstyle: 'Leftie Drop-Shot Artist' },
};

export const getPlayerTacticalProfile = (name: string): PlayerEnrichedProfile => {
  const norm = (name || '').toLowerCase().trim();
  if (PLAYER_TACTICAL_LOOKUP[norm]) {
    const s = PLAYER_TACTICAL_LOOKUP[norm];
    return { name, hand: s.hand, backhand: s.backhand, playstyle: s.playstyle };
  }
  for (const [key, val] of Object.entries(PLAYER_TACTICAL_LOOKUP)) {
    if (norm.includes(key) || key.includes(norm)) {
      return { name, hand: val.hand, backhand: val.backhand, playstyle: val.playstyle };
    }
  }
  return { name, hand: 'R', backhand: '2H', playstyle: 'Standard All-Court Pro' };
};

export const calculateRecentRetirements = (
  lastMatches: HistoricalMatchItem[],
  playerId?: number,
  referenceDate?: string | number
): RecentRetirementMetrics => {
  const refTimeMs = parseToEpochMs(referenceDate);

  for (const m of (lastMatches || [])) {
    if (m.isRetirement) {
      const matchMs = parseToEpochMs(m.date);
      const daysAgo = Math.max(0, (refTimeMs - matchMs) / (1000 * 60 * 60 * 24));
      if (daysAgo <= 30) {
        const penalty = daysAgo <= 7 ? 25 : daysAgo <= 14 ? 15 : 8;
        return {
          hasRecentRetirement: true,
          retirementDate: m.date,
          retirementTournament: m.tournamentName || 'Recent Tourney',
          retirementType: 'RET',
          daysSinceRetirement: Math.round(daysAgo),
          injuryAlertWarning: `⚠️ Warning: Player retired from match ${Math.round(daysAgo)} days ago. Physical stamina at risk.`,
          penaltyPct: penalty,
        };
      }
    }
  }

  return {
    hasRecentRetirement: false,
    penaltyPct: 0,
  };
};

export const detectKryptoniteMatchup = (
  homeName: string,
  awayName: string,
  h2hSummary?: { homeWins: number; awayWins: number } | null
): { homeKryptonite: boolean; awayKryptonite: boolean; summary: string } => {
  if (!h2hSummary) return { homeKryptonite: false, awayKryptonite: false, summary: 'No H2H signal' };

  const { homeWins, awayWins } = h2hSummary;
  if (awayWins >= 3 && homeWins === 0) {
    return {
      homeKryptonite: true,
      awayKryptonite: false,
      summary: `⚡ Kryptonite Matchup: ${awayName} has dominant 0-${awayWins} record vs ${homeName}`,
    };
  }
  if (homeWins >= 3 && awayWins === 0) {
    return {
      homeKryptonite: false,
      awayKryptonite: true,
      summary: `⚡ Kryptonite Matchup: ${homeName} has dominant ${homeWins}-0 record vs ${awayName}`,
    };
  }

  return { homeKryptonite: false, awayKryptonite: false, summary: 'Balanced H2H dynamic' };
};

export const calculateTiltRiskLevel = (
  firstSetLostComebackRate = 22,
  decidingSetWinRate = 50,
  doubleFaultRate = 3.5
): { tiltRiskLevel: 'LOW' | 'MODERATE' | 'HIGH'; tiltSummary: string } => {
  let score = 0;
  if (firstSetLostComebackRate < 18) score += 2;
  if (decidingSetWinRate < 42) score += 2;
  if (doubleFaultRate > 4.5) score += 1;

  if (score >= 3) {
    return { tiltRiskLevel: 'HIGH', tiltSummary: 'High tilt & mental breakdown risk under adverse flow' };
  }
  if (score >= 1) {
    return { tiltRiskLevel: 'MODERATE', tiltSummary: 'Moderate emotional vulnerability on crucial breaks' };
  }
  return { tiltRiskLevel: 'LOW', tiltSummary: 'High mental composure and emotional resilience' };
};

export const calculateMatchupPressureProfile = (
  ranking = 50,
  opponentRanking = 50,
  winRatePct = 50
): MatchupPressureProfile => {
  const isFav = ranking < opponentRanking;
  const winRateAsFav = Math.min(95, Math.max(50, Math.round(winRatePct * 1.15)));
  const winRateAsDog = Math.min(60, Math.max(15, Math.round(winRatePct * 0.75)));

  const chokeRisk = isFav && winRateAsFav < 68 ? 'HIGH' : isFav && winRateAsFav < 78 ? 'MODERATE' : 'LOW';
  const upsetThreat = !isFav && winRateAsDog >= 42 ? 'HIGH_UPSET_THREAT' : !isFav && winRateAsDog >= 30 ? 'SOLID' : 'LOW';

  return {
    winRateAsFavorite: winRateAsFav,
    favoriteRecord: `${winRateAsFav}% when priced favorite`,
    winRateAsUnderdog: winRateAsDog,
    underdogRecord: `${winRateAsDog}% when priced underdog`,
    chokeRiskLevel: chokeRisk,
    upsetThreatLevel: upsetThreat,
  };
};
