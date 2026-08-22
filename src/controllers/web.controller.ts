import { Request, Response } from 'express';
import sharp from 'sharp';
import { PredictionsService } from '../services/predictions.service';
import { StatsService } from '../services/stats.service';
import { PlayersService } from '../services/players.service';
import { SettingsRepo } from '../db/repositories/settings.repo';
import { BackendDataPoolOrchestrator } from '../dataPool/dataPool.orchestrator';
import { BackendDataPoolStore } from '../dataPool/dataPool.store';
import { BackendTennisApi } from '../dataPool/dataPool.tennisApi';
import { ENV } from '../config/env';

export const WebController = {
  getLandingData: async (req: Request, res: Response) => {
    try {
      const active = PredictionsService.getActive();
      const stats = StatsService.getSummary();
      const featuredPlayers = PlayersService.getFeatured();
      const rawWebConfig = SettingsRepo.get('website_config');
      const websiteConfig = rawWebConfig ? JSON.parse(rawWebConfig) : {};

      res.json({
        platform: 'PTIN Sports Analytics',
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

  getLiveTournaments: async (req: Request, res: Response) => {
    try {
      const groups = await BackendDataPoolOrchestrator.getLiveTournamentGroups();
      res.json(groups);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getTodayTournaments: async (req: Request, res: Response) => {
    try {
      const groups = await BackendDataPoolOrchestrator.getTodayTournamentGroups();
      res.json(groups);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getTournamentsByDate: async (req: Request, res: Response) => {
    try {
      const date = String(req.params.date);
      // Validate format YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      }
      const groups = await BackendDataPoolOrchestrator.getDateTournamentGroups(date);
      res.json(groups);
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

  getRankings: async (req: Request, res: Response) => {
    try {
      const tour = String(req.params.tour || 'atp').toLowerCase() as 'atp' | 'wta';
      const key = 'rankings_' + tour;
      const cached = BackendDataPoolStore.get<any>(key);
      if (cached) {
        return res.json(cached);
      }

      const data = await BackendTennisApi.getRankings(tour);
      if (data) {
        BackendDataPoolStore.set(key, data, 12 * 60 * 60 * 1000); // 12h TTL
        return res.json(data);
      }

      res.status(500).json({ error: 'Failed to fetch rankings' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getPlayerImage: async (req: Request, res: Response) => {
    try {
      const playerId = String(req.params.playerId);
      const targetSize = Math.min(Math.max(parseInt(String(req.query.size || req.query.w || '96'), 10) || 96, 32), 512);
      const cacheKey = `player_webp_${playerId}_${targetSize}`;
      
      const cachedBuf = BackendDataPoolStore.get<string>(cacheKey);
      if (cachedBuf) {
        if (cachedBuf === 'NOT_FOUND') {
          return res.status(404).send('Image unavailable');
        }
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
        return res.send(Buffer.from(cachedBuf, 'base64'));
      }

      // Fetch raw image buffer through RateLimiter queue
      const buffer = await BackendTennisApi.getPlayerImage(playerId);
      if (!buffer || buffer.length === 0) {
        BackendDataPoolStore.set(cacheKey, 'NOT_FOUND', 24 * 60 * 60 * 1000); // 24h negative cache
        return res.status(404).send('Image unavailable');
      }

      // Convert & optimize to WebP using sharp
      let optimizedWebP: Buffer;
      try {
        optimizedWebP = await sharp(buffer)
          .resize(targetSize, targetSize, {
            fit: 'cover',
            position: 'top',
            withoutEnlargement: false,
          })
          .webp({ quality: 85, effort: 4 })
          .toBuffer();
      } catch {
        // Fallback to original buffer if sharp encounters unknown image format
        optimizedWebP = buffer;
      }

      BackendDataPoolStore.set(cacheKey, optimizedWebP.toString('base64'), 14 * 24 * 60 * 60 * 1000); // 14 days TTL

      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
      res.send(optimizedWebP);
    } catch (err: any) {
      res.status(404).send('Image unavailable');
    }
  },

  getPoolStats: async (req: Request, res: Response) => {
    try {
      res.json(BackendDataPoolStore.getStats());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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