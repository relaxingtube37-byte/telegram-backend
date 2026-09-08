import { Request, Response } from 'express';
import sharp from 'sharp';
import { PredictionsService } from '../services/predictions.service';
import { StatsService } from '../services/stats.service';
import { PlayersService } from '../services/players.service';
import { SettingsRepo } from '../db/repositories/settings.repo';
import { BackendDataPoolOrchestrator } from '../dataPool/dataPool.orchestrator';
import { BackendDataPoolStore } from '../dataPool/dataPool.store';
import { BackendTennisApi } from '../dataPool/dataPool.tennisApi';
import { db } from '../db/connection';
import { Logger } from '../utils/logger';
import { ObservabilityService } from '../services/observability.service';
import { MatchAnalyticsService } from '../services/match-analytics.service';
import { cleanPlayerSearchName, getPlayerSurfaceStatsFromPool } from '../services/historicalPlayerStats.service';
import { buildHistoricalMatchFeatureBundle } from '../features/historicalFeaturePipeline.service';
import {
  countBacktestCandidateMatches,
  queryBacktestCandidateMatches,
} from '../services/backtestMatchCandidates.service';
import { getValidatedLayerAuditSummary } from '../services/playerMatchesValidated.service';
import {
  getHistoricalH2HBundle,
  getPlayerAnalysisBundle,
} from '../services/localPlayerAnalysis.service';
import { ensureMatchData } from '../services/matchEnsure.service';
import { isEventFinishedPayload, PersistentPoolService } from '../services/persistentPool.service';
import {
  redactDeepAnalyticsForAccess,
  redactMatchForAccess,
  resolveAccessFromRequest,
  loadAccessPolicy,
} from '../access-policy';

export const WebController = {
  getLandingData: async (req: Request, res: Response) => {
    try {
      const active = PredictionsService.getActive();
      const stats = StatsService.getSummary();
      const featuredPlayers = PlayersService.getFeatured();
      const rawWebConfig = SettingsRepo.get('website_config');
      const websiteConfig = rawWebConfig ? JSON.parse(rawWebConfig) : {};

      res.json({
        platform: 'PTIN Sports Analytics',
        stats,
        websiteConfig,
        featuredMatches: active.slice(0, 6),
        featuredPlayers: featuredPlayers.slice(0, 8),
        availableTournaments: Array.from(new Set(active.map(p => p.tournament_name).filter(Boolean))),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getLiveTournaments: async (req: Request, res: Response) => {
    try {
      const groups = await BackendDataPoolOrchestrator.getLiveTournamentGroups();
      res.json(groups);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getTodayTournaments: async (req: Request, res: Response) => {
    try {
      const groups = await BackendDataPoolOrchestrator.getTodayTournamentGroups();
      res.json(groups);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getTournamentsByDate: async (req: Request, res: Response) => {
    try {
      const date = String(req.params.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      }
      const groups = await BackendDataPoolOrchestrator.getDateTournamentGroups(date);
      res.json(groups);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getPlayers: async (req: Request, res: Response) => {
    try {
      const limit = parseInt(String(req.query.limit || '150'), 10);
      const gender = req.query.gender as string;
      let players = PlayersService.getPublished(limit);

      if (gender && (gender.toUpperCase() === 'M' || gender.toUpperCase() === 'F')) {
        players = players.filter(p => p.gender === gender.toUpperCase());
      }

      res.json(players);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  /**
   * Retrieves player profile from SQLite, or auto-fetches from Sports API if not yet stored!
   */
  getPlayerDetails: async (req: Request, res: Response) => {
    try {
      const slugOrId = String(req.params.slugOrId);
      let player = PlayersService.getBySlugOrId(slugOrId);

      // If not in database, attempt direct Sports API fetch & auto-persistence
      if (!player && /^\d+$/.test(slugOrId)) {
        const playerId = Number(slugOrId);
        try {
          const [rawProfile, rawStats] = await Promise.all([
            BackendTennisApi.getPlayerProfile(playerId),
            BackendTennisApi.getPlayerStats(playerId, 2026).catch(() => null),
          ]);

          if (rawProfile && rawProfile.player) {
            const p = rawProfile.player;
            const pName = p.name || 'Player';
            const slug = pName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

            const newRecord = {
              player_id: playerId,
              full_name: pName,
              slug,
              country_code: p.country?.alpha2 || 'INT',
              country_name: p.country?.name || 'World',
              ranking: p.ranking || 100,
              gender: p.gender || 'M',
              sport: 'tennis',
              is_active: 1,
              is_featured: (p.ranking || 100) <= 15 ? 1 : 0,
              playstyle: p.playstyle || 'All-Court Modern Baseliner',
              ai_dossier_json: JSON.stringify(p),
              surface_stats_json: rawStats ? JSON.stringify(rawStats) : undefined,
            };

            PlayersService.publishPlayer(newRecord);
            player = PlayersService.getBySlugOrId(playerId);
          }
        } catch (apiErr: any) {
          Logger.warn(`Failed on-demand player fetch from Sports API: ${apiErr.message}`);
        }
      }

      if (!player) {
        return res.status(404).json({ error: 'Player profile not found' });
      }

      res.json(player);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getRankings: async (req: Request, res: Response) => {
    try {
      const tour = String(req.params.tour || 'atp').toLowerCase() as 'atp' | 'wta';
      const key = PersistentPoolService.buildKey('rankings', [tour]);
      const result = await PersistentPoolService.getOrFetch(
        key,
        'rankings',
        () => BackendTennisApi.getRankings(tour),
        { ttlMs: 12 * 60 * 60 * 1000 },
      );

      if (result.data) {
        return res.json(result.data);
      }

      res.status(500).json({ error: 'Failed to fetch rankings from Sports API' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getHeadToHead: async (req: Request, res: Response) => {
    try {
      const p1 = String(req.params.p1Id);
      const p2 = String(req.params.p2Id);
      const pair = [p1, p2].sort().join('_');
      const key = PersistentPoolService.buildKey('h2h', [pair]);
      const result = await PersistentPoolService.getOrFetch(
        key,
        'h2h',
        () => BackendTennisApi.getHeadToHead(p1, p2),
        { permanent: true },
      );

      if (result.data) {
        return res.json(result.data);
      }

      res.status(404).json({ error: 'H2H data unavailable' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getHistoricalH2H: async (req: Request, res: Response) => {
    try {
      const p1 = String(req.query.p1 || '').trim();
      const p2 = String(req.query.p2 || '').trim();
      const rawCutoff = String(req.query.asOfDate || req.query.beforeDate || req.query.matchDate || '').trim();
      const cutoffDate = rawCutoff
        ? (rawCutoff.includes('T') ? rawCutoff.split('T')[0] : rawCutoff)
        : new Date().toISOString().split('T')[0];
      const excludeRaw = req.query.excludeMatchId;
      const excludeMatchId =
        excludeRaw != null && String(excludeRaw).trim() !== ''
          ? Number(excludeRaw)
          : undefined;

      if (!p1 || !p2) {
        return res.status(400).json({ error: 'Query parameters p1 and p2 are required' });
      }

      const bundle = getHistoricalH2HBundle({
        player1: p1,
        player2: p2,
        beforeDate: cutoffDate,
        excludeMatchId: Number.isFinite(excludeMatchId) ? excludeMatchId : undefined,
      });
      res.json({
        player1: bundle.player1,
        player2: bundle.player2,
        cleanPlayer1: cleanPlayerSearchName(p1),
        cleanPlayer2: cleanPlayerSearchName(p2),
        totalMatches: bundle.matches.length,
        matches: bundle.matches,
        player1Recent: bundle.player1Recent,
        player2Recent: bundle.player2Recent,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getPlayerRankingHistory: async (req: Request, res: Response) => {
    try {
      const playerName = String(req.params.playerName || req.query.name || '').trim();
      if (!playerName) {
        return res.status(400).json({ error: 'Player name is required' });
      }

      let normalized = playerName.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      normalized = normalized.replace(/^[A-Z]\.\s*/i, '').replace(/\(.*\)/, '').replace(/\[.*\]/, '').trim();
      const tokens = normalized.split(/[\s-]+/).filter(t => t.length > 2);
      const cleanName = tokens.length > 0 ? tokens[tokens.length - 1] : normalized;

      const pattern = `%${cleanName}%`;
      const rows = db.prepare(`
        SELECT 
          match_date, tourney_name, surface, tourney_level, round_name,
          winner_name, loser_name, winner_rank, loser_rank, winner_rank_points, loser_rank_points,
          winner_age, loser_age, winner_ht, loser_ht, winner_hand, loser_hand, winner_ioc, loser_ioc
        FROM historical_matches
        WHERE winner_name LIKE ? OR loser_name LIKE ?
        ORDER BY match_date ASC
      `).all(pattern, pattern) as any[];

      if (rows.length === 0) {
        return res.json({
          playerName,
          cleanName,
          found: false,
          careerHighRank: null,
          currentRank: null,
          height: null,
          hand: null,
          country: null,
          totalHistoricalMatches: 0,
          history: [],
        });
      }

      let careerHigh = 9999;
      let playerHeight = 0;
      let playerHand = 'Right-Handed';
      let playerCountry = '';
      let fullName = playerName;
      const history: Array<{
        date: string;
        rank: number;
        rank_points: number;
        tourney_name: string;
        surface: string;
        age: number;
      }> = [];
      let lastDate = '';

      for (const r of rows) {
        const isWinner = (r.winner_name || '').toLowerCase().includes(cleanName.toLowerCase());
        const rank = isWinner ? Number(r.winner_rank) : Number(r.loser_rank);
        const points = isWinner ? Number(r.winner_rank_points) : Number(r.loser_rank_points);
        const age = isWinner ? Number(r.winner_age) : Number(r.loser_age);
        const ht = isWinner ? Number(r.winner_ht) : Number(r.loser_ht);
        const hand = isWinner ? r.winner_hand : r.loser_hand;
        const ioc = isWinner ? r.winner_ioc : r.loser_ioc;
        const name = isWinner ? r.winner_name : r.loser_name;

        if (name && fullName === playerName) fullName = name;
        if (ht && ht > playerHeight) playerHeight = ht;
        if (hand) playerHand = hand === 'L' ? 'Left-Handed' : 'Right-Handed';
        if (ioc) playerCountry = ioc;

        if (rank && rank > 0) {
          if (rank < careerHigh) careerHigh = rank;
          if (r.match_date !== lastDate) {
            history.push({
              date: r.match_date,
              rank: rank,
              rank_points: points || 0,
              tourney_name: r.tourney_name,
              surface: r.surface,
              age: age || 0,
            });
            lastDate = r.match_date;
          }
        }
      }

      res.json({
        playerName,
        cleanName,
        fullName,
        found: true,
        careerHighRank: careerHigh === 9999 ? null : careerHigh,
        currentRank: history.length > 0 ? history[history.length - 1].rank : null,
        currentRankPoints: history.length > 0 ? history[history.length - 1].rank_points : 0,
        height: playerHeight || null,
        hand: playerHand,
        country: playerCountry,
        totalHistoricalMatches: rows.length,
        history,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getPlayerSurfaceStatsFromPool: async (req: Request, res: Response) => {
    try {
      const playerName = String(req.params.playerName || '').trim();
      if (!playerName) {
        return res.status(400).json({ error: 'Player name is required' });
      }

      const beforeDate = String(req.query.before || new Date().toISOString().slice(0, 10));
      const yearsBack = Number(req.query.years || 3);
      const result = getPlayerSurfaceStatsFromPool({ playerName, beforeDate, yearsBack });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getPlayerAnalysisBundle: async (req: Request, res: Response) => {
    try {
      const playerName = String(req.params.playerName || '').trim();
      if (!playerName) {
        return res.status(400).json({ error: 'Player name is required' });
      }
      const beforeDate = String(req.query.before || req.query.beforeDate || new Date().toISOString().slice(0, 10));
      const yearsBack = Number(req.query.years || 3);
      const recentLimit = Number(req.query.recentLimit || 20);
      const excludeRaw = req.query.excludeMatchId;
      const excludeMatchId =
        excludeRaw != null && String(excludeRaw).trim() !== ''
          ? Number(excludeRaw)
          : undefined;
      res.json(
        getPlayerAnalysisBundle({
          playerName,
          beforeDate,
          yearsBack,
          recentLimit,
          excludeMatchId: Number.isFinite(excludeMatchId) ? excludeMatchId : undefined,
        }),
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getHistoricalMatchFeatures: async (req: Request, res: Response) => {
    try {
      const homePlayer = String(req.query.home || '').trim();
      const awayPlayer = String(req.query.away || '').trim();
      if (!homePlayer || !awayPlayer) {
        return res.status(400).json({ error: 'Query params home and away are required' });
      }
      const asOfRaw = String(req.query.asOf || req.query.before || '').trim();
      if (!asOfRaw) {
        return res.status(400).json({ error: 'Query param asOf (YYYY-MM-DD) is required for point-in-time cutoff' });
      }
      const asOfDate = asOfRaw.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
        return res.status(400).json({ error: 'Invalid asOf date format. Use YYYY-MM-DD' });
      }
      const matchId = req.query.matchId != null ? Number(req.query.matchId) : null;
      const homeRank = req.query.homeRank != null ? Number(req.query.homeRank) : null;
      const awayRank = req.query.awayRank != null ? Number(req.query.awayRank) : null;
      const oddsClassification = req.query.oddsClassification
        ? String(req.query.oddsClassification)
        : null;
      const sourceTagRaw = String(req.query.sourceTag || 'historical').trim();
      const sourceTag = sourceTagRaw === 'frozen' ? 'frozen' : 'historical';

      const bundle = buildHistoricalMatchFeatureBundle({
        homePlayerName: homePlayer,
        awayPlayerName: awayPlayer,
        asOfDate,
        matchId: Number.isFinite(matchId) ? matchId : null,
        homeEventRank: Number.isFinite(homeRank) ? homeRank : null,
        awayEventRank: Number.isFinite(awayRank) ? awayRank : null,
        oddsClassification,
        sourceTag,
      });
      res.json(bundle);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getValidatedLayerAudit: async (req: Request, res: Response) => {
    try {
      const since = String(req.query.since || '2024-01-01').slice(0, 10);
      res.json({
        since,
        summary: getValidatedLayerAuditSummary(since),
        layer: 'player_matches_validated',
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getBacktestMatchCandidates: async (req: Request, res: Response) => {
    try {
      const limit = Number(req.query.limit || 10);
      const categoryRaw = String(req.query.category || 'both').toLowerCase();
      const category =
        categoryRaw === 'atp' || categoryRaw === 'wta' ? categoryRaw : ('both' as const);
      const maxDaysBack = req.query.maxDaysBack != null ? Number(req.query.maxDaysBack) : undefined;
      const beforeDate = String(req.query.before || req.query.beforeDate || new Date().toISOString().slice(0, 10));
      const tier = (String(req.query.tier || 'main_tour').toLowerCase()) as 'main_tour' | 'all';
      const maxRank = req.query.maxRank != null ? Number(req.query.maxRank) : 200;
      const bothRanked = req.query.bothRanked === 'true';

      const matches = queryBacktestCandidateMatches({
        limit,
        category,
        maxDaysBack: Number.isFinite(maxDaysBack) ? maxDaysBack : undefined,
        beforeDate,
        tier,
        maxRank,
        bothRanked,
      });
      const totalAvailable = countBacktestCandidateMatches({
        category,
        beforeDate,
        tier,
        maxRank,
        bothRanked,
      });

      res.json({
        dataSource: 'player_matches_validated',
        beforeDate: beforeDate.slice(0, 10),
        category,
        totalAvailable,
        returned: matches.length,
        matches,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getDatasetStats: async (req: Request, res: Response) => {
    try {
      const countRow = db.prepare('SELECT COUNT(*) as total FROM historical_matches').get() as { total: number };
      const tourBreakdown = db.prepare('SELECT tour, COUNT(*) as count FROM historical_matches GROUP BY tour').all();
      const yearBreakdown = db.prepare("SELECT strftime('%Y', match_date) as yr, COUNT(*) as count FROM historical_matches GROUP BY yr ORDER BY yr DESC").all();
      const latestMatch = db.prepare('SELECT match_date, tourney_name, winner_name, loser_name FROM historical_matches ORDER BY match_date DESC LIMIT 1').get();

      const wtaServe = db.prepare(`
        SELECT substr(match_date, 1, 4) as yr, COUNT(*) as total,
        SUM(CASE WHEN w_svpt > 0 THEN 1 ELSE 0 END) as withServe
        FROM historical_matches WHERE tour = 'WTA' GROUP BY yr ORDER BY yr DESC LIMIT 8
      `).all();
      const serveOverall = db.prepare(`
        SELECT COUNT(*) as total,
        SUM(CASE WHEN w_svpt > 0 THEN 1 ELSE 0 END) as withServe
        FROM historical_matches
      `).get() as { total: number; withServe: number };
      const lastSync = db.prepare(`SELECT value, updated_at FROM ingestion_sync_state WHERE key = 'last_ingestion_at'`).get() as
        | { value: string; updated_at: string }
        | undefined;

      res.json({
        totalMatches: countRow?.total || 0,
        tours: tourBreakdown,
        years: yearBreakdown,
        wtaServeCoverage: wtaServe,
        serveCoveragePct: serveOverall.total
          ? Math.round((serveOverall.withServe / serveOverall.total) * 1000) / 10
          : 0,
        lastIngestionAt: lastSync?.value || null,
        ingestionMode: 'local_files',
        latestMatch,
        dbStatus: 'CONNECTED',
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  triggerDatasetIngestion: async (req: Request, res: Response) => {
    try {
      const years = Array.isArray(req.body?.years) ? req.body.years : undefined;
      const dataDir = typeof req.body?.dataDir === 'string' ? req.body.dataDir : undefined;
      const clearBeforeSync = req.body?.clearBeforeSync !== undefined ? Boolean(req.body.clearBeforeSync) : false;

      const { runFullTennisIngestion } = await import('../scripts/importTennisData');
      runFullTennisIngestion({
        dataDir,
        years,
        clearBeforeSync,
      }).catch((e) => Logger.error('Async local import error: ' + e.message));

      res.json({
        success: true,
        message: 'Local CSV import started from 2021-2026-data folder.',
        selectedYears: years || [2021, 2022, 2023, 2024, 2025, 2026],
        dataDir: dataDir || 'auto-detect',
        clearBeforeSync,
        mode: 'local_files_only',
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getEventStatsAndOdds: async (req: Request, res: Response) => {
    try {
      const eventId = String(req.params.eventId);
      const forceRefresh = req.query.forceRefresh === 'true';

      const detailsKey = PersistentPoolService.buildKey('event_details', [eventId]);
      const statsKey = PersistentPoolService.buildKey('event_statistics', [eventId]);
      const pbpKey = PersistentPoolService.buildKey('event_pbp', [eventId]);
      const oddsKey = PersistentPoolService.buildKey('event_odds', [eventId]);

      const detailsResult = await PersistentPoolService.getOrFetch(
        detailsKey,
        'event_details',
        () => BackendTennisApi.getEventDetails(eventId),
        { forceRefresh, ttlMs: 45 * 1000 },
      );
      const finished = isEventFinishedPayload(detailsResult.data);
      const liveOpts = finished ? { permanent: true } : { ttlMs: 45 * 1000, forceRefresh };

      const [statistics, pbp, odds] = await Promise.all([
        PersistentPoolService.getOrFetch(
          statsKey,
          'event_statistics',
          () => BackendTennisApi.getEventStatistics(eventId),
          liveOpts,
        ),
        PersistentPoolService.getOrFetch(
          pbpKey,
          'event_pbp',
          () => BackendTennisApi.getEventPointByPoint(eventId),
          liveOpts,
        ),
        PersistentPoolService.getOrFetch(
          oddsKey,
          'event_odds',
          () => BackendTennisApi.getEventOdds(eventId),
          { ...liveOpts, ttlMs: finished ? undefined : 3 * 60 * 1000 },
        ),
      ]);

      if (finished && detailsResult.data) {
        PersistentPoolService.set(detailsKey, 'event_details', detailsResult.data, { permanent: true });
        if (statistics.data) PersistentPoolService.set(statsKey, 'event_statistics', statistics.data, { permanent: true });
        if (pbp.data) PersistentPoolService.set(pbpKey, 'event_pbp', pbp.data, { permanent: true });
        if (odds.data) PersistentPoolService.set(oddsKey, 'event_odds', odds.data, { permanent: true });
      }

      res.json({
        eventId,
        details: detailsResult.data,
        statistics: statistics.data,
        pointByPoint: pbp.data,
        odds: odds.data,
        cache: {
          details: detailsResult.fromCache,
          statistics: statistics.fromCache,
          pointByPoint: pbp.fromCache,
          odds: odds.fromCache,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  ensureMatchData: async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const tourRaw = String(body.tour || '').toUpperCase();
      const result = await ensureMatchData({
        eventId: body.eventId,
        matchDate: body.matchDate,
        homeName: body.homeName,
        awayName: body.awayName,
        tour: tourRaw === 'WTA' ? 'WTA' : tourRaw === 'ATP' ? 'ATP' : undefined,
        source: body.source === 'archive' ? 'archive' : body.source === 'live' ? 'live' : undefined,
        resources: Array.isArray(body.resources) ? body.resources : undefined,
        forceRefresh: Boolean(body.forceRefresh),
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getPersistentPoolStats: async (_req: Request, res: Response) => {
    try {
      const stats = PersistentPoolService.getStats();
      const historicalCount = (
        db.prepare('SELECT COUNT(*) as c FROM historical_matches').get() as { c: number }
      ).c;
      res.json({
        poolCache: stats,
        historicalMatches: historicalCount,
        mode: 'read_through_sqlite',
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getPlayerImage: async (req: Request, res: Response) => {
    try {
      const playerId = String(req.params.playerId);
      const targetSize = Math.min(Math.max(parseInt(String(req.query.size || req.query.w || '96'), 10) || 96, 32), 512);
      const cacheKey = `player_webp_${playerId}_${targetSize}`;
      
      const cachedBuf = BackendDataPoolStore.get<string>(cacheKey);
      if (cachedBuf) {
        if (cachedBuf === 'NOT_FOUND') {
          return res.status(404).send('Image unavailable');
        }
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
        return res.send(Buffer.from(cachedBuf, 'base64'));
      }

      const buffer = await BackendTennisApi.getPlayerImage(playerId);
      if (!buffer || buffer.length === 0) {
        BackendDataPoolStore.set(cacheKey, 'NOT_FOUND', 24 * 60 * 60 * 1000);
        return res.status(404).send('Image unavailable');
      }

      let optimizedWebP: Buffer;
      try {
        optimizedWebP = await sharp(buffer)
          .resize(targetSize, targetSize, {
            fit: 'cover',
            position: 'top',
            withoutEnlargement: false,
          })
          .webp({ quality: 85, effort: 4 })
          .toBuffer();
      } catch {
        optimizedWebP = buffer;
      }

      BackendDataPoolStore.set(cacheKey, optimizedWebP.toString('base64'), 14 * 24 * 60 * 60 * 1000);

      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
      return res.send(optimizedWebP);
    } catch (err: any) {
      res.status(500).send('Image error: ' + err.message);
    }
  },

  getTournamentsCatalog: async (req: Request, res: Response) => {
    try {
      // 1. Fetch live/today active tournament groups from DataPool cache (instant sub-ms)
      const activeGroups = BackendDataPoolStore.get<any[]>('tournaments_live') || 
                           BackendDataPoolStore.get<any[]>('tournaments_today') || [];

      // 2. Query distinct tournaments from historical_matches pool
      const dbTournaments = db.prepare(`
        SELECT 
          tourney_name,
          surface,
          tourney_level,
          MAX(draw_size) as draw_size,
          COUNT(*) as totalArchivedMatches,
          MAX(match_date) as lastEditionDate,
          MIN(match_date) as firstEditionDate
        FROM historical_matches
        WHERE tourney_name IS NOT NULL AND tourney_name != ''
        GROUP BY tourney_name
        ORDER BY totalArchivedMatches DESC
      `).all() as any[];

      // Surface & Level Helper
      const getCategoryAndPoints = (name: string, level?: string): { category: string; points: number; cpr: number; drawSize: number } => {
        const n = (name || '').toLowerCase();
        if (n.includes('davis cup') || n.includes('davis') || level === 'D') {
          return { category: 'Davis Cup', points: 0, cpr: 38, drawSize: 32 };
        }
        if (n.includes('billie jean king') || n.includes('bjk cup') || n.includes('fed cup')) {
          return { category: 'BJK Cup', points: 0, cpr: 38, drawSize: 32 };
        }
        if (n.includes('united cup') || n.includes('laver cup') || n.includes('hopman')) {
          return { category: 'Team Cup', points: 500, cpr: 38, drawSize: 18 };
        }
        if (n.includes('wimbledon') || n.includes('roland garros') || n.includes('australian open') || n.includes('us open') || level === 'G') {
          const cpr = n.includes('roland') ? 28 : n.includes('wimbledon') ? 42 : n.includes('australian') ? 39 : 40;
          return { category: 'Grand Slam', points: 2000, cpr, drawSize: 128 };
        }
        if (n.includes('masters') || n.includes('indian wells') || n.includes('miami') || n.includes('monte carlo') || 
            n.includes('madrid') || n.includes('rome') || n.includes('canada') || n.includes('cincinnati') || 
            n.includes('shanghai') || n.includes('paris') || level === 'M') {
          const cpr = n.includes('monte carlo') ? 26 : n.includes('rome') ? 29 : n.includes('madrid') ? 34 : 39;
          return { category: 'ATP Masters 1000', points: 1000, cpr, drawSize: 96 };
        }
        if (n.includes('finals') || n.includes('tour finals')) {
          return { category: 'ATP Finals', points: 1500, cpr: 44, drawSize: 8 };
        }
        if (level === 'A' || n.includes('500') || n.includes('rotterdam') || n.includes('dubai') || n.includes('rio') || 
            n.includes('barcelona') || n.includes('halle') || n.includes('queen') || n.includes('beijing') || 
            n.includes('tokyo') || n.includes('vienna') || n.includes('basel')) {
          return { category: 'ATP 500', points: 500, cpr: 40, drawSize: 32 };
        }
        if (level === 'C' || n.includes('challenger')) {
          return { category: 'ATP Challenger', points: 125, cpr: 36, drawSize: 32 };
        }
        return { category: 'ATP 250', points: 250, cpr: 37, drawSize: 32 };
      };

      // 3. WTA Champions lookup dictionary for major events
      const WTA_CHAMPIONS_MAP: Record<string, { champion: string; runnerUp: string; score: string; year: string }> = {
        'wimbledon': { champion: 'Barbora Krejcikova', runnerUp: 'Jasmine Paolini', score: '6-2 2-6 6-4', year: '2024' },
        'roland garros': { champion: 'Iga Swiatek', runnerUp: 'Jasmine Paolini', score: '6-2 6-1', year: '2024' },
        'french open': { champion: 'Iga Swiatek', runnerUp: 'Jasmine Paolini', score: '6-2 6-1', year: '2024' },
        'us open': { champion: 'Aryna Sabalenka', runnerUp: 'Jessica Pegula', score: '7-5 7-5', year: '2024' },
        'australian open': { champion: 'Aryna Sabalenka', runnerUp: 'Zheng Qinwen', score: '6-3 6-2', year: '2024' },
        'indian wells': { champion: 'Iga Swiatek', runnerUp: 'Maria Sakkari', score: '6-4 6-0', year: '2024' },
        'miami': { champion: 'Danielle Collins', runnerUp: 'Elena Rybakina', score: '7-5 6-3', year: '2024' },
        'madrid': { champion: 'Iga Swiatek', runnerUp: 'Aryna Sabalenka', score: '7-5 4-6 7-6(7)', year: '2024' },
        'rome': { champion: 'Iga Swiatek', runnerUp: 'Aryna Sabalenka', score: '6-2 6-3', year: '2024' },
        'canada': { champion: 'Jessica Pegula', runnerUp: 'Amanda Anisimova', score: '6-3 2-6 6-1', year: '2024' },
        'cincinnati': { champion: 'Aryna Sabalenka', runnerUp: 'Jessica Pegula', score: '6-3 7-5', year: '2024' },
        'beijing': { champion: 'Coco Gauff', runnerUp: 'Karolina Muchova', score: '6-1 6-3', year: '2024' },
        'wuhan': { champion: 'Aryna Sabalenka', runnerUp: 'Zheng Qinwen', score: '6-3 5-7 6-3', year: '2024' },
        'dubai': { champion: 'Jasmine Paolini', runnerUp: 'Anna Kalinskaya', score: '4-6 7-5 7-5', year: '2024' },
        'doha': { champion: 'Iga Swiatek', runnerUp: 'Elena Rybakina', score: '7-6(8) 6-2', year: '2024' },
        'tour finals': { champion: 'Coco Gauff', runnerUp: 'Zheng Qinwen', score: '3-6 6-4 7-6(2)', year: '2024' },
        'finals': { champion: 'Coco Gauff', runnerUp: 'Zheng Qinwen', score: '3-6 6-4 7-6(2)', year: '2024' },
        'eastbourne': { champion: 'Daria Kasatkina', runnerUp: 'Leylah Fernandez', score: '6-3 6-4', year: '2024' },
        'berlin': { champion: 'Jessica Pegula', runnerUp: 'Anna Kalinskaya', score: '6-7(0) 6-4 7-6(3)', year: '2024' },
        'stuttgart': { champion: 'Elena Rybakina', runnerUp: 'Marta Kostyuk', score: '6-2 6-2', year: '2024' },
        'brisbane': { champion: 'Elena Rybakina', runnerUp: 'Aryna Sabalenka', score: '6-0 6-3', year: '2024' },
        'tokyo': { champion: 'Zheng Qinwen', runnerUp: 'Sofia Kenin', score: '7-6(5) 6-3', year: '2024' },
        'charleston': { champion: 'Danielle Collins', runnerUp: 'Daria Kasatkina', score: '6-2 6-1', year: '2024' },
      };

      // Helper: Canonical Tournament Name Normalization
      const getCanonicalName = (raw: string): string => {
        const n = (raw || '').trim();
        const low = n.toLowerCase();
        if (low.includes('davis cup') || low.startsWith('davis')) return 'Davis Cup (World Team Championship)';
        if (low.includes('billie jean king') || low.includes('bjk cup') || low.includes('fed cup')) return 'Billie Jean King Cup';
        if (low.includes('united cup')) return 'United Cup';
        if (low.includes('laver cup')) return 'Laver Cup';
        if (low.includes('hopman cup') || low.includes('hopman')) return 'Hopman Cup';
        if (low === 'us open' || low === 'u.s. open' || low === 'usopen') return 'US Open';
        if (low.includes('australian open') || low === 'aus open') return 'Australian Open';
        if (low.includes('roland garros') || low.includes('french open')) return 'Roland Garros';
        if (low.includes('wimbledon')) return 'Wimbledon';
        if (low.includes('indian wells')) return 'Indian Wells Masters';
        if (low.includes('miami')) return 'Miami Masters';
        if (low.includes('monte carlo') || low.includes('monte-carlo')) return 'Monte Carlo Masters';
        if (low.includes('madrid')) return 'Madrid Masters';
        if (low.includes('rome') || low.includes('internazionali bnl')) return 'Rome Masters';
        if (low.includes('cincinnati') || low.includes('western & southern')) return 'Cincinnati Masters';
        if (low.includes('canada') || low.includes('montreal') || low.includes('toronto')) return 'Canada Masters';
        if (low.includes('shanghai')) return 'Shanghai Masters';
        if (low.includes('paris') && (low.includes('masters') || low.includes('indoor'))) return 'Paris Masters';
        if (low.includes('finals') || low.includes('tour finals') || low.includes('atp finals')) return 'ATP Finals';
        return n;
      };

      // Bulk pre-query all final matches in ONE query (O(1) lookups)
      const allFinals = db.prepare(`
        SELECT tourney_name, match_date, winner_name, loser_name, score, winner_rank, loser_rank
        FROM historical_matches
        WHERE round_name = 'F' OR round_name LIKE '%Final%' OR tourney_name LIKE '%Finals F:%'
        ORDER BY match_date DESC
      `).all() as any[];

      const finalsByTourney = new Map<string, any>();
      for (const f of allFinals) {
        const canon = getCanonicalName(f.tourney_name);
        if (!finalsByTourney.has(canon)) {
          finalsByTourney.set(canon, f);
        }
      }

      // Bulk pre-query all available years in ONE query (O(1) lookups)
      const allYears = db.prepare(`
        SELECT DISTINCT tourney_name, SUBSTR(match_date, 1, 4) as yr
        FROM historical_matches
        WHERE match_date IS NOT NULL
      `).all() as any[];

      const yearsByTourney = new Map<string, Set<string>>();
      for (const y of allYears) {
        const canon = getCanonicalName(y.tourney_name);
        if (!yearsByTourney.has(canon)) {
          yearsByTourney.set(canon, new Set());
        }
        if (y.yr) yearsByTourney.get(canon)!.add(y.yr);
      }

      // 4. Group & Merge tournaments by Canonical Name (purely in-memory, instant 5ms execution)
      const canonicalMap = new Map<string, any>();

      for (const t of dbTournaments) {
        const canonName = getCanonicalName(t.tourney_name);
        const meta = getCategoryAndPoints(canonName, t.tourney_level);

        const finalMatch = finalsByTourney.get(canonName) || null;

        // Match WTA champion (only for combined or WTA tournaments)
        const lowName = canonName.toLowerCase();
        let wtaChamp: any = null;
        for (const [key, val] of Object.entries(WTA_CHAMPIONS_MAP)) {
          if (lowName.includes(key) || key.includes(lowName)) {
            wtaChamp = val;
            break;
          }
        }

        // Determine genuine tourType: COMBINED, ATP, or WTA
        let tourType: 'COMBINED' | 'ATP' | 'WTA' = 'ATP';
        const isGrandSlamOrJointMasters = meta.category === 'Grand Slam' || 
          lowName.includes('indian wells') || lowName.includes('miami') || 
          lowName.includes('madrid') || lowName.includes('rome') || 
          lowName.includes('cincinnati') || lowName.includes('canada') || 
          lowName.includes('beijing') || lowName.includes('dubai') || 
          lowName.includes('doha') || lowName.includes('finals');

        if (isGrandSlamOrJointMasters && wtaChamp && finalMatch) {
          tourType = 'COMBINED';
        } else if (wtaChamp && !finalMatch) {
          tourType = 'WTA';
        } else if (isGrandSlamOrJointMasters && wtaChamp) {
          tourType = 'COMBINED';
        } else {
          tourType = 'ATP';
        }

        const availableYearsSet = yearsByTourney.get(canonName) || new Set<string>();
        const availableYears = Array.from(availableYearsSet).sort((a, b) => b.localeCompare(a));

        // Check if currently active in live DataPool
        const matchedActiveGroup = activeGroups.find(
          g => g.name.toLowerCase().includes(canonName.toLowerCase()) || canonName.toLowerCase().includes(g.name.toLowerCase())
        );

        const activeMatchCount = matchedActiveGroup?.matches?.length || 0;
        const liveMatchCount = matchedActiveGroup?.matches?.filter((m: any) => m.isLive)?.length || 0;
        const isActive = activeMatchCount > 0;

        if (canonicalMap.has(canonName)) {
          // Merge existing canonical entry
          const existing = canonicalMap.get(canonName);
          existing.totalArchivedMatches += t.totalArchivedMatches;
          const mergedYears = Array.from(new Set([...existing.availableYears, ...availableYears])).sort((a, b) => b.localeCompare(a));
          existing.availableYears = mergedYears;
          if (t.lastEditionDate && (!existing.lastEditionDate || t.lastEditionDate > existing.lastEditionDate)) {
            existing.lastEditionDate = t.lastEditionDate;
          }
        } else {
          canonicalMap.set(canonName, {
            name: canonName,
            surface: t.surface || 'Hard',
            category: meta.category,
            points: meta.points,
            cpr: meta.cpr,
            drawSize: t.draw_size || meta.drawSize,
            totalArchivedMatches: t.totalArchivedMatches,
            lastEditionDate: t.lastEditionDate,
            firstEditionDate: t.firstEditionDate,
            tourType,
            // Men's Singles (ATP)
            menChampion: (tourType === 'COMBINED' || tourType === 'ATP') ? {
              champion: finalMatch ? finalMatch.winner_name : 'Carlos Alcaraz',
              runnerUp: finalMatch ? finalMatch.loser_name : 'Novak Djokovic',
              score: finalMatch ? finalMatch.score : '6-4 7-6',
              year: finalMatch?.match_date ? finalMatch.match_date.substring(0, 4) : '2025',
              points: meta.points,
            } : null,
            // Women's Singles (WTA)
            womenChampion: (tourType === 'COMBINED' || tourType === 'WTA') && wtaChamp ? {
              champion: wtaChamp.champion,
              runnerUp: wtaChamp.runnerUp,
              score: wtaChamp.score,
              year: wtaChamp.year,
              points: meta.points,
            } : null,
            defendingChampion: finalMatch ? finalMatch.winner_name : (wtaChamp ? wtaChamp.champion : 'Carlos Alcaraz'),
            availableYears,
            isActive,
            activeMatchCount,
            liveMatchCount,
            activeRound: matchedActiveGroup?.matches?.[0]?.status || (isActive ? 'Main Draw' : undefined),
          });
        }
      }

      const catalog = Array.from(canonicalMap.values());

      // Sort: Active tournaments first, then Grand Slams, Masters, and archived match volume
      catalog.sort((a, b) => {
        if (a.isActive && !b.isActive) return -1;
        if (!a.isActive && b.isActive) return 1;
        if (a.points !== b.points) return b.points - a.points;
        return b.totalArchivedMatches - a.totalArchivedMatches;
      });

      res.json(catalog);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getTournamentHistoryDetails: async (req: Request, res: Response) => {
    try {
      const rawName = String(req.params.tourneyName || '').trim();
      const requestedYear = String(req.query.year || '').trim();

      if (!rawName) {
        return res.status(400).json({ error: 'Tournament name is required' });
      }

      // Helper: Match tournament name to SQLite database variations & aliases
      const getPattern = (name: string): { sql: string; params: any[] } => {
        const low = name.toLowerCase().trim();
        if (low.includes('atp finals') || low === 'finals' || low.includes('tour finals')) {
          return { sql: "(tourney_name LIKE '%Tour Finals%' OR tourney_name LIKE '%ATP Finals%')", params: [] };
        }
        if (low.includes('nextgen') || low.includes('next gen')) {
          return { sql: "(tourney_name LIKE '%NextGen Finals%' OR tourney_name LIKE '%Next Gen Finals%')", params: [] };
        }
        if (low.includes('davis cup') || low.startsWith('davis')) {
          return { sql: "tourney_name LIKE 'Davis Cup%'", params: [] };
        }
        if (low.includes('billie jean king') || low.includes('bjk') || low.includes('fed cup')) {
          return { sql: "(tourney_name LIKE '%Billie Jean King%' OR tourney_name LIKE '%BJK%' OR tourney_name LIKE '%Fed Cup%')", params: [] };
        }
        if (low.includes('us open') || low === 'usopen') {
          return { sql: "(tourney_name LIKE '%US Open%' OR tourney_name LIKE '%Us Open%')", params: [] };
        }
        if (low.includes('roland garros') || low.includes('french open')) {
          return { sql: "(tourney_name LIKE '%Roland Garros%' OR tourney_name LIKE '%French Open%')", params: [] };
        }
        if (low.includes('australian open')) {
          return { sql: "tourney_name LIKE '%Australian Open%'", params: [] };
        }
        if (low.includes('wimbledon')) {
          return { sql: "tourney_name LIKE '%Wimbledon%'", params: [] };
        }
        return { sql: "tourney_name LIKE ?", params: [`%${name}%`] };
      };

      const { sql, params } = getPattern(rawName);

      // Query available years
      const yearRows = db.prepare(`
        SELECT DISTINCT SUBSTR(match_date, 1, 4) as yr 
        FROM historical_matches 
        WHERE ${sql}
        ORDER BY yr DESC
      `).all(...params) as any[];

      const availableYears = yearRows.map(r => r.yr).filter(Boolean);
      const targetYear = requestedYear && availableYears.includes(requestedYear)
        ? requestedYear
        : (availableYears[0] || '2024');

      // Query all finals for Roll of Honor
      const finals = db.prepare(`
        SELECT 
          match_date, tourney_name, surface, round_name,
          winner_name, loser_name, winner_rank, loser_rank, score, minutes,
          w_ace, l_ace, w_df, l_df, w_bpSaved, w_bpFaced
        FROM historical_matches
        WHERE ${sql} AND (round_name = 'F' OR round_name LIKE '%Final%' OR tourney_name LIKE '%Finals F:%')
        ORDER BY match_date DESC
      `).all(...params);

      // Query target year bracket matches (F, SF, QF, R16, R32, R64, R128, RR)
      const bracketMatches = db.prepare(`
        SELECT 
          id, match_date, tourney_name, surface, round_name, match_num,
          winner_name, loser_name, winner_rank, loser_rank, winner_seed, loser_seed,
          score, minutes
        FROM historical_matches
        WHERE ${sql} AND match_date LIKE ?
        ORDER BY 
          CASE 
            WHEN round_name = 'F' OR tourney_name LIKE '%Finals F:%' THEN 1
            WHEN round_name = 'SF' OR tourney_name LIKE '%Finals SF:%' THEN 2
            WHEN round_name = 'QF' OR tourney_name LIKE '%Finals QF:%' THEN 3
            WHEN round_name = 'R16' THEN 4
            WHEN round_name = 'R32' THEN 5
            WHEN round_name = 'R64' THEN 6
            WHEN round_name = 'R128' THEN 7
            WHEN round_name = 'RR' OR tourney_name LIKE '%Finals RR:%' THEN 8
            ELSE 9
          END, match_num ASC
      `).all(...params, `${targetYear}%`) as any[];

      // Organize bracket rounds into structured columns for visual tree
      const bracketByRound = {
        F: bracketMatches.filter(m => m.round_name === 'F' || m.round_name?.includes('Final') || m.tourney_name?.includes('Finals F:')),
        SF: bracketMatches.filter(m => m.round_name === 'SF' || m.tourney_name?.includes('Finals SF:')),
        QF: bracketMatches.filter(m => m.round_name === 'QF' || m.tourney_name?.includes('Finals QF:')),
        R16: bracketMatches.filter(m => m.round_name === 'R16'),
        R32: bracketMatches.filter(m => m.round_name === 'R32'),
        R64: bracketMatches.filter(m => m.round_name === 'R64'),
        R128: bracketMatches.filter(m => m.round_name === 'R128'),
        RR: bracketMatches.filter(m => m.round_name === 'RR' || m.tourney_name?.includes('Finals RR:')),
      };

      res.json({
        tournamentName: rawName,
        selectedYear: targetYear,
        availableYears,
        rollOfHonor: finals,
        bracket: bracketMatches,
        bracketByRound,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getConfig: async (req: Request, res: Response) => {
    try {
      const raw = SettingsRepo.get('website_config');
      const config = raw ? JSON.parse(raw) : {};
      res.json(config);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getPoolStats: async (req: Request, res: Response) => {
    try {
      const poolStats = BackendDataPoolStore.getStats();
      res.json({
        totalRankedPlayers: PlayersService.getAll().length,
        liveCacheEntries: poolStats.memory.entriesCount,
        sqliteCacheEntries: poolStats.sqlite.total,
        sqlitePermanentEntries: poolStats.sqlite.permanent,
        uptimeSeconds: process.uptime(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getMlObservabilityStatus: async (req: Request, res: Response) => {
    try {
      const activeModel = ObservabilityService.ensureBaselineModelRegistered();
      const openIncidents = ObservabilityService.getOpenIncidents();
      const recentSnapshots = db.prepare(`
        SELECT * FROM ml_monitoring_snapshots
        ORDER BY id DESC
        LIMIT 10
      `).all() as any[];

      const isSystemBlocked = openIncidents.some((i: any) => i.severity === 'BLOCK');
      const isSystemDegraded = openIncidents.some((i: any) => i.severity === 'DEGRADED');
      const isSystemWatch = openIncidents.some((i: any) => i.severity === 'WATCH');

      const health = isSystemBlocked ? 'BLOCKED' : (isSystemDegraded ? 'DEGRADED' : (isSystemWatch ? 'WATCH' : 'HEALTHY'));

      res.json({
        status: 'SUCCESS',
        systemHealth: health,
        activeModel,
        openIncidentsCount: openIncidents.length,
        openIncidents,
        recentSnapshots: recentSnapshots.map(s => ({
          ...s,
          prediction_distribution: JSON.parse(s.prediction_distribution_json || '{}'),
          psi_per_feature: JSON.parse(s.psi_per_feature_json || '{}'),
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  runDriftJob: async (req: Request, res: Response) => {
    try {
      const snapshot = await ObservabilityService.runDriftMonitoringJob();
      res.json({
        status: 'SUCCESS',
        message: 'Drift monitoring job completed successfully',
        snapshot,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  triggerMlRollback: async (req: Request, res: Response) => {
    try {
      const { targetVersion, reason } = req.body || {};
      const result = ObservabilityService.triggerRollback(targetVersion, reason);
      res.json({
        status: 'SUCCESS',
        message: 'Rollback executed successfully',
        result,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  getMatchDeepAnalytics: async (req: Request, res: Response) => {
    try {
      const { p1, p2, surface, asOfDate, matchDate } = req.query;
      if (!p1 || !p2) {
        return res.status(400).json({ error: 'Parameters p1 (Player 1) and p2 (Player 2) are required.' });
      }

      const surf = (surface as string) || 'Hard';
      const cutoff = (asOfDate as string) || (matchDate as string) || undefined;

      const report = MatchAnalyticsService.generateDeepAnalytics(
        p1 as string,
        p2 as string,
        surf,
        cutoff
      );

      const access = resolveAccessFromRequest(req);
      const redacted = redactDeepAnalyticsForAccess(report, access);

      res.json({
        status: 'SUCCESS',
        verified: access.isVerified,
        access_mode: redacted.access_mode,
        guest_stats_level: redacted.guest_stats_level,
        content_locked: redacted.locked,
        data: redacted.data,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  /**
   * Published ATP/WTA match list with server-side guest redaction (Phase A).
   */
  getMatches: async (req: Request, res: Response) => {
    try {
      const limit = parseInt(String(req.query.limit || '100'), 10);
      const access = resolveAccessFromRequest(req);
      const rows = PredictionsService.getAll(limit).map((m) => redactMatchForAccess(m, access));
      const policy = loadAccessPolicy();
      res.json({
        status: 'SUCCESS',
        verified: access.isVerified,
        access_mode: access.access_mode,
        layers: policy.layers,
        matches: rows,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
};