import { Request, Response } from 'express';
import { PredictionsService } from '../services/predictions.service';
import { PredictionsRepo } from '../db/repositories/predictions.repo';
import { UsersRepo } from '../db/repositories/users.repo';
import { ReferralsRepo } from '../db/repositories/referrals.repo';
import { SettingsRepo } from '../db/repositories/settings.repo';
import { ChannelPosterService } from '../services/channel-poster.service';
import { StatsService } from '../services/stats.service';
import { PlayersService } from '../services/players.service';
import { BackupService } from '../services/backup.service';
import { ResultSettlerService } from '../services/result-settler.service';
import { NeonSyncService } from '../services/neon-sync.service';
import { autoEnrichPredictionMultilingual } from '../services/multilingualEnricher.service';
import { Logger } from '../utils/logger';
import { bot } from '../services/telegram-bot.service';
import { ENV } from '../config/env';
import type { Prediction, MatchStatus } from '../types';
import {
  loadAccessPolicy,
  saveAccessMode,
  saveAccessPolicyLayers,
  type AccessPolicyLayers,
} from '../access-policy';
import {
  loadBusinessActionSettings,
  saveBusinessActionSettings,
  type BusinessActionSettings,
} from '../business-actions';

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

  publishWebPlayersBulk: async (req: Request, res: Response) => {
    try {
      const players = Array.isArray(req.body) ? req.body : req.body.players;
      if (!Array.isArray(players) || players.length === 0) {
        return res.status(400).json({ error: 'players array is required' });
      }

      const count = PlayersService.publishPlayersBulk(players);
      res.json({ success: true, count });
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

      // Keep access_policy layers synchronized if provided in website_config
      if (config && typeof config === 'object') {
        const layerUpdates: Partial<AccessPolicyLayers> = {};
        if (typeof config.guest_can_see_summary === 'boolean') {
          layerUpdates.guest_can_see_summary = config.guest_can_see_summary;
        }
        if (typeof config.guest_can_see_ai_full === 'boolean') {
          layerUpdates.guest_can_see_ai_full = config.guest_can_see_ai_full;
        }
        if (config.guest_stats_level) {
          layerUpdates.guest_stats_level = config.guest_stats_level;
        } else if (typeof config.guest_can_see_stats === 'boolean') {
          layerUpdates.guest_stats_level = config.guest_can_see_stats ? 'partial' : 'none';
        }
        if (Object.keys(layerUpdates).length > 0) {
          saveAccessPolicyLayers(layerUpdates);
        }
      }

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
        home_name, away_name, gender, tour_category, home_odds, away_odds,
        predicted_winner, win_probability, confidence, predicted_score,
        best_bet_selection, best_bet_market, best_bet_ev, best_bet_rationale,
        alt_bet_selection, alt_bet_market, alt_bet_rationale, key_factors, devils_advocate_risk,
        ai_summary, home_image, away_image, home_id, away_id,
        post_to_channel, postToChannel, is_teaser, isTeaser, status, published_at, created_at
      } = req.body;

      if (!home_name || !away_name || !predicted_winner) {
        return res.status(400).json({ error: 'Missing required match fields (home_name, away_name, predicted_winner)' });
      }

      let effectiveGender: 'men' | 'women' = (gender === 'men' || gender === 'women') ? gender : 'men';
      let effectiveTourCategory: string = tour_category || '';

      if (!gender) {
        const text = `${tournament_name || ''} ${round_name || ''} ${home_name || ''} ${away_name || ''}`.toLowerCase();
        const isWomen =
          text.includes('wta') ||
          text.includes('women') ||
          text.includes('ladies') ||
          text.includes('bjk') ||
          text.includes('billie jean king') ||
          text.includes('girls') ||
          text.includes('guadalajara') ||
          text.includes('sao paulo') ||
          text.includes('monastir') ||
          text.includes('caldas da rainha') ||
          /\bw(15|25|35|50|75|100)\b/.test(text);

        effectiveGender = isWomen ? 'women' : 'men';
        if (!effectiveTourCategory) {
          effectiveTourCategory = isWomen
            ? (text.includes('125') ? 'WTA125' : 'WTA')
            : (text.includes('challenger') ? 'CHALLENGER' : 'ATP');
        }
      }

      const prediction: Prediction = {
        fixture_id, tournament_name, round_name, surface, match_date,
        home_name, away_name, gender: effectiveGender, tour_category: effectiveTourCategory,
        home_odds, away_odds,
        predicted_winner, win_probability: win_probability || 65, confidence: confidence || 'HIGH',
        predicted_score, best_bet_selection, best_bet_market, best_bet_ev, best_bet_rationale,
        alt_bet_selection, alt_bet_market, alt_bet_rationale, key_factors, devils_advocate_risk,
        ai_summary, home_image, away_image, home_id, away_id,
        status: (status as MatchStatus) || 'UPCOMING',
        published_at: published_at || new Date().toISOString(),
        created_at: created_at || new Date().toISOString(),
      };

      await autoEnrichPredictionMultilingual(prediction);

      const predictionId = PredictionsService.publish(prediction);
      prediction.id = predictionId;

      let channelMsgId: number | null = null;
      let postedToChannel = false;

      // Robust check for whether to post this individual prediction to the Telegram channel
      const postFlag = post_to_channel !== undefined ? post_to_channel : postToChannel;
      const shouldPost = postFlag !== false && postFlag !== 'false' && postFlag !== 0;

      if (shouldPost) {
        const isTeaserMode = is_teaser === true || isTeaser === true;
        channelMsgId = await ChannelPosterService.publishPrediction(prediction, isTeaserMode);
        if (channelMsgId) {
          postedToChannel = true;
          PredictionsRepo.updateChannelMessageId(predictionId, channelMsgId);
        }
      }

      // Persist authentic pro intelligence only if supplied (NEVER synthesize fake baseline data)
      const incomingProIntel = req.body.pro_intelligence || req.body.proIntelligence;
      const targetFixtureId = prediction.fixture_id || predictionId;
      const isAuthentic = incomingProIntel && 
        incomingProIntel.version !== 'baseline-fallback' && 
        !incomingProIntel.isFallback &&
        (incomingProIntel.player_one?.radar_axes || incomingProIntel.player1?.radar_axes);

      if (targetFixtureId && isAuthentic) {
        try {
          const isWta = prediction.gender === 'women' ||
            (prediction.tournament_name || '').toUpperCase().includes('WTA') ||
            (prediction.tour_category || '').toUpperCase().includes('WTA') ||
            incomingProIntel.tour === 'WTA';

          await NeonSyncService.saveProIntelligence(
            targetFixtureId,
            prediction.home_name || 'Player 1',
            prediction.away_name || 'Player 2',
            isWta ? 'WTA' : 'ATP',
            prediction.surface || 'Hard',
            incomingProIntel
          );
        } catch (e: any) {
          Logger.warn?.(`[AdminController] Could not auto-save pro intelligence for fixture #${targetFixtureId}: ${e.message}`);
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
      const normStatus = String(status).toUpperCase().trim();
      if (prediction && ['WON', 'LOST', 'VOID', 'INTERRUPTED'].includes(normStatus)) {
        await ChannelPosterService.announceResultIfNeeded(prediction, normStatus, result_score);
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
          if (success) {
            updatedCount++;
            const pred = PredictionsRepo.getByFixtureId(item.fixture_id);
            const normStatus = String(item.status).toUpperCase().trim();
            if (pred && ['WON', 'LOST', 'VOID', 'INTERRUPTED'].includes(normStatus)) {
              ChannelPosterService.announceResultIfNeeded(pred, normStatus, item.result_score).catch(() => {});
            }
          }
        }
      }

      res.json({ success: true, updatedCount });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  batchUpdateResults: async (req: Request, res: Response) => {
    try {
      const { items, postBatchSummary, batchTitle } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'items array is required' });
      }

      let count = 0;
      const targetPredictions: any[] = [];

      for (const item of items) {
        if (!item.id || !item.status) continue;
        const updated = PredictionsService.updateResult(item.id, item.status, item.result_score);
        if (updated) {
          count++;
          const pred = PredictionsRepo.getById(item.id);
          if (pred) {
            targetPredictions.push(pred);
            const normStatus = String(item.status).toUpperCase().trim();
            if (['WON', 'LOST', 'VOID', 'INTERRUPTED'].includes(normStatus)) {
              ChannelPosterService.announceResultIfNeeded(pred, normStatus, item.result_score).catch(err => {
                Logger.warn(`[BatchResult] Failed to announce #${item.id}: ${err.message}`);
              });
            }
          }
        }
      }

      let summaryMessageId: number | null = null;
      if (postBatchSummary !== false && targetPredictions.length > 0) {
        try {
          summaryMessageId = await ChannelPosterService.publishBatchSummary(targetPredictions, batchTitle);
        } catch (e: any) {
          Logger.warn(`[BatchResult] Failed to publish batch summary: ${e.message}`);
        }
      }

      res.json({ success: true, count, summaryMessageId });
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

  publishBatchAnnouncement: async (req: Request, res: Response) => {
    try {
      const { count, matches, title, channelTitle, headerText, footerText, includePicks, mode } = req.body;
      const numCount = Number(count) || (Array.isArray(matches) ? matches.length : 0);
      const messageId = await ChannelPosterService.publishBatchCountAnnouncement({
        count: numCount,
        matches: Array.isArray(matches) ? matches : [],
        title,
        channelTitle,
        headerText,
        footerText,
        includePicks,
        mode,
      });

      // If announcement posted successfully, link this messageId to the batch's predictions
      if (messageId && Array.isArray(matches) && matches.length > 0) {
        for (const m of matches) {
          const h = m.home || m.home_name;
          const a = m.away || m.away_name;
          if (h && a) {
            const pred = PredictionsRepo.findActiveByTeams(h, a);
            if (pred && pred.id && !pred.channel_message_id) {
              PredictionsRepo.updateChannelMessageId(pred.id, messageId);
            }
          }
        }
      }

      res.json({ success: !!messageId, messageId, count: numCount });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  deletePrediction: async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

      // Look up prediction first to capture fixture_id for Neon PostgreSQL sync
      let pred = PredictionsRepo.getById(id);
      if (!pred) {
        pred = PredictionsRepo.getByFixtureId(id);
      }
      const fixtureId = pred?.fixture_id ? Number(pred.fixture_id) : null;
      const targetId = pred?.id ? Number(pred.id) : id;

      const success = PredictionsRepo.delete(targetId);

      // Permanently remove from Neon cloud database if fixture_id is known
      let neonDeleted = false;
      if (fixtureId) {
        neonDeleted = await NeonSyncService.deletePrediction(fixtureId);
      }

      res.json({ success, id: targetId, fixture_id: fixtureId, neon_deleted: neonDeleted });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  patchPrediction: async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
      const { tournament_name, round_name, surface, match_date } = req.body;
      const fields: Record<string, string | undefined> = {};
      if (tournament_name !== undefined) fields.tournament_name = String(tournament_name);
      if (round_name !== undefined) fields.round_name = String(round_name);
      if (surface !== undefined) fields.surface = String(surface);
      if (match_date !== undefined) fields.match_date = String(match_date);
      const success = PredictionsRepo.patch(id, fields as any);
      const updated = PredictionsRepo.getById(id);
      res.json({ success, id, prediction: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  batchDeletePredictions: async (req: Request, res: Response) => {
    try {
      const { ids } = req.body;
      let count = 0;
      const fixtureIds: number[] = [];
      if (Array.isArray(ids)) {
        for (const rawId of ids) {
          const numId = Number(rawId);
          if (isNaN(numId)) continue;
          let pred = PredictionsRepo.getById(numId);
          if (!pred) {
            pred = PredictionsRepo.getByFixtureId(numId);
          }
          if (pred?.fixture_id) {
            fixtureIds.push(Number(pred.fixture_id));
          }
          const targetId = pred?.id ? Number(pred.id) : numId;
          if (PredictionsRepo.delete(targetId)) count++;
        }
        if (fixtureIds.length > 0) {
          await NeonSyncService.batchDeletePredictions(fixtureIds);
        }
      }
      res.json({ success: true, count, neon_deleted: fixtureIds.length });
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

  getChannelStats: async (req: Request, res: Response) => {
    try {
      let subscriberCount: number | null = null;
      if (bot && ENV.CHANNEL_ID) {
        try {
          subscriberCount = await bot.api.getChatMemberCount(ENV.CHANNEL_ID);
        } catch (e: any) {
          Logger.warn(`Could not getChatMemberCount for ${ENV.CHANNEL_ID}: ${e.message}`);
        }
      }
      res.json({
        channelId: ENV.CHANNEL_ID || null,
        subscriberCount,
      });
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
      const all = SettingsRepo.getAll();
      const policy = loadAccessPolicy();
      const business = loadBusinessActionSettings();
      res.json({
        ...all,
        access_mode: policy.access_mode,
        access_policy: JSON.stringify(policy.layers),
        access_policy_layers: policy.layers,
        business_action_settings: business,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  saveSetting: async (req: Request, res: Response) => {
    try {
      const { key, value } = req.body;
      if (!key) return res.status(400).json({ error: 'key is required' });

      if (key === 'access_mode') {
        const mode = saveAccessMode(String(value));
        return res.json({ success: true, key, value: mode, access_mode: mode });
      }

      if (key === 'access_policy') {
        let layers: Partial<AccessPolicyLayers>;
        if (typeof value === 'string') {
          try {
            layers = JSON.parse(value);
          } catch {
            return res.status(400).json({ error: 'access_policy must be valid JSON' });
          }
        } else if (value && typeof value === 'object') {
          layers = value;
        } else {
          return res.status(400).json({ error: 'access_policy value required' });
        }
        const saved = saveAccessPolicyLayers(layers);
        return res.json({
          success: true,
          key,
          value: saved,
          access_policy_layers: saved,
        });
      }

      if (key === 'business_action_settings') {
        let partial: Partial<BusinessActionSettings>;
        if (typeof value === 'string') {
          try {
            partial = JSON.parse(value);
          } catch {
            return res.status(400).json({ error: 'business_action_settings must be valid JSON' });
          }
        } else if (value && typeof value === 'object') {
          partial = value;
        } else {
          return res.status(400).json({ error: 'business_action_settings value required' });
        }
        const saved = saveBusinessActionSettings(partial);
        return res.json({
          success: true,
          key,
          value: saved,
          business_action_settings: saved,
        });
      }

      SettingsRepo.set(key, typeof value === 'string' ? value : JSON.stringify(value));
      res.json({ success: true, key, value });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  exportBackup: async (req: Request, res: Response) => {
    try {
      const fullBackup = BackupService.exportFullJsonBackup();
      res.json(fullBackup);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  exportFullBackup: async (req: Request, res: Response) => {
    try {
      const fullBackup = BackupService.exportFullJsonBackup();
      res.json(fullBackup);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  downloadWalSafeSqlite: async (req: Request, res: Response) => {
    try {
      const result = await BackupService.createWalSafeBackup();
      res.download(result.backupPath, (downloadErr: any) => {
        if (downloadErr) {
          Logger.error('Failed to send binary backup file:', downloadErr.message);
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  importBackup: async (req: Request, res: Response) => {
    try {
      const { backupData, mode } = req.body;
      const targetPayload = backupData || req.body;
      const importMode = mode === 'replace' ? 'replace' : 'merge';

      if (!targetPayload || typeof targetPayload !== 'object') {
        return res.status(400).json({ error: 'Valid JSON backup payload is required' });
      }

      const result = await BackupService.importBackup(targetPayload, importMode);
      res.json({
        message: `Database restored successfully in ${importMode} mode.`,
        ...result,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },

  runResultSettler: async (req: Request, res: Response) => {
    try {
      const result = await ResultSettlerService.settleActivePredictions();
      res.json({
        success: true,
        message: `Settler run completed: ${result.settled} of ${result.checked} active prediction(s) settled.`,
        ...result,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },

  saveProIntelligence: async (req: Request, res: Response) => {
    try {
      const fixtureId = Number(req.params.fixtureId);
      if (!fixtureId) return res.status(400).json({ error: 'Valid fixtureId is required' });
      const { homeName, awayName, tour, surface, payload } = req.body;
      const targetPayload = payload || req.body;
      if (!targetPayload) return res.status(400).json({ error: 'Payload is required' });

      await NeonSyncService.saveProIntelligence(
        fixtureId,
        homeName || targetPayload?.player1?.name || '',
        awayName || targetPayload?.player2?.name || '',
        tour || targetPayload?.meta?.tour || 'ATP',
        surface || targetPayload?.meta?.surface || 'Hard',
        targetPayload
      );

      res.json({ success: true, fixtureId });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },

  getProIntelligence: async (req: Request, res: Response) => {
    try {
      const fixtureId = Number(req.params.fixtureId);
      if (!fixtureId) return res.status(400).json({ error: 'Valid fixtureId is required' });
      const data = await NeonSyncService.getProIntelligence(fixtureId);
      if (!data) return res.status(404).json({ error: 'Pro intelligence not found for fixture' });
      res.json({ success: true, fixtureId, data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
};

