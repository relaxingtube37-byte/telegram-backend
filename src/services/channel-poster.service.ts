import { InlineKeyboard } from 'grammy';
import { bot, resolveWebAppUrl } from './telegram-bot.service';
import { ENV } from '../config/env';
import { escapeHtml, getSurfaceEmoji } from '../utils/htmlEscaper';
import { Logger } from '../utils/logger';
import type { Prediction } from '../types';
import { PredictionsRepo } from '../db/repositories/predictions.repo';
import { db } from '../db';
import { ObservabilityService } from './observability.service';

const announcedFixtureIds = new Set<number>();
const inFlightFixtureIds = new Set<number>();

// Pre-seed known announced fixtures from database
try {
  const rows = db.prepare(`
    SELECT fixture_id FROM predictions 
    WHERE fixture_id IS NOT NULL 
      AND (result_announced_at IS NOT NULL OR (result_channel_message_id IS NOT NULL AND result_channel_message_id > 0))
  `).all() as { fixture_id: number }[];
  for (const r of rows) {
    if (r.fixture_id) announcedFixtureIds.add(Number(r.fixture_id));
  }
} catch {
  // DB might not be ready yet
}

export const ChannelPosterService = {
  formatPredictionHtml: (prediction: Prediction, isTeaser: boolean = false): string => {
    const surfaceEmoji = getSurfaceEmoji(prediction.surface);
    const roundStr = prediction.round_name ? ` · ${escapeHtml(prediction.round_name)}` : '';

    let factors: string[] = [];
    const rawFactors = prediction.key_factors as unknown;
    if (Array.isArray(rawFactors)) {
      factors = rawFactors.map(String);
    } else if (rawFactors && typeof rawFactors === 'object') {
      const enArr = (rawFactors as any).en || Object.values(rawFactors)[0];
      if (Array.isArray(enArr)) factors = enArr.map(String);
      else if (typeof enArr === 'string') factors = [enArr];
    } else if (typeof rawFactors === 'string') {
      const trimmed = rawFactors.trim();
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) factors = parsed.map(String);
        else if (parsed && typeof parsed === 'object') {
          const enArr = parsed.en || Object.values(parsed)[0];
          if (Array.isArray(enArr)) factors = enArr.map(String);
          else if (typeof enArr === 'string') factors = [enArr];
        } else if (trimmed) factors = [trimmed];
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

    const devilsRisk = typeof prediction.devils_advocate_risk === 'object'
      ? ((prediction.devils_advocate_risk as any)?.en || Object.values(prediction.devils_advocate_risk)[0] || '')
      : (prediction.devils_advocate_risk || '');

    let devilsAdvocateSection = '';
    if (devilsRisk && typeof devilsRisk === 'string' && devilsRisk.trim()) {
      devilsAdvocateSection = `\n⚠️ <b>Contrarian Risk (Upset Scenario):</b>\n<i>${escapeHtml(devilsRisk.trim())}</i>\n`;
    }

    const aiSummaryText = typeof prediction.ai_summary === 'object'
      ? ((prediction.ai_summary as any)?.en || Object.values(prediction.ai_summary)[0] || '')
      : (prediction.ai_summary || '');

    let summarySection = '';
    if (aiSummaryText && typeof aiSummaryText === 'string' && aiSummaryText.trim()) {
      summarySection = `\n🧠 <b>AI Tactical Breakdown:</b>\n<i>${escapeHtml(aiSummaryText.trim())}</i>\n`;
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
   * Post WON/LOST/VOID/INTERRUPTED reply or standalone message once per prediction.
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
    const normStatus = (status || '').toUpperCase().trim();
    if (normStatus !== 'WON' && normStatus !== 'LOST' && normStatus !== 'VOID' && normStatus !== 'INTERRUPTED') {
      return { posted: false, skipped: true, reason: 'non_terminal_status' };
    }

    const fixtureId = prediction.fixture_id ? Number(prediction.fixture_id) : null;

    // 1. In-memory check (prevents duplicate calls within same process lifetime)
    if (fixtureId && (announcedFixtureIds.has(fixtureId) || inFlightFixtureIds.has(fixtureId))) {
      Logger.info(`[ChannelPoster] Skip result announce for fixture #${fixtureId}: already in memory cache or in-flight.`);
      return { posted: false, skipped: true, reason: 'already_announced' };
    }

    // 2. Fresh database record check (guards against stale prediction objects passed by callers)
    const fresh = PredictionsRepo.getById(prediction.id) || (fixtureId ? PredictionsRepo.getByFixtureId(fixtureId) : null);
    if (fresh && PredictionsRepo.isResultAnnounced(fresh)) {
      if (fixtureId) announcedFixtureIds.add(fixtureId);
      Logger.info(
        `[ChannelPoster] Skip result announce for fixture #${fixtureId ?? '?'} ` +
          `(prediction #${prediction.id}): already announced at ${fresh.result_announced_at}`,
      );
      return { posted: false, skipped: true, reason: 'already_announced' };
    }

    if (fixtureId) inFlightFixtureIds.add(fixtureId);

    try {
      const resultMessageId = await ChannelPosterService.updateResult(
        prediction.channel_message_id,
        normStatus as any,
        resultScore,
        {
          homeName: prediction.home_name,
          awayName: prediction.away_name,
          predictedWinner: prediction.predicted_winner,
          tournamentName: prediction.tournament_name,
        },
      );

      // Mark announced only after a successful Telegram send (message id returned).
      if (resultMessageId != null) {
        const announcedAt = new Date().toISOString();
        if (fixtureId) announcedFixtureIds.add(fixtureId);
        PredictionsRepo.markResultAnnounced(prediction.id, announcedAt, resultMessageId);
        Logger.success(
          `[ChannelPoster] Result announced for fixture #${fixtureId ?? '?'} ` +
            `(prediction #${prediction.id}) msgId=${resultMessageId}`,
        );
        return { posted: true, skipped: false, resultMessageId };
      }

      return { posted: false, skipped: false, reason: 'send_failed', resultMessageId: null };
    } finally {
      if (fixtureId) inFlightFixtureIds.delete(fixtureId);
    }
  },

  updateResult: async (
    messageId?: number | null,
    status: 'WON' | 'LOST' | 'VOID' | 'INTERRUPTED' | string = 'VOID',
    resultScore?: string,
    matchInfo?: {
      homeName?: string;
      awayName?: string;
      predictedWinner?: string;
      tournamentName?: string;
    },
  ): Promise<number | null> => {
    const currentChannelId = ENV.CHANNEL_ID;
    const normStatus = (status || '').toUpperCase().trim();
    if (!bot || !currentChannelId || normStatus === 'UPCOMING' || normStatus === 'LIVE') {
      return null;
    }

    const isValidScore = resultScore && 
      !['INTERRUPTED', 'UPCOMING', 'LIVE', 'VOID', 'WON', 'LOST'].includes(resultScore.toUpperCase().trim()) && 
      /\d/.test(resultScore);
    const scoreStr = isValidScore ? ` (${escapeHtml(resultScore.trim())})` : '';

    const resultBadge = normStatus === 'WON' 
      ? `🎯 <b>MATCH RESULT: WON!</b> ✅`
      : normStatus === 'LOST' 
      ? `❌ <b>MATCH RESULT: LOST</b>`
      : normStatus === 'INTERRUPTED'
      ? `⏸ <b>MATCH RESULT: INTERRUPTED / RETIRED</b>`
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

    // 1. If messageId exists (> 0), try to reply to the original message
    if (messageId && Number(messageId) > 0) {
      try {
        const res = await bot.api.sendMessage(currentChannelId, htmlMsg, {
          reply_parameters: { message_id: Number(messageId) },
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
        Logger.success(`Replied result update (${normStatus}) to message #${messageId}`);
        return res.message_id;
      } catch (e: any) {
        Logger.warn(`Could not reply to message #${messageId}, falling back to standalone post: ${e.message}`);
      }
    }

    // 2. Standalone channel post (when no messageId or reply failed)
    try {
      const res = await bot.api.sendMessage(currentChannelId, htmlMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      Logger.success(`Published standalone result update (${normStatus}) to channel ${currentChannelId}, Msg ID: ${res.message_id}`);
      return res.message_id;
    } catch (err: any) {
      Logger.error(`Failed to post result update (${normStatus}) to channel: ${err.message}`);
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
    channelTitle?: string;
    headerText?: string;
    footerText?: string;
    includePicks?: boolean;
    mode?: 'summary_list' | 'count_only';
  }): Promise<number | null> => {
    const currentChannelId = ENV.CHANNEL_ID;
    if (!bot || !currentChannelId || params.count <= 0) return null;

    const isTeaser = params.includePicks !== true;
    const targetUrl = resolveWebAppUrl();
    const btnLabel = `🚀 🎾 Open MiniApp & View Analyses (${params.count} Matches)`;
    const keyboard = new InlineKeyboard().url(btnLabel, targetUrl);

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

        const listHeader = isTeaser
          ? '\n📋 <b>Featured Matches (AI Analyzed & Ready):</b>'
          : '\n📋 <b>Featured Matches & AI Predictions:</b>';
        const lines: string[] = [listHeader];
        const groupEntries = Array.from(groups.entries());
        for (const [tournName, list] of groupEntries) {
          lines.push(`\n🏆 <b>${escapeHtml(tournName)}</b>`);
          for (const m of list) {
            const home = m.home || m.home_name || 'Home';
            const away = m.away || m.away_name || 'Away';
            const timeRaw = m.time ? String(m.time).trim() : '';
            const time = timeRaw ? ` ⏰ <code>${escapeHtml(timeRaw)}</code>` : '';
            lines.push(`• <b>${escapeHtml(home)} vs ${escapeHtml(away)}</b>${time}`);
            if (params.includePicks === true) {
              const pick = m.best_bet || m.winner;
              const odds = m.odds ? ` | Odds: <b>${escapeHtml(String(m.odds))}</b>` : '';
              if (pick && pick !== 'PASS' && pick !== 'NO_BET') {
                lines.push(`  🎯 <i>Lean: <b>${escapeHtml(pick)}</b>${odds}</i>`);
              }
            }
          }
        }
        lines.push('');
        matchPreviews = lines.join('\n');
      }
    }

    // Resolve channel name dynamically or from parameters
    let channelName = (params.channelTitle || '').trim();
    if (!channelName && ENV.CHANNEL_TITLE) {
      channelName = ENV.CHANNEL_TITLE;
    }
    if (!channelName && bot && currentChannelId) {
      try {
        const chat = await bot.api.getChat(currentChannelId);
        if ('title' in chat && chat.title) {
          channelName = chat.title;
        } else if ('username' in chat && chat.username) {
          channelName = `@${chat.username}`;
        }
      } catch {}
    }
    if (!channelName && ENV.CHANNEL_URL) {
      const handle = ENV.CHANNEL_URL.split('/').pop();
      if (handle) channelName = `@${handle}`;
    }
    if (!channelName) {
      channelName = 'BetBaz Tennis AI';
    }

    const channelHeader = `📢 <b>${escapeHtml(channelName)}</b>\n`;
    const titleHeader = params.title || `🎾 <b>TENNIS AI MATCH ANALYSIS & DOSSIERS</b>`;
    const subHeader = params.headerText || `⚡ <b>${params.count} New AI Match Tactical Dossiers are live in the MiniApp:</b>`;
    const defaultFooter = isTeaser
      ? `📊 <b>4-Agent Tactical Dossiers, Win Probabilities & Form Analysis are available in the MiniApp.</b>\n` +
        `👇 <b>Tap the button below to open the MiniApp & view all match analyses:</b>\n` +
        `🌐 <b><a href="https://ptin-AI.com">ptin-AI.com</a></b>`
      : `💡 <i>Tap the button below to view 4-agent tactical breakdowns, win probabilities & live tracking inside the MiniApp!</i>\n` +
        `🌐 <b><a href="https://ptin-AI.com">ptin-AI.com</a></b>`;
    const footer = params.footerText || defaultFooter;

    const htmlMsg =
      `${channelHeader}` +
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
