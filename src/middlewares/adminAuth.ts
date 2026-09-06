import { timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { ENV, isAdminSecretUsable } from '../config/env';

const UNAUTHORIZED_MESSAGE = 'Unauthorized: Invalid or missing admin secret';

function secretsMatch(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(providedBuf, expectedBuf);
}

function extractProvidedSecret(req: Request): string {
  const querySecret = typeof req.query.secret === 'string' ? req.query.secret : '';
  const headerSecret = typeof req.headers['x-admin-secret'] === 'string' ? req.headers['x-admin-secret'] : '';
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  let bearerSecret = '';

  if (authHeader.startsWith('Bearer ')) {
    bearerSecret = authHeader.substring(7).trim();
  }

  const providedSecret = (querySecret || headerSecret || bearerSecret).trim();
  try {
    return decodeURIComponent(providedSecret).trim();
  } catch {
    return providedSecret;
  }
}

export const requireAdminAuth = (req: Request, res: Response, next: NextFunction) => {
  const configuredSecret = ENV.ADMIN_SECRET;

  if (!isAdminSecretUsable(configuredSecret)) {
    return res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
  }

  const providedSecret = extractProvidedSecret(req);
  if (!providedSecret || !secretsMatch(providedSecret, configuredSecret)) {
    return res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
  }

  return next();
};
