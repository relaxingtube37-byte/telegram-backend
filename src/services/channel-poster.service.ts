import { InlineKeyboard } from 'grammy';
import { bot } from './telegram-bot.service';
import { ENV } from '../config/env';
import { escapeHtml, getSurfaceEmoji } from '../utils/htmlEscaper';
import { Logger } from '../utils/logger';
import type { Prediction } from '../types';

import { ObservabilityService } from './observability.service';

export const ChannelPosterService = {
  formatPredictionHtml: (prediction: Prediction, isTeaser: boolean = false): string => {
    const surfaceEmoji = getSurfaceEmoji(prediction.surface);
    const roundStr = prediction.round_name ? ` · ${escapeHtml(prediction.round_name)}` : '';

    let factors: string[] = [];
    const rawFactors = prediction.key_factors as unknown;
    if (Array.isArray(rawFactors)) {
      factors = rawFactors.map(String);
    } else if (typeof rawFactors === 'string') {
      const trimmed = rawFactors.trim();
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) factors = parsed.map(String);
        else if (trimmed) factors = [trimmed];
      } catch {
        if (trimmed) factors = [trimmed];
      }
    }
    const topFactors = factors.map(f => String(f).trim()).filter(Boolean).slice(0, 3);

    if (isTeaser) {
      return (
        `🎾 <b>NEW AI MATCH ANALYSIS AVAILABLE</b>\n` +
        `🏆 <b>${escapeHtml(prediction.tournament_name || 'Tennis Tournament')}</b>${roundStr} (${surfaceEmoji})\n` +
        `────────────────────────\n` +
        `⚔️ <b>${escapeHtml(prediction.home_name)} vs ${escapeHtml(prediction.away_name)}</b>\n\n` +
        `🤖 <b>5-Agent Specialist Audit:</b> COMPLETE ✅\n` +
        `🎯 <b>Predicted Winner:</b> <code>${escapeHtml(prediction.predicted_winner)}</code>\n` +
        `⚡ <b>Confidence Level:</b> <code>${escapeHtml(prediction.confidence || 'HIGH')} (${prediction.win_probability || 65}%)</code>\n\n` +
        `💡 <i>Tap the button below to view the full 5-agent tactical breakdown & live tracking inside the MiniApp!</i>`
      );
    }

    let factorsSection = '';
    if (topFactors.length > 0) {
      factorsSection =
        `\n⚡ <b>Key Match Factors:</b>\n` +
        topFactors.map(f => `• ${escapeHtml(f)}`).join('\n') + '\n';
    }

    let summarySection = '';
    if (prediction.ai_summary && prediction.ai_summary.trim()) {
      summarySection = `\n🧠 <b>AI Tactical Breakdown:</b>\n<i>${escapeHtml(prediction.ai_summary.trim())}</i>\n`;
    }

    return (
      `🎾 <b>AI MATCH ANALYSIS & PREDICTION</b>\n` +
      `🏆 <b>${escapeHtml(prediction.tournament_name || 'Tennis Tournament')}</b>${roundStr} (${surfaceEmoji})\n` +
      `────────────────────────\n` +
      `⚔️ <b>${escapeHtml(prediction.home_name)} vs ${escapeHtml(prediction.away_name)}</b>\n\n` +
      `🎯 <b>AI Predicted Winner:</b> <code>${escapeHtml(prediction.predicted_winner)}</code> (${prediction.win_probability || 65}% Win Prob)\n` +
      (prediction.predicted_score ? `📊 <b>Projected Score:</b> ${escapeHtml(prediction.predicted_score)}\n` : '') +
      `🔒 <b>Confidence:</b> <code>${escapeHtml(prediction.confidence || 'HIGH')}</code>\n` +
      factorsSection +
      summarySection +
      `────────────────────────\n` +
      `💡 <i>Explore the full match analytics & live tracking inside the MiniApp!</i>`
    );
  },

  publishPrediction: async (prediction: Prediction, isTeaser: boolean = false): Promise<number | null> => {
    const currentChannelId = ENV.CHANNEL_ID;
    if (!bot || !currentChannelId) {
      Logger.warn('Cannot publish to channel: bot instance or CHANNEL_ID is not configured');
      return null;
    }

    // ── ML Observability Gating Check ───────────────────────────────────────
    const gatingVerdict = ObservabilityService.evaluateGatingRules(
      prediction.match_date || '',
      prediction.win_probability || 65,
      85, // DQS
      10, // Surface sample count
      false // Injury flag
    );

    if (isTeaser && !gatingVerdict.telegramTeaserAllowed) {
      Logger.warn(`⏸️ Telegram Teaser Gated for fixture #${prediction.fixture_id}: Risk Bucket: ${gatingVerdict.riskBucket}, Failed Gates: ${gatingVerdict.failedGates.join(', ')}`);
      return null;
    } else if (!isTeaser && !gatingVerdict.telegramAllowed) {
      Logger.warn(`⏸️ Telegram Broadcast Gated for fixture #${prediction.fixture_id}: Risk Bucket: ${gatingVerdict.riskBucket}, Failed Gates: ${gatingVerdict.failedGates.join(', ')}`);
      return null;
    }

    const targetUrl = ENV.WEBAPP_DIRECT_URL || `https://t.me/${ENV.BOT_USERNAME}/${ENV.WEBAPP_SHORT_NAME}`;
    const keyboard = new InlineKeyboard().url('🚀 🎾 Open MiniApp & View Full Analysis', targetUrl);
    const htmlMsg = ChannelPosterService.formatPredictionHtml(prediction, isTeaser);

    try {
      const res = await bot.api.sendMessage(currentChannelId, htmlMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      Logger.success(`Published prediction #${prediction.id} (Teaser: ${isTeaser}) to channel ${currentChannelId}, Msg ID: ${res.message_id}`);
      return res.message_id;
    } catch (err: any) {
      Logger.error(`Failed to post to Telegram Channel (${currentChannelId}):`, err.message);
      try {
        const fallbackRes = await bot.api.sendMessage(currentChannelId, htmlMsg, { parse_mode: 'HTML' });
        Logger.success(`Published prediction #${prediction.id} (fallback) to channel ${currentChannelId}, Msg ID: ${fallbackRes.message_id}`);
        return fallbackRes.message_id;
      } catch (e2: any) {
        Logger.error('Fallback post also failed:', e2.message);
        return null;
      }
    }
  },

  updateResult: async (messageId: number, status: 'WON' | 'LOST' | 'VOID' | 'INTERRUPTED', resultScore?: string): Promise<void> => {
    const currentChannelId = ENV.CHANNEL_ID;
    if (!bot || !currentChannelId || !messageId || status === 'INTERRUPTED' || (status as any) === 'UPCOMING' || (status as any) === 'LIVE') {
      return;
    }

    const isValidScore = resultScore && 
      !['INTERRUPTED', 'UPCOMING', 'LIVE', 'VOID', 'WON', 'LOST'].includes(resultScore.toUpperCase().trim()) && 
      /\d/.test(resultScore);
    const scoreStr = isValidScore ? ` (${escapeHtml(resultScore.trim())})` : '';

    const resultBadge = status === 'WON' 
      ? `🎯 <b>MATCH RESULT: WON!</b> ✅`
      : status === 'LOST' 
      ? `❌ <b>MATCH RESULT: LOST</b>`
      : `🔄 <b>MATCH RESULT: VOID / CANCELLED</b>`;

    const targetUrl = `https://t.me/${ENV.BOT_USERNAME}/${ENV.WEBAPP_SHORT_NAME}`;
    const keyboard = new InlineKeyboard().url('🚀 📱 View Live Stats in MiniApp', targetUrl);

    const htmlMsg = 
      `${resultBadge}${scoreStr}

` +
      `📊 <i>Live stats, updated accuracy & upcoming picks are live in the MiniApp!</i>`;

    try {
      await bot.api.sendMessage(currentChannelId, htmlMsg, {
        reply_parameters: { message_id: messageId },
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      Logger.success(`Replied result update (${status}) to message #${messageId}`);
    } catch (e: any) {
      Logger.warn('Could not reply result update to channel:', e.message);
    }
  },

  publishBatchSummary: async (predictions: any[], customTitle?: string): Promise<number | null> => {
    const currentChannelId = ENV.CHANNEL_ID;
    if (!bot || !currentChannelId || !predictions || predictions.length === 0) return null;

    const wonCount = predictions.filter(p => p.status === 'WON').length;
    const lostCount = predictions.filter(p => p.status === 'LOST').length;
    const voidCount = predictions.filter(p => p.status === 'VOID' || p.status === 'INTERRUPTED').length;
    const totalSettled = wonCount + lostCount;
    const winRatePct = totalSettled > 0 ? Math.round((wonCount / totalSettled) * 100) : 0;

    const title = escapeHtml(customTitle || '📢 DAILY RESULTS RECAP · TENNIS AI STUDIO');
    const targetUrl = ENV.WEBAPP_DIRECT_URL || `https://t.me/${ENV.BOT_USERNAME}/${ENV.WEBAPP_SHORT_NAME}`;
    const keyboard = new InlineKeyboard().url('🚀 🏆 Open MiniApp & Get Tomorrow Picks', targetUrl);

    let matchLines = '';
    predictions.forEach((p, idx) => {
      const badge = p.status === 'WON' ? '✅ WON' : p.status === 'LOST' ? '❌ LOST' : p.status === 'INTERRUPTED' ? '⏸ INTERRUPTED' : '🔄 VOID';
      const scoreStr = p.result_score ? ` (${escapeHtml(p.result_score)})` : '';
      const hName = escapeHtml(p.home_name || 'Home');
      const aName = escapeHtml(p.away_name || 'Away');
      const sel = escapeHtml(p.predicted_winner || 'Winner');

      matchLines += `${idx + 1}. <b>${hName} vs ${aName}</b>\n` +
                   `   👉 Prediction: <code>${sel}</code> ${badge}${scoreStr}\n\n`;
    });

    const htmlMsg = 
      `🏆 <b>${title}</b>
` +
      `────────────────────────
` +
      `📊 <b>Daily Accuracy Summary:</b>
` +
      `✅ <b>Wins:</b> ${wonCount} | ❌ <b>Losses:</b> ${lostCount}${voidCount > 0 ? ` | 🔄 <b>Void:</b> ${voidCount}` : ''}
` +
      `🔥 <b>Accuracy / Win Rate:</b> <code>${winRatePct}%</code>
` +
      `────────────────────────

` +
      `${matchLines}` +
      `💡 <i>All live matches & tomorrow's VIP picks are available in the MiniApp!</i>`;

    try {
      const res = await bot.api.sendMessage(currentChannelId, htmlMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      Logger.success(`Published batch summary to channel ${currentChannelId}, Msg ID: ${res.message_id}`);
      return res.message_id;
    } catch (err: any) {
      Logger.error('Failed to post batch summary to Telegram Channel:', err.message);
      return null;
    }
  },
};
