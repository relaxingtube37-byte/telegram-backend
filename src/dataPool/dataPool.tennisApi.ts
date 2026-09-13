import { ENV } from '../config/env';
import { Logger } from '../utils/logger';

const ALLSPORTS_BASE = 'https://prod.api.market/api/v1/recodex/allsportsapi';
const RAPID_HOST = 'tennisapi1.p.rapidapi.com';
const INTERVAL_MS = 140; // ~7 req/sec

let lastRequestTime = 0;
let requestQueue: Promise<any> = Promise.resolve();

function isAllSportsActive(): boolean {
  return Boolean(ENV.ALLSPORTS_API_KEY && ENV.ALLSPORTS_API_KEY.length > 5);
}

function getRequestTarget(endpoint: string): { url: string; headers: Record<string, string>; providerName: string } {
  if (isAllSportsActive()) {
    return {
      url: `${ALLSPORTS_BASE}${endpoint}`,
      headers: {
        'x-api-market-key': ENV.ALLSPORTS_API_KEY,
      },
      providerName: 'AllSports',
    };
  }
  return {
    url: `https://${RAPID_HOST}${endpoint}`,
    headers: {
      'x-rapidapi-key': ENV.RAPIDAPI_KEY,
      'x-rapidapi-host': RAPID_HOST,
    },
    providerName: 'RapidAPI',
  };
}

export class BackendTennisApi {
  /**
   * Paced, rate-limited and auto-retrying fetch for Tennis API (AllSports / RapidAPI).
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

            const target = getRequestTarget(endpoint);

            try {
              const res = await fetch(target.url, {
                headers: target.headers,
                signal: AbortSignal.timeout(6000),
              });

              if (res.status === 429) {
                if (attempt < maxRetries) {
                  Logger.warn(`[TennisAPI RateLimiter] 429 on ${endpoint} (${target.providerName}). Backing off 1.5s... (attempt ${attempt + 1}/${maxRetries})`);
                  await new Promise((r) => setTimeout(r, 1500));
                  continue;
                } else {
                  Logger.warn(`[TennisAPI RateLimiter] 429 limit reached on ${endpoint} (${target.providerName})`);
                  resolve(null);
                  return;
                }
              }

              // API returns 204 with empty body when no data (e.g. no stats/PBP for match)
              if (res.status === 204) {
                resolve(null);
                return;
              }

              if (!res.ok) {
                Logger.warn(`[TennisAPI] HTTP ${res.status} on ${endpoint} (${target.providerName})`);
                resolve(null);
                return;
              }

              const text = await res.text();
              if (!text.trim()) {
                resolve(null);
                return;
              }

              const data = JSON.parse(text) as T;
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

      // Categories: 3 = ATP, 6 = WTA, 72 = Challenger, 785 = ITF Men, 213 = ITF Women, 1843 = UTR Men, 1844 = UTR Women
      const categories = [3, 6, 72, 785, 213, 1843, 1844];
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

  static async getPlayerProfile(playerId: string | number): Promise<any> {
    return this.request(`/api/tennis/player/${playerId}`);
  }

  static async getPlayerStats(playerId: string | number, year: number = 2026): Promise<any> {
    return this.request(`/api/tennis/player/${playerId}/statistics/${year}`);
  }

  static async getPlayerRecentEvents(playerId: string | number, count: number = 5): Promise<any> {
    return this.request(`/api/tennis/player/${playerId}/events/last/${count}`);
  }

  static async getPlayerPreviousEvents(playerId: string | number, page: number = 0): Promise<any> {
    return this.request(`/api/tennis/player/${playerId}/events/previous/${page}`);
  }

  static async searchPlayers(query: string): Promise<any> {
    const encoded = encodeURIComponent(query.trim());
    if (!encoded) return null;
    return this.request(`/api/tennis/search/${encoded}`);
  }

  static async getHeadToHead(p1Id: string | number, p2Id: string | number): Promise<any> {
    return this.request(`/api/tennis/h2h/${p1Id}/${p2Id}`);
  }

  static async getTournamentDetails(tournamentId: string | number): Promise<any> {
    return this.request(`/api/tennis/tournament/${tournamentId}`);
  }

  static async getEventDetails(eventId: string | number): Promise<any> {
    return this.request(`/api/tennis/event/${eventId}`);
  }

  static async getEventPointByPoint(eventId: string | number): Promise<any> {
    return this.request(`/api/tennis/event/${eventId}/point-by-point`);
  }

  static async getEventStatistics(eventId: string | number): Promise<any> {
    return this.request(`/api/tennis/event/${eventId}/statistics`);
  }

  static async getEventOdds(eventId: string | number): Promise<any> {
    return this.request(`/api/tennis/event/${eventId}/odds`);
  }

  /** All match odds for one calendar day — keyed by eventId in response.odds */
  static async getEventsOddsByDate(day: number, month: number, year: number): Promise<any> {
    return this.request(`/api/tennis/events/odds/${day}/${month}/${year}`);
  }

  static async getEventDuel(eventId: string | number): Promise<any> {
    return this.request(`/api/tennis/event/${eventId}/duel`);
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

            const target = getRequestTarget(endpoint);

            try {
              const res = await fetch(target.url, {
                headers: target.headers,
                signal: AbortSignal.timeout(8000),
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