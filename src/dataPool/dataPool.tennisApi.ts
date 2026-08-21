import { ENV } from '../config/env';
import { Logger } from '../utils/logger';

const RAPID_HOST = 'tennisapi1.p.rapidapi.com';

export class BackendTennisApi {
  private static async request<T>(endpoint: string): Promise<T | null> {
    try {
      const url = 'https://' + RAPID_HOST + endpoint;
      const res = await fetch(url, {
        headers: {
          'x-rapidapi-key': ENV.RAPIDAPI_KEY,
          'x-rapidapi-host': RAPID_HOST,
        },
      });

      if (!res.ok) {
        Logger.warn('RapidAPI Tennis error ' + res.status + ' on ' + endpoint);
        return null;
      }

      return (await res.json()) as T;
    } catch (err: any) {
      Logger.error('Failed RapidAPI call: ' + err.message);
      return null;
    }
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

      const categories = [3, 6, 72]; // 3=ATP, 6=WTA, 72=Challenger
      const results = await Promise.all(
        categories.map((catId) =>
          this.request<{ events?: any[] }>(`/api/tennis/category/${catId}/events/${d}/${m}/${y}`)
        )
      );

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
}