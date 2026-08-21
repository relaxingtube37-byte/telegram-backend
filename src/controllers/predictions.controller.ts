import { Request, Response } from 'express';
import { PredictionsService } from '../services/predictions.service';
import { ReferralsRepo } from '../db/repositories/referrals.repo';
import { SettingsRepo } from '../db/repositories/settings.repo';
import { StatsService } from '../services/stats.service';

export const PredictionsController = {
  getFeed: async (req: Request, res: Response) => {
    try {
      const active = PredictionsService.getActive();
      const history = PredictionsService.getHistory(30);
      const referralSites = ReferralsRepo.getActive();
      const accessMode = SettingsRepo.get('access_mode') || 'FREE';
      const stats = StatsService.getSummary();

      res.json({
        active,
        history,
        referralSites,
        accessMode,
        stats,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getActive: async (req: Request, res: Response) => {
    try {
      const active = PredictionsService.getActive();
      res.json(active);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getHistory: async (req: Request, res: Response) => {
    try {
      const limit = parseInt(String(req.query.limit || '50'), 10);
      const history = PredictionsService.getHistory(limit);
      res.json(history);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getById: async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const prediction = PredictionsService.getById(id);
      if (!prediction) return res.status(404).json({ error: 'Prediction not found' });
      res.json(prediction);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
};
