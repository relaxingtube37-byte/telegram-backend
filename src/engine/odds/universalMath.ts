export const calculateImpliedProbability = (odds: number): number => {
  if (odds <= 1.0) return 1.0;
  return Math.round((1.0 / odds) * 1000) / 1000;
};

export const calculateExpectedValue = (
  modeledWinProb: number,
  bookmakerOdds: number
): { evPct: number; isValueBet: boolean; edgeTier: 'HIGH' | 'SOLID' | 'SLIGHT' | 'NEGATIVE' } => {
  const ev = (modeledWinProb * bookmakerOdds) - 1.0;
  const evPct = Math.round(ev * 1000) / 10;
  const isValue = evPct > 2.5;

  let edgeTier: 'HIGH' | 'SOLID' | 'SLIGHT' | 'NEGATIVE' = 'NEGATIVE';
  if (evPct >= 8.0) edgeTier = 'HIGH';
  else if (evPct >= 4.5) edgeTier = 'SOLID';
  else if (evPct >= 2.0) edgeTier = 'SLIGHT';

  return {
    evPct,
    isValueBet: isValue,
    edgeTier,
  };
};
