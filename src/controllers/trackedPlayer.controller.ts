import { Request, Response } from 'express';
import {
  bootstrapTopRankedPlayers,
  getPlayerArchive,
  getPlayerMatchBundle,
  getTrackedPlayerStatus,
  listTrackedPlayersWithCoverage,
  registerPlayer,
  reindexAllTrackedPlayersFromHistorical,
  searchPlayersByName,
  syncAllTrackedPlayers,
  syncTrackedPlayer,
} from '../services/playerSync.service';
import { runDailyPlayerUpdate } from '../services/dailyPlayerUpdate.service';
import { TrackedPlayerRepo } from '../db/repositories/trackedPlayer.repo';

export const TrackedPlayerController = {
  list: async (req: Request, res: Response) => {
    try {
      const sinceDate =
        typeof req.query.sinceDate === 'string' && req.query.sinceDate.trim()
          ? req.query.sinceDate.trim()
          : undefined;
      const summary = TrackedPlayerRepo.count();
      res.json({
        summary,
        players: listTrackedPlayersWithCoverage(sinceDate),
        periods: {
          file: { label: '2021-2026', sinceDate: '2021-01-01' },
          api: { label: '2024-2026', sinceDate: '2024-01-01' },
        },
        sinceDate: sinceDate ?? null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getStatus: async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const status = getTrackedPlayerStatus(id);
      if (!status) return res.status(404).json({ error: 'Player not found' });
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  search: async (req: Request, res: Response) => {
    try {
      const query = String(req.query.name || req.query.q || '').trim();
      if (!query) return res.status(400).json({ error: 'Provide name or q query param' });
      const hits = await searchPlayersByName(query);
      res.json({ query, hits });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  track: async (req: Request, res: Response) => {
    try {
      const result = await registerPlayer({
        rapidPlayerId: req.body?.rapidPlayerId ? Number(req.body.rapidPlayerId) : undefined,
        name: req.body?.name,
        tour: req.body?.tour,
        pickIndex: req.body?.pickIndex !== undefined ? Number(req.body.pickIndex) : undefined,
        addedBy: 'admin_api',
      });

      if (result.searchHits && result.searchHits.length > 1 && req.body?.pickIndex === undefined) {
        return res.status(409).json({
          message: 'Multiple players found. Pick one with pickIndex.',
          hits: result.searchHits,
        });
      }

      if (!result.player) {
        return res.status(400).json({ error: 'Player could not be registered' });
      }

      const autoSync = req.body?.autoSync !== false;
      let syncResult = null;
      if (autoSync && result.player?.id) {
        syncResult = await syncTrackedPlayer(result.player.id, {
          sinceDate: req.body?.sinceDate || '2024-01-01',
          fetchAllPages: req.body?.fetchAllPages !== false,
          maxPages: req.body?.maxPages,
          maxBundleFetches: req.body?.maxBundleFetches ?? 0,
          bundlesOnly: req.body?.bundlesOnly === true,
          refreshEventPages: req.body?.refreshEventPages === true,
        });
      }

      res.json({ player: getTrackedPlayerStatus(result.player.id), sync: syncResult });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  },

  syncOne: async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const result = await syncTrackedPlayer(id, {
        sinceDate: req.body?.sinceDate || '2024-01-01',
        csvOnly: req.body?.csvOnly !== false,
        linkCsv: req.body?.linkCsv !== false,
        fetchBundles: req.body?.fetchBundles === true,
        bundlesOnly: req.body?.bundlesOnly === true,
        refreshEventPages: req.body?.refreshEventPages === true,
      });
      res.json({ result, player: getTrackedPlayerStatus(id) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  syncAll: async (req: Request, res: Response) => {
    try {
      const result = await syncAllTrackedPlayers({
        sinceDate: req.body?.sinceDate || '2024-01-01',
        maxPages: req.body?.maxPages || 6,
        maxPlayers: req.body?.maxPlayers || 50,
        fetchBundles: req.body?.fetchBundles !== false,
        maxBundleFetches: req.body?.maxBundleFetches ?? 0,
        bundlesOnly: req.body?.bundlesOnly === true,
        linkCsv: req.body?.linkCsv !== false,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  bootstrap: async (req: Request, res: Response) => {
    try {
      const result = await bootstrapTopRankedPlayers({
        limitPerTour: req.body?.limitPerTour || 200,
        autoSync: Boolean(req.body?.autoSync),
      });
      res.json({
        ...result,
        summary: TrackedPlayerRepo.count(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getArchive: async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const archive = getPlayerArchive(id);
      if (!archive) return res.status(404).json({ error: 'Player not found' });
      res.json(archive);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getMatchBundle: async (req: Request, res: Response) => {
    try {
      const playerId = parseInt(String(req.params.id), 10);
      const indexId = parseInt(String(req.params.indexId), 10);
      const bundle = getPlayerMatchBundle(playerId, indexId);
      if (!bundle) return res.status(404).json({ error: 'Match not found' });
      res.json(bundle);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  reindexCsv: async (req: Request, res: Response) => {
    try {
      const sinceDate = req.body?.sinceDate || '2018-01-01';
      const result = reindexAllTrackedPlayersFromHistorical(sinceDate);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  /** Catch-up update for recent + upcoming matches (low API usage). */
  dailyUpdate: async (req: Request, res: Response) => {
    try {
      const lookbackDays = Number(req.body?.lookbackDays || 30);
      const maxPlayers = Number(req.body?.maxPlayers || 60);
      const maxApiCalls = Number(req.body?.maxApiCalls || 200);
      const maxEventPages = Number(req.body?.maxEventPages || 3);
      const result = await runDailyPlayerUpdate({
        lookbackDays,
        maxPlayers,
        maxApiCalls,
        maxEventPages,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
};
