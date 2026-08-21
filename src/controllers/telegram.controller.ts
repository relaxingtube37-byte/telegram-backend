import { Request, Response } from 'express';
import { UsersRepo } from '../db/repositories/users.repo';
import { SettingsRepo } from '../db/repositories/settings.repo';

export const TelegramController = {
  getUserStatus: async (req: Request, res: Response) => {
    try {
      const telegramId = parseInt(String(req.params.telegramId), 10);
      if (isNaN(telegramId)) return res.status(400).json({ error: 'Invalid telegramId' });

      UsersRepo.touchActivity(telegramId);
      const user = UsersRepo.getByTelegramId(telegramId);
      const accessMode = SettingsRepo.get('access_mode') || 'FREE';

      res.json({
        telegramId,
        isVerified: accessMode === 'FREE' ? true : !!(user && user.is_verified),
        user: user || null,
        accessMode,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
};
