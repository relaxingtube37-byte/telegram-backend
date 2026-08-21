import { Request, Response } from 'express';
import { PredictionsService } from '../services/predictions.service';
import { StatsService } from '../services/stats.service';

export const WebController = {
  getLandingData: async (req: Request, res: Response) => {
    try {
      const active = PredictionsService.getActive();
      const stats = StatsService.getSummary();
      res.json({
        platform: 'State Football Tennis Web',
        stats,
        featuredMatches: active.slice(0, 5),
        availableTournaments: Array.from(new Set(active.map(p => p.tournament_name).filter(Boolean))),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
};
