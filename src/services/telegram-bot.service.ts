import { Bot, InlineKeyboard } from 'grammy';
import { ENV } from '../config/env';
import { UsersRepo } from '../db/repositories/users.repo';
import { Logger } from '../utils/logger';

export const bot = ENV.BOT_TOKEN ? new Bot(ENV.BOT_TOKEN) : null;

if (bot) {
  // Command /start
  bot.command('start', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (telegramId) {
      UsersRepo.touchActivity(telegramId);
    }

    const firstName = ctx.from?.first_name || 'Champion';
    const targetUrl = `https://t.me/${ENV.BOT_USERNAME}/${ENV.WEBAPP_SHORT_NAME}`;

    const keyboard = new InlineKeyboard()
      .url('🚀 🎾 Open Tennis AI Predictions', targetUrl)
      .row()
      .url('📢 Join Official VIP Channel', `https://t.me/${ENV.CHANNEL_ID.replace('@', '')}`);

    const welcomeMsg = 
      `👋 <b>Welcome to State Football — Tennis AI Studio, ${firstName}!</b>

` +
      `🎾 <i>Your autonomous 5-agent AI engine for elite tennis match predictions & value bets.</i>

` +
      `• <b>Real-time mathematical probability</b>
` +
      `• <b>+EV Value bets & Shin de-vig pricing</b>
` +
      `• <b>38-metric tactical & fatigue breakdown</b>

` +
      `👇 <b>Tap the button below to launch the MiniApp:</b>`;

    await ctx.reply(welcomeMsg, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  });

  bot.catch((err) => {
    Logger.error('Telegram Bot Error:', err.message);
  });
}
