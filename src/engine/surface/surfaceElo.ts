export const calculateSurfaceEloRating = (
  baseRank = 100,
  surfaceWinRate = 50,
  surfaceMatches = 0
): number => {
  // Base Elo approximation from ATP/WTA ranking:
  // Rank 1 ≈ 2500, Rank 10 ≈ 2200, Rank 50 ≈ 1900, Rank 100 ≈ 1700, Rank 200 ≈ 1500
  const baseElo = Math.max(1200, Math.round(2500 - Math.log(Math.max(1, baseRank)) * 175));

  if (surfaceMatches === 0) return baseElo;

  // Surface adjustment based on deviation from 50% win rate and sample confidence
  const sampleConfidence = Math.min(1.0, surfaceMatches / 15);
  const eloDelta = (surfaceWinRate - 50) * 5.0 * sampleConfidence;

  return Math.round(baseElo + eloDelta);
};
