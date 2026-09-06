import { Request, Response } from 'express';
import { EditorialsRepo, MatchEditorialRecord } from '../db/repositories/editorials.repo';
import { PredictionsRepo } from '../db/repositories/predictions.repo';
import { PredictionsService } from '../services/predictions.service';
import { ChannelPosterService } from '../services/channel-poster.service';
import { Logger } from '../utils/logger';

export const AnalysisController = {
  /**
   * Ingests dual-mode AI analysis payload from Football State Desktop Engine.
   * Persists both Website Editorial record and Telegram Betting record in SQLite.
   */
  ingestAnalysis: async (req: Request, res: Response) => {
    try {
      const payload = req.body;

      if (!payload || !payload.fixtureId) {
        return res.status(400).json({ error: 'Missing required fixtureId in payload' });
      }

      const fixtureId = Number(payload.fixtureId);
      const results: { editorial?: any; betting?: any; postedToChannel?: boolean } = {};

      // 1. Ingest Mode A: Website Editorial Record
      if (payload.websiteEditorial) {
        const edit = payload.websiteEditorial;
        const slug = edit.slug || `${(edit.headline || 'match').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${fixtureId}`;
        
        const editorialRecord: MatchEditorialRecord = {
          fixture_id: fixtureId,
          slug,
          headline: edit.headline || `${payload.homeName || 'Player 1'} vs ${payload.awayName || 'Player 2'} Match Preview`,
          summary: edit.summary || '',
          tactical_analysis: edit.tacticalAnalysis || '',
          surface_breakdown: edit.surfaceBreakdown || undefined,
          h2h_breakdown: edit.h2hBreakdown || undefined,
          key_stats_json: edit.keyStatsJson ? JSON.stringify(edit.keyStatsJson) : undefined,
          author_name: edit.authorName || 'PTIN Tennis Editorial Team',
          seo_title: edit.seoTitle || undefined,
          seo_description: edit.seoDescription || undefined,
          ai_assisted: 1,
          is_published: 1,
        };

        results.editorial = EditorialsRepo.upsert(editorialRecord);
      }

      // 2. Ingest Mode B: Telegram Betting Record
      if (payload.telegramBetting) {
        const bet = payload.telegramBetting;
        const predictionRecord: any = {
          fixture_id: fixtureId,
          tournament_name: payload.tournamentName || 'Tennis Tournament',
          round_name: payload.roundName || '',
          surface: payload.surface || '',
          match_date: payload.matchDate || new Date().toISOString(),
          home_name: payload.homeName,
          away_name: payload.awayName,
          home_odds: bet.homeOdds ? String(bet.homeOdds) : undefined,
          away_odds: bet.awayOdds ? String(bet.awayOdds) : undefined,
          predicted_winner: bet.predictedWinner || payload.homeName,
          win_probability: bet.winProbability || 50,
          confidence: bet.confidence || 'MEDIUM',
          predicted_score: bet.predictedScore || '',
          best_bet_selection: bet.bestBetSelection || '',
          best_bet_market: bet.bestBetMarket || '',
          best_bet_ev: bet.bestBetEv ? String(bet.bestBetEv) : undefined,
          best_bet_rationale: bet.bestBetRationale || '',
          alt_bet_selection: bet.altBetSelection || '',
          alt_bet_market: bet.altBetMarket || '',
          key_factors: Array.isArray(bet.keyFactors) ? JSON.stringify(bet.keyFactors) : bet.keyFactors,
          devils_advocate_risk: bet.devilsAdvocateRisk || '',
          ai_summary: bet.aiSummary || '',
          status: 'UPCOMING',
          published_at: new Date().toISOString(),
        };

        const predictionId = PredictionsService.publish(predictionRecord);
        results.betting = { id: predictionId };

        // Auto-broadcast to Telegram channel if requested
        if (payload.postToTelegramChannel && predictionId) {
          try {
            const channelMsgId = await ChannelPosterService.publishPrediction(predictionRecord);
            results.postedToChannel = !!channelMsgId;
          } catch (postErr: any) {
            Logger.warn(`Channel broadcast failed: ${postErr.message}`);
            results.postedToChannel = false;
          }
        }
      }

      res.json({
        success: true,
        fixtureId,
        results,
      });
    } catch (err: any) {
      Logger.error(`Analysis ingestion error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  },

  /**
   * Serves Website Editorial Mode data for a match fixture or slug.
   * Strictly non-gambling tactical and statistical content.
   */
  getMatchEditorial: async (req: Request, res: Response) => {
    try {
      const param = String(req.params.idOrSlug);
      const isNum = /^\d+$/.test(param);

      const editorial = isNum
        ? EditorialsRepo.getByFixtureId(Number(param))
        : EditorialsRepo.getBySlug(param);

      if (!editorial) {
        return res.status(404).json({ error: 'Editorial analysis not found for this match' });
      }

      let parsedKeyStats = null;
      if (editorial.key_stats_json) {
        try {
          parsedKeyStats = JSON.parse(editorial.key_stats_json);
        } catch {}
      }

      res.json({
        ...editorial,
        key_stats: parsedKeyStats,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  /**
   * Serves Telegram Mini App Betting Mode data for a match fixture.
   */
  getMatchBetting: async (req: Request, res: Response) => {
    try {
      const fixtureId = Number(req.params.fixtureId);
      const prediction = PredictionsRepo.getByFixtureId(fixtureId);

      if (!prediction) {
        return res.status(404).json({ error: 'Betting analysis not found for this match' });
      }

      res.json(prediction);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
};
