import { Request, Response } from 'express';

export const HealthController = {
  check: (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'State Football Tennis AI Backend (Unified Telegram & Web)',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  },
};
