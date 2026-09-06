import { Request, Response } from 'express';
import { BackendDataPoolOrchestrator } from '../dataPool/dataPool.orchestrator';
import { runDailyPlayerUpdate } from '../services/dailyPlayerUpdate.service';

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

  cronDailyPlayers: async (req: Request, res: Response) => {
    try {
      const maxPlayers = Number(req.query.maxPlayers || 40);
      const maxApiCalls = Number(req.query.maxApiCalls || 120);
      const result = await runDailyPlayerUpdate({ maxPlayers, maxApiCalls });
      res.json({
        status: 'ok',
        cron: 'daily_players',
        timestamp: new Date().toISOString(),
        result,
      });
    } catch (err: any) {
      res.status(500).json({ status: 'error', error: err?.message || 'Daily player update failed' });
    }
  },
};

