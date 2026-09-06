export interface MarkovMatchupPointParams {
  pA: number;
  pB: number;
  pA_return: number;
  pB_return: number;
  holdProbA: number;
  holdProbB: number;
}

export interface SetScoreDistribution {
  score: string;
  games: number;
  winner: 'home' | 'away';
  probability: number;
}

export interface BarnettClarkePricingResult {
  matchWinProbHome: number;
  matchWinProbAway: number;
  fairOddsHome: number;
  fairOddsAway: number;
  setWinProbHome: number;
  setWinProbAway: number;
  expectedTotalGames: number;
  isBestOfFive?: boolean;
  setScores: {
    twoZeroHome: number;
    twoOneHome: number;
    zeroTwoAway: number;
    oneTwoAway: number;
    threeZeroHome?: number;
    threeOneHome?: number;
    threeTwoHome?: number;
    zeroThreeAway?: number;
    oneThreeAway?: number;
    twoThreeAway?: number;
  };
  pointParams: MarkovMatchupPointParams;
}

export const calculateMarkovGameProb = (p: number): number => {
  const safeP = Math.min(Math.max(p, 0.05), 0.95);
  const q = 1 - safeP;

  const winAtLove = Math.pow(safeP, 4);
  const winAt15 = 4 * Math.pow(safeP, 4) * q;
  const winAt30 = 10 * Math.pow(safeP, 4) * Math.pow(q, 2);
  const deuceProb = 20 * Math.pow(safeP, 3) * Math.pow(q, 3);
  const winFromDeuce = Math.pow(safeP, 2) / (Math.pow(safeP, 2) + Math.pow(q, 2));

  return winAtLove + winAt15 + winAt30 + deuceProb * winFromDeuce;
};

export const calculateMarkovTiebreakProb = (pA: number, pB: number): number => {
  const safeA = Math.min(Math.max(pA, 0.05), 0.95);
  const safeB = Math.min(Math.max(pB, 0.05), 0.95);

  const dp: number[][] = Array.from({ length: 8 }, () => Array(8).fill(0));
  dp[0][0] = 1.0;

  for (let total = 0; total < 12; total++) {
    const cycle = total % 4;
    const isAServing = cycle === 0 || cycle === 3;
    const pServeA = isAServing ? safeA : 1 - safeB;

    for (let a = 0; a <= Math.min(total, 6); a++) {
      const b = total - a;
      if (b > 6) continue;
      const cur = dp[a][b];
      if (cur <= 0) continue;

      if (a + 1 <= 7) dp[a + 1][b] += cur * pServeA;
      if (b + 1 <= 7) dp[a][b + 1] += cur * (1 - pServeA);
    }
  }

  let winProb = 0;
  for (let b = 0; b <= 5; b++) {
    winProb += dp[7][b];
  }

  const p66 = dp[6][6];
  const pA_winsTwo = safeA * (1 - safeB);
  const pB_winsTwo = (1 - safeA) * safeB;
  const winFrom66 = pA_winsTwo / (pA_winsTwo + pB_winsTwo || 1);
  winProb += p66 * winFrom66;

  return Math.min(Math.max(winProb, 0.001), 0.999);
};

export const calculateMarkovSetProbAndDist = (
  pA: number,
  pB: number
): {
  setWinProbHome: number;
  setWinProbAway: number;
  expectedGames: number;
  scoreDistributions: SetScoreDistribution[];
} => {
  const gA = calculateMarkovGameProb(pA);
  const gB = calculateMarkovGameProb(pB);
  const tProb = calculateMarkovTiebreakProb(pA, pB);

  const computeForServer = (firstServer: 'home' | 'away') => {
    const dp: number[][] = Array.from({ length: 8 }, () => Array(8).fill(0));
    dp[0][0] = 1.0;

    for (let total = 0; total < 12; total++) {
      const isA_ServingGame = firstServer === 'home' ? total % 2 === 0 : total % 2 === 1;
      const pHomeWinsGame = isA_ServingGame ? gA : 1 - gB;

      for (let a = 0; a <= Math.min(total, 6); a++) {
        const b = total - a;
        if (b > 6) continue;
        const cur = dp[a][b];
        if (cur <= 0) continue;

        if (a === 6 && b <= 4) continue;
        if (b === 6 && a <= 4) continue;
        if (a === 7 || b === 7) continue;

        if (a + 1 <= 7) dp[a + 1][b] += cur * pHomeWinsGame;
        if (b + 1 <= 7) dp[a][b + 1] += cur * (1 - pHomeWinsGame);
      }
    }

    const scores: SetScoreDistribution[] = [
      { score: '6-0', games: 6, winner: 'home', probability: dp[6][0] },
      { score: '6-1', games: 7, winner: 'home', probability: dp[6][1] },
      { score: '6-2', games: 8, winner: 'home', probability: dp[6][2] },
      { score: '6-3', games: 9, winner: 'home', probability: dp[6][3] },
      { score: '6-4', games: 10, winner: 'home', probability: dp[6][4] },
      { score: '7-5', games: 12, winner: 'home', probability: dp[7][5] },
      { score: '7-6', games: 13, winner: 'home', probability: dp[6][6] * tProb },

      { score: '0-6', games: 6, winner: 'away', probability: dp[0][6] },
      { score: '1-6', games: 7, winner: 'away', probability: dp[1][6] },
      { score: '2-6', games: 8, winner: 'away', probability: dp[2][6] },
      { score: '3-6', games: 9, winner: 'away', probability: dp[3][6] },
      { score: '4-6', games: 10, winner: 'away', probability: dp[4][6] },
      { score: '5-7', games: 12, winner: 'away', probability: dp[5][7] },
      { score: '6-7', games: 13, winner: 'away', probability: dp[6][6] * (1 - tProb) },
    ];

    return scores;
  };

  const scoresHomeFirst = computeForServer('home');
  const scoresAwayFirst = computeForServer('away');

  const blendedScores: SetScoreDistribution[] = scoresHomeFirst.map((item, idx) => ({
    ...item,
    probability: (item.probability + scoresAwayFirst[idx].probability) / 2,
  }));

  const homeSetWinProb = blendedScores
    .filter(s => s.winner === 'home')
    .reduce((acc, s) => acc + s.probability, 0);

  const awaySetWinProb = 1 - homeSetWinProb;
  const expectedGames = blendedScores.reduce((acc, s) => acc + s.games * s.probability, 0);

  return {
    setWinProbHome: homeSetWinProb,
    setWinProbAway: awaySetWinProb,
    expectedGames,
    scoreDistributions: blendedScores,
  };
};

export const calculateBarnettClarkeMatchPricing = (
  pA = 0.64,
  pB = 0.63,
  isBestOfFive = false
): BarnettClarkePricingResult => {
  const { setWinProbHome, setWinProbAway, expectedGames, scoreDistributions } = calculateMarkovSetProbAndDist(pA, pB);

  const sA = setWinProbHome;
  const sB = setWinProbAway;

  let matchWinProbHome = 0;
  let matchWinProbAway = 0;
  let pTwoZero = 0;
  let pTwoOne = 0;
  let pZeroTwo = 0;
  let pOneTwo = 0;
  let pThreeZero = 0;
  let pThreeOne = 0;
  let pThreeTwo = 0;
  let pZeroThree = 0;
  let pOneThree = 0;
  let pTwoThree = 0;
  let expectedSets = 0;

  if (isBestOfFive) {
    pThreeZero = Math.pow(sA, 3);
    pThreeOne = 3 * Math.pow(sA, 3) * sB;
    pThreeTwo = 6 * Math.pow(sA, 3) * Math.pow(sB, 2);
    pZeroThree = Math.pow(sB, 3);
    pOneThree = 3 * Math.pow(sB, 3) * sA;
    pTwoThree = 6 * Math.pow(sB, 3) * Math.pow(sA, 2);

    matchWinProbHome = pThreeZero + pThreeOne + pThreeTwo;
    matchWinProbAway = 1 - matchWinProbHome;

    expectedSets = 3 * (pThreeZero + pZeroThree) + 4 * (pThreeOne + pOneThree) + 5 * (pThreeTwo + pTwoThree);

    pTwoZero = pThreeZero;
    pTwoOne = pThreeOne;
    pZeroTwo = pZeroThree;
    pOneTwo = pOneThree;
  } else {
    pTwoZero = Math.pow(sA, 2);
    pTwoOne = 2 * Math.pow(sA, 2) * sB;
    pZeroTwo = Math.pow(sB, 2);
    pOneTwo = 2 * Math.pow(sB, 2) * sA;

    matchWinProbHome = pTwoZero + pTwoOne;
    matchWinProbAway = 1 - matchWinProbHome;

    expectedSets = 2 * (pTwoZero + pZeroTwo) + 3 * (pTwoOne + pOneTwo);
  }

  const totalExpectedGames = Math.round(expectedSets * expectedGames * 10) / 10;

  const fairOddsHome = Math.min(100, Math.max(1.01, Math.round((1 / Math.max(0.01, matchWinProbHome)) * 100) / 100));
  const fairOddsAway = Math.min(100, Math.max(1.01, Math.round((1 / Math.max(0.01, matchWinProbAway)) * 100) / 100));

  return {
    matchWinProbHome: Math.round(matchWinProbHome * 1000) / 1000,
    matchWinProbAway: Math.round(matchWinProbAway * 1000) / 1000,
    fairOddsHome,
    fairOddsAway,
    setWinProbHome: Math.round(sA * 1000) / 1000,
    setWinProbAway: Math.round(sB * 1000) / 1000,
    expectedTotalGames: totalExpectedGames,
    isBestOfFive,
    setScores: {
      twoZeroHome: Math.round(pTwoZero * 1000) / 1000,
      twoOneHome: Math.round(pTwoOne * 1000) / 1000,
      zeroTwoAway: Math.round(pZeroTwo * 1000) / 1000,
      oneTwoAway: Math.round(pOneTwo * 1000) / 1000,
      threeZeroHome: Math.round(pThreeZero * 1000) / 1000,
      threeOneHome: Math.round(pThreeOne * 1000) / 1000,
      threeTwoHome: Math.round(pThreeTwo * 1000) / 1000,
      zeroThreeAway: Math.round(pZeroThree * 1000) / 1000,
      oneThreeAway: Math.round(pOneThree * 1000) / 1000,
      twoThreeAway: Math.round(pTwoThree * 1000) / 1000,
    },
    pointParams: {
      pA,
      pB,
      pA_return: Math.round((1 - pB) * 1000) / 1000,
      pB_return: Math.round((1 - pA) * 1000) / 1000,
      holdProbA: Math.round(calculateMarkovGameProb(pA) * 1000) / 1000,
      holdProbB: Math.round(calculateMarkovGameProb(pB) * 1000) / 1000,
    },
  };
};
