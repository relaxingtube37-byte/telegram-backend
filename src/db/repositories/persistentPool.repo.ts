import { db } from '../connection';

export interface PoolCacheRow {
  cache_key: string;
  namespace: string;
  payload_json: string;
  source: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export const PersistentPoolRepo = {
  get(cacheKey: string): PoolCacheRow | null {
    const row = db
      .prepare(
        `
      SELECT cache_key, namespace, payload_json, source, expires_at, created_at, updated_at
      FROM pool_cache
      WHERE cache_key = @cacheKey
    `,
      )
      .get({ cacheKey }) as PoolCacheRow | undefined;

    if (!row) return null;
    if (row.expires_at && row.expires_at <= new Date().toISOString()) {
      db.prepare('DELETE FROM pool_cache WHERE cache_key = @cacheKey').run({ cacheKey });
      return null;
    }
    return row;
  },

  upsert(input: {
    cacheKey: string;
    namespace: string;
    payloadJson: string;
    source?: string;
    expiresAt?: string | null;
  }): void {
    const now = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO pool_cache (cache_key, namespace, payload_json, source, expires_at, created_at, updated_at)
      VALUES (@cacheKey, @namespace, @payloadJson, @source, @expiresAt, @createdAt, @updatedAt)
      ON CONFLICT(cache_key) DO UPDATE SET
        namespace = excluded.namespace,
        payload_json = excluded.payload_json,
        source = excluded.source,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `,
    ).run({
      cacheKey: input.cacheKey,
      namespace: input.namespace,
      payloadJson: input.payloadJson,
      source: input.source || 'rapidapi',
      expiresAt: input.expiresAt ?? null,
      createdAt: now,
      updatedAt: now,
    });
  },

  delete(cacheKey: string): void {
    db.prepare('DELETE FROM pool_cache WHERE cache_key = @cacheKey').run({ cacheKey });
  },

  stats(): { total: number; permanent: number; byNamespace: Array<{ namespace: string; count: number }> } {
    const total = (db.prepare('SELECT COUNT(*) as c FROM pool_cache').get() as { c: number }).c;
    const permanent = (
      db.prepare('SELECT COUNT(*) as c FROM pool_cache WHERE expires_at IS NULL').get() as { c: number }
    ).c;
    const byNamespace = db
      .prepare('SELECT namespace, COUNT(*) as count FROM pool_cache GROUP BY namespace ORDER BY count DESC')
      .all() as Array<{ namespace: string; count: number }>;
    return { total, permanent, byNamespace };
  },
};
