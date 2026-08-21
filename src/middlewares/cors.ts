import cors from 'cors';
import { ENV } from '../config/env';

export const corsMiddleware = cors({
  origin: ENV.CORS_ORIGIN === '*' ? true : ENV.CORS_ORIGIN.split(','),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-secret', 'x-telegram-init-data'],
  credentials: true,
});
