import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3001', 10),
  BOT_TOKEN: (process.env.BOT_TOKEN || '').trim(),
  CHANNEL_ID: (process.env.CHANNEL_ID || '').trim(),
  BOT_USERNAME: (process.env.BOT_USERNAME || '').replace(/^@/, '').trim() || 'admdinbetbetforbot',
  WEBAPP_SHORT_NAME: (process.env.WEBAPP_SHORT_NAME || 'app').trim(),
  ADMIN_SECRET: (process.env.ADMIN_SECRET || 'state_tennis_secret_2026').trim(),
  PUBLIC_BASE_URL: (process.env.PUBLIC_BASE_URL || 'https://telegram-backend-2yck.onrender.com').trim().replace(/\/+$/, ''),
  DATABASE_FILE: process.env.DATABASE_FILE || path.join(process.cwd(), 'data', 'database.sqlite'),
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  RAPIDAPI_KEY: (process.env.RAPIDAPI_KEY || '3b98e0a4e3mshfb887513c847f6bp1602e4jsnaa6342ccddfa').trim(),
};