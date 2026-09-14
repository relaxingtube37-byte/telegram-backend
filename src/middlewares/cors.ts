import cors from 'cors';
import { ENV } from '../config/env';

/**
 * Validates whether a request origin is allowed under strict security policy.
 */
function isOriginAllowed(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();

    // 1. Production domain & subdomains (e.g. ptin-ai.com, app.ptin-ai.com)
    if (hostname === 'ptin-ai.com' || hostname.endsWith('.ptin-ai.com')) {
      return true;
    }

    // 2. Vercel deployment domains (preview and production)
    if (hostname === 'vercel.app' || hostname.endsWith('.vercel.app')) {
      return true;
    }

    // 3. Official Telegram WebApp domains
    if (hostname === 'telegram.org' || hostname.endsWith('.telegram.org')) {
      return true;
    }

    // 4. Render backend/frontend hosting domains
    if (hostname === 'onrender.com' || hostname.endsWith('.onrender.com')) {
      return true;
    }

    // 5. Local development environments
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.localhost')
    ) {
      return true;
    }

    // 6. Explicit configured origins in ENV.CORS_ORIGIN
    const raw = (ENV.CORS_ORIGIN || '').trim();
    if (raw && raw !== '*') {
      const allowedList = raw
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
      if (allowedList.includes(origin) || allowedList.includes(hostname)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

export const corsMiddleware = cors({
  origin: (requestOrigin, callback) => {
    // Allow requests with no origin (curl, server-to-server postbacks, native iOS/Android Telegram Webview)
    if (!requestOrigin) {
      return callback(null, true);
    }

    if (isOriginAllowed(requestOrigin)) {
      return callback(null, true);
    }

    // Securely deny untrusted cross-origin requests
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
});

