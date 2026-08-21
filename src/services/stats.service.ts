import { PredictionsRepo } from '../db/repositories/predictions.repo';
import type { StatsSummary } from '../types';

export const StatsService = {
  getSummary: (): StatsSummary => {
    const all = PredictionsRepo.getAll(500);
    const wonCount = all.filter(p => p.status === 'WON').length;
    const lostCount = all.filter(p => p.status === 'LOST').length;
    const voidCount = all.filter(p => p.status === 'VOID' || p.status === 'INTERRUPTED').length;
    const activeCount = all.filter(p => p.status === 'UPCOMING' || p.status === 'LIVE').length;
    const settled = wonCount + lostCount;
    const winRatePct = settled > 0 ? Math.round((wonCount / settled) * 100) : 0;

    return {
      totalPredictions: all.length,
      wonCount,
      lostCount,
      voidCount,
      winRatePct,
      activeCount,
    };
  },
};
