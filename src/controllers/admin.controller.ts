import { Request, Response } from 'express';
import { PredictionsService } from '../services/predictions.service';
import { PredictionsRepo } from '../db/repositories/predictions.repo';
import { UsersRepo } from '../db/repositories/users.repo';
import { ReferralsRepo } from '../db/repositories/referrals.repo';
import { SettingsRepo } from '../db/repositories/settings.repo';
import { ChannelPosterService } from '../services/channel-poster.service';
import { StatsService } from '../services/stats.service';
import { PlayersService } from '../services/players.service';
import type { Prediction, MatchStatus } from '../types';

export const AdminController = {

  getWebPlayers: async (req: Request, res: Response) => {
    try {
      const players = PlayersService.getAll(200);
      res.json(players);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  publishPlayer: async (req: Request, res: Response) => {
    try {
      const player = req.body;
      if (!player.player_id || !player.full_name) {
        return res.status(400).json({ error: 'Missing required player fields (player_id, full_name)' });
      }

      const id = PlayersService.publishPlayer(player);
      res.json({ success: true, id, player_id: player.player_id, slug: player.slug });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  deletePlayer: async (req: Request, res: Response) => {
    try {
      const playerId = parseInt(String(req.params.playerId), 10);
      const success = PlayersService.deletePlayer(playerId);
      res.json({ success, playerId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  toggleFeaturedPlayer: async (req: Request, res: Response) => {
    try {
      const { playerId, featured } = req.body;
      const success = PlayersService.toggleFeatured(Number(playerId), featured === true);
      res.json({ success, playerId, featured });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  saveWebsiteConfig: async (req: Request, res: Response) => {
    try {
      const config = req.body;
      SettingsRepo.set('website_config', JSON.stringify(config));
      res.json({ success: true, config });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getOverview: async (req: Request, res: Response) => {
    try {
      const predictions = PredictionsService.getAll(200);
      const users = UsersRepo.getAll(200);
      const referralSites = ReferralsRepo.getAll();
      const settings = SettingsRepo.getAll();
      const stats = StatsService.getSummary();

      res.json({
        stats,
        predictions,
        users,
        referralSites,
        settings,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getPredictions: async (req: Request, res: Response) => {
    try {
      const limit = parseInt(String(req.query.limit || '200'), 10);
      res.json(PredictionsService.getAll(limit));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  publishPrediction: async (req: Request, res: Response) => {
    try {
      const {
        fixture_id, tournament_name, round_name, surface, match_date,
        home_name, away_name, home_odds, away_odds,
        predicted_winner, win_probability, confidence, predicted_score,
        best_bet_selection, best_bet_market, best_bet_ev, best_bet_rationale,
        alt_bet_selection, alt_bet_market, key_factors, devils_advocate_risk,
        ai_summary, home_image, away_image, home_id, away_id,
        post_to_channel, is_teaser, status, published_at, created_at
      } = req.body;

      if (!home_name || !away_name || !predicted_winner) {
        return res.status(400).json({ error: 'Missing required match fields (home_name, away_name, predicted_winner)' });
      }

      const prediction: Prediction = {
        fixture_id, tournament_name, round_name, surface, match_date,
        home_name, away_name, home_odds, away_odds,
        predicted_winner, win_probability: win_probability || 65, confidence: confidence || 'HIGH',
        predicted_score, best_bet_selection, best_bet_market, best_bet_ev, best_bet_rationale,
        alt_bet_selection, alt_bet_market, key_factors, devils_advocate_risk,
        ai_summary, home_image, away_image, home_id, away_id,
        status: (status as MatchStatus) || 'UPCOMING',
        published_at: published_at || new Date().toISOString(),
        created_at: created_at || new Date().toISOString(),
      };

      const predictionId = PredictionsService.publish(prediction);
      prediction.id = predictionId;

      let channelMsgId: number | null = null;
      let postedToChannel = false;

      if (post_to_channel !== false) {
        const isTeaserMode = is_teaser === true;
        channelMsgId = await ChannelPosterService.publishPrediction(prediction, isTeaserMode);
        if (channelMsgId) {
          postedToChannel = true;
          PredictionsRepo.updateChannelMessageId(predictionId, channelMsgId);
        }
      }

      res.json({
        success: true,
        predictionId,
        postedToChannel,
        channelMessageId: channelMsgId,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  updateResult: async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const { status, result_score } = req.body;

      if (!status) return res.status(400).json({ error: 'Status is required' });

      const updated = PredictionsService.updateResult(id, status, result_score);
      if (!updated) return res.status(404).json({ error: 'Prediction not found' });

      const prediction = PredictionsRepo.getById(id);
      if (prediction && prediction.channel_message_id && (status === 'WON' || status === 'LOST' || status === 'VOID')) {
        await ChannelPosterService.updateResult(prediction.channel_message_id, status, result_score);
      }

      res.json({ success: true, predictionId: id, status, result_score });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  syncFixtureResults: async (req: Request, res: Response) => {
    try {
      const { results } = req.body;
      if (!Array.isArray(results)) return res.status(400).json({ error: 'Results array is required' });

      let updatedCount = 0;
      for (const item of results) {
        if (item.fixture_id && item.status) {
          const success = PredictionsService.updateResultByFixtureId(item.fixture_id, item.status, item.result_score);
          if (success) updatedCount++;
        }
      }

      res.json({ success: true, updatedCount });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  publishBatchSummary: async (req: Request, res: Response) => {
    try {
      const { prediction_ids, batch_title } = req.body;
      let targetPredictions: any[] = [];

      if (Array.isArray(prediction_ids) && prediction_ids.length > 0) {
        targetPredictions = prediction_ids.map((id: number) => PredictionsRepo.getById(id)).filter(Boolean);
      } else {
        targetPredictions = PredictionsRepo.getAll(15);
      }

      const messageId = await ChannelPosterService.publishBatchSummary(targetPredictions, batch_title);
      res.json({ success: true, messageId, count: targetPredictions.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getUsers: async (req: Request, res: Response) => {
    try {
      res.json(UsersRepo.getAll());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  toggleUserVerify: async (req: Request, res: Response) => {
    try {
      const { telegram_id, verified } = req.body;
      if (!telegram_id) return res.status(400).json({ error: 'telegram_id is required' });
      UsersRepo.setManualVerified(Number(telegram_id), verified !== false);
      res.json({ success: true, telegram_id, is_verified: verified ? 1 : 0 });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getSites: async (req: Request, res: Response) => {
    try {
      res.json(ReferralsRepo.getAll());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  saveSite: async (req: Request, res: Response) => {
    try {
      const site = req.body;
      if (site.id) {
        ReferralsRepo.update(site.id, site);
        res.json({ success: true, id: site.id });
      } else {
        const id = ReferralsRepo.create(site);
        res.json({ success: true, id });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  deleteSite: async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      ReferralsRepo.delete(id);
      res.json({ success: true, id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getSettings: async (req: Request, res: Response) => {
    try {
      res.json(SettingsRepo.getAll());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  saveSetting: async (req: Request, res: Response) => {
    try {
      const { key, value } = req.body;
      if (!key) return res.status(400).json({ error: 'key is required' });
      SettingsRepo.set(key, String(value));
      res.json({ success: true, key, value });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  exportBackup: async (req: Request, res: Response) => {
    try {
      const predictions = PredictionsRepo.getAll(1000);
      const users = UsersRepo.getAll(1000);
      const referralSites = ReferralsRepo.getAll();
      const settings = SettingsRepo.getAll();
      res.json({
        exportedAt: new Date().toISOString(),
        predictions,
        users,
        referralSites,
        settings,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
};
