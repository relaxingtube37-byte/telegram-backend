import express from 'express';
import { ENV } from './config/env';
import { initSchema } from './db/schema';
import { runMigrations } from './db/migrations';
import { corsMiddleware } from './middlewares/cors';
import { errorHandler } from './middlewares/errorHandler';
import { apiRouter } from './routes';
import { goRoutes } from './routes/go.routes';
import { startBot } from './bot';
import { Logger } from './utils/logger';

const app = express();

// Initialize DB schema & non-destructive migrations
initSchema();
runMigrations();

// Attach middlewares
app.use(corsMiddleware);
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));

// Attach routes
app.use('/', goRoutes);
app.use('/', apiRouter);

// Global error handler
app.use(errorHandler);

// Start server
app.listen(ENV.PORT, () => {
  Logger.success(`🎾 Unified Tennis AI Backend running on port ${ENV.PORT} [${ENV.NODE_ENV}]`);
  Logger.info(`🌐 Health check: ${ENV.PUBLIC_BASE_URL}/health`);
  
  // Start bot polling
  startBot();
});

export default app;
