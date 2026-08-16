import { Bot, InlineKeyboard } from 'grammy';
import dotenv from 'dotenv';

dotenv.config();

const token = process.env.BOT_TOKEN || '';
const channelId = process.env.CHANNEL_ID || '';
const webAppUrl = process.env.WEBAPP_URL || '';

export const bot = token && !token.includes('YOUR_') && !token.includes('placeholder')
  ? new Bot(token)
  : null;

if (bot) {
  bot.command('start', async (ctx) => {
    const botUsernameEnv = (process.env.BOT_USERNAME || '').replace(/^@/, '').trim();
    const rawBotUsername = botUsernameEnv || ctx.me?.username || 'admdinbetbetforbot';
    const webAppShortName = (process.env.WEBAPP_SHORT_NAME || 'app').trim();
    const targetUrl = `https://t.me/${rawBotUsername}/${webAppShortName}`;

    const keyboard = new InlineKeyboard().url('🚀 Open Tennis AI WebApp', targetUrl);

    await ctx.reply(
      `🎾 <b>Welcome to Tennis AI Studio!</b>\n\n` +
      `Get access to real-time 5-Agent Multi-AI predictions, statistical hold/break matrices, and high-EV value bets across ATP & WTA tours.\n\n` +
      `Tap the button below to launch the MiniApp:`,
      {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      }
    );
  });

  bot.start({
    onStart: async (info) => {
      console.log(`🤖 Telegram Bot @${info.username} started successfully!`);
      try {
        await bot.api.setMyCommands([
          { command: 'start', description: '🚀 Launch Tennis AI WebApp' },
        ]);
        if (webAppUrl && webAppUrl.startsWith('http')) {
          await bot.api.setChatMenuButton({
            menu_button: {
              type: 'web_app',
              text: '🚀 Open WebApp',
              web_app: { url: webAppUrl },
            },
          });
          console.log(`✅ Auto-configured persistent Telegram Menu Button -> ${webAppUrl}`);
        }
      } catch (e: any) {
        console.warn('⚠ Bot menu configuration warning:', e.message);
      }
    },
  }).catch((err) => console.warn('Telegram Bot start warning:', err.message));
} else {
  console.warn('⚠ TELEGRAM BOT_TOKEN not configured or placeholder token used. Bot commands disabled until token is set.');
}

const escapeHtml = (str?: string): string => {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

/**
 * Format and publish a prediction card to the Telegram Channel
 * Styled with clean Information Architecture & CTA driving traffic to MiniApp
 */
export const publishPredictionToChannel = async (prediction: any, isTeaser: boolean = true): Promise<number | null> => {
  const currentChannelId = (process.env.CHANNEL_ID || '').trim();

  if (!bot) {
    console.warn('⚠ Bot instance not initialized. Check BOT_TOKEN in environment variables.');
    return null;
  }
  if (!currentChannelId) {
    console.warn('⚠ CHANNEL_ID not configured in environment variables.');
    return null;
  }

  const surfaceEmoji = prediction.surface?.toLowerCase().includes('clay') ? '🧱 Clay'
    : prediction.surface?.toLowerCase().includes('grass') ? '🌱 Grass' : '🟦 Hard';

  const botUsernameEnv = (process.env.BOT_USERNAME || '').replace(/^@/, '').trim();
  const rawBotUsername = botUsernameEnv || 'admdinbetbetforbot';
  const webAppShortName = (process.env.WEBAPP_SHORT_NAME || 'app').trim();
  
  // Format Telegram Direct Mini App Link: https://t.me/BotUsername/app?startapp=pred_123
  const targetUrl = `https://t.me/${rawBotUsername}/${webAppShortName}?startapp=pred_${prediction.id}`;

  const keyboard = new InlineKeyboard().url('🚀 📊 Open Full Analysis in MiniApp', targetUrl);

  const homeOddsStr = prediction.home_odds ? ` (${prediction.home_odds})` : '';
  const awayOddsStr = prediction.away_odds ? ` (${prediction.away_odds})` : '';
  const roundStr = prediction.round_name ? ` · ${escapeHtml(prediction.round_name)}` : '';

  let htmlMsg = '';

  if (isTeaser) {
    // 🎭 Teaser Mode: Perfect conversion hook to drive users into the MiniApp
    htmlMsg = 
      `🔥 <b>NEW MATCH INTEL & VIP VALUE BET</b>\n` +
      `🏆 <b>${escapeHtml(prediction.tournament_name || 'Tennis Tournament')}</b>${roundStr} (${surfaceEmoji})\n` +
      `────────────────────────\n` +
      `⚔️ <b>${escapeHtml(prediction.home_name)}${homeOddsStr} vs ${escapeHtml(prediction.away_name)}${awayOddsStr}</b>\n\n` +
      `🤖 <b>5-Agent Specialist Audit:</b> COMPLETE ✅\n` +
      `🎯 <b>Projected Winner & Score:</b> Calculated\n` +
      `🔒 <b>High-Confidence Value Bet:</b> <i>Locked inside MiniApp</i>\n` +
      `⚡ <b>Confidence Level:</b> <code>${escapeHtml(prediction.confidence || 'HIGH')} (${prediction.win_probability || 65}%)</code>\n\n` +
      `💡 <i>Tap the button below to view the full 5-agent tactical dossier, value bet, and upset risk inside the MiniApp!</i>`;
  } else {
    // 🎾 Full Details Mode: Authoritative match preview with MiniApp deep-link
    htmlMsg = 
      `🎾 <b>AI MATCH PREDICTION & VALUE BET</b>\n` +
      `🏆 <b>${escapeHtml(prediction.tournament_name || 'Tennis Tournament')}</b>${roundStr} (${surfaceEmoji})\n` +
      `────────────────────────\n` +
      `⚔️ <b>${escapeHtml(prediction.home_name)}${homeOddsStr} vs ${escapeHtml(prediction.away_name)}${awayOddsStr}</b>\n\n` +
      `🎯 <b>AI Predicted Winner:</b> <code>${escapeHtml(prediction.predicted_winner)}</code> (${prediction.win_probability || 65}% Win Prob)\n` +
      (prediction.predicted_score ? `📊 <b>Projected Score:</b> ${escapeHtml(prediction.predicted_score)}\n` : '') +
      `🔒 <b>Confidence:</b> <code>${escapeHtml(prediction.confidence || 'HIGH')}</code>\n\n` +
      `🔥 <b>RECOMMENDED VALUE BET:</b>\n` +
      `👉 <b>${escapeHtml(prediction.best_bet_selection || prediction.predicted_winner)}</b>\n` +
      `📌 <i>Market: ${escapeHtml(prediction.best_bet_market || 'Match Winner')}</i>` +
      (prediction.best_bet_ev ? ` [<b>EV: ${escapeHtml(prediction.best_bet_ev)}</b>]` : '') + `\n` +
      (prediction.best_bet_rationale ? `💬 <i>"${escapeHtml(prediction.best_bet_rationale)}"</i>\n` : '') +
      (prediction.alt_bet_selection ? `\n🛡️ <b>Secondary Hedge:</b> ${escapeHtml(prediction.alt_bet_selection)} (${escapeHtml(prediction.alt_bet_market)})\n` : '') +
      `────────────────────────\n` +
      `💡 <i>Explore the full 38-metric radar & live tracking inside the MiniApp!</i>`;
  }

  try {
    const res = await bot.api.sendMessage(currentChannelId, htmlMsg, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
    console.log(`✅ Published prediction #${prediction.id} (Teaser: ${isTeaser}) to channel ${currentChannelId}, Msg ID: ${res.message_id}`);
    return res.message_id;
  } catch (err: any) {
    console.error(`❌ Failed to post to Telegram Channel (${currentChannelId}):`, err.message);
    try {
      const fallbackRes = await bot.api.sendMessage(currentChannelId, htmlMsg, { parse_mode: 'HTML' });
      console.log(`✅ Published prediction #${prediction.id} (fallback) to channel ${currentChannelId}, Msg ID: ${fallbackRes.message_id}`);
      return fallbackRes.message_id;
    } catch (e2: any) {
      console.error(`❌ Fallback post also failed:`, e2.message);
      return null;
    }
  }
};

/**
 * Edit/reply to channel post when result is recorded (WON / LOST)
 */
export const updateChannelPostResult = async (messageId: number, status: 'WON' | 'LOST' | 'VOID' | 'INTERRUPTED', resultScore?: string) => {
  if (!bot || !channelId || !messageId) return;

  const resultBadge = status === 'WON' ? '✅ WINNER / WON!'
    : status === 'LOST' ? '❌ MATCH LOST'
    : status === 'INTERRUPTED' ? '⏸ MATCH INTERRUPTED / POSTPONED'
    : '🔄 VOID / CANCELLED';

  const botUsernameEnv = (process.env.BOT_USERNAME || '').replace(/^@/, '').trim();
  const rawBotUsername = botUsernameEnv || 'admdinbetbetforbot';
  const webAppShortName = (process.env.WEBAPP_SHORT_NAME || 'app').trim();
  const targetUrl = `https://t.me/${rawBotUsername}/${webAppShortName}`;

  const keyboard = new InlineKeyboard().url('🚀 📱 View Live Stats in MiniApp', targetUrl);

  try {
    await bot.api.sendMessage(channelId, `📢 <b>MATCH RESULT CONFIRMED:</b>\n\n${resultBadge}${resultScore ? ` (<b>${escapeHtml(resultScore)}</b>)` : ''}\n\n📊 <i>Check updated win rates and upcoming picks in the MiniApp!</i>`, {
      reply_parameters: { message_id: messageId },
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  } catch (e: any) {
    console.warn('Could not reply result update to channel:', e.message);
  }
};

/**
 * Format and publish a batch results summary post to the Telegram Channel
 */
export const publishBatchSummaryToChannel = async (predictions: any[], customTitle?: string): Promise<number | null> => {
  const currentChannelId = (process.env.CHANNEL_ID || '').trim();

  if (!bot || !currentChannelId || !predictions || predictions.length === 0) return null;

  const wonCount = predictions.filter(p => p.status === 'WON').length;
  const lostCount = predictions.filter(p => p.status === 'LOST').length;
  const voidCount = predictions.filter(p => p.status === 'VOID' || p.status === 'INTERRUPTED').length;
  const totalSettled = wonCount + lostCount;
  const winRatePct = totalSettled > 0 ? Math.round((wonCount / totalSettled) * 100) : 0;

  const title = escapeHtml(customTitle || `📢 DAILY RESULTS RECAP · TENNIS AI STUDIO`);
  const botUsernameEnv = (process.env.BOT_USERNAME || '').replace(/^@/, '').trim();
  const rawBotUsername = botUsernameEnv || 'admdinbetbetforbot';
  const webAppShortName = (process.env.WEBAPP_SHORT_NAME || 'app').trim();
  const targetUrl = `https://t.me/${rawBotUsername}/${webAppShortName}`;

  const keyboard = new InlineKeyboard().url('🚀 🏆 Open MiniApp & Get Tomorrow Picks', targetUrl);

  let matchLines = '';
  predictions.forEach((p, idx) => {
    const badge = p.status === 'WON' ? '✅ WON' : p.status === 'LOST' ? '❌ LOST' : p.status === 'INTERRUPTED' ? '⏸ INTERRUPTED' : '🔄 VOID';
    const scoreStr = p.result_score ? ` (${escapeHtml(p.result_score)})` : '';
    const hName = escapeHtml(p.home_name || 'Home');
    const aName = escapeHtml(p.away_name || 'Away');
    const sel = escapeHtml(p.best_bet_selection || p.predicted_winner || 'Winner');

    matchLines += `${idx + 1}. <b>${hName} vs ${aName}</b>\n` +
                 `   👉 Pick: <code>${sel}</code> ${badge}${scoreStr}\n\n`;
  });

  const htmlMsg = 
    `🏆 <b>${title}</b>\n` +
    `────────────────────────\n` +
    `📊 <b>Daily Accuracy Summary:</b>\n` +
    `✅ <b>Wins:</b> ${wonCount} | ❌ <b>Losses:</b> ${lostCount}${voidCount > 0 ? ` | 🔄 <b>Void:</b> ${voidCount}` : ''}\n` +
    `🔥 <b>Accuracy / Win Rate:</b> <code>${winRatePct}%</code>\n` +
    `────────────────────────\n\n` +
    `${matchLines}` +
    `💡 <i>All live matches & tomorrow's VIP picks are available in the MiniApp!</i>`;

  try {
    const res = await bot.api.sendMessage(currentChannelId, htmlMsg, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
    console.log(`✅ Published batch summary to channel ${currentChannelId}, Msg ID: ${res.message_id}`);
    return res.message_id;
  } catch (err: any) {
    console.error(`❌ Failed to post batch summary to Telegram Channel:`, err.message);
    return null;
  }
};
