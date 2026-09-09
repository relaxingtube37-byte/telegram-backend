import { Bot, InlineKeyboard } from 'grammy';
import { ENV } from '../config/env';
import { UsersRepo } from '../db/repositories/users.repo';
import { Logger } from '../utils/logger';

const isValidToken = Boolean(ENV.BOT_TOKEN && /^\d+:[A-Za-z0-9_-]{20,}$/.test(ENV.BOT_TOKEN));
export const bot = isValidToken ? new Bot(ENV.BOT_TOKEN) : null;

let cachedBotUsername: string | null = null;

export const setResolvedBotUsername = (username: string) => {
  if (username) {
    cachedBotUsername = username.replace(/^@/, '').trim();
  }
};

export const getResolvedBotUsername = (): string => {
  if (cachedBotUsername) return cachedBotUsername;
  return ENV.BOT_USERNAME || 'admdinbetbetforbot';
};

export const resolveWebAppUrl = (): string => {
  if (ENV.WEBAPP_DIRECT_URL) {
    let url = ENV.WEBAPP_DIRECT_URL.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    return url;
  }
  return 'https://www.ptin-ai.com';
};

if (bot) {
  bot.api.getMe().then(async (me) => {
    if (me?.username) {
      setResolvedBotUsername(me.username);
      Logger.info(`Verified Telegram bot username: @${me.username}`);
    }
    try {
      const webAppUrl = resolveWebAppUrl();
      if (webAppUrl && (webAppUrl.startsWith('http://') || webAppUrl.startsWith('https://')) && !webAppUrl.includes('t.me/')) {
        await bot.api.setChatMenuButton({
          menu_button: {
            type: 'web_app',
            text: '🚀 Tennis AI',
            web_app: { url: webAppUrl },
          },
        });
        Logger.info(`Configured persistent Telegram WebApp menu button -> ${webAppUrl}`);
      }
    } catch (e: any) {
      Logger.warn(`Menu button configuration warning: ${e.message}`);
    }
  }).catch(() => {});

  // Command /start
  bot.command('start', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (telegramId) {
      UsersRepo.touchActivity(telegramId);
    }

    const firstName = ctx.from?.first_name || 'Champion';
    const targetUrl = resolveWebAppUrl();
    const isDirectWeb = targetUrl.startsWith('http://') || targetUrl.startsWith('https://');
    const isTelegramShortLink = targetUrl.includes('t.me/');

    const keyboard = new InlineKeyboard();
    if (isDirectWeb && !isTelegramShortLink) {
      keyboard.webApp('🚀 🎾 Open Tennis AI Predictions', targetUrl);
    } else {
      keyboard.url('🚀 🎾 Open Tennis AI Predictions', targetUrl);
    }
    keyboard.row().url('📢 Join Official VIP Channel', `https://t.me/${ENV.CHANNEL_ID.replace('@', '')}`);

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
