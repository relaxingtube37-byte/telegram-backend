import { db } from '../db/connection';
import { Logger } from '../utils/logger';
import { BackendTennisApi } from '../dataPool/dataPool.tennisApi';
import { computeFullMatchAnalytics, MatchAnalyticsInput, MatchAnalyticsResult } from '../engine';

export class PrecomputationService {
  /**
   * Retrieves precomputed match analytics from SQLite database in sub-millisecond time.
   */
  static getAnalyticsByFixtureId(fixtureId: number): MatchAnalyticsResult | null {
    try {
      const row = db.prepare(`
        SELECT * FROM match_analytics WHERE fixture_id = ?
      `).get(fixtureId) as any;

      if (!row) return null;

      if (row.raw_result_json) {
        return JSON.parse(row.raw_result_json) as MatchAnalyticsResult;
      }

      return {
        fixtureId: row.fixture_id,
        tournamentName: row.tournament_name,
        matchDate: row.match_date,
        homeName: row.home_name,
        awayName: row.away_name,
        surface: row.surface,
        computedAt: row.computed_at,
        energy: row.energy_json ? JSON.parse(row.energy_json) : null,
        environmental: null,
        surfaceKpis: row.surface_kpis_json ? JSON.parse(row.surface_kpis_json) : null,
        synergy: row.synergy_json ? JSON.parse(row.synergy_json) : null,
        tactical: row.tactical_json ? JSON.parse(row.tactical_json) : null,
        markovOdds: row.markov_odds_json ? JSON.parse(row.markov_odds_json) : null,
      };
    } catch (err: any) {
      Logger.error(`Error fetching match_analytics for fixture ${fixtureId}: ${err.message}`);
      return null;
    }
  }

  /**
   * Persists computed analytics into SQLite database permanently.
   */
  static saveMatchAnalytics(
    result: MatchAnalyticsResult,
    status: 'SUCCESS' | 'FAILED' = 'SUCCESS',
    errorMessage?: string
  ): void {
    try {
      const now = new Date().toISOString();
      const insert = db.prepare(`
        INSERT INTO match_analytics (
          fixture_id, tournament_name, round_name, match_date,
          home_id, away_id, home_name, away_name, surface,
          status, error_message, energy_json, surface_kpis_json,
          synergy_json, tactical_json, markov_odds_json, raw_result_json,
          computed_at, updated_at
        ) VALUES (
          @fixture_id, @tournament_name, @round_name, @match_date,
          @home_id, @away_id, @home_name, @away_name, @surface,
          @status, @error_message, @energy_json, @surface_kpis_json,
          @synergy_json, @tactical_json, @markov_odds_json, @raw_result_json,
          @computed_at, @updated_at
        )
        ON CONFLICT(fixture_id) DO UPDATE SET
          tournament_name = excluded.tournament_name,
          surface = excluded.surface,
          status = excluded.status,
          error_message = excluded.error_message,
          energy_json = excluded.energy_json,
          surface_kpis_json = excluded.surface_kpis_json,
          synergy_json = excluded.synergy_json,
          tactical_json = excluded.tactical_json,
          markov_odds_json = excluded.markov_odds_json,
          raw_result_json = excluded.raw_result_json,
          updated_at = excluded.updated_at
      `);

      insert.run({
        fixture_id: result.fixtureId,
        tournament_name: result.tournamentName || 'Tennis Tournament',
        round_name: '',
        match_date: result.matchDate || now.slice(0, 10),
        home_id: null,
        away_id: null,
        home_name: result.homeName,
        away_name: result.awayName,
        surface: result.surface || 'hard',
        status,
        error_message: errorMessage || null,
        energy_json: JSON.stringify(result.energy),
        surface_kpis_json: JSON.stringify(result.surfaceKpis),
        synergy_json: JSON.stringify(result.synergy),
        tactical_json: JSON.stringify(result.tactical),
        markov_odds_json: JSON.stringify(result.markovOdds),
        raw_result_json: JSON.stringify(result),
        computed_at: result.computedAt || now,
        updated_at: now,
      });
    } catch (err: any) {
      Logger.error(`Failed to save match_analytics: ${err.message}`);
    }
  }

  /**
   * Computes and saves analytics for a single raw event from the tennis API or frontend.
   */
  static async computeAndStoreMatch(ev: any): Promise<MatchAnalyticsResult | null> {
    try {
      const fixtureId = Number(ev.id || ev.fixtureId || ev.event?.id);
      if (!fixtureId) return null;

      const p1 = ev.homeTeam?.name || ev.player1 || ev.homeName || 'Player 1';
      const p2 = ev.awayTeam?.name || ev.player2 || ev.awayName || 'Player 2';
      const p1Id = ev.homeTeam?.id || ev.playerId1 || null;
      const p2Id = ev.awayTeam?.id || ev.playerId2 || null;
      const p1Rank = ev.homeTeam?.ranking || ev.rank1 || null;
      const p2Rank = ev.awayTeam?.ranking || ev.rank2 || null;
      const p1Country = ev.homeTeam?.country?.alpha2 || ev.country1 || 'US';
      const p2Country = ev.awayTeam?.country?.alpha2 || ev.country2 || 'US';

      const tourneyName = ev.tournament?.name || ev.tournamentName || ev.competition?.name || 'ATP Tour';
      const surface = ev.tournament?.groundType || ev.surface || 'hard';
      const isWTA = (tourneyName.toLowerCase().includes('wta') || (ev.tournament?.category?.name || '').toLowerCase().includes('wta'));

      const matchIsoDate = ev.startTimestamp ? new Date(ev.startTimestamp * 1000).toISOString() : (ev.fixture?.date || new Date().toISOString());

      // Query real surface stats from SQLite historical matches pool
      const homeSurfaceStats = PrecomputationService.queryPlayerSurfaceStats(p1, surface, matchIsoDate);
      const awaySurfaceStats = PrecomputationService.queryPlayerSurfaceStats(p2, surface, matchIsoDate);

      // Query real historical match timeline from SQLite pool for scientific fatigue & recovery with strict temporal cutoff
      const homeRecentMatches = PrecomputationService.queryPlayerRecentMatches(p1, 10, matchIsoDate);
      const awayRecentMatches = PrecomputationService.queryPlayerRecentMatches(p2, 10, matchIsoDate);

      const input: MatchAnalyticsInput = {
        fixtureId,
        tournamentName: tourneyName,
        roundName: ev.roundInfo?.name || ev.round || 'Main Draw',
        surface,
        matchDate: matchIsoDate,
        homePlayer: {
          id: p1Id,
          name: p1,
          country: p1Country,
          ranking: p1Rank,
        },
        awayPlayer: {
          id: p2Id,
          name: p2,
          country: p2Country,
          ranking: p2Rank,
        },
        homeSurfaceStats,
        awaySurfaceStats,
        homeRecentMatches,
        awayRecentMatches,
        isWTA,
      };

      const result = computeFullMatchAnalytics(input);
      this.saveMatchAnalytics(result, 'SUCCESS');
      return result;
    } catch (err: any) {
      Logger.error(`computeAndStoreMatch failed for fixture ${ev.id}: ${err.message}`);
      return null;
    }
  }

  private static PLAYER_MATCHES_CACHE = new Map<string, { time: number; data: any[] }>();

  /**
   * Cleans and extracts search surname from full name or abbreviated name (e.g. "J. Sinner" -> "Sinner")
   */
  static cleanPlayerSearchName(name: string): string {
    if (!name) return '';
    let normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    normalized = normalized.replace(/^[A-Z]\.\s*/i, '');
    normalized = normalized.replace(/\(.*\)/g, '').replace(/\[.*\]/g, '').trim();
    const tokens = normalized.split(/[\s-]+/).filter(t => t.length >= 3);
    return tokens.length > 0 ? tokens[tokens.length - 1] : normalized.trim();
  }

  /**
   * Queries real historical matches from SQLite for a player to calculate physiological fatigue and recovery.
   * Strictly enforces temporal isolation with asOfDate cutoff to prevent future data leakage.
   */
  static queryPlayerRecentMatches(playerName?: string, limit = 10, asOfDate?: string): any[] {
    if (!playerName || playerName === 'Player 1' || playerName === 'Player 2') return [];
    const cleanName = this.cleanPlayerSearchName(playerName);
    if (!cleanName || cleanName.length < 2) return [];

    const cutoffDate = asOfDate 
      ? (asOfDate.includes('T') ? asOfDate.split('T')[0] : asOfDate.trim())
      : new Date().toISOString().split('T')[0];

    const cacheKey = `${cleanName.toLowerCase()}_${limit}_${cutoffDate}`;
    const cached = this.PLAYER_MATCHES_CACHE.get(cacheKey);
    const now = Date.now();
    if (cached && (now - cached.time) < 10 * 60 * 1000) {
      return cached.data;
    }

    try {
      const rows = db.prepare(`
        SELECT match_date, tourney_name, surface, round_name, winner_name, loser_name, score, minutes
        FROM historical_matches
        WHERE (winner_name LIKE ? OR loser_name LIKE ?)
          AND match_date < ?
        ORDER BY match_date DESC
        LIMIT ?
      `).all(`%${cleanName}%`, `%${cleanName}%`, cutoffDate, limit) as any[];

      const data = rows.map(r => {
        const isWinner = (r.winner_name || '').toLowerCase().includes(cleanName.toLowerCase());
        return {
          date: r.match_date,
          durationMinutes: r.minutes || 105,
          winnerHome: isWinner,
          surface: r.surface || 'Hard',
          tournament: r.tourney_name,
          sets: (r.score || '').split(' ').map((s: string) => {
            const parts = s.split('-');
            return {
              homeScore: parseInt(parts[0], 10) || 0,
              awayScore: parseInt(parts[1], 10) || 0,
            };
          }),
        };
      });

      this.PLAYER_MATCHES_CACHE.set(cacheKey, { time: now, data });
      return data;
    } catch {
      return [];
    }
  }

  /**
   * Queries real surface statistics (win rate, 1st serve %, hold/break rates) from SQLite for a player.
   * Strictly enforces temporal isolation with asOfDate cutoff to prevent future data leakage.
   */
  static queryPlayerSurfaceStats(playerName?: string, surface = 'hard', asOfDate?: string): any {
    if (!playerName || playerName === 'Player 1' || playerName === 'Player 2') return null;
    const cleanName = this.cleanPlayerSearchName(playerName);
    if (!cleanName || cleanName.length < 2) return null;

    const cutoffDate = asOfDate 
      ? (asOfDate.includes('T') ? asOfDate.split('T')[0] : asOfDate.trim())
      : new Date().toISOString().split('T')[0];

    const surfNorm = surface.toLowerCase().includes('clay') ? 'Clay' : surface.toLowerCase().includes('grass') ? 'Grass' : 'Hard';

    try {
      const rows = db.prepare(`
        SELECT 
          winner_name, loser_name, surface,
          w_svpt, w_1stIn, w_1stWon, w_2ndWon, w_SvGms, w_bpSaved, w_bpFaced,
          l_svpt, l_1stIn, l_1stWon, l_2ndWon, l_SvGms, l_bpSaved, l_bpFaced
        FROM historical_matches
        WHERE (winner_name LIKE ? OR loser_name LIKE ?)
          AND surface LIKE ?
          AND match_date < ?
        ORDER BY match_date DESC
        LIMIT 40
      `).all(`%${cleanName}%`, `%${cleanName}%`, `%${surfNorm}%`, cutoffDate) as any[];

      if (rows.length === 0) return null;

      let wins = 0;
      let losses = 0;
      let firstServeTotal = 0;
      let firstServePointsScored = 0;
      let secondServeTotal = 0;
      let secondServePointsScored = 0;
      let serviceGamesTotal = 0;
      let serviceGamesWon = 0;
      let breakPointsSaved = 0;
      let breakPointsFaced = 0;
      let breakPointsConverted = 0;
      let breakPointsTotal = 0;
      let returnGamesTotal = 0;
      let returnGamesWon = 0;

      for (const r of rows) {
        const isWinner = (r.winner_name || '').toLowerCase().includes(cleanName.toLowerCase());
        if (isWinner) {
          wins++;
          firstServeTotal += r.w_1stIn || 45;
          firstServePointsScored += r.w_1stWon || 32;
          const svpt = r.w_svpt || 70;
          const firstIn = r.w_1stIn || 45;
          secondServeTotal += Math.max(0, svpt - firstIn);
          secondServePointsScored += r.w_2ndWon || 15;
          const svGms = r.w_SvGms || 10;
          serviceGamesTotal += svGms;
          const bpF = r.w_bpFaced || 2;
          const bpS = r.w_bpSaved || 2;
          breakPointsFaced += bpF;
          breakPointsSaved += bpS;
          serviceGamesWon += Math.max(0, svGms - bpF + bpS);
          const retGms = r.l_SvGms || 10;
          returnGamesTotal += retGms;
          const oppBpF = r.l_bpFaced || 3;
          const oppBpS = r.l_bpSaved || 1;
          breakPointsTotal += oppBpF;
          const breaksMade = Math.max(0, oppBpF - oppBpS);
          breakPointsConverted += breaksMade;
          returnGamesWon += breaksMade;
        } else {
          losses++;
          firstServeTotal += r.l_1stIn || 40;
          firstServePointsScored += r.l_1stWon || 25;
          const svpt = r.l_svpt || 65;
          const firstIn = r.l_1stIn || 40;
          secondServeTotal += Math.max(0, svpt - firstIn);
          secondServePointsScored += r.l_2ndWon || 12;
          const svGms = r.l_SvGms || 10;
          serviceGamesTotal += svGms;
          const bpF = r.l_bpFaced || 4;
          const bpS = r.l_bpSaved || 2;
          breakPointsFaced += bpF;
          breakPointsSaved += bpS;
          serviceGamesWon += Math.max(0, svGms - bpF + bpS);
          const retGms = r.w_SvGms || 10;
          returnGamesTotal += retGms;
          const oppBpF = r.w_bpFaced || 2;
          const oppBpS = r.w_bpSaved || 2;
          breakPointsTotal += oppBpF;
          const breaksMade = Math.max(0, oppBpF - oppBpS);
          breakPointsConverted += breaksMade;
          returnGamesWon += breaksMade;
        }
      }

      const totalMatches = wins + losses;
      return {
        surface: surfNorm,
        matches: totalMatches,
        wins,
        losses,
        winRatePct: Math.round((wins / Math.max(1, totalMatches)) * 100),
        firstServeTotal,
        firstServePointsScored,
        secondServeTotal,
        secondServePointsScored,
        serviceGamesTotal,
        serviceGamesWon,
        breakPointsSaved,
        breakPointsFaced,
        breakPointsTotal,
        breakPointsConverted,
        returnGamesTotal,
        returnGamesWon,
      };
    } catch {
      return null;
    }
  }

  /**
   * Main Lookahead Engine:
   * Scans upcoming 7 days, checks against SQLite DB, precomputes missing/failed matches.
   */
  static async runLookaheadPrecomputation(daysAhead = 7): Promise<{
    scannedDates: string[];
    totalEventsFound: number;
    newlyComputed: number;
    alreadyCached: number;
    failed: number;
  }> {
    Logger.info(`🔄 Starting Lookahead Precomputation for next ${daysAhead} days...`);
    const now = new Date();
    const scannedDates: string[] = [];
    let totalEventsFound = 0;
    let newlyComputed = 0;
    let alreadyCached = 0;
    let failed = 0;

    for (let i = 0; i <= daysAhead; i++) {
      const targetDate = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      const y = targetDate.getFullYear();
      const m = String(targetDate.getMonth() + 1).padStart(2, '0');
      const d = String(targetDate.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${d}`;
      scannedDates.push(dateStr);

      try {
        const raw = await BackendTennisApi.getDailyEvents(dateStr);
        if (!raw || !Array.isArray(raw.events)) continue;

        // Filter for ATP, WTA, and Grand Slam tournaments
        const targetEvents = raw.events.filter((e: any) => {
          if (!e || !e.id) return false;
          const catName = (e.tournament?.category?.name || e.category || '').toUpperCase();
          const tName = (e.tournament?.name || '').toUpperCase();
          const isDoubles = (e.homeTeam?.name || '').includes('/') || tName.includes('DOUBLES');
          // We compute for singles matches
          return (catName.includes('ATP') || catName.includes('WTA') || catName.includes('GRAND SLAM') || tName.includes('OPEN') || tName.includes('MASTERS')) && !isDoubles;
        });

        totalEventsFound += targetEvents.length;

        for (const ev of targetEvents) {
          const fixtureId = ev.id;
          
          // Check if already in DB with SUCCESS
          const existing = db.prepare(`
            SELECT id FROM match_analytics WHERE fixture_id = ? AND status = 'SUCCESS'
          `).get(fixtureId);

          if (existing) {
            alreadyCached++;
            continue;
          }

          // Precompute and store!
          const result = await this.computeAndStoreMatch(ev);
          if (result) {
            newlyComputed++;
          } else {
            failed++;
          }
        }
      } catch (err: any) {
        Logger.warn(`Lookahead sync error on date ${dateStr}: ${err.message}`);
      }
    }

    Logger.success(`✅ Lookahead Precomputation Completed: Scanned ${scannedDates.length} days | Total: ${totalEventsFound} | New: ${newlyComputed} | Cached: ${alreadyCached} | Failed: ${failed}`);

    return {
      scannedDates,
      totalEventsFound,
      newlyComputed,
      alreadyCached,
      failed,
    };
  }

  /**
   * Retries calculation for previously failed matches.
   */
  static async retryFailedMatches(): Promise<number> {
    try {
      const failedRows = db.prepare(`
        SELECT fixture_id, tournament_name, home_name, away_name, surface
        FROM match_analytics
        WHERE status = 'FAILED'
        LIMIT 50
      `).all() as any[];

      if (failedRows.length === 0) return 0;

      let recovered = 0;
      for (const row of failedRows) {
        const result = await this.computeAndStoreMatch({
          id: row.fixture_id,
          tournamentName: row.tournament_name,
          player1: row.home_name,
          player2: row.away_name,
          surface: row.surface,
        });
        if (result) recovered++;
      }

      Logger.info(`Retried ${failedRows.length} failed matches, successfully recovered: ${recovered}`);
      return recovered;
    } catch (err: any) {
      Logger.error(`retryFailedMatches error: ${err.message}`);
      return 0;
    }
  }
}
