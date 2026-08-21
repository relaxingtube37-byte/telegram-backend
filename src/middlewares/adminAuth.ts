import { Request, Response, NextFunction } from 'express';
import { ENV } from '../config/env';

export const requireAdminAuth = (req: Request, res: Response, next: NextFunction) => {
  const querySecret = (req.query.secret as string) || '';
  const headerSecret = (req.headers['x-admin-secret'] as string) || '';
  const authHeader = req.headers['authorization'] || '';
  let bearerSecret = '';

  if (authHeader.startsWith('Bearer ')) {
    bearerSecret = authHeader.substring(7).trim();
  }

  const providedSecret = querySecret || headerSecret || bearerSecret;
  const decodedProvided = decodeURIComponent(providedSecret).trim();
  const validSecret = ENV.ADMIN_SECRET.trim();

  if (decodedProvided && decodedProvided === validSecret) {
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized: Invalid or missing admin secret' });
};
