import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

/** Previously used defaults or example values — never accept as valid admin credentials. */
export const KNOWN_WEAK_ADMIN_SECRETS = [
  'admin123',
  'state_tennis_secret_2026',
  'sofascore-tennis-admin-secret-2026',
  'change-this-secret-key-12345',
  'ptin-local-dev-admin-key',
] as const;

const WEAK_ADMIN_SECRET_SET = new Set<string>(KNOWN_WEAK_ADMIN_SECRETS);

export function isAdminSecretUsable(secret: string): boolean {
  const trimmed = secret.trim();
  if (!trimmed) return false;
  if (WEAK_ADMIN_SECRET_SET.has(trimmed)) return false;
  if (trimmed.length < 12) return false;
  return true;
}

export function validateSecurityEnvironment(): void {
  const isProd = (process.env.NODE_ENV || 'development') === 'production';
  if (isProd) {
    const adminSec = (process.env.ADMIN_SECRET || '').trim();
    if (!isAdminSecretUsable(adminSec)) {
      console.error(
        '\n🚨 [SECURITY FATAL] Running in PRODUCTION with a missing, weak, or default ADMIN_SECRET!' +
        '\n🚨 All /api/admin endpoints will reject requests until a strong secret (>= 12 characters) is configured in your Render environment variables.\n'
      );
    }
    if (!process.env.BOT_TOKEN) {
      console.warn(
        '\n⚠️ [SECURITY WARNING] Running in PRODUCTION without BOT_TOKEN configured. Telegram bot services will not start.\n'
      );
    }
  }
}

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '8080', 10),
  BOT_TOKEN: (process.env.BOT_TOKEN || '').trim(),
  CHANNEL_ID: (process.env.CHANNEL_ID || '').trim(),
  CHANNEL_TITLE: (process.env.CHANNEL_TITLE || process.env.CHANNEL_NAME || '').trim(),
  CHANNEL_URL: (process.env.CHANNEL_URL || '').trim(),
  BOT_USERNAME: ((process.env.BOT_USERNAME || '').replace(/^@/, '').trim() && (process.env.BOT_USERNAME || '').replace(/^@/, '').trim() !== 'tennis_prediction_bot') 
    ? (process.env.BOT_USERNAME || '').replace(/^@/, '').trim() 
    : 'admdinbetbetforbot',
  WEBAPP_SHORT_NAME: (process.env.WEBAPP_SHORT_NAME || 'app').trim(),
  WEBAPP_DIRECT_URL: (process.env.WEBAPP_DIRECT_URL || process.env.WEBAPP_URL || '').trim(),
  ADMIN_SECRET: (process.env.ADMIN_SECRET || '').trim(),
  PUBLIC_BASE_URL: (process.env.PUBLIC_BASE_URL || 'https://telegram-backend-2yck.onrender.com').trim().replace(/\/+$/, ''),
  DATABASE_FILE:
    process.env.DATABASE_FILE ||
    process.env.DATABASE_PATH ||
    path.join(process.cwd(), 'data', 'database.sqlite'),
  BACKUP_DIR:
    process.env.BACKUP_DIR ||
    path.join(
      path.dirname(
        process.env.DATABASE_FILE ||
          process.env.DATABASE_PATH ||
          path.join(process.cwd(), 'data', 'database.sqlite')
      ),
      'backups'
    ),
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  RAPIDAPI_KEY: (process.env.RAPIDAPI_KEY || '3b98e0a4e3mshfb887513c847f6bp1602e4jsnaa6342ccddfa').trim(),
  ALLSPORTS_API_KEY: (process.env.ALLSPORTS_API_KEY || '').trim(),
  LOCAL_TENNIS_DATA_DIR: (process.env.LOCAL_TENNIS_DATA_DIR || '').trim(),
  DEFAULT_AFFILIATE_URL: (process.env.DEFAULT_AFFILIATE_URL || process.env.AFFILIATE_1WIN_URL || 'https://r1whtrt.life/betting?open=register&p=5ccv').trim(),
  NEON_DATABASE_URL: (process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || '').trim(),
};

