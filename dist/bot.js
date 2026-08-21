"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishBatchSummaryToChannel = exports.updateChannelPostResult = exports.publishPredictionToChannel = exports.bot = exports.startBot = void 0;
const telegram_bot_service_1 = require("./services/telegram-bot.service");
Object.defineProperty(exports, "bot", { enumerable: true, get: function () { return telegram_bot_service_1.bot; } });
const channel_poster_service_1 = require("./services/channel-poster.service");
const logger_1 = require("./utils/logger");
const startBot = async () => {
    if (telegram_bot_service_1.bot) {
        telegram_bot_service_1.bot.start({
            onStart: (botInfo) => {
                logger_1.Logger.success(`🤖 Telegram Bot started as @${botInfo.username}`);
            },
        }).catch((err) => {
            logger_1.Logger.warn(`⚠️ Telegram bot polling error (server still running): ${err}`);
        });
    }
    else {
        logger_1.Logger.warn('Telegram bot is not running (BOT_TOKEN is missing or empty)');
    }
};
exports.startBot = startBot;
exports.publishPredictionToChannel = channel_poster_service_1.ChannelPosterService.publishPrediction;
exports.updateChannelPostResult = channel_poster_service_1.ChannelPosterService.updateResult;
exports.publishBatchSummaryToChannel = channel_poster_service_1.ChannelPosterService.publishBatchSummary;
