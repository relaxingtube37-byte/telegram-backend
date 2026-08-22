import { ENV } from '../config/env';
import { Logger } from '../utils/logger';

const RAPID_HOST = 'tennisapi1.p.rapidapi.com';
const INTERVAL_MS = 140; // ~7 req/sec (Safe for 8 req/s RapidAPI plan)

let lastRequestTime = 0;
let requestQueue: Promise<any> = Promise.resolve();

export class BackendTennisApi {
  /**
   * Paced, rate-limited and auto-retrying fetch for RapidAPI Tennis.
   * Uses an iterative loop inside the queue to avoid recursive promise deadlocks.
   */
  private static async request<T>(endpoint: string, maxRetries = 2): Promise<T | null> {
    return new Promise<T | null>((resolve) => {
      requestQueue = requestQueue
        .catch(() => {}) // keep queue alive even if previous request failed
        .then(async () => {
          let lastErr: any = null;
          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const now = Date.now();
            const elapsed = now - lastRequestTime;
            if (elapsed < INTERVAL_MS) {
              await new Promise((r) => setTimeout(r, INTERVAL_MS - elapsed));
            }
            lastRequestTime = Date.now();

            try {
              const url = 'https://' + RAPID_HOST + endpoint;
              const res = await fetch(url, {
                headers: {
                  'x-rapidapi-key': ENV.RAPIDAPI_KEY,
                  'x-rapidapi-host': RAPID_HOST,
                },
              });

              if (res.status === 429) {
                if (attempt < maxRetries) {
                  Logger.warn(`[TennisAPI RateLimiter] 429 on ${endpoint}. Backing off 1.5s... (attempt ${attempt + 1}/${maxRetries})`);
                  await new Promise((r) => setTimeout(r, 1500));
                  continue;
                } else {
                  Logger.warn(`[TennisAPI RateLimiter] 429 limit reached on ${endpoint}`);
                  resolve(null);
                  return;
                }
              }

              if (!res.ok) {
                Logger.warn(`RapidAPI Tennis HTTP ${res.status} on ${endpoint}`);
                resolve(null);
                return;
              }

              const data = (await res.json()) as T;
              resolve(data);
              return;
            } catch (err: any) {
              lastErr = err;
              if (attempt < maxRetries) {
                await new Promise((r) => setTimeout(r, 600));
              }
            }
          }

          if (lastErr) {
            Logger.error('Failed RapidAPI call: ' + lastErr.message);
          }
          resolve(null);
        });
    });
  }

  static async getLiveEvents(): Promise<any> {
    return this.request('/api/tennis/events/live');
  }

  static async getDailyEvents(dateStr: string): Promise<any> {
    try {
      let d: number, m: number, y: number;
      if (dateStr.includes('-')) {
        const parts = dateStr.split('-');
        y = parseInt(parts[0], 10);
        m = parseInt(parts[1], 10);
        d = parseInt(parts[2], 10);
      } else if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        d = parseInt(parts[0], 10);
        m = parseInt(parts[1], 10);
        y = parseInt(parts[2], 10);
      } else {
        const now = new Date();
        d = now.getDate();
        m = now.getMonth() + 1;
        y = now.getFullYear();
      }

      // Categories: 3 = ATP, 6 = WTA, 72 = Challenger
      // Dispatched through our rate-limited sequential queue
      const categories = [3, 6, 72];
      const results: any[] = [];

      for (const catId of categories) {
        const res = await this.request<{ events?: any[] }>(`/api/tennis/category/${catId}/events/${d}/${m}/${y}`);
        if (res) results.push(res);
      }

      const allEvents: any[] = [];
      const seenIds = new Set<number>();

      for (const res of results) {
        if (res && Array.isArray(res.events)) {
          for (const ev of res.events) {
            if (ev && ev.id && !seenIds.has(ev.id)) {
              seenIds.add(ev.id);
              allEvents.push(ev);
            }
          }
        }
      }

      return { events: allEvents };
    } catch (err: any) {
      Logger.error('Failed getDailyEvents: ' + err.message);
      return null;
    }
  }

  static async getRankings(tour: 'atp' | 'wta'): Promise<any> {
    return this.request('/api/tennis/rankings/' + tour);
  }

  static async getPlayerImage(playerId: string | number, maxRetries = 1): Promise<Buffer | null> {
    const endpoint = `/api/tennis/player/${playerId}/image`;
    return new Promise<Buffer | null>((resolve) => {
      requestQueue = requestQueue
        .catch(() => {})
        .then(async () => {
          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const now = Date.now();
            const elapsed = now - lastRequestTime;
            if (elapsed < INTERVAL_MS) {
              await new Promise((r) => setTimeout(r, INTERVAL_MS - elapsed));
            }
            lastRequestTime = Date.now();

            try {
              const url = 'https://' + RAPID_HOST + endpoint;
              const res = await fetch(url, {
                headers: {
                  'x-rapidapi-key': ENV.RAPIDAPI_KEY,
                  'x-rapidapi-host': RAPID_HOST,
                },
              });

              if (res.status === 429) {
                if (attempt < maxRetries) {
                  Logger.warn(`[TennisAPI RateLimiter] Image 429 on ${endpoint}. Backing off 1.5s...`);
                  await new Promise((r) => setTimeout(r, 1500));
                  continue;
                } else {
                  resolve(null);
                  return;
                }
              }

              if (!res.ok) {
                resolve(null);
                return;
              }

              const arrayBuffer = await res.arrayBuffer();
              resolve(Buffer.from(arrayBuffer));
              return;
            } catch (err: any) {
              if (attempt < maxRetries) {
                await new Promise((r) => setTimeout(r, 600));
              }
            }
          }
          resolve(null);
        });
    });
  }
}