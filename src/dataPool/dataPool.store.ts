interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttlMs: number;
}

export class BackendDataPoolStore {
  private static memoryCache = new Map<string, CacheEntry<any>>();

  static get<T>(key: string): T | null {
    const entry = this.memoryCache.get(key);
    if (!entry) return null;
    const isExpired = Date.now() - entry.timestamp > entry.ttlMs;
    if (isExpired) {
      this.memoryCache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  static set<T>(key: string, data: T, ttlMs: number): void {
    this.memoryCache.set(key, {
      data,
      timestamp: Date.now(),
      ttlMs,
    });
  }

  static clear(): void {
    this.memoryCache.clear();
  }

  static getStats() {
    return {
      entriesCount: this.memoryCache.size,
      keys: Array.from(this.memoryCache.keys()),
    };
  }
}