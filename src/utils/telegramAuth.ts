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

/**
 * Validates Telegram Login Widget auth data using standard SHA256/HMAC-SHA256 protocol.
 * https://core.telegram.org/widgets/login#checking-authorization
 *
 * @param authData Dictionary of fields received from Telegram Login widget
 * @param botToken Bot token used to generate verification secret key
 * @param maxAgeSeconds Maximum age of auth_date in seconds (default: 86400 = 24 hours)
 */
export function validateTelegramWidgetAuth(
  authData: Record<string, any>,
  botToken: string,
  maxAgeSeconds: number = 86400
): { valid: boolean; error?: string; user?: TelegramInitDataUser } {
  if (!authData || typeof authData !== 'object') {
    return { valid: false, error: 'Missing auth data' };
  }

  const { hash, ...fields } = authData;
  if (!hash || typeof hash !== 'string') {
    return { valid: false, error: 'Missing or invalid hash in auth data' };
  }

  if (!botToken) {
    return { valid: false, error: 'BOT_TOKEN is not configured' };
  }

  const authDate = parseInt(String(fields.auth_date), 10);
  if (isNaN(authDate)) {
    return { valid: false, error: 'Invalid auth_date' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > maxAgeSeconds) {
    return { valid: false, error: 'Telegram login session expired' };
  }
  if (authDate > now + 300) {
    return { valid: false, error: 'Telegram login auth_date is in the future' };
  }

  // Construct data-check-string: sorted alphabetically by key, format key=value\n
  const checkArr: string[] = [];
  const keys = Object.keys(fields).sort();
  for (const key of keys) {
    const val = fields[key];
    if (val !== undefined && val !== null) {
      checkArr.push(`${key}=${val}`);
    }
  }
  const dataCheckString = checkArr.join('\n');

  // secret_key = SHA256(bot_token)
  const secretKey = crypto.createHash('sha256').update(botToken).digest();

  // calculated_hash = HMAC_SHA256(secret_key, data_check_string)
  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  const calcBuf = Buffer.from(calculatedHash, 'hex');
  const hashBuf = Buffer.from(hash, 'hex');

  if (calcBuf.length !== hashBuf.length || !crypto.timingSafeEqual(calcBuf, hashBuf)) {
    return { valid: false, error: 'Invalid Telegram widget auth signature' };
  }

  const userId = parseInt(String(fields.id), 10);
  if (isNaN(userId) || userId <= 0) {
    return { valid: false, error: 'Invalid user id' };
  }

  return {
    valid: true,
    user: {
      id: userId,
      first_name: fields.first_name ? String(fields.first_name) : undefined,
      last_name: fields.last_name ? String(fields.last_name) : undefined,
      username: fields.username ? String(fields.username) : undefined,
    },
  };
}

export interface WebSessionPayload {
  webId: string;
  telegramId?: number | null;
  createdAt: number;
}

/**
 * Creates an HMAC-SHA256 signed session token for web visitors.
 */
export function createWebSessionToken(payload: WebSessionPayload, secret: string): string {
  const dataStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(dataStr).digest('base64url');
  return `${dataStr}.${signature}`;
}

/**
 * Verifies an HMAC-SHA256 signed web session token.
 */
export function verifyWebSessionToken(
  token: string | undefined | null,
  secret: string,
  maxAgeMs: number = 30 * 24 * 60 * 60 * 1000
): { valid: boolean; payload?: WebSessionPayload; error?: string } {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Missing token' };
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Malformed token structure' };
  }

  const [dataStr, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', secret).update(dataStr).digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, error: 'Invalid token signature' };
  }

  try {
    const payloadJson = Buffer.from(dataStr, 'base64url').toString('utf8');
    const payload: WebSessionPayload = JSON.parse(payloadJson);
    if (!payload || !payload.webId || !payload.createdAt) {
      return { valid: false, error: 'Invalid payload structure' };
    }
    if (Date.now() - payload.createdAt > maxAgeMs) {
      return { valid: false, error: 'Web session token expired' };
    }
    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: `Failed to decode token payload: ${err.message}` };
  }
}

