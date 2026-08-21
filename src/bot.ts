import { bot } from './services/telegram-bot.service';
import { ChannelPosterService } from './services/channel-poster.service';
import { Logger } from './utils/logger';

export const startBot = async () => {
  if (bot) {
    bot.start({
      onStart: (botInfo) => {
        Logger.success(`🤖 Telegram Bot started as @${botInfo.username}`);
      },
    });
  } else {
    Logger.warn('Telegram bot is not running (BOT_TOKEN is missing or empty)');
  }
};

export { bot };
export const publishPredictionToChannel = ChannelPosterService.publishPrediction;
export const updateChannelPostResult = ChannelPosterService.updateResult;
export const publishBatchSummaryToChannel = ChannelPosterService.publishBatchSummary;
