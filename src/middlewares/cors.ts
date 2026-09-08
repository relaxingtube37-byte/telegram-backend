import cors from 'cors';
import { ENV } from '../config/env';

export const corsMiddleware = cors({
  origin: (requestOrigin, callback) => {
    // Allow requests with no origin (curl, server-to-server, native mobile)
    if (!requestOrigin) {
      return callback(null, true);
    }

    const raw = (ENV.CORS_ORIGIN || '*').trim();
    if (raw === '*' || raw === 'true') {
      return callback(null, true);
    }

    const allowed = raw.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    if (allowed.includes('*') || allowed.includes(requestOrigin)) {
      return callback(null, true);
    }

    // Always permit Telegram webviews, localhost, and render domains
    if (
      requestOrigin.endsWith('.telegram.org') ||
      requestOrigin.endsWith('.onrender.com') ||
      requestOrigin.includes('localhost')
    ) {
      return callback(null, true);
    }

    // Permissive fallback so MiniApp clients are never blocked
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-admin-secret',
    'x-telegram-init-data',
    'x-ptin-session',
  ],
  credentials: true,
});
