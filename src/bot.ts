import { bot } from './services/telegram-bot.service';
import { ChannelPosterService } from './services/channel-poster.service';
import { ENV } from './config/env';
import { Logger } from './utils/logger';

export const startBot = async () => {
  if (bot && ENV.NODE_ENV === 'production' && ENV.BOT_TOKEN) {
    try {
      bot.start({
        onStart: (botInfo) => {
          Logger.success(`🤖 Telegram Bot started as @${botInfo.username}`);
        },
      }).catch((err: unknown) => {
        Logger.warn(`⚠️ Telegram bot polling error (server still running): ${err}`);
      });
    } catch (err) {
      Logger.warn(`⚠️ Telegram bot failed to start: ${err}`);
    }
  } else {
    Logger.info('Telegram bot polling skipped in development mode.');
  }
};

export { bot };
export const publishPredictionToChannel = ChannelPosterService.publishPrediction;
export const updateChannelPostResult = ChannelPosterService.updateResult;
export const publishBatchSummaryToChannel = ChannelPosterService.publishBatchSummary;
