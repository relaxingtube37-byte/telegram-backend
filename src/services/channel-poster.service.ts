import { InlineKeyboard } from 'grammy';
import { bot, resolveWebAppUrl } from './telegram-bot.service';
import { ENV } from '../config/env';
import { escapeHtml, getSurfaceEmoji } from '../utils/htmlEscaper';
import { Logger } from '../utils/logger';
import type { Prediction } from '../types';
import { PredictionsRepo } from '../db/repositories/predictions.repo';

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
        `🤖 <b>4-Agent Specialist Audit:</b> COMPLETE ✅\n` +
        `🎯 <b>Predicted Winner:</b> <code>${escapeHtml(prediction.predicted_winner)}</code>\n` +
        `⚡ <b>Confidence Level:</b> <code>${escapeHtml(prediction.confidence || 'HIGH')} (${prediction.win_probability || 65}%)</code>\n\n` +
        `💡 <i>Tap the button below to view the full 4-agent tactical breakdown & live tracking inside the MiniApp!</i>\n` +
        `🌐 <b><a href="https://ptin-AI.com">ptin-AI.com</a></b>`
      );
    }

    let factorsSection = '';
    if (topFactors.length > 0) {
      factorsSection =
        `\n⚡ <b>Key Match Factors:</b>\n` +
        topFactors.map(f => `• ${escapeHtml(f)}`).join('\n') + '\n';
    }

    let devilsAdvocateSection = '';
    if (prediction.devils_advocate_risk && prediction.devils_advocate_risk.trim()) {
      devilsAdvocateSection = `\n⚠️ <b>Contrarian Risk (Upset Scenario):</b>\n<i>${escapeHtml(prediction.devils_advocate_risk.trim())}</i>\n`;
    }

    let summarySection = '';
    if (prediction.ai_summary && prediction.ai_summary.trim()) {
      summarySection = `\n🧠 <b>AI Tactical Breakdown:</b>\n<i>${escapeHtml(prediction.ai_summary.trim())}</i>\n`;
    }

    return (
      `🎾 <b>AI MATCH ANALYSIS & PREDICTION</b>\n` +
      `🏆 <b>${escapeHtml(prediction.tournament_name || 'Tennis Tournament')}</b>${roundStr} (${surfaceEmoji})\n` +
      `────────────────────────\n` +
      `⚔️ <b>${escapeHtml(prediction.home_name)}</b>${prediction.home_odds && prediction.home_odds !== 'N/A' ? ` [<code>${escapeHtml(String(prediction.home_odds))}</code>]` : ''} vs <b>${escapeHtml(prediction.away_name)}</b>${prediction.away_odds && prediction.away_odds !== 'N/A' ? ` [<code>${escapeHtml(String(prediction.away_odds))}</code>]` : ''}\n\n` +
      `🎯 <b>AI Predicted Winner:</b> <code>${escapeHtml(prediction.predicted_winner)}</code> (${prediction.win_probability || 65}% Win Prob)\n` +
      (prediction.predicted_score ? `📊 <b>Projected Score:</b> ${escapeHtml(prediction.predicted_score)}\n` : '') +
      `🔒 <b>Confidence:</b> <code>${escapeHtml(prediction.confidence || 'HIGH')}</code>\n` +
      factorsSection +
      devilsAdvocateSection +
      summarySection +
      `────────────────────────\n` +
      `💡 <i>Explore the full match analytics & live tracking inside the MiniApp!</i>\n` +
      `🌐 <b><a href="https://ptin-AI.com">ptin-AI.com</a></b>`
    );
  },

  publishPrediction: async (prediction: Prediction, isTeaser: boolean = false): Promise<number | null> => {
    const currentChannelId = ENV.CHANNEL_ID;
    if (!bot || !currentChannelId) {
      Logger.warn('Cannot publish to channel: bot instance or CHANNEL_ID is not configured');
      return null;
    }

    // ── ML Observability Advisory Check (Non-blocking for explicit admin publishes) ──
    try {
      const gatingVerdict = ObservabilityService.evaluateGatingRules(
        prediction.match_date || '',
        prediction.win_probability || 65,
        85, // DQS
        10, // Surface sample count
        false // Injury flag
      );
      if (!gatingVerdict.telegramAllowed) {
        Logger.warn(`⚠️ Telegram Broadcast advisory for fixture #${prediction.fixture_id}: Risk: ${gatingVerdict.riskBucket}, Gates: ${gatingVerdict.failedGates.join(', ')}`);
      }
    } catch (e: any) {
      Logger.warn('Gating evaluation skipped:', e.message);
    }

    const targetUrl = resolveWebAppUrl();
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

  /**
   * Post WON/LOST/VOID reply once per prediction (durable via fixture_id / result_announced_at).
   * Safe across backend restart and backup import when those columns are restored.
   */
  announceResultIfNeeded: async (
    prediction: Prediction | null | undefined,
    status: 'WON' | 'LOST' | 'VOID' | 'INTERRUPTED' | string,
    resultScore?: string,
  ): Promise<{ posted: boolean; skipped: boolean; reason?: string; resultMessageId?: number | null }> => {
    if (!prediction?.id) {
      return { posted: false, skipped: true, reason: 'missing_prediction' };
    }
    if (status !== 'WON' && status !== 'LOST' && status !== 'VOID') {
      return { posted: false, skipped: true, reason: 'non_terminal_status' };
    }
    if (!prediction.channel_message_id) {
      return { posted: false, skipped: true, reason: 'no_channel_message' };
    }
    if (PredictionsRepo.isResultAnnounced(prediction)) {
      Logger.info(
        `[ChannelPoster] Skip result announce for fixture #${prediction.fixture_id ?? '?'} ` +
          `(prediction #${prediction.id}): already announced at ${prediction.result_announced_at}`,
      );
      return { posted: false, skipped: true, reason: 'already_announced' };
    }

    const resultMessageId = await ChannelPosterService.updateResult(
      prediction.channel_message_id,
      status,
      resultScore,
      {
        homeName: prediction.home_name,
        awayName: prediction.away_name,
        predictedWinner: prediction.predicted_winner,
        tournamentName: prediction.tournament_name,
      },
    );

    // Mark announced only after a successful Telegram send (message id returned).
    // If channel/bot unavailable, leave unmarked so a later sync can retry once.
    if (resultMessageId != null) {
      const announcedAt = new Date().toISOString();
      PredictionsRepo.markResultAnnounced(prediction.id, announcedAt, resultMessageId);
      Logger.success(
        `[ChannelPoster] Result announced for fixture #${prediction.fixture_id ?? '?'} ` +
          `(prediction #${prediction.id}) replyMsg=${resultMessageId}`,
      );
      return { posted: true, skipped: false, resultMessageId };
    }

    return { posted: false, skipped: false, reason: 'send_failed', resultMessageId: null };
  },

  updateResult: async (
    messageId: number,
    status: 'WON' | 'LOST' | 'VOID' | 'INTERRUPTED',
    resultScore?: string,
    matchInfo?: {
      homeName?: string;
      awayName?: string;
      predictedWinner?: string;
      tournamentName?: string;
    },
  ): Promise<number | null> => {
    const currentChannelId = ENV.CHANNEL_ID;
    if (!bot || !currentChannelId || !messageId || status === 'INTERRUPTED' || (status as any) === 'UPCOMING' || (status as any) === 'LIVE') {
      return null;
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

    let matchDetailStr = '';
    if (matchInfo?.homeName && matchInfo?.awayName) {
      const tourStr = matchInfo.tournamentName ? `🏆 <i>${escapeHtml(matchInfo.tournamentName)}</i>\n` : '';
      const vsStr = `🎾 <b>${escapeHtml(matchInfo.homeName)} vs ${escapeHtml(matchInfo.awayName)}</b>\n`;
      const pickStr = matchInfo.predictedWinner ? `🎯 Pick: <b>${escapeHtml(matchInfo.predictedWinner)}</b>\n` : '';
      matchDetailStr = `\n${tourStr}${vsStr}${pickStr}`;
    }

    const targetUrl = resolveWebAppUrl();
    const keyboard = new InlineKeyboard().url('🚀 📱 View Live Stats in MiniApp', targetUrl);

    const htmlMsg = 
      `${resultBadge}${scoreStr}\n` +
      matchDetailStr +
      `\n📊 <i>Live stats, updated accuracy & upcoming picks are live in the MiniApp!</i>\n` +
      `🌐 <b><a href="https://ptin-AI.com">ptin-AI.com</a></b>`;

    try {
      const res = await bot.api.sendMessage(currentChannelId, htmlMsg, {
        reply_parameters: { message_id: messageId },
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      Logger.success(`Replied result update (${status}) to message #${messageId}`);
      return res.message_id;
    } catch (e: any) {
      Logger.warn('Could not reply result update to channel:', e.message);
      return null;
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
    const targetUrl = resolveWebAppUrl();
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
      `💡 <i>All live matches & tomorrow's VIP picks are available in the MiniApp!</i>\n` +
      `🌐 <b><a href="https://ptin-AI.com">ptin-AI.com</a></b>`;

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

  publishBatchCountAnnouncement: async (params: {
    count: number;
    matches?: Array<{
      home?: string;
      away?: string;
      tourn?: string;
      time?: string;
      winner?: string;
      best_bet?: string;
      odds?: string | number;
      surface?: string;
      home_name?: string;
      away_name?: string;
      tournament?: string;
      tournament_name?: string;
    }>;
    title?: string;
    headerText?: string;
    footerText?: string;
    includePicks?: boolean;
    mode?: 'summary_list' | 'count_only';
  }): Promise<number | null> => {
    const currentChannelId = ENV.CHANNEL_ID;
    if (!bot || !currentChannelId || params.count <= 0) return null;

    const targetUrl = resolveWebAppUrl();
    const keyboard = new InlineKeyboard().url(`🚀 🎾 Open MiniApp & View Analyses (${params.count} Matches)`, targetUrl);

    let matchPreviews = '';
    if (Array.isArray(params.matches) && params.matches.length > 0) {
      if (params.mode === 'count_only') {
        matchPreviews = '\n🏆 <b>Featured Matches Added:</b>\n' +
          params.matches.slice(0, 5).map(m => {
            const home = m.home || m.home_name || 'Home';
            const away = m.away || m.away_name || 'Away';
            const tourn = m.tourn || m.tournament || m.tournament_name || '';
            return `• <b>${escapeHtml(home)} vs ${escapeHtml(away)}</b>${tourn ? ` <i>(${escapeHtml(tourn)})</i>` : ''}`;
          }).join('\n');

        const remaining = params.count - Math.min(params.matches.length, 5);
        if (remaining > 0) {
          matchPreviews += `\n<i>... and ${remaining} more match(es)</i>`;
        }
        matchPreviews += '\n';
      } else {
        // Tournament-grouped summary list (Single Digest)
        const groups = new Map<string, Array<any>>();
        for (const m of params.matches) {
          const rawTourn = m.tourn || m.tournament || m.tournament_name || '🎾 International Tennis';
          const tName = rawTourn.trim();
          if (!groups.has(tName)) groups.set(tName, []);
          groups.get(tName)!.push(m);
        }

        const lines: string[] = ['\n📋 <b>Featured Matches & AI Predictions:</b>'];
        const groupEntries = Array.from(groups.entries());
        for (const [tournName, list] of groupEntries) {
          lines.push(`\n🏆 <b>${escapeHtml(tournName)}</b>`);
          for (const m of list) {
            const home = m.home || m.home_name || 'Home';
            const away = m.away || m.away_name || 'Away';
            const time = m.time ? ` ⏰ <code>${escapeHtml(m.time)}</code>` : '';
            lines.push(`• <b>${escapeHtml(home)} vs ${escapeHtml(away)}</b>${time}`);
            if (params.includePicks !== false) {
              const pick = m.best_bet || m.winner;
              const odds = m.odds ? ` | Odds: <b>${escapeHtml(String(m.odds))}</b>` : '';
              if (pick && pick !== 'PASS' && pick !== 'NO_BET') {
                lines.push(`  🎯 <i>Pick: <b>${escapeHtml(pick)}</b>${odds}</i>`);
              }
            }
          }
        }
        lines.push('');
        matchPreviews = lines.join('\n');
      }
    }

    const titleHeader = params.title || `🎾 <b>TENNIS AI MATCH PREDICTIONS & DOSSIERS</b>`;
    const subHeader = params.headerText || `⚡ <b>${params.count} new AI match analysis dossier(s) & predictions are live in the MiniApp!</b>`;
    const footer = params.footerText || 
      `💡 <i>Tap the button below to view 4-agent tactical breakdowns, win probabilities & live tracking inside the MiniApp!</i>\n` +
      `🌐 <b><a href="https://ptin-AI.com">ptin-AI.com</a></b>`;

    const htmlMsg =
      `${titleHeader}\n` +
      `────────────────────────\n` +
      `${subHeader}\n` +
      matchPreviews +
      `────────────────────────\n` +
      `${footer}`;

    try {
      const res = await bot.api.sendMessage(currentChannelId, htmlMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      Logger.success(`Published batch announcement (${params.count} matches) to channel ${currentChannelId}, Msg ID: ${res.message_id}`);
      return res.message_id;
    } catch (err: any) {
      Logger.error('Failed to post batch announcement to Telegram Channel:', err.message);
      return null;
    }
  },
};
