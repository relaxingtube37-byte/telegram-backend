import type { PlayerYearSurfaceStats } from '../types';

export const CPI_BASELINE = 42;

export interface PlayerSurfaceAIFeatures {
  surface: string;
  cpiIndex: number;
  matches: number;
  wins: number;
  losses: number;
  winRatePct: number;
  sdi: number;
  surfaceCompatibilityScore: number;
  firstServeInPct?: number;
  firstServeWonPct?: number;
  secondServeWonPct?: number;
  doubleFaultRate?: number;
  breakPointsSavedPct?: number;
  breakPointsConvertedPct?: number;
  holdRatePct?: number;
  breakRatePct?: number;
}

export type CanonicalSurfaceKey = 'hard' | 'clay' | 'grass' | 'indoor';

export const normalizeSurfaceKey = (groundType?: string | null): CanonicalSurfaceKey => {
  const s = (groundType || '').toLowerCase();
  if (s.includes('clay')) return 'clay';
  if (s.includes('grass')) return 'grass';
  if (s.includes('indoor')) return 'indoor';
  return 'hard';
};

export const getSurfaceCPI = (surface: string): { cpi: number; cpiNorm: number; gammaServe: number; gammaRally: number } => {
  const s = surface.toLowerCase();
  if (s.includes('clay')) return { cpi: 28, cpiNorm: 0.65, gammaServe: 0.8, gammaRally: 1.3 };
  if (s.includes('grass')) return { cpi: 42, cpiNorm: 1.05, gammaServe: 1.25, gammaRally: 0.85 };
  if (s.includes('indoor')) return { cpi: 40, cpiNorm: 0.98, gammaServe: 1.15, gammaRally: 0.90 };
  return { cpi: 37, cpiNorm: 1.00, gammaServe: 1.0, gammaRally: 1.0 };
};

export const calculateSurfaceKpis = (
  stat: PlayerYearSurfaceStats | null | undefined,
  surface: string
): PlayerSurfaceAIFeatures => {
  const { cpi } = getSurfaceCPI(surface);
  if (!stat || stat.matches === 0) {
    return {
      surface,
      cpiIndex: cpi,
      matches: 0,
      wins: 0,
      losses: 0,
      winRatePct: 50,
      sdi: 50,
      surfaceCompatibilityScore: 65,
      firstServeInPct: 62,
      firstServeWonPct: 70,
      secondServeWonPct: 50,
      doubleFaultRate: 3.5,
      breakPointsSavedPct: 60,
      breakPointsConvertedPct: 38,
      holdRatePct: 78,
      breakRatePct: 22,
    };
  }

  const matches = Math.max(1, stat.matches);
  const wins = stat.wins || 0;
  const losses = stat.losses || (matches - wins);
  const winRate = Math.round((wins / matches) * 100);

  const firstTotal = stat.firstServeTotal || 0;
  const firstWon = stat.firstServePointsScored || 0;
  const secondTotal = stat.secondServeTotal || 0;
  const secondWon = stat.secondServePointsScored || 0;
  const svGms = stat.serviceGamesTotal || 0;
  const svGmsWon = stat.serviceGamesWon || 0;
  const retGms = stat.returnGamesTotal || 0;
  const retGmsWon = stat.returnGamesWon || 0;
  const dfTotal = stat.doubleFaultsTotal || 0;
  const bpSaved = stat.breakPointsSaved || 0;
  const bpFaced = stat.breakPointsFaced || 0;
  const bpConv = stat.breakPointsConverted || 0;
  const bpTot = stat.breakPointsTotal || 0;

  const totalSvPts = firstTotal + secondTotal;
  const firstServeInPct = totalSvPts > 0 ? Math.min(85, Math.max(45, Math.round((firstTotal / totalSvPts) * 100))) : 62;
  const firstServeWonPct = firstTotal > 0 ? Math.min(92, Math.max(45, Math.round((firstWon / firstTotal) * 100))) : 71;
  const secondServeWonPct = secondTotal > 0 ? Math.min(75, Math.max(30, Math.round((secondWon / secondTotal) * 100))) : 51;
  const doubleFaultRate = matches > 0 && dfTotal > 0 ? Math.round((dfTotal / matches) * 10) / 10 : 3.2;
  const breakPointsSavedPct = bpFaced > 0 ? Math.round((bpSaved / bpFaced) * 100) : 60;
  const breakPointsConvertedPct = bpTot > 0 ? Math.round((bpConv / bpTot) * 100) : 40;

  const holdRatePct = svGms > 0 ? Math.min(98, Math.max(45, Math.round((svGmsWon / svGms) * 100))) : Math.min(95, Math.max(55, Math.round(firstServeWonPct * 1.1)));
  const breakRatePct = retGms > 0 ? Math.min(60, Math.max(5, Math.round((retGmsWon / retGms) * 100))) : Math.min(45, Math.max(10, Math.round(breakPointsConvertedPct * 0.6)));

  const compatibility = Math.min(98, Math.max(35, Math.round(50 + (winRate - 50) * 0.75 + (firstServeWonPct - 70) * 0.35)));

  return {
    surface,
    cpiIndex: cpi,
    matches,
    wins,
    losses,
    winRatePct: winRate,
    sdi: Math.round(50 + (winRate - 50) * 0.8),
    surfaceCompatibilityScore: compatibility,
    firstServeInPct,
    firstServeWonPct,
    secondServeWonPct,
    doubleFaultRate,
    breakPointsSavedPct,
    breakPointsConvertedPct,
    holdRatePct,
    breakRatePct,
  };
};
