import { Request, Response } from 'express';
import { BackendDataPoolOrchestrator } from '../dataPool/dataPool.orchestrator';

export const HealthController = {
  check: (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'State Football Tennis AI Backend (Unified Telegram & Web)',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  },

  cronWarmup: async (req: Request, res: Response) => {
    try {
      // Warm up today and live cache in background
      BackendDataPoolOrchestrator.getTodayTournamentGroups().catch(() => {});
      BackendDataPoolOrchestrator.getLiveTournamentGroups().catch(() => {});
      
      res.json({
        status: 'ok',
        cron: 'warmup_triggered',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ status: 'error', error: err?.message || 'Warmup failed' });
    }
  },
};

