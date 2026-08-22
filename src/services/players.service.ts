import { PlayersRepo } from '../db/repositories/players.repo';
import type { PublishedPlayer } from '../types';

export const PlayersService = {
  formatPlayer: (raw: any): any => {
    if (!raw) return null;
    return {
      ...raw,
      surfaceStats: typeof raw.surface_stats_json === 'string'
        ? (() => { try { return JSON.parse(raw.surface_stats_json); } catch { return []; } })()
        : (raw.surface_stats_json || []),
      recentMatches: typeof raw.recent_matches_json === 'string'
        ? (() => { try { return JSON.parse(raw.recent_matches_json); } catch { return []; } })()
        : (raw.recent_matches_json || []),
      aiDossier: typeof raw.ai_dossier_json === 'string'
        ? (() => { try { return JSON.parse(raw.ai_dossier_json); } catch { return null; } })()
        : (raw.ai_dossier_json || null),
    };
  },

  getAll: (limit = 100): any[] => {
    return PlayersRepo.getAll(limit).map(PlayersService.formatPlayer);
  },

  getPublished: (limit = 100): any[] => {
    return PlayersRepo.getPublished(limit).map(PlayersService.formatPlayer);
  },

  getFeatured: (): any[] => {
    return PlayersRepo.getFeatured().map(PlayersService.formatPlayer);
  },

  getBySlugOrId: (slugOrId: string | number): any => {
    const raw = PlayersRepo.getBySlugOrId(slugOrId);
    return raw ? PlayersService.formatPlayer(raw) : null;
  },

  publishPlayer: (player: PublishedPlayer): number => {
    return PlayersRepo.upsert(player);
  },

  publishPlayersBulk: (players: PublishedPlayer[]): number => {
    return PlayersRepo.bulkUpsert(players);
  },

  deletePlayer: (playerId: number): boolean => {
    return PlayersRepo.delete(playerId);
  },

  toggleFeatured: (playerId: number, featured: boolean): boolean => {
    return PlayersRepo.toggleFeatured(playerId, featured);
  },
};
