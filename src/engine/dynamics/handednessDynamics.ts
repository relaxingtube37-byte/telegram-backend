export interface HandednessMetrics {
  player1Hand: 'L' | 'R';
  player2Hand: 'L' | 'R';
  isLeftyVsRighty: boolean;
  leftyAdvantageScore: number;
  advantageSummary: string;
}

export const KNOWN_LEFT_HANDED_NAMES = new Set([
  'rafael nadal', 'ben shelton', 'jack draper', 'ugo humbert', 'cameron norrie',
  'denis shapovalov', 'adrian mannarino',
  'marketa vondrousova', 'petra kvitova', 'angelique kerber', 'leylah fernandez',
  'bernas pacheco', 'albert ramos-vinolas', 'thiago monteiro', 'dominik koepfer'
]);

export const calculateHandednessAdvantage = (
  p1Name: string,
  p2Name: string,
  p1Hand?: 'L' | 'R',
  p2Hand?: 'L' | 'R',
  surface = 'hard'
): HandednessMetrics => {
  const n1 = p1Name.toLowerCase();
  const n2 = p2Name.toLowerCase();

  const h1 = p1Hand || (KNOWN_LEFT_HANDED_NAMES.has(n1) ? 'L' : 'R');
  const h2 = p2Hand || (KNOWN_LEFT_HANDED_NAMES.has(n2) ? 'L' : 'R');

  const isL1 = h1 === 'L';
  const isL2 = h2 === 'L';
  const isLvR = (isL1 && !isL2) || (!isL1 && isL2);

  let advScore = 0;
  let summary = 'Standard Righty vs Righty matchup';

  if (isLvR) {
    const isGrass = surface.toLowerCase().includes('grass');
    const multiplier = isGrass ? 1.4 : 1.0;
    if (isL1) {
      advScore = Math.round(6 * multiplier);
      summary = `Player 1 (${p1Name}) holds Lefty slice/angle advantage against righty (+${advScore}% modeled edge)`;
    } else {
      advScore = Math.round(-6 * multiplier);
      summary = `Player 2 (${p2Name}) holds Lefty slice/angle advantage against righty (${advScore}% modeled edge)`;
    }
  } else if (isL1 && isL2) {
    summary = 'Mirror Left-Handed matchup (neutralizes lefty crosscourt bias)';
  }

  return {
    player1Hand: h1,
    player2Hand: h2,
    isLeftyVsRighty: isLvR,
    leftyAdvantageScore: advScore,
    advantageSummary: summary,
  };
};
