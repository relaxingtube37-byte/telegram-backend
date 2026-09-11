/**
 * src/middlewares/shadowHttpInterceptor.ts
 *
 * Express Middleware for Phase 10 Public HTTP Endpoint Shadow Comparison.
 *
 * Invariants:
 *   1. Client receives primary response synchronously with 0ms added delay.
 *   2. Asynchronous shadow evaluation dispatched via setImmediate().
 *   3. All shadow execution errors are suppressed.
 *   4. Disarmed immediately (<10ms) when ENABLE_STAGING_PG_SHADOW !== 'true' or in production.
 */

import { Request, Response, NextFunction } from 'express';
import { ShadowComparator } from '../db/shadow/shadowComparator';
import { RepositoryFactory } from '../db/repositoryFactory';
import { PostgresPredictionsAdapter } from '../db/adapters/postgres/predictions.pg';
import { PostgresEditorialsAdapter } from '../db/adapters/postgres/editorials.pg';
import { PostgresPlayersAdapter } from '../db/adapters/postgres/players.pg';
import { PostgresMatchesAdapter } from '../db/adapters/postgres/matches.pg';
import { Logger } from '../utils/logger';

export interface HttpShadowMetrics {
  totalIntercepted: number;
  shadowDispatched: number;
  suppressedErrors: number;
}

const httpMetrics: HttpShadowMetrics = {
  totalIntercepted: 0,
  shadowDispatched: 0,
  suppressedErrors: 0
};

export function getHttpShadowMetrics(): HttpShadowMetrics {
  return { ...httpMetrics };
}

export function resetHttpShadowMetrics(): void {
  httpMetrics.totalIntercepted = 0;
  httpMetrics.shadowDispatched = 0;
  httpMetrics.suppressedErrors = 0;
}

export function shadowHttpInterceptor(req: Request, res: Response, next: NextFunction): void {
  httpMetrics.totalIntercepted++;

  // Disarm check
  if (!ShadowComparator.isEnabled()) {
    return next();
  }

  // Intercept res.json
  const originalJson = res.json.bind(res);

  res.json = function (body: any): Response {
    // 1. Immediately return canonical response to client
    const responseResult = originalJson(body);

    // 2. Dispatch detached shadow comparison in setImmediate
    setImmediate(async () => {
      try {
        httpMetrics.shadowDispatched++;
        await evaluateHttpShadow(req.path, req.params, body);
      } catch (err: any) {
        httpMetrics.suppressedErrors++;
        Logger.debug(`[HttpShadowInterceptor] Suppressed error on ${req.path}: ${err.message}`);
      }
    });

    return responseResult;
  };

  next();
}

async function evaluateHttpShadow(path: string, params: Record<string, any>, primaryBody: any): Promise<void> {
  const pgPredictions = new PostgresPredictionsAdapter();
  const pgEditorials = new PostgresEditorialsAdapter();
  const pgPlayers = new PostgresPlayersAdapter();
  const pgMatches = new PostgresMatchesAdapter();

  const t0 = performance.now();

  if (path.startsWith('/api/predictions') || path.startsWith('/api/webapp/predictions')) {
    const shadowData = await pgPredictions.getAll(20);
    const shadowLatency = performance.now() - t0;
    ShadowComparator.compare('PREDICTIONS', 'http_predictions_feed', primaryBody, shadowData, 0.05, shadowLatency, 'http_feed');
  } else if (path.includes('/editorial')) {
    const slug = params.slug || params.idOrSlug || path.split('/').slice(-2)[0] || '';
    const shadowData = await pgEditorials.getBySlug(slug);
    const shadowLatency = performance.now() - t0;
    ShadowComparator.compare('EDITORIALS', 'http_editorial_by_slug', primaryBody, shadowData, 0.05, shadowLatency, `slug_${slug}`);
  } else if (path.startsWith('/api/web/players') || path.startsWith('/api/players') || path.startsWith('/api/webapp/players')) {
    const slug = params.slug || params.slugOrId || params.playerId || 'aryna-sabalenka';
    const shadowData = await pgPlayers.getBySlugOrId(slug);
    const shadowLatency = performance.now() - t0;
    ShadowComparator.compare('PLAYERS', 'http_player_by_slug', primaryBody, shadowData, 0.05, shadowLatency, `player_${slug}`);
  } else if (path.startsWith('/api/web/matches') || path.startsWith('/api/matches') || path.startsWith('/api/web/tournaments') || path.startsWith('/api/webapp/stats')) {
    const shadowData = await pgMatches.listByTrackedPlayer(1, 20);
    const shadowLatency = performance.now() - t0;
    ShadowComparator.compare('MATCHES', 'http_matches_list', primaryBody, shadowData, 0.05, shadowLatency, 'http_matches');
  }
}

