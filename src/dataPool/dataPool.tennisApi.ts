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
    return this.request('/api/tennis/events/date/' + dateStr);
  }

  static async getRankings(tour: 'atp' | 'wta'): Promise<any> {
    return this.request('/api/tennis/rankings/' + tour);
  }
}