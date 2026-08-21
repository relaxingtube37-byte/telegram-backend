import { Request, Response } from 'express';
import { PredictionsService } from '../services/predictions.service';
import { StatsService } from '../services/stats.service';
import { PlayersService } from '../services/players.service';
import { SettingsRepo } from '../db/repositories/settings.repo';

export const WebController = {
  getLandingData: async (req: Request, res: Response) => {
    try {
      const active = PredictionsService.getActive();
      const stats = StatsService.getSummary();
      const featuredPlayers = PlayersService.getFeatured();
      const rawWebConfig = SettingsRepo.get('website_config');
      const websiteConfig = rawWebConfig ? JSON.parse(rawWebConfig) : {};

      res.json({
        platform: 'State Football Tennis Web',
        stats,
        websiteConfig,
        featuredMatches: active.slice(0, 6),
        featuredPlayers: featuredPlayers.slice(0, 8),
        availableTournaments: Array.from(new Set(active.map(p => p.tournament_name).filter(Boolean))),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getPlayers: async (req: Request, res: Response) => {
    try {
      const limit = parseInt(String(req.query.limit || '100'), 10);
      const gender = req.query.gender as string;
      let players = PlayersService.getPublished(limit);

      if (gender && (gender.toUpperCase() === 'M' || gender.toUpperCase() === 'F')) {
        players = players.filter(p => p.gender === gender.toUpperCase());
      }

      res.json(players);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getPlayerDetails: async (req: Request, res: Response) => {
    try {
      const slugOrId = String(req.params.slugOrId);
      const player = PlayersService.getBySlugOrId(slugOrId);

      if (!player) {
        return res.status(404).json({ error: 'Player profile not found on website' });
      }

      res.json(player);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  
  getPlayerImage: async (req: Request, res: Response) => {
    try {
      const playerId = String(req.params.playerId);
      const rapidKey = process.env.RAPIDAPI_KEY || '3b98e0a4e3mshfb887513c847f6bp1602e4jsnaa6342ccddfa';
      const fetchRes = await fetch(`https://tennisapi1.p.rapidapi.com/api/tennis/player/${playerId}/image`, {
        headers: {
          'x-rapidapi-key': rapidKey,
          'x-rapidapi-host': 'tennisapi1.p.rapidapi.com',
        },
      });

      if (!fetchRes.ok) {
        return res.status(fetchRes.status).send('Image unavailable');
      }

      const buffer = Buffer.from(await fetchRes.arrayBuffer());
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=604800');
      res.send(buffer);
    } catch (err: any) {
      res.status(500).send('Failed to fetch player image');
    }
  },

  getConfig: async (req: Request, res: Response) => {
    try {
      const rawConfig = SettingsRepo.get('website_config');
      const config = rawConfig ? JSON.parse(rawConfig) : {};
      res.json(config);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
};
