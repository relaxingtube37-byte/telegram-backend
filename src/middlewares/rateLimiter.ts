import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';
import { ENV, isAdminSecretUsable } from '../config/env';

/**
 * Checks if the request carries a cryptographically valid ADMIN_SECRET.
 * If valid, the request originates from an authorized tool (e.g. State Football engine)
 * and bypasses rate limits to allow high-throughput sync and control.
 */
export function isAuthorizedAdminRequest(req: Request): boolean {
  const configured = (ENV.ADMIN_SECRET || '').trim();
  if (!configured || !isAdminSecretUsable(configured)) return false;

  const headerSecret = (req.headers['x-admin-secret'] || '').toString().trim();
  const authHeader = (req.headers.authorization || '').toString().trim();
  const bearerSecret = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const querySecret = (req.query?.secret || '').toString().trim();

  const candidate = (headerSecret || bearerSecret || querySecret).trim();
  if (!candidate) return false;

  const pBuf = Buffer.from(candidate, 'utf8');
  const eBuf = Buffer.from(configured, 'utf8');
  if (pBuf.length !== eBuf.length) return false;

  return timingSafeEqual(pBuf, eBuf);
}

/**
 * Extracts and normalizes client IP for rate limiting.
 * Handles Cloudflare edge proxy (cf-connecting-ip), reverse proxies (x-forwarded-for),
 * and falls back to Express req.ip with IPv4/IPv6 subnet normalization.
 */
export function getClientIpKey(req: Request): string {
  const cfIp = req.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp.trim()) {
    return ipKeyGenerator(cfIp.trim());
  }

  const xForwardedFor = req.headers['x-forwarded-for'];
  if (typeof xForwardedFor === 'string' && xForwardedFor.trim()) {
    const firstIp = xForwardedFor.split(',')[0].trim();
    if (firstIp) return ipKeyGenerator(firstIp);
  }

  return ipKeyGenerator(req.ip || '127.0.0.1');
}

const isTestEnv = () => process.env.NODE_ENV === 'test';

/**
 * General WebApp / API Rate Limiter
 * 450 requests per 15 minutes (~30 req/min per IP).
 * Accommodates the WebApp 5-second silent live score polling (12 req/min) with generous headroom.
 */
export const webappLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isTestEnv() ? 10000 : 450,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: getClientIpKey,
  message: {
    error: 'Too many requests from this IP. Please try again later.',
    retryAfterMinutes: 15,
  },
  skip: (req) => isTestEnv() || req.path === '/health' || isAuthorizedAdminRequest(req),
});

/**
 * Sensitive Authentication Limiter
 * Applied to Telegram auth & Google token validation endpoints.
 * Throttles brute-force attempts: 25 requests per 15 minutes per IP.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isTestEnv() ? 1000 : 25,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: getClientIpKey,
  message: {
    error: 'Too many authentication attempts. Please try again in 15 minutes.',
    retryAfterMinutes: 15,
  },
  skip: () => isTestEnv(),
});

/**
 * Admin Panel Limiter
 * Applied to /api/admin/* to strictly prevent ADMIN_SECRET brute-forcing.
 * Limit: 30 requests per 15 minutes per IP.
 */
export const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isTestEnv() ? 1000 : 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: getClientIpKey,
  message: {
    error: 'Too many admin requests. Access restricted by rate limiter.',
    retryAfterMinutes: 15,
  },
  skip: (req) => isTestEnv() || isAuthorizedAdminRequest(req),
});

/**
 * Postback / Webhook Limiter
 * Applied to affiliate postback endpoints to prevent flood attacks:
 * 60 requests per 1 minute per IP.
 */
export const postbackLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  limit: isTestEnv() ? 1000 : 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: getClientIpKey,
  message: {
    error: 'Too many postback webhook requests. Rate limit exceeded.',
  },
  skip: () => isTestEnv(),
});
