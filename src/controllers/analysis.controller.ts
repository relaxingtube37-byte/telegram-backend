import { Request, Response } from 'express';
import { EditorialsRepo, MatchEditorialRecord, type EditorialPublishStatus } from '../db/repositories/editorials.repo';
import { PredictionsRepo } from '../db/repositories/predictions.repo';
import { PredictionsService } from '../services/predictions.service';
import { ChannelPosterService } from '../services/channel-poster.service';
import { Logger } from '../utils/logger';
import { redactEditorial, redactPrediction, resolveWebappAccess } from '../utils/contentAccess';
import {
  canTransitionStatus,
  validateEditorialForPublish,
} from '../editorial/validateEditorial';

function parseJsonArray(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function toPublicEditorial(editorial: MatchEditorialRecord) {
  let parsedKeyStats = null;
  if (editorial.key_stats_json) {
    try {
      parsedKeyStats = JSON.parse(editorial.key_stats_json);
    } catch {}
  }
  let seoMetadata = null;
  if (editorial.seo_metadata_json) {
    try {
      seoMetadata = JSON.parse(editorial.seo_metadata_json);
    } catch {}
  }
  let statusHistory = [];
  if (editorial.status_history_json) {
    try {
      statusHistory = JSON.parse(editorial.status_history_json);
    } catch {}
  }

  return {
    ...editorial,
    key_stats: parsedKeyStats,
    key_facts: parseJsonArray(editorial.key_facts_json),
    data_bullets: parseJsonArray(editorial.data_bullets_json),
    tags: parseJsonArray(editorial.tags_json),
    seo_metadata: seoMetadata,
    status_history: statusHistory,
    title: editorial.headline,
    short_summary: editorial.short_summary || editorial.summary,
  };
}

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
        const pkg = edit.editorialPackage || {};
        const slug =
          edit.slug ||
          pkg.slug ||
          `${(edit.headline || 'match').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${fixtureId}`;

        const publishStatus =
          (edit.publishStatus || pkg.publishStatus || payload.publishStatus || 'draft') as EditorialPublishStatus;

        const keyFacts = edit.keyFacts || pkg.keyFacts || [];
        const dataBullets = edit.dataBullets || pkg.dataBullets || [];
        const tags = edit.tags || pkg.tags || [];
        const seoMeta = edit.seoMetadata || pkg.seo || null;
        const guestSafe =
          edit.guestSafeSummary || pkg.guestSafeSummary || (edit.summary || '').slice(0, 280);

        const editorialRecord: MatchEditorialRecord = {
          fixture_id: fixtureId,
          slug,
          headline: edit.headline || pkg.title || `${payload.homeName || 'Player 1'} vs ${payload.awayName || 'Player 2'} Match Preview`,
          summary: edit.summary || pkg.shortSummary || '',
          tactical_analysis: edit.tacticalAnalysis || pkg.aiAnalysis || '',
          surface_breakdown: edit.surfaceBreakdown || undefined,
          h2h_breakdown: edit.h2hBreakdown || undefined,
          key_stats_json: edit.keyStatsJson ? JSON.stringify(edit.keyStatsJson) : undefined,
          author_name: edit.authorName || pkg.author || 'PTIN Tennis Editorial Team',
          seo_title: edit.seoTitle || seoMeta?.titleTag || seoMeta?.metaTitle || undefined,
          seo_description: edit.seoDescription || seoMeta?.metaDescription || undefined,
          ai_assisted: 1,
          is_published: publishStatus === 'published' ? 1 : 0,
          subtitle: edit.subtitle || pkg.subtitle || null,
          short_summary: edit.shortSummary || pkg.shortSummary || edit.summary || null,
          key_facts_json: JSON.stringify(keyFacts),
          data_bullets_json: JSON.stringify(dataBullets),
          tags_json: JSON.stringify(tags),
          seo_metadata_json: seoMeta ? JSON.stringify(seoMeta) : null,
          share_text: edit.shareText || pkg.seo?.shareText || seoMeta?.shareText || null,
          guest_safe_summary: guestSafe,
          publish_status: publishStatus,
          version: pkg.version || 1,
          editor_name: pkg.editor || null,
          published_at: publishStatus === 'published' ? new Date().toISOString() : null,
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

  listEditorials: async (_req: Request, res: Response) => {
    try {
      const rows = EditorialsRepo.listAll(200).map(toPublicEditorial);
      res.json({ success: true, editorials: rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getEditorialAdmin: async (req: Request, res: Response) => {
    try {
      const fixtureId = Number(req.params.fixtureId);
      const editorial = EditorialsRepo.getByFixtureId(fixtureId);
      if (!editorial) return res.status(404).json({ error: 'Editorial not found' });
      res.json({ success: true, editorial: toPublicEditorial(editorial) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  transitionEditorialStatus: async (req: Request, res: Response) => {
    try {
      const fixtureId = Number(req.params.fixtureId);
      const nextStatus = String(req.body?.status || '') as EditorialPublishStatus;
      const editor = String(req.body?.editor || req.body?.author || '').trim() || undefined;
      const note = String(req.body?.note || '').trim() || undefined;

      const existing = EditorialsRepo.getByFixtureId(fixtureId);
      if (!existing) return res.status(404).json({ error: 'Editorial not found' });

      const from = (existing.publish_status || (existing.is_published ? 'published' : 'draft')) as EditorialPublishStatus;
      if (!canTransitionStatus(from, nextStatus)) {
        return res.status(400).json({
          error: `Invalid transition ${from} → ${nextStatus}`,
          from,
          to: nextStatus,
        });
      }

      if (nextStatus === 'published') {
        const gate = validateEditorialForPublish({
          fixtureId,
          title: existing.headline,
          shortSummary: existing.short_summary || existing.summary,
          slug: existing.slug,
          seoTitle: existing.seo_title || undefined,
          seoDescription: existing.seo_description || undefined,
          guestSafeSummary: existing.guest_safe_summary || existing.short_summary || existing.summary,
          keyFacts: parseJsonArray(existing.key_facts_json),
          bodyText: [existing.tactical_analysis, existing.surface_breakdown, existing.h2h_breakdown]
            .filter(Boolean)
            .join(' '),
        });
        if (!gate.ok) {
          return res.status(400).json({
            error: 'Publish validation failed',
            validation: gate,
          });
        }
      }

      const updated = EditorialsRepo.updateStatus(fixtureId, nextStatus, { editor, note });
      res.json({ success: true, editorial: updated ? toPublicEditorial(updated) : null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  validateEditorial: async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const result = validateEditorialForPublish({
        fixtureId: body.fixtureId,
        title: body.title || body.headline,
        shortSummary: body.shortSummary || body.summary,
        slug: body.slug,
        seoTitle: body.seoTitle || body.titleTag,
        seoDescription: body.seoDescription || body.metaDescription,
        guestSafeSummary: body.guestSafeSummary,
        keyFacts: body.keyFacts,
        bodyText: body.bodyText || body.aiAnalysis,
      });
      res.json({ success: result.ok, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

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

      // Public site should primarily see published packages
      const status = editorial.publish_status || (editorial.is_published ? 'published' : 'draft');
      if (status !== 'published' && editorial.is_published !== 1) {
        return res.status(404).json({ error: 'Editorial not published yet' });
      }

      const access = resolveWebappAccess(req);
      const payload = redactEditorial(toPublicEditorial(editorial) as any, access);

      res.json({
        ...payload,
        verified: access.isVerified,
        access_mode: access.accessMode,
        content_layers: access.contentFlags,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getMatchBetting: async (req: Request, res: Response) => {
    try {
      const fixtureId = Number(req.params.fixtureId);
      const prediction = PredictionsRepo.getByFixtureId(fixtureId);

      if (!prediction) {
        return res.status(404).json({ error: 'Match analysis not found for this fixture' });
      }

      const access = resolveWebappAccess(req);
      const formatted = PredictionsService.formatPrediction(prediction);
      res.json({
        ...redactPrediction(formatted, access),
        verified: access.isVerified,
        access_mode: access.accessMode,
        content_layers: access.contentFlags,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
};
