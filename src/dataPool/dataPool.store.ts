import { PersistentPoolService } from '../services/persistentPool.service';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttlMs: number;
}

/**
 * In-memory hot cache backed by SQLite permanent pool (pool_cache table).
 * Finished match payloads are stored permanently; live data uses TTL.
 */
export class BackendDataPoolStore {
  private static memoryCache = new Map<string, CacheEntry<any>>();

  static get<T>(key: string): T | null {
    const entry = this.memoryCache.get(key);
    if (entry) {
      const isExpired = Date.now() - entry.timestamp > entry.ttlMs;
      if (!isExpired) {
        return entry.data as T;
      }
      this.memoryCache.delete(key);
    }

    const persisted = PersistentPoolService.get<T>(`generic:${key}`);
    if (persisted !== null) {
      this.memoryCache.set(key, {
        data: persisted,
        timestamp: Date.now(),
        ttlMs: 24 * 60 * 60 * 1000,
      });
      return persisted;
    }

    return null;
  }

  static set<T>(key: string, data: T, ttlMs: number, options?: { permanent?: boolean }): void {
    this.memoryCache.set(key, {
      data,
      timestamp: Date.now(),
      ttlMs,
    });

    PersistentPoolService.set(`generic:${key}`, 'generic', data, {
      permanent: options?.permanent,
      ttlMs: options?.permanent ? undefined : ttlMs,
    });
  }

  static clear(): void {
    this.memoryCache.clear();
  }

  static getStats() {
    const memory = {
      entriesCount: this.memoryCache.size,
      keys: Array.from(this.memoryCache.keys()),
    };
    const sqlite = PersistentPoolService.getStats();
    return { memory, sqlite };
  }
}
