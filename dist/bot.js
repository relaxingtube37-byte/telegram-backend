"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishBatchSummaryToChannel = exports.updateChannelPostResult = exports.publishPredictionToChannel = exports.bot = void 0;
const grammy_1 = require("grammy");
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = require("./db");
dotenv_1.default.config();
const botToken = process.env.BOT_TOKEN || '';
const channelId = process.env.CHANNEL_ID || '';
const webAppUrl = (process.env.WEBAPP_URL || 'https://telegram-webapp-hd6g.onrender.com').trim();
exports.bot = botToken && !botToken.includes('example') ? new grammy_1.Bot(botToken) : null;
if (exports.bot) {
    // Setup Bot commands
    exports.bot.command('start', async (ctx) => {
        const from = ctx.from;
        if (from) {
            // Save or update user
            const existing = db_1.db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(from.id);
            if (!existing) {
                db_1.db.prepare(`
          INSERT INTO users (telegram_id, username, first_name, created_at)
          VALUES (?, ?, ?, ?)
        `).run(from.id, from.username || null, from.first_name || null, new Date().toISOString());
            }
        }
        const keyboard = new grammy_1.InlineKeyboard().webApp('🚀 Open Tennis AI Predictions', webAppUrl);
        await ctx.reply(`👋 <b>Welcome to Tennis AI Predictions!</b>\n\n` +
            `🎾 High-precision AI Tennis Match Predictions & Value Betting Recommendations.\n\n` +
            `Click the button below to launch the Telegram Web App:`, { parse_mode: 'HTML', reply_markup: keyboard });
    });
    exports.bot.catch((err) => {
        console.error('Telegram Bot Error:', err.message);
    });
    exports.bot.start({
        onStart: async (info) => {
            console.log(`🤖 Telegram Bot @${info.username} started successfully!`);
            try {
                await exports.bot.api.setMyCommands([
                    { command: 'start', description: '🚀 Launch Tennis AI WebApp' },
                ]);
                if (webAppUrl && webAppUrl.startsWith('http')) {
                    await exports.bot.api.setChatMenuButton({
                        menu_button: {
                            type: 'web_app',
                            text: '🚀 Open WebApp',
                            web_app: { url: webAppUrl },
                        },
                    });
                    console.log(`✅ Auto-configured persistent Telegram Menu Button -> ${webAppUrl}`);
                }
            }
            catch (e) {
                console.warn('⚠ Bot menu configuration warning:', e.message);
            }
        },
    }).catch((err) => console.warn('Telegram Bot start warning:', err.message));
}
else {
    console.warn('⚠ TELEGRAM BOT_TOKEN not configured or placeholder token used. Bot commands disabled until token is set.');
}
/**
 * Format and publish a prediction card to the Telegram Channel
 */
const publishPredictionToChannel = async (prediction, isTeaser = true) => {
    const currentChannelId = (process.env.CHANNEL_ID || '').trim();
    if (!exports.bot) {
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
    // Format Telegram Direct Mini App Link: https://t.me/BotUsername/app
    // When configured in @BotFather via /newapp, Telegram opens this natively as a WebApp overlay inside Telegram!
    const targetUrl = `https://t.me/${rawBotUsername}/${webAppShortName}?startapp=pred_${prediction.id}`;
    console.log(`[POST TO CHANNEL] Target Channel: ${currentChannelId}, Direct MiniApp URL: ${targetUrl}, TeaserMode: ${isTeaser}`);
    const keyboard = new grammy_1.InlineKeyboard().url('🚀 Open Full Analysis in WebApp', targetUrl);
    let htmlMsg = '';
    if (isTeaser) {
        // Teaser Mode
        htmlMsg =
            `🔥 <b>NEW AI MATCH PREDICTION AVAILABLE!</b>\n` +
                `🏆 <b>${escapeHtml(prediction.tournament_name || 'Tennis Tournament')}</b> (${surfaceEmoji})\n` +
                `----------------------------------------\n` +
                `⚔ <b>${escapeHtml(prediction.home_name)} vs ${escapeHtml(prediction.away_name)}</b>\n\n` +
                `📊 <b>AI Analysis & Value Bet:</b> READY ✅\n` +
                `🔒 <b>Confidence Level:</b> <code>${escapeHtml(prediction.confidence || 'HIGH')}</code>\n\n` +
                `💡 <i>To view the predicted winner, best odds, and full AI rationale, tap the button below!</i>`;
    }
    else {
        // Full Details Mode
        htmlMsg =
            `🎾 <b>AI TENNIS MATCH PREDICTION</b>\n` +
                `🏆 <b>${escapeHtml(prediction.tournament_name || 'Tennis Tournament')}</b> (${surfaceEmoji})\n` +
                `----------------------------------------\n` +
                `⚔ <b>${escapeHtml(prediction.home_name)} vs ${escapeHtml(prediction.away_name)}</b>\n\n` +
                `🎯 <b>Predicted Winner:</b> <code>${escapeHtml(prediction.predicted_winner)}</code> (${prediction.win_probability || 65}%)\n` +
                `📊 <b>Predicted Score:</b> ${escapeHtml(prediction.predicted_score || '2:1')}\n` +
                `🔒 <b>Confidence:</b> ${escapeHtml(prediction.confidence || 'HIGH')}\n\n` +
                `🔥 <b>RECOMMENDED VALUE BET:</b>\n` +
                `👉 <b>${escapeHtml(prediction.best_bet_selection || prediction.predicted_winner)}</b>\n` +
                `📌 <i>Market: ${escapeHtml(prediction.best_bet_market || 'Full Time Winner')}</i>\n` +
                (prediction.best_bet_rationale ? `💬 "${escapeHtml(prediction.best_bet_rationale)}"\n` : '') +
                (prediction.alt_bet_selection ? `\n🛡 <b>Option Bet:</b> ${escapeHtml(prediction.alt_bet_selection)} (${escapeHtml(prediction.alt_bet_market)})\n` : '') +
                `----------------------------------------\n` +
                `💡 <i>Check full physical & environmental deltas in our WebApp!</i>`;
    }
    try {
        const res = await exports.bot.api.sendMessage(currentChannelId, htmlMsg, {
            parse_mode: 'HTML',
            reply_markup: keyboard,
        });
        console.log(`✅ Published prediction #${prediction.id} (Teaser: ${isTeaser}) to channel ${currentChannelId}, Msg ID: ${res.message_id}`);
        return res.message_id;
    }
    catch (err) {
        console.error(`❌ Failed to post to Telegram Channel (${currentChannelId}):`, err.message);
        try {
            const fallbackRes = await exports.bot.api.sendMessage(currentChannelId, htmlMsg, { parse_mode: 'HTML' });
            console.log(`✅ Published prediction #${prediction.id} (fallback without keyboard) to channel ${currentChannelId}, Msg ID: ${fallbackRes.message_id}`);
            return fallbackRes.message_id;
        }
        catch (e2) {
            console.error(`❌ Fallback post also failed:`, e2.message);
            return null;
        }
    }
};
exports.publishPredictionToChannel = publishPredictionToChannel;
/**
 * Edit channel post when result is recorded (WON / LOST)
 */
const updateChannelPostResult = async (messageId, status, resultScore) => {
    if (!exports.bot || !channelId || !messageId)
        return;
    const resultBadge = status === 'WON' ? '✅ WINNER / WON!'
        : status === 'LOST' ? '❌ MATCH LOST'
            : status === 'INTERRUPTED' ? '⏸ GAME INTERRUPTED / PAUSED'
                : '🔄 VOID / CANCELLED';
    const botUsernameEnv = (process.env.BOT_USERNAME || '').replace(/^@/, '').trim();
    const rawBotUsername = botUsernameEnv || 'admdinbetbetforbot';
    const webAppShortName = (process.env.WEBAPP_SHORT_NAME || 'app').trim();
    const targetUrl = `https://t.me/${rawBotUsername}/${webAppShortName}`;
    const keyboard = new grammy_1.InlineKeyboard().url('🚀 Open Full Analysis in WebApp', targetUrl);
    try {
        // Reply to the channel post with result announcement & WebApp button
        await exports.bot.api.sendMessage(channelId, `📢 <b>MATCH RESULT UPDATE:</b>\n\n${resultBadge}${resultScore ? ` (${escapeHtml(resultScore)})` : ''}`, {
            reply_parameters: { message_id: messageId },
            parse_mode: 'HTML',
            reply_markup: keyboard,
        });
    }
    catch (e) {
        console.warn('Could not reply result update to channel:', e.message);
    }
};
exports.updateChannelPostResult = updateChannelPostResult;
const escapeHtml = (str) => {
    if (!str)
        return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
};
/**
 * Format and publish a batch results summary post to the Telegram Channel
 */
const publishBatchSummaryToChannel = async (predictions, customTitle) => {
    const currentChannelId = (process.env.CHANNEL_ID || '').trim();
    if (!exports.bot || !currentChannelId || !predictions || predictions.length === 0)
        return null;
    const wonCount = predictions.filter(p => p.status === 'WON').length;
    const lostCount = predictions.filter(p => p.status === 'LOST').length;
    const voidCount = predictions.filter(p => p.status === 'VOID' || p.status === 'INTERRUPTED').length;
    const totalSettled = wonCount + lostCount;
    const winRatePct = totalSettled > 0 ? Math.round((wonCount / totalSettled) * 100) : 0;
    const title = escapeHtml(customTitle || `📢 DAILY RESULTS RECAP & SUMMARY`);
    const botUsernameEnv = (process.env.BOT_USERNAME || '').replace(/^@/, '').trim();
    const rawBotUsername = botUsernameEnv || 'admdinbetbetforbot';
    const webAppShortName = (process.env.WEBAPP_SHORT_NAME || 'app').trim();
    const targetUrl = `https://t.me/${rawBotUsername}/${webAppShortName}`;
    const keyboard = new grammy_1.InlineKeyboard().url('🚀 Open Full Analysis in WebApp', targetUrl);
    let matchLines = '';
    predictions.forEach((p, idx) => {
        const badge = p.status === 'WON' ? '✅ WON' : p.status === 'LOST' ? '❌ LOST' : p.status === 'INTERRUPTED' ? '⏸ INTERRUPTED' : '🔄 VOID';
        const scoreStr = p.result_score ? ` (${escapeHtml(p.result_score)})` : '';
        const hName = escapeHtml(p.home_name || 'Home');
        const aName = escapeHtml(p.away_name || 'Away');
        const sel = escapeHtml(p.best_bet_selection || p.predicted_winner || 'Winner');
        matchLines += `${idx + 1}. <b>${hName} vs ${aName}</b>\n` +
            `   👉 Bet: <code>${sel}</code> ${badge}${scoreStr}\n\n`;
    });
    const htmlMsg = `🏆 <b>${title}</b>\n` +
        `----------------------------------------\n` +
        `📊 <b>Performance Stats:</b>\n` +
        `✅ <b>Wins:</b> ${wonCount} | ❌ <b>Losses:</b> ${lostCount}${voidCount > 0 ? ` | 🔄 <b>Void:</b> ${voidCount}` : ''}\n` +
        `🔥 <b>Accuracy / Win Rate:</b> <code>${winRatePct}%</code>\n` +
        `----------------------------------------\n\n` +
        `${matchLines}` +
        `💡 <i>Check complete match history and detailed stats in our WebApp!</i>`;
    try {
        const res = await exports.bot.api.sendMessage(currentChannelId, htmlMsg, {
            parse_mode: 'HTML',
            reply_markup: keyboard,
        });
        console.log(`✅ Published batch summary to channel ${currentChannelId}, Msg ID: ${res.message_id}`);
        return res.message_id;
    }
    catch (err) {
        console.error(`❌ Failed to post batch summary to Telegram Channel:`, err.message);
        return null;
    }
};
exports.publishBatchSummaryToChannel = publishBatchSummaryToChannel;
