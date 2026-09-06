import type { HistoricalMatchItem } from '../types';

export interface SetConversionDynamics {
  firstSetWinConversionRate: number;
  firstSetLostComebackRate: number;
  decidingSetWinRate: number;
  decidingSetRecord: string;
  firstSetWinRecord: string;
  totalMatchesAnalyzed: number;
  clutchVerdict: 'ELITE_CLOSER' | 'SOLID_CLOSER' | 'AVERAGE' | 'CHOKER' | 'LOW_SAMPLE';
}

export const calculateSetConversionDynamics = (
  lastMatches: HistoricalMatchItem[],
  playerId?: number
): SetConversionDynamics => {
  let wonSet1Count = 0;
  let wonSet1AndMatchCount = 0;
  let lostSet1Count = 0;
  let lostSet1AndMatchCount = 0;
  let decidingSetTotal = 0;
  let decidingSetWins = 0;
  let finishedCount = 0;

  (lastMatches || []).forEach(m => {
    finishedCount++;
    const isHome = playerId ? m.homePlayer?.id === playerId : true;
    const playerWonMatch = isHome ? !!m.winnerHome : !m.winnerHome;

    if (m.sets && m.sets.length > 0) {
      const set1 = m.sets[0];
      const p1WonSet1 = isHome ? set1.homeScore > set1.awayScore : set1.awayScore > set1.homeScore;
      if (p1WonSet1) {
        wonSet1Count++;
        if (playerWonMatch) wonSet1AndMatchCount++;
      } else {
        lostSet1Count++;
        if (playerWonMatch) lostSet1AndMatchCount++;
      }

      const tName = (m.tournamentName || '').toLowerCase();
      const isGrandSlam = tName.includes('us open') || tName.includes('wimbledon') || tName.includes('roland garros') || tName.includes('australian open');
      const isDecidingSet = isGrandSlam ? m.sets.length === 5 : m.sets.length === 3;

      if (isDecidingSet) {
        decidingSetTotal++;
        if (playerWonMatch) decidingSetWins++;
      }
    }
  });

  const firstSetWinConversionRate = wonSet1Count > 0
    ? Math.round(((wonSet1AndMatchCount + 3.9) / (wonSet1Count + 5)) * 100)
    : 78;

  const firstSetLostComebackRate = lostSet1Count > 0
    ? Math.round(((lostSet1AndMatchCount + 1.1) / (lostSet1Count + 5)) * 100)
    : 22;

  const decidingSetWinRate = decidingSetTotal > 0
    ? Math.round(((decidingSetWins + 2.5) / (decidingSetTotal + 5)) * 100)
    : 50;

  const decidingSetRecord = decidingSetTotal > 0
    ? `${decidingSetWins}-${decidingSetTotal - decidingSetWins} (${decidingSetWinRate}%)`
    : 'No 3-setters (50% base)';

  const firstSetWinRecord = wonSet1Count > 0
    ? `${wonSet1AndMatchCount}/${wonSet1Count} (${firstSetWinConversionRate}%)`
    : '78% base';

  let clutchVerdict: SetConversionDynamics['clutchVerdict'] = 'AVERAGE';
  if (finishedCount === 0) {
    clutchVerdict = 'LOW_SAMPLE';
  } else if (decidingSetTotal >= 2 || wonSet1Count >= 3) {
    if (decidingSetWinRate >= 65 && firstSetWinConversionRate >= 80) clutchVerdict = 'ELITE_CLOSER';
    else if (decidingSetWinRate >= 55 || firstSetWinConversionRate >= 75) clutchVerdict = 'SOLID_CLOSER';
    else if (decidingSetWinRate <= 40) clutchVerdict = 'CHOKER';
    else clutchVerdict = 'AVERAGE';
  } else {
    clutchVerdict = 'SOLID_CLOSER';
  }

  return {
    firstSetWinConversionRate,
    firstSetLostComebackRate,
    decidingSetWinRate,
    decidingSetRecord,
    firstSetWinRecord,
    totalMatchesAnalyzed: finishedCount,
    clutchVerdict,
  };
};
