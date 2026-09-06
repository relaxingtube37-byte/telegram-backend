import { PersistentPoolRepo } from '../db/repositories/persistentPool.repo';
import { Logger } from '../utils/logger';

export type PoolNamespace =
  | 'event_details'
  | 'event_statistics'
  | 'event_odds'
  | 'daily_odds'
  | 'event_pbp'
  | 'event_duel'
  | 'player_profile'
  | 'player_year_stats'
  | 'player_recent_events'
  | 'h2h'
  | 'rankings'
  | 'daily_events'
  | 'generic';

export interface PoolFetchOptions {
  ttlMs?: number;
  permanent?: boolean;
  forceRefresh?: boolean;
  source?: string;
  /** Remember permanent "no data" so we do not re-call API for missing stats/PBP */
  cacheNullAsMiss?: boolean;
}

const memoryHot = new Map<string, { payload: unknown; expiresAt: number | null }>();

function parsePayload<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

const NO_DATA_MARKER = '__noData';

function isNoDataMarker(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)[NO_DATA_MARKER] === true
  );
}

function isEmptyPayload(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (isNoDataMarker(value)) return false;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

export function isEventFinishedPayload(details: any): boolean {
  const status = String(details?.event?.status?.type || details?.status?.type || '').toLowerCase();
  const desc = String(details?.event?.status?.description || details?.status?.description || '').toLowerCase();
  return status === 'finished' || desc.includes('finished') || desc.includes('ended') || desc === 'ft';
}

export class PersistentPoolService {
  static buildKey(namespace: PoolNamespace, parts: Array<string | number>): string {
    return `${namespace}:${parts.map((p) => String(p)).join(':')}`;
  }

  static get<T>(cacheKey: string): T | null {
    const hot = memoryHot.get(cacheKey);
    if (hot) {
      if (hot.expiresAt === null || hot.expiresAt > Date.now()) {
        if (isNoDataMarker(hot.payload)) return null;
        return hot.payload as T;
      }
      memoryHot.delete(cacheKey);
    }

    const row = PersistentPoolRepo.get(cacheKey);
    if (!row) return null;
    const payload = parsePayload<T>(row.payload_json);
    if (payload === null) return null;
    if (isNoDataMarker(payload)) return null;

    const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null;
    memoryHot.set(cacheKey, { payload, expiresAt });
    return payload;
  }

  static hasCachedOrMiss(cacheKey: string): boolean {
    const hot = memoryHot.get(cacheKey);
    if (hot && (hot.expiresAt === null || hot.expiresAt > Date.now())) return true;
    return PersistentPoolRepo.get(cacheKey) !== null;
  }

  static markNoData(cacheKey: string, namespace: PoolNamespace, options?: PoolFetchOptions): void {
    this.set(cacheKey, namespace, { [NO_DATA_MARKER]: true }, options);
  }

  static set<T>(
    cacheKey: string,
    namespace: PoolNamespace,
    payload: T,
    options?: PoolFetchOptions,
  ): void {
    if (isEmptyPayload(payload)) return;

    const permanent = options?.permanent === true;
    const expiresAt =
      permanent || !options?.ttlMs
        ? null
        : new Date(Date.now() + options.ttlMs).toISOString();

    PersistentPoolRepo.upsert({
      cacheKey,
      namespace,
      payloadJson: JSON.stringify(payload),
      source: options?.source || 'rapidapi',
      expiresAt: permanent ? null : expiresAt,
    });

    memoryHot.set(cacheKey, {
      payload,
      expiresAt: permanent || !options?.ttlMs ? null : Date.now() + options.ttlMs,
    });
  }

  static async getOrFetch<T>(
    cacheKey: string,
    namespace: PoolNamespace,
    fetcher: () => Promise<T | null>,
    options?: PoolFetchOptions,
  ): Promise<{ data: T | null; fromCache: boolean; fetched: boolean }> {
    if (!options?.forceRefresh && this.hasCachedOrMiss(cacheKey)) {
      const cached = this.get<T>(cacheKey);
      return { data: cached, fromCache: true, fetched: false };
    }

    const fresh = await fetcher();
    if (!isEmptyPayload(fresh)) {
      this.set(cacheKey, namespace, fresh, options);
      return { data: fresh as T, fromCache: false, fetched: true };
    }

    if (options?.cacheNullAsMiss) {
      this.markNoData(cacheKey, namespace, options);
    }

    return { data: null, fromCache: false, fetched: true };
  }

  static getStats() {
    return PersistentPoolRepo.stats();
  }

  static logFetch(cacheKey: string, fromCache: boolean): void {
    if (!fromCache) {
      Logger.info(`[PersistentPool] fetched ${cacheKey}`);
    }
  }
}
