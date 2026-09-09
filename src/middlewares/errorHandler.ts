import { Request, Response, NextFunction } from 'express';
import { Logger } from '../utils/logger';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err) {
    Logger.warn(`[${req.method} ${req.originalUrl}] Malformed JSON in request body: ${err.message}`);
    return res.status(400).json({
      success: false,
      error: 'Malformed JSON payload. Please send valid standard JSON with double quotes.',
    });
  }

  Logger.error(`[${req.method} ${req.originalUrl}] Uncaught Exception:`, err.message || err);
  const status = err.status || 500;
  res.status(status).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
};
