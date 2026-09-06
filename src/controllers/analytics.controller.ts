import { Request, Response } from 'express';
import { PrecomputationService } from '../services/precomputation.service';
import { Logger } from '../utils/logger';

export const AnalyticsController = {
  /**
   * Retrieves precalculated analytics for a specific match fixture in <1ms.
   * If not found, attempts on-demand computation and persistence.
   */
  getMatchAnalytics: async (req: Request, res: Response) => {
    try {
      const fixtureId = parseInt(String(req.params.fixtureId), 10);
      if (isNaN(fixtureId)) {
        return res.status(400).json({ error: 'Invalid fixtureId parameter' });
      }

      // 1. Try instant SQLite read (0.1ms)
      let data = PrecomputationService.getAnalyticsByFixtureId(fixtureId);

      // 2. If missing, attempt on-demand computation
      if (!data) {
        data = await PrecomputationService.computeAndStoreMatch({
          id: fixtureId,
          tournamentName: req.query.tournamentName as string || 'ATP Tour',
          player1: req.query.player1 as string || 'Player 1',
          player2: req.query.player2 as string || 'Player 2',
          surface: req.query.surface as string || 'hard',
        });
      }

      if (!data) {
        return res.status(404).json({ error: 'Match analytics not found or could not be computed' });
      }

      res.json(data);
    } catch (err: any) {
      Logger.error(`getMatchAnalytics error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  },

  /**
   * Trigger lookahead precomputation for upcoming matches.
   */
  triggerPrecomputation: async (req: Request, res: Response) => {
    try {
      const days = parseInt(String(req.query.days || req.body?.days || '7'), 10);
      // Run in background so request doesn't timeout
      PrecomputationService.runLookaheadPrecomputation(days).catch(err => {
        Logger.error(`Background precomputation error: ${err.message}`);
      });

      res.json({
        success: true,
        message: `Lookahead precomputation initiated for next ${days} days in background.`,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  /**
   * Retries all failed match computations.
   */
  retryFailed: async (req: Request, res: Response) => {
    try {
      const recovered = await PrecomputationService.retryFailedMatches();
      res.json({ success: true, recoveredCount: recovered });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
};
