import { InlineKeyboard } from 'grammy';
import { bot } from './telegram-bot.service';
import { ENV } from '../config/env';
import { escapeHtml, getSurfaceEmoji } from '../utils/htmlEscaper';
import { Logger } from '../utils/logger';
import type { Prediction } from '../types';

export const ChannelPosterService = {
  publishPrediction: async (prediction: Prediction, isTeaser: boolean = false): Promise<number | null> => {
    const currentChannelId = ENV.CHANNEL_ID;
    if (!bot || !currentChannelId) {
      Logger.warn('Cannot publish to channel: bot instance or CHANNEL_ID is not configured');
      return null;
    }

    const surfaceEmoji = getSurfaceEmoji(prediction.surface);
    const roundStr = prediction.round_name ? ` · ${escapeHtml(prediction.round_name)}` : '';
    const homeOddsStr = prediction.home_odds ? ` (Odds: ${escapeHtml(prediction.home_odds)})` : '';
    const awayOddsStr = prediction.away_odds ? ` (Odds: ${escapeHtml(prediction.away_odds)})` : '';

    const targetUrl = `https://t.me/${ENV.BOT_USERNAME}/${ENV.WEBAPP_SHORT_NAME}`;
    const keyboard = new InlineKeyboard().url('🚀 🎾 Open MiniApp & View Full Analysis', targetUrl);

    let htmlMsg = '';
    if (isTeaser) {
      htmlMsg = 
        `🎾 <b>NEW AI TENNIS PREDICTION AVAILABLE</b>
` +
        `🏆 <b>${escapeHtml(prediction.tournament_name || 'Tennis Tournament')}</b>${roundStr} (${surfaceEmoji})
` +
        `────────────────────────
` +
        `⚔️ <b>${escapeHtml(prediction.home_name)}${homeOddsStr} vs ${escapeHtml(prediction.away_name)}${awayOddsStr}</b>

` +
        `🤖 <b>5-Agent Specialist Audit:</b> COMPLETE ✅
` +
        `🎯 <b>Projected Winner & Score:</b> Calculated
` +
        `🔒 <b>High-Confidence Value Bet:</b> <i>Locked inside MiniApp</i>
` +
        `⚡ <b>Confidence Level:</b> <code>${escapeHtml(prediction.confidence || 'HIGH')} (${prediction.win_probability || 65}%)</code>

` +
        `💡 <i>Tap the button below to view the full 5-agent tactical dossier, value bet, and upset risk inside the MiniApp!</i>`;
    } else {
      htmlMsg = 
        `🎾 <b>AI MATCH PREDICTION & VALUE BET</b>
` +
        `🏆 <b>${escapeHtml(prediction.tournament_name || 'Tennis Tournament')}</b>${roundStr} (${surfaceEmoji})
` +
        `────────────────────────
` +
        `⚔️ <b>${escapeHtml(prediction.home_name)}${homeOddsStr} vs ${escapeHtml(prediction.away_name)}${awayOddsStr}</b>

` +
        `🎯 <b>AI Predicted Winner:</b> <code>${escapeHtml(prediction.predicted_winner)}</code> (${prediction.win_probability || 65}% Win Prob)
` +
        (prediction.predicted_score ? `📊 <b>Projected Score:</b> ${escapeHtml(prediction.predicted_score)}
` : '') +
        `🔒 <b>Confidence:</b> <code>${escapeHtml(prediction.confidence || 'HIGH')}</code>

` +
        `🔥 <b>RECOMMENDED VALUE BET:</b>
` +
        `👉 <b>${escapeHtml(prediction.best_bet_selection || prediction.predicted_winner)}</b>
` +
        `📌 <i>Market: ${escapeHtml(prediction.best_bet_market || 'Match Winner')}</i>` +
        (prediction.best_bet_ev ? ` [<b>EV: ${escapeHtml(prediction.best_bet_ev)}</b>]` : '') + `
` +
        (prediction.best_bet_rationale ? `💬 <i>"${escapeHtml(prediction.best_bet_rationale)}"</i>
` : '') +
        (prediction.alt_bet_selection ? `
🛡️ <b>Secondary Hedge:</b> ${escapeHtml(prediction.alt_bet_selection)} (${escapeHtml(prediction.alt_bet_market)})
` : '') +
        `────────────────────────
` +
        `💡 <i>Explore the full 38-metric radar & live tracking inside the MiniApp!</i>`;
    }

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
    const targetUrl = `https://t.me/${ENV.BOT_USERNAME}/${ENV.WEBAPP_SHORT_NAME}`;
    const keyboard = new InlineKeyboard().url('🚀 🏆 Open MiniApp & Get Tomorrow Picks', targetUrl);

    let matchLines = '';
    predictions.forEach((p, idx) => {
      const badge = p.status === 'WON' ? '✅ WON' : p.status === 'LOST' ? '❌ LOST' : p.status === 'INTERRUPTED' ? '⏸ INTERRUPTED' : '🔄 VOID';
      const scoreStr = p.result_score ? ` (${escapeHtml(p.result_score)})` : '';
      const hName = escapeHtml(p.home_name || 'Home');
      const aName = escapeHtml(p.away_name || 'Away');
      const sel = escapeHtml(p.best_bet_selection || p.predicted_winner || 'Winner');

      matchLines += `${idx + 1}. <b>${hName} vs ${aName}</b>
` +
                   `   👉 Pick: <code>${sel}</code> ${badge}${scoreStr}

`;
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
