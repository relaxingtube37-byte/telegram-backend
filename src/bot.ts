import { Bot, InlineKeyboard } from 'grammy';
import dotenv from 'dotenv';
import { db } from './db';

dotenv.config();

const botToken = process.env.BOT_TOKEN || '';
const channelId = process.env.CHANNEL_ID || '';
const webAppUrl = (process.env.WEBAPP_URL || 'https://telegram-webapp-hd6g.onrender.com').trim();

export const bot = botToken && !botToken.includes('example') ? new Bot(botToken) : null;

if (bot) {
  // Setup Bot commands
  bot.command('start', async (ctx) => {
    const from = ctx.from;
    if (from) {
      // Save or update user
      const existing = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(from.id);
      if (!existing) {
        db.prepare(`
          INSERT INTO users (telegram_id, username, first_name, created_at)
          VALUES (?, ?, ?, ?)
        `).run(from.id, from.username || null, from.first_name || null, new Date().toISOString());
      }
    }

    const keyboard = new InlineKeyboard().webApp('🚀 Open Tennis AI Predictions', webAppUrl);

    await ctx.reply(
      `👋 <b>Welcome to Tennis AI Predictions!</b>\n\n` +
      `🎾 High-precision AI Tennis Match Predictions & Value Betting Recommendations.\n\n` +
      `Click the button below to launch the Telegram Web App:`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  });

  bot.catch((err) => {
    console.error('Telegram Bot Error:', err.message);
  });

  bot.start({
    onStart: (info) => console.log(`🤖 Telegram Bot @${info.username} started successfully!`),
  }).catch((err) => console.warn('Telegram Bot start warning:', err.message));
} else {
  console.warn('⚠ TELEGRAM BOT_TOKEN not configured or placeholder token used. Bot commands disabled until token is set.');
}

/**
 * Format and publish a prediction card to the Telegram Channel
 */
export const publishPredictionToChannel = async (prediction: any): Promise<number | null> => {
  const currentChannelId = (process.env.CHANNEL_ID || '').trim();
  const currentWebAppUrl = (process.env.WEBAPP_URL || '').trim();

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

  const rawBotUsername = (process.env.BOT_USERNAME || 'admdinbetbetforbot').replace(/^@/, '').trim();
  let targetUrl = currentWebAppUrl.trim();

  if (!targetUrl || !targetUrl.startsWith('http')) {
    if (rawBotUsername) {
      targetUrl = `https://t.me/${rawBotUsername}/app`;
    } else {
      targetUrl = 'https://t.me';
    }
  }

  if (targetUrl.startsWith('http://')) {
    targetUrl = targetUrl.replace('http://', 'https://');
  }

  console.log(`[POST TO CHANNEL] Target Channel: ${currentChannelId}, Button URL: ${targetUrl}`);
  const keyboard = new InlineKeyboard().url('🚀 Open Full Analysis in WebApp', targetUrl);

  const htmlMsg = 
    `🎾 <b>AI TENNIS MATCH PREDICTION</b>\n` +
    `🏆 <b>${prediction.tournament_name || 'Tennis Tournament'}</b> (${surfaceEmoji})\n` +
    `----------------------------------------\n` +
    `⚔ <b>${prediction.home_name} vs ${prediction.away_name}</b>\n\n` +
    `🎯 <b>Predicted Winner:</b> <code>${prediction.predicted_winner}</code> (${prediction.win_probability || 65}%)\n` +
    `📊 <b>Predicted Score:</b> ${prediction.predicted_score || '2:1'}\n` +
    `🔒 <b>Confidence:</b> ${prediction.confidence || 'HIGH'}\n\n` +
    `🔥 <b>RECOMMENDED VALUE BET:</b>\n` +
    `👉 <b>${prediction.best_bet_selection || prediction.predicted_winner}</b>\n` +
    `📌 <i>Market: ${prediction.best_bet_market || 'Full Time Winner'}</i>\n` +
    (prediction.best_bet_rationale ? `💬 "${prediction.best_bet_rationale}"\n` : '') +
    (prediction.alt_bet_selection ? `\n🛡 <b>Option Bet:</b> ${prediction.alt_bet_selection} (${prediction.alt_bet_market})\n` : '') +
    `----------------------------------------\n` +
    `💡 <i>Check full physical & environmental deltas in our WebApp!</i>`;

  try {
    const res = await bot.api.sendMessage(currentChannelId, htmlMsg, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
    console.log(`✅ Published prediction #${prediction.id} to channel ${currentChannelId}, Msg ID: ${res.message_id}`);
    return res.message_id;
  } catch (err: any) {
    console.error(`❌ Failed to post to Telegram Channel (${currentChannelId}):`, err.message);
    try {
      const fallbackRes = await bot.api.sendMessage(currentChannelId, htmlMsg, { parse_mode: 'HTML' });
      console.log(`✅ Published prediction #${prediction.id} (fallback without keyboard) to channel ${currentChannelId}, Msg ID: ${fallbackRes.message_id}`);
      return fallbackRes.message_id;
    } catch (e2: any) {
      console.error(`❌ Fallback post also failed:`, e2.message);
      return null;
    }
  }
};

/**
 * Edit channel post when result is recorded (WON / LOST)
 */
export const updateChannelPostResult = async (messageId: number, status: 'WON' | 'LOST' | 'VOID', resultScore?: string) => {
  if (!bot || !channelId || !messageId) return;

  const resultBadge = status === 'WON' ? '✅ WINNER / WON!'
    : status === 'LOST' ? '❌ MATCH LOST' : '🔄 VOID / CANCELLED';

  try {
    // Reply to the channel post with result announcement
    await bot.api.sendMessage(channelId, `📢 <b>MATCH RESULT UPDATE:</b>\n\n${resultBadge}${resultScore ? ` (${resultScore})` : ''}`, {
      reply_parameters: { message_id: messageId },
      parse_mode: 'HTML',
    });
  } catch (e: any) {
    console.warn('Could not reply result update to channel:', e.message);
  }
};
