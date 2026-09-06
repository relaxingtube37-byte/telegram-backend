import crypto from 'crypto';
import { ENV } from '../config/env';
import { Logger } from './logger';

export interface TelegramInitDataUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface ValidatedTelegramSession {
  valid: boolean;
  user?: TelegramInitDataUser;
  authDate?: number;
  error?: string;
}

/**
 * Generates an authentically signed Telegram WebApp initData string.
 * Used for integration testing and automated verification.
 */
export function signTelegramInitData(
  user: TelegramInitDataUser,
  botToken: string,
  authDate: number = Math.floor(Date.now() / 1000)
): string {
  const params = new URLSearchParams();
  params.set('auth_date', String(authDate));
  params.set('user', JSON.stringify(user));

  const keys = Array.from(params.keys()).sort();
  const dataCheckString = keys.map((k) => `${k}=${params.get(k)}`).join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  params.set('hash', calculatedHash);
  return params.toString();
}

/**
 * Validates Telegram WebApp initData string using standard HMAC-SHA256 protocol.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * @param initDataString Raw initData string received from Telegram WebApp
 * @param maxAgeSeconds Maximum age of auth_date in seconds (default: 86400 = 24 hours)
 */
export function validateTelegramInitData(
  initDataString: string,
  maxAgeSeconds: number = 86400
): ValidatedTelegramSession {
  if (!initDataString || typeof initDataString !== 'string') {
    return { valid: false, error: 'Missing initData string' };
  }

  // Allow explicit mock token during automated unit tests
  if (process.env.NODE_ENV === 'test' && initDataString.startsWith('mock_test_init_data:')) {
    try {
      const parts = initDataString.split(':');
      const userId = parseInt(parts[1], 10);
      const username = parts[2] || 'testuser';
      return {
        valid: true,
        user: { id: userId, username, first_name: 'Test' },
        authDate: Math.floor(Date.now() / 1000),
      };
    } catch {
      return { valid: false, error: 'Invalid test mock initData' };
    }
  }

  const botToken = ENV.BOT_TOKEN;
  if (!botToken) {
    Logger.error('Cannot validate initData: BOT_TOKEN is not configured');
    return { valid: false, error: 'Server misconfiguration: BOT_TOKEN missing' };
  }

  try {
    const params = new URLSearchParams(initDataString);
    const hash = params.get('hash');
    if (!hash) {
      return { valid: false, error: 'Missing hash parameter in initData' };
    }

    params.delete('hash');

    // Sort keys alphabetically and construct check string
    const keys = Array.from(params.keys()).sort();
    const dataCheckString = keys.map((k) => `${k}=${params.get(k)}`).join('\n');

    // 1. secret_key = HMAC_SHA256("WebAppData", bot_token)
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    // 2. calculated_hash = HMAC_SHA256(secret_key, data_check_string)
    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    // 3. Constant-time hash comparison
    const calcBuf = Buffer.from(calculatedHash, 'hex');
    const hashBuf = Buffer.from(hash, 'hex');

    if (calcBuf.length !== hashBuf.length || !crypto.timingSafeEqual(calcBuf, hashBuf)) {
      return { valid: false, error: 'Invalid HMAC signature' };
    }

    // 4. Freshness check: verify auth_date
    const authDateStr = params.get('auth_date');
    if (!authDateStr) {
      return { valid: false, error: 'Missing auth_date in initData' };
    }

    const authDate = parseInt(authDateStr, 10);
    const now = Math.floor(Date.now() / 1000);

    if (isNaN(authDate)) {
      return { valid: false, error: 'Invalid auth_date format' };
    }

    if (now - authDate > maxAgeSeconds) {
      return { valid: false, error: 'Telegram initData session expired (auth_date too old)' };
    }

    if (authDate > now + 300) {
      return { valid: false, error: 'Telegram initData auth_date is in the future' };
    }

    // 5. Parse authenticated user
    const userRaw = params.get('user');
    let user: TelegramInitDataUser | null = null;
    if (userRaw) {
      user = JSON.parse(userRaw);
    }

    if (!user || !user.id || typeof user.id !== 'number') {
      return { valid: false, error: 'Missing or invalid user object in initData' };
    }

    return {
      valid: true,
      user,
      authDate,
    };
  } catch (err: any) {
    return { valid: false, error: `Failed to parse initData: ${err.message}` };
  }
}
