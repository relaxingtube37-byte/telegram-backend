import { ENV } from '../config/env';
import { Logger } from '../utils/logger';
import { PersistentPoolService, isEventFinishedPayload } from '../services/persistentPool.service';

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
          const target = getRequestTarget(endpoint);
          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const now = Date.now();
            const elapsed = now - lastRequestTime;
            if (elapsed < INTERVAL_MS) {
              await new Promise((r) => setTimeout(r, INTERVAL_MS - elapsed));
            }
            lastRequestTime = Date.now();

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
            Logger.error(`Failed ${target.providerName} call: ` + lastErr.message);
          }
          resolve(null);
        });
    });
  }

  private static liveEventsCache: { data: any; expiresAt: number } | null = null;
  private static inFlightLive: Promise<any> | null = null;

  static async getLiveEvents(forceRefresh = false): Promise<any> {
    const now = Date.now();
    if (!forceRefresh && this.liveEventsCache && this.liveEventsCache.expiresAt > now) {
      return this.liveEventsCache.data;
    }

    if (!forceRefresh && this.inFlightLive) {
      return this.inFlightLive;
    }

    this.inFlightLive = (async () => {
      try {
        const raw = await this.request<any>('/api/tennis/events/live');
        if (raw && Array.isArray(raw.events)) {
          this.liveEventsCache = {
            data: raw,
            expiresAt: Date.now() + 4000, // 4s TTL for live
          };
          return raw;
        }
        return this.liveEventsCache ? this.liveEventsCache.data : null;
      } finally {
        this.inFlightLive = null;
      }
    })();

    return this.inFlightLive;
  }

  static normalizeDateStr(dateStr?: string): { d: number; m: number; y: number; iso: string } {
    let d: number, m: number, y: number;
    if (!dateStr) {
      const now = new Date();
      d = now.getDate();
      m = now.getMonth() + 1;
      y = now.getFullYear();
    } else if (dateStr.includes('-')) {
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
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return { d, m, y, iso };
  }

  static async getDailyEvents(dateStr: string, options?: { forceRefresh?: boolean }): Promise<any> {
    const { d, m, y, iso } = this.normalizeDateStr(dateStr);
    const key = PersistentPoolService.buildKey('daily_events', [iso]);

    const now = new Date();
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const isPast = iso < todayIso;
    const isToday = iso === todayIso;

    // Past matches never change -> permanent! Today -> 45s TTL. Future -> 15m TTL.
    const ttlMs = isPast ? undefined : (isToday ? 45 * 1000 : 15 * 60 * 1000);
    const permanent = isPast;

    const result = await PersistentPoolService.getOrFetch(
      key,
      'daily_events',
      async () => {
        try {
          // 1. Try calendar discovery first to only query active categories
          let categoriesToFetch = [3, 6, 72, 871, 785, 213, 1843, 1844];
          try {
            const cal = await this.request<{ categories?: any[] }>(`/api/tennis/calendar/${d}/${m}/${y}/categories`);
            if (cal && Array.isArray(cal.categories) && cal.categories.length > 0) {
              const activeCats = cal.categories
                .filter((c: any) => (c?.totalEvents ?? 1) > 0)
                .map((c: any) => c?.category?.id ?? c?.id)
                .filter((id: any) => typeof id === 'number');
              if (activeCats.length > 0) {
                // Ensure core tours are included
                const set = new Set<number>([3, 6, 72, 871, ...activeCats]);
                categoriesToFetch = Array.from(set);
              }
            }
          } catch {}

          const results: { catId: number; res: { events?: any[] } | null }[] = [];
          for (const catId of categoriesToFetch) {
            const res = await this.request<{ events?: any[] }>(`/api/tennis/category/${catId}/events/${d}/${m}/${y}`);
            if (res) results.push({ catId, res });
          }

          const allEvents: any[] = [];
          const seenIds = new Set<number>();

          for (const { catId, res } of results) {
            if (res && Array.isArray(res.events)) {
              for (const ev of res.events) {
                if (ev && ev.id && !seenIds.has(ev.id)) {
                  seenIds.add(ev.id);
                  if (!ev.tournament) ev.tournament = {};
                  if (!ev.tournament.category) ev.tournament.category = {};
                  if (!ev.tournament.category.id) ev.tournament.category.id = catId;

                  // Explicitly tag gender and tour tier based on verified OpenAPI category IDs
                  if ([6, 871, 213, 74, 1844].includes(catId)) {
                    ev._inferredGender = 'women';
                    ev._inferredTourCategory = catId === 871 ? 'WTA125' : ([213, 74].includes(catId) ? 'ITF' : 'WTA');
                  } else if ([3, 72, 785, 73, 1843].includes(catId)) {
                    ev._inferredGender = 'men';
                    ev._inferredTourCategory = catId === 72 ? 'CHALLENGER' : ([785, 73].includes(catId) ? 'ITF' : 'ATP');
                  }

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
      },
      {
        ttlMs,
        permanent,
        forceRefresh: options?.forceRefresh,
      }
    );

    return result.data;
  }

  /** Global Tennis Schedule for Specific Date from OpenAPI /events/schedule/{day}/{month}/{year} */
  static async getDailyEventsBySchedule(dateStr: string, options?: { forceRefresh?: boolean }): Promise<any> {
    const { d, m, y, iso } = this.normalizeDateStr(dateStr);
    const key = PersistentPoolService.buildKey('daily_schedule', [iso]);
    const result = await PersistentPoolService.getOrFetch(
      key,
      'daily_schedule',
      () => this.request(`/api/tennis/events/schedule/${d}/${m}/${y}`),
      {
        ttlMs: 15 * 60 * 1000,
        forceRefresh: options?.forceRefresh,
      }
    );
    return result.data;
  }

  /**
   * Official Rankings from OpenAPI /rankings/{tour}:
   * Supports: 'atp' | 'wta' | 'atp-doubles' | 'wta-doubles' | 'race-atp' | 'race-wta' | 'itf-men' | 'itf-women'
   */
  static async getRankings(
    tour: 'atp' | 'wta' | 'atp-doubles' | 'wta-doubles' | 'race-atp' | 'race-wta' | 'itf-men' | 'itf-women' | string,
    options?: { forceRefresh?: boolean }
  ): Promise<any> {
    const tourSlug = tour.toLowerCase().trim();
    const key = PersistentPoolService.buildKey('rankings', [tourSlug]);
    const result = await PersistentPoolService.getOrFetch(
      key,
      'rankings',
      () => this.request('/api/tennis/rankings/' + tourSlug),
      {
        ttlMs: 12 * 60 * 60 * 1000,
        forceRefresh: options?.forceRefresh,
      }
    );
    return result.data;
  }

  static async getPlayerProfile(playerId: string | number, options?: { forceRefresh?: boolean }): Promise<any> {
    const key = PersistentPoolService.buildKey('player_profile', [playerId]);
    const result = await PersistentPoolService.getOrFetch(
      key,
      'player_profile',
      () => this.request(`/api/tennis/player/${playerId}`),
      {
        permanent: true,
        forceRefresh: options?.forceRefresh,
      }
    );
    return result.data;
  }

  static async getPlayerStats(playerId: string | number, year: number = 2026, options?: { forceRefresh?: boolean }): Promise<any> {
    const key = PersistentPoolService.buildKey('player_year_stats', [playerId, year]);
    const result = await PersistentPoolService.getOrFetch(
      key,
      'player_year_stats',
      () => this.request(`/api/tennis/player/${playerId}/statistics/${year}`),
      {
        ttlMs: 24 * 60 * 60 * 1000,
        cacheNullAsMiss: true,
        forceRefresh: options?.forceRefresh,
      }
    );
    return result.data;
  }

  static async getPlayerRecentEvents(playerId: string | number, count: number = 5, options?: { forceRefresh?: boolean }): Promise<any> {
    const key = PersistentPoolService.buildKey('player_recent_events', [playerId, count]);
    const result = await PersistentPoolService.getOrFetch(
      key,
      'player_recent_events',
      () => this.request(`/api/tennis/player/${playerId}/events/last/${count}`),
      {
        ttlMs: 2 * 60 * 60 * 1000,
        forceRefresh: options?.forceRefresh,
      }
    );
    return result.data;
  }

  static async getPlayerPreviousEvents(playerId: string | number, page: number = 0): Promise<any> {
    return this.request(`/api/tennis/player/${playerId}/events/previous/${page}`);
  }

  static async searchPlayers(query: string): Promise<any> {
    const encoded = encodeURIComponent(query.trim());
    if (!encoded) return null;
    return this.request(`/api/tennis/search/${encoded}`);
  }

  static async getHeadToHead(p1Id: string | number, p2Id: string | number, options?: { forceRefresh?: boolean }): Promise<any> {
    const pair = [String(p1Id), String(p2Id)].sort().join('_');
    const key = PersistentPoolService.buildKey('h2h', [pair]);
    const result = await PersistentPoolService.getOrFetch(
      key,
      'h2h',
      () => this.request(`/api/tennis/h2h/${p1Id}/${p2Id}`),
      {
        permanent: true,
        forceRefresh: options?.forceRefresh,
      }
    );
    return result.data;
  }

  static async getTournamentDetails(tournamentId: string | number, options?: { forceRefresh?: boolean }): Promise<any> {
    const key = `tournament_${tournamentId}`;
    const result = await PersistentPoolService.getOrFetch(
      key,
      'generic',
      () => this.request(`/api/tennis/tournament/${tournamentId}`),
      {
        permanent: true,
        forceRefresh: options?.forceRefresh,
      }
    );
    return result.data;
  }

  static async getTournamentSeasons(tournamentId: string | number, options?: { forceRefresh?: boolean }): Promise<any> {
    const key = `tournament_${tournamentId}_seasons`;
    const result = await PersistentPoolService.getOrFetch(
      key,
      'generic',
      () => this.request(`/api/tennis/tournament/${tournamentId}/seasons`),
      { permanent: true, forceRefresh: options?.forceRefresh }
    );
    return result.data;
  }

  static async getTournamentSeasonEvents(tournamentId: string | number, seasonId: string | number, options?: { forceRefresh?: boolean }): Promise<any> {
    const key = `tournament_${tournamentId}_season_${seasonId}_events`;
    const result = await PersistentPoolService.getOrFetch(
      key,
      'generic',
      () => this.request(`/api/tennis/tournament/${tournamentId}/season/${seasonId}/events`),
      { permanent: true, forceRefresh: options?.forceRefresh }
    );
    return result.data;
  }

  static async getTournamentSeasonStandings(tournamentId: string | number, seasonId: string | number, options?: { forceRefresh?: boolean }): Promise<any> {
    const key = `tournament_${tournamentId}_season_${seasonId}_standings`;
    const result = await PersistentPoolService.getOrFetch(
      key,
      'generic',
      () => this.request(`/api/tennis/tournament/${tournamentId}/season/${seasonId}/standings`),
      { permanent: true, forceRefresh: options?.forceRefresh }
    );
    return result.data;
  }

  static async getTournamentSeasonCuptrees(tournamentId: string | number, seasonId: string | number, options?: { forceRefresh?: boolean }): Promise<any> {
    const key = `tournament_${tournamentId}_season_${seasonId}_cuptrees`;
    const result = await PersistentPoolService.getOrFetch(
      key,
      'generic',
      () => this.request(`/api/tennis/tournament/${tournamentId}/season/${seasonId}/cuptrees`),
      { permanent: true, forceRefresh: options?.forceRefresh }
    );
    return result.data;
  }

  static async getEventDetails(eventId: string | number, options?: { forceRefresh?: boolean }): Promise<any> {
    const id = Number(eventId);
    const key = PersistentPoolService.buildKey('event_details', [id]);
    const result = await PersistentPoolService.getOrFetch(
      key,
      'event_details',
      () => this.request(`/api/tennis/event/${id}`),
      {
        ttlMs: 45 * 1000,
        forceRefresh: options?.forceRefresh,
      }
    );

    if (result.data && isEventFinishedPayload(result.data)) {
      PersistentPoolService.set(key, 'event_details', result.data, { permanent: true });
    }

    return result.data;
  }

  static async getEventPointByPoint(eventId: string | number, options?: { forceRefresh?: boolean }): Promise<any> {
    const id = Number(eventId);
    const key = PersistentPoolService.buildKey('event_pbp', [id]);
    const result = await PersistentPoolService.getOrFetch(
      key,
      'event_pbp',
      () => this.request(`/api/tennis/event/${id}/point-by-point`),
      {
        ttlMs: 60 * 1000,
        cacheNullAsMiss: true,
        forceRefresh: options?.forceRefresh,
      }
    );
    return result.data;
  }

  static async getEventStatistics(eventId: string | number, options?: { forceRefresh?: boolean }): Promise<any> {
    const id = Number(eventId);
    const key = PersistentPoolService.buildKey('event_statistics', [id]);
    const result = await PersistentPoolService.getOrFetch(
      key,
      'event_statistics',
      () => this.request(`/api/tennis/event/${id}/statistics`),
      {
        ttlMs: 60 * 1000,
        cacheNullAsMiss: true,
        forceRefresh: options?.forceRefresh,
      }
    );
    return result.data;
  }

  static async getEventOdds(eventId: string | number, options?: { forceRefresh?: boolean }): Promise<any> {
    const id = Number(eventId);
    const key = PersistentPoolService.buildKey('event_odds', [id]);
    const result = await PersistentPoolService.getOrFetch(
      key,
      'event_odds',
      () => this.request(`/api/tennis/event/${id}/odds`),
      {
        ttlMs: 3 * 60 * 1000,
        cacheNullAsMiss: true,
        forceRefresh: options?.forceRefresh,
      }
    );
    return result.data;
  }

  /** All match odds for one calendar day — keyed by eventId in response.odds */
  static async getEventsOddsByDate(day: number, month: number, year: number, options?: { forceRefresh?: boolean }): Promise<any> {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const key = PersistentPoolService.buildKey('daily_odds', [dateStr]);
    const result = await PersistentPoolService.getOrFetch(
      key,
      'daily_odds',
      () => this.request(`/api/tennis/events/odds/${day}/${month}/${year}`),
      {
        permanent: true,
        cacheNullAsMiss: true,
        forceRefresh: options?.forceRefresh,
      }
    );
    return result.data;
  }

  static async getEventDuel(eventId: string | number, options?: { forceRefresh?: boolean }): Promise<any> {
    const id = Number(eventId);
    const key = PersistentPoolService.buildKey('event_duel', [id]);
    const result = await PersistentPoolService.getOrFetch(
      key,
      'event_duel',
      () => this.request(`/api/tennis/event/${id}/duel`),
      {
        ttlMs: 60 * 1000,
        cacheNullAsMiss: true,
        forceRefresh: options?.forceRefresh,
      }
    );
    return result.data;
  }

  static async getEventGraph(eventId: string | number, options?: { forceRefresh?: boolean }): Promise<any> {
    const id = Number(eventId);
    const key = PersistentPoolService.buildKey('event_graph', [id]);
    const result = await PersistentPoolService.getOrFetch(
      key,
      'event_graph',
      () => this.request(`/api/tennis/event/${id}/graph`),
      {
        ttlMs: 60 * 1000,
        cacheNullAsMiss: true,
        forceRefresh: options?.forceRefresh,
      }
    );
    return result.data;
  }

  static async getEventIncidents(eventId: string | number, options?: { forceRefresh?: boolean }): Promise<any> {
    const id = Number(eventId);
    const key = PersistentPoolService.buildKey('event_incidents', [id]);
    const result = await PersistentPoolService.getOrFetch(
      key,
      'event_incidents',
      () => this.request(`/api/tennis/event/${id}/incidents`),
      {
        ttlMs: 60 * 1000,
        cacheNullAsMiss: true,
        forceRefresh: options?.forceRefresh,
      }
    );
    return result.data;
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