"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const env_1 = require("./config/env");
const schema_1 = require("./db/schema");
const migrations_1 = require("./db/migrations");
const cors_1 = require("./middlewares/cors");
const errorHandler_1 = require("./middlewares/errorHandler");
const routes_1 = require("./routes");
const go_routes_1 = require("./routes/go.routes");
const bot_1 = require("./bot");
const logger_1 = require("./utils/logger");
const app = (0, express_1.default)();
// Initialize DB schema & non-destructive migrations
(0, schema_1.initSchema)();
(0, migrations_1.runMigrations)();
// Attach middlewares
app.use(cors_1.corsMiddleware);
app.use(express_1.default.json({ limit: '15mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
// Attach routes
app.use('/', go_routes_1.goRoutes);
app.use('/', routes_1.apiRouter);
// Global error handler
app.use(errorHandler_1.errorHandler);
// Start server
app.listen(env_1.ENV.PORT, () => {
    logger_1.Logger.success(`🎾 Unified Tennis AI Backend running on port ${env_1.ENV.PORT} [${env_1.ENV.NODE_ENV}]`);
    logger_1.Logger.info(`🌐 Health check: ${env_1.ENV.PUBLIC_BASE_URL}/health`);
    // Start bot polling (non-fatal — bad token won't crash the HTTP server)
    try {
        (0, bot_1.startBot)();
    }
    catch (err) {
        logger_1.Logger.warn?.(`⚠️ Telegram bot failed to start: ${err}`);
    }
});
exports.default = app;
