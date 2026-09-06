import express from 'express';
import { ENV } from './config/env';
import { corsMiddleware } from './middlewares/cors';
import { errorHandler } from './middlewares/errorHandler';
import { apiRouter } from './routes';
import { goRoutes } from './routes/go.routes';
import { startBot } from './bot';
import { ResultSettlerService } from './services/result-settler.service';
import { PrecomputationService } from './services/precomputation.service';
import { Logger } from './utils/logger';

const app = express();

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
app.listen(ENV.PORT, '0.0.0.0', () => {
  Logger.success(`🎾 Unified Tennis AI Backend running on port ${ENV.PORT} [${ENV.NODE_ENV}]`);
  Logger.info(`🌐 Health check: ${ENV.PUBLIC_BASE_URL}/health`);
  
  // Bot polling (non-fatal)
  try {
    startBot();
  } catch (err) {
    Logger.warn?.(`⚠️ Telegram bot failed to start: ${err}`);
  }

  // Auto Result Settler (non-fatal)
  try {
    ResultSettlerService.start();
  } catch (err) {
    Logger.warn?.(`⚠️ Result Settler service failed to start: ${err}`);
  }
});

export default app;
