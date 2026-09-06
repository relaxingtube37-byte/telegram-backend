export interface PointsDefenseMetrics {
  pointsDefending: number;
  projectedRankDrop: number;
  defensePressureTier: 'CRITICAL_DEFENSE' | 'MODERATE_PRESSURE' | 'LOW_DEFENSE';
  summary: string;
}

export const calculateRankingPointsDefense = (
  ranking = 50,
  roundName = 'R32',
  tournamentTier = 'ATP 500'
): PointsDefenseMetrics => {
  let pointsDefending = 0;
  if (tournamentTier.includes('Grand Slam')) pointsDefending = 180;
  else if (tournamentTier.includes('1000')) pointsDefending = 90;
  else if (tournamentTier.includes('500')) pointsDefending = 45;
  else pointsDefending = 20;

  let projectedDrop = 0;
  if (ranking <= 20) projectedDrop = Math.min(6, Math.round(pointsDefending / 40));
  else if (ranking <= 60) projectedDrop = Math.min(12, Math.round(pointsDefending / 25));
  else projectedDrop = Math.min(25, Math.round(pointsDefending / 15));

  const tier = projectedDrop >= 8 ? 'CRITICAL_DEFENSE' : projectedDrop >= 3 ? 'MODERATE_PRESSURE' : 'LOW_DEFENSE';
  const summary = tier === 'CRITICAL_DEFENSE'
    ? `High pressure: Defending ${pointsDefending} pts (risk of dropping ~${projectedDrop} spots)`
    : `Defending ${pointsDefending} pts (~${projectedDrop} ranking spots buffer)`;

  return {
    pointsDefending,
    projectedRankDrop: projectedDrop,
    defensePressureTier: tier,
    summary,
  };
};
