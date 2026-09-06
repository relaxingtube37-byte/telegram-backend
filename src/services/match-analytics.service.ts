import { db } from '../db/connection';
import { Logger } from '../utils/logger';
import { calculateWeightedFatigueLoad } from '../engine/physics/fatigueEngine';

export interface PlayerRollingForm {
  playerName: string;
  matchesEvaluated: number;
  last5WinRatePct: number;
  last10WinRatePct: number;
  currentStreak: string; // e.g. "+4 W" or "-2 L"
  setsWinRatePct: number;
  recentScores: string[];
}

export interface SafeH2HSummary {
  totalPreMatchEncounters: number;
  p1Wins: number;
  p2Wins: number;
  surfaceH2H: {
    surface: string;
    p1Wins: number;
    p2Wins: number;
  }[];
  recentEncounters: {
    matchDate: string;
    tourneyName: string;
    surface: string;
    roundName: string;
    winnerName: string;
    score: string;
  }[];
}

export interface SurfaceMasteryMetrics {
  surface: string;
  matchesCount: number;
  winRatePct: number;
  holdRatePct: number;
  breakRatePct: number;
  totalSynergyIndex: number; // Hold% + Break%
}

export interface WorkloadExposureMetrics {
  daysSinceLastMatch: number;
  restHours: number;
  acute7dMatchesCount: number;
  acute7dMinutes: number;
  energyTankPct: number;
  compositeFatigueIndex: number;
  fatigueStatusLabel: string;
}

export interface ClutchResilienceMetrics {
  decidingSetWinRatePct: number;
  tiebreakWinRatePct: number;
  breakPointsSavedPct: number;
  breakPointsConvertedPct: number;
  clutchIndexScore: number;
}

export interface MatchupGapMetrics {
  p1ServeVsP2ReturnEdge: number;
  p2ServeVsP1ReturnEdge: number;
  p1AceAvg: number;
  p2AceAvg: number;
  p1DfAvg: number;
  p2DfAvg: number;
  rankDelta: number;
}

export interface MatchDeepAnalyticsReport {
  matchInfo: {
    player1: string;
    player2: string;
    surface: string;
    asOfCutoff: string;
    dataCompletenessPct: number;
  };
  p1RollingForm: PlayerRollingForm;
  p2RollingForm: PlayerRollingForm;
  h2hSummary: SafeH2HSummary;
  p1SurfaceMastery: SurfaceMasteryMetrics;
  p2SurfaceMastery: SurfaceMasteryMetrics;
  p1Workload: WorkloadExposureMetrics;
  p2Workload: WorkloadExposureMetrics;
  p1Clutch: ClutchResilienceMetrics;
  p2Clutch: ClutchResilienceMetrics;
  matchupGaps: MatchupGapMetrics;
  explanationCards: {
    title: string;
    tag: string;
    description: string;
    confidence: 'HIGH' | 'MEDIUM' | 'INFO';
  }[];
}

function cleanName(name: string): string {
  if (!name) return '';
  let normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  normalized = normalized.replace(/^[A-Z]\.\s*/i, '').replace(/\(.*\)/g, '').replace(/\[.*\]/g, '').trim();
  const tokens = normalized.split(/[\s-]+/).filter(t => t.length >= 3);
  return (tokens.length > 0 ? tokens[tokens.length - 1] : normalized).toLowerCase();
}

export const MatchAnalyticsService = {
  /**
   * Generates a 100% cutoff-safe, comprehensive analytical dossier for any two players
   */
  generateDeepAnalytics: (
    player1Name: string,
    player2Name: string,
    surface = 'Hard',
    asOfDate?: string
  ): MatchDeepAnalyticsReport => {
    const cutoffDate = asOfDate || new Date().toISOString().split('T')[0];
    const p1Clean = cleanName(player1Name);
    const p2Clean = cleanName(player2Name);

    // 1. Fetch pre-match historical matches for P1 (strictly before cutoffDate)
    const p1Matches = db.prepare(`
      SELECT match_date, tourney_name, surface, round_name, winner_name, loser_name,
             winner_rank, loser_rank, score, minutes,
             w_ace, w_df, l_ace, l_df, w_1stIn, w_1stWon, w_2ndWon, w_SvGms,
             l_1stIn, l_1stWon, l_2ndWon, l_SvGms, w_bpSaved, w_bpFaced, l_bpSaved, l_bpFaced
      FROM historical_matches
      WHERE (winner_name LIKE ? OR loser_name LIKE ?)
        AND match_date < ?
      ORDER BY match_date DESC
      LIMIT 30
    `).all(`%${p1Clean}%`, `%${p1Clean}%`, cutoffDate) as any[];

    // 2. Fetch pre-match historical matches for P2 (strictly before cutoffDate)
    const p2Matches = db.prepare(`
      SELECT match_date, tourney_name, surface, round_name, winner_name, loser_name,
             winner_rank, loser_rank, score, minutes,
             w_ace, w_df, l_ace, l_df, w_1stIn, w_1stWon, w_2ndWon, w_SvGms,
             l_1stIn, l_1stWon, l_2ndWon, l_SvGms, w_bpSaved, w_bpFaced, l_bpSaved, l_bpFaced
      FROM historical_matches
      WHERE (winner_name LIKE ? OR loser_name LIKE ?)
        AND match_date < ?
      ORDER BY match_date DESC
      LIMIT 30
    `).all(`%${p2Clean}%`, `%${p2Clean}%`, cutoffDate) as any[];

    // 3. Fetch safe pre-match H2H encounters
    const h2hMatches = db.prepare(`
      SELECT match_date, tourney_name, surface, round_name, winner_name, loser_name, score
      FROM historical_matches
      WHERE ((winner_name LIKE ? AND loser_name LIKE ?) OR (winner_name LIKE ? AND loser_name LIKE ?))
        AND match_date < ?
      ORDER BY match_date DESC
    `).all(`%${p1Clean}%`, `%${p2Clean}%`, `%${p2Clean}%`, `%${p1Clean}%`, cutoffDate) as any[];

    // Helper: Compute Rolling Form
    const computeRollingForm = (matches: any[], nameClean: string, displayName: string): PlayerRollingForm => {
      if (matches.length === 0) {
        return {
          playerName: displayName,
          matchesEvaluated: 0,
          last5WinRatePct: 50.0,
          last10WinRatePct: 50.0,
          currentStreak: 'N/A',
          setsWinRatePct: 50.0,
          recentScores: [],
        };
      }

      const l5 = matches.slice(0, 5);
      const l10 = matches.slice(0, 10);

      const isWin = (m: any) => cleanName(m.winner_name) === nameClean;
      const l5Wins = l5.filter(isWin).length;
      const l10Wins = l10.filter(isWin).length;

      // Streak calculation
      let streakType = isWin(matches[0]) ? 'W' : 'L';
      let streakCount = 0;
      for (const m of matches) {
        if ((isWin(m) ? 'W' : 'L') === streakType) {
          streakCount++;
        } else {
          break;
        }
      }

      // Sets win rate
      let setsWon = 0;
      let setsTotal = 0;
      l10.forEach(m => {
        const win = isWin(m);
        const scoreParts = (m.score || '').trim().split(/\s+/);
        scoreParts.forEach((sp: string) => {
          const games = sp.split('-').map(Number);
          if (games.length === 2 && !isNaN(games[0]) && !isNaN(games[1])) {
            setsTotal++;
            if (win ? games[0] > games[1] : games[1] > games[0]) {
              setsWon++;
            }
          }
        });
      });

      return {
        playerName: displayName,
        matchesEvaluated: matches.length,
        last5WinRatePct: Math.round((l5Wins / Math.max(1, l5.length)) * 1000) / 10,
        last10WinRatePct: Math.round((l10Wins / Math.max(1, l10.length)) * 1000) / 10,
        currentStreak: `${streakType === 'W' ? '+' : '-'}${streakCount} ${streakType}`,
        setsWinRatePct: setsTotal > 0 ? Math.round((setsWon / setsTotal) * 1000) / 10 : 50.0,
        recentScores: l5.map(m => `${isWin(m) ? 'W' : 'L'} vs ${isWin(m) ? m.loser_name : m.winner_name} (${m.score})`),
      };
    };

    const p1RollingForm = computeRollingForm(p1Matches, p1Clean, player1Name);
    const p2RollingForm = computeRollingForm(p2Matches, p2Clean, player2Name);

    // Helper: Compute Safe H2H
    let p1H2hWins = 0;
    let p2H2hWins = 0;
    const surfaceMap = new Map<string, { p1Wins: number; p2Wins: number }>();

    h2hMatches.forEach(m => {
      const p1Won = cleanName(m.winner_name) === p1Clean;
      if (p1Won) p1H2hWins++;
      else p2H2hWins++;

      const surf = m.surface || 'Hard';
      const cur = surfaceMap.get(surf) || { p1Wins: 0, p2Wins: 0 };
      if (p1Won) cur.p1Wins++;
      else cur.p2Wins++;
      surfaceMap.set(surf, cur);
    });

    const h2hSummary: SafeH2HSummary = {
      totalPreMatchEncounters: h2hMatches.length,
      p1Wins: p1H2hWins,
      p2Wins: p2H2hWins,
      surfaceH2H: Array.from(surfaceMap.entries()).map(([surf, record]) => ({
        surface: surf,
        p1Wins: record.p1Wins,
        p2Wins: record.p2Wins,
      })),
      recentEncounters: h2hMatches.slice(0, 5).map(m => ({
        matchDate: m.match_date,
        tourneyName: m.tourney_name,
        surface: m.surface,
        roundName: m.round_name,
        winnerName: m.winner_name,
        score: m.score,
      })),
    };

    // Helper: Compute Surface Mastery
    const computeSurfaceMastery = (matches: any[], nameClean: string, targetSurf: string): SurfaceMasteryMetrics => {
      const surfMatches = matches.filter(m => (m.surface || '').toLowerCase() === targetSurf.toLowerCase());
      if (surfMatches.length === 0) {
        return {
          surface: targetSurf,
          matchesCount: 0,
          winRatePct: 50.0,
          holdRatePct: 78.0,
          breakRatePct: 22.0,
          totalSynergyIndex: 100.0,
        };
      }

      const isWin = (m: any) => cleanName(m.winner_name) === nameClean;
      const wins = surfMatches.filter(isWin).length;

      let holdGms = 0;
      let holdTot = 0;
      let breakGms = 0;
      let breakTot = 0;

      surfMatches.forEach(m => {
        const win = isWin(m);
        if (win) {
          const svg = m.w_SvGms || 10;
          holdTot += svg;
          holdGms += Math.max(0, svg - (m.w_bpFaced || 2) + (m.w_bpSaved || 2));
          const retGms = m.l_SvGms || 10;
          breakTot += retGms;
          breakGms += Math.max(0, (m.l_bpFaced || 2) - (m.l_bpSaved || 2));
        } else {
          const svg = m.l_SvGms || 10;
          holdTot += svg;
          holdGms += Math.max(0, svg - (m.l_bpFaced || 2) + (m.l_bpSaved || 2));
          const retGms = m.w_SvGms || 10;
          breakTot += retGms;
          breakGms += Math.max(0, (m.w_bpFaced || 2) - (m.w_bpSaved || 2));
        }
      });

      const holdRate = holdTot > 0 ? (holdGms / holdTot) * 100 : 78.0;
      const breakRate = breakTot > 0 ? (breakGms / breakTot) * 100 : 22.0;

      return {
        surface: targetSurf,
        matchesCount: surfMatches.length,
        winRatePct: Math.round(((wins + 2.5) / (surfMatches.length + 5.0)) * 1000) / 10,
        holdRatePct: Math.round(holdRate * 10) / 10,
        breakRatePct: Math.round(breakRate * 10) / 10,
        totalSynergyIndex: Math.round((holdRate + breakRate) * 10) / 10,
      };
    };

    const p1SurfaceMastery = computeSurfaceMastery(p1Matches, p1Clean, surface);
    const p2SurfaceMastery = computeSurfaceMastery(p2Matches, p2Clean, surface);

    // Helper: Compute Bio-Fatigue & Workload Exposure
    const computeWorkload = (matches: any[], nameClean: string): WorkloadExposureMetrics => {
      if (matches.length === 0) {
        return {
          daysSinceLastMatch: 999,
          restHours: 999 * 24,
          acute7dMatchesCount: 0,
          acute7dMinutes: 0,
          energyTankPct: 100,
          compositeFatigueIndex: 0.0,
          fatigueStatusLabel: 'Full (100%)',
        };
      }

      const cutoffDt = new Date(cutoffDate);
      const lastMatchDt = new Date(matches[0].match_date);
      const restHours = Math.max(12, Math.round((cutoffDt.getTime() - lastMatchDt.getTime()) / 3600000));
      const daysSince = Math.round(restHours / 24);

      // Matches in 7 days before cutoff
      const acuteMatches = matches.filter(m => {
        const mdt = new Date(m.match_date);
        const diffDays = (cutoffDt.getTime() - mdt.getTime()) / 86400000;
        return diffDays >= 0 && diffDays <= 7;
      });

      const acuteMinutes = acuteMatches.reduce((sum, m) => sum + (m.minutes || 90), 0);

      // Bio-Fatigue calculation
      let wfl = 0.0;
      acuteMatches.forEach(m => {
        const mdt = new Date(m.match_date);
        const daysAgo = Math.max(0.5, (cutoffDt.getTime() - mdt.getTime()) / 86400000);
        const dur = m.minutes || 90;
        wfl += (22 * 1.0 + (dur / 60.0) * 8.0) * Math.exp(-0.12 * daysAgo);
      });

      const shortRestDeficit = restHours < 24 ? 14.0 : 0.0;
      const energy = Math.max(15, Math.min(100, Math.round(100 - (wfl * 0.16) - shortRestDeficit)));
      const compFatigue = Math.round(((100 - energy) / 100) * 100) / 100;

      let label = 'Full (100%)';
      if (energy >= 85) label = `Fresh (${energy}%)`;
      else if (energy >= 65) label = `Good (${energy}%)`;
      else if (energy >= 50) label = `Moderate Drain (${energy}%)`;
      else label = `Critical Fatigue (${energy}%)`;

      return {
        daysSinceLastMatch: daysSince,
        restHours,
        acute7dMatchesCount: acuteMatches.length,
        acute7dMinutes: acuteMinutes,
        energyTankPct: energy,
        compositeFatigueIndex: compFatigue,
        fatigueStatusLabel: label,
      };
    };

    const p1Workload = computeWorkload(p1Matches, p1Clean);
    const p2Workload = computeWorkload(p2Matches, p2Clean);

    // Helper: Compute Clutch & Pressure Composure
    const computeClutch = (matches: any[], nameClean: string): ClutchResilienceMetrics => {
      const evalPool = matches.slice(0, 15);
      if (evalPool.length === 0) {
        return {
          decidingSetWinRatePct: 50.0,
          tiebreakWinRatePct: 50.0,
          breakPointsSavedPct: 62.0,
          breakPointsConvertedPct: 38.0,
          clutchIndexScore: 50.0,
        };
      }

      const isWin = (m: any) => cleanName(m.winner_name) === nameClean;
      let decidingSets = 0;
      let decidingWins = 0;
      let tiebreaks = 0;
      let tiebreakWins = 0;

      let bpSaved = 0;
      let bpFaced = 0;
      let bpConverted = 0;
      let bpOppFaced = 0;

      evalPool.forEach(m => {
        const win = isWin(m);
        const score = m.score || '';
        const sets = score.trim().split(/\s+/);

        // Deciding set
        if (sets.length >= 3) {
          decidingSets++;
          if (win) decidingWins++;
        }

        // Tiebreak
        sets.forEach((s: string) => {
          if (s.includes('7-6') || s.includes('6-7')) {
            tiebreaks++;
            if (win && s.includes('7-6')) tiebreakWins++;
            else if (!win && s.includes('6-7')) tiebreakWins++;
          }
        });

        // Break points
        if (win) {
          bpSaved += m.w_bpSaved || 2;
          bpFaced += m.w_bpFaced || 3;
          bpConverted += Math.max(0, (m.l_bpFaced || 3) - (m.l_bpSaved || 2));
          bpOppFaced += m.l_bpFaced || 3;
        } else {
          bpSaved += m.l_bpSaved || 2;
          bpFaced += m.l_bpFaced || 3;
          bpConverted += Math.max(0, (m.w_bpFaced || 3) - (m.w_bpSaved || 2));
          bpOppFaced += m.w_bpFaced || 3;
        }
      });

      const decidingWr = decidingSets > 0 ? (decidingWins / decidingSets) * 100 : 50.0;
      const tbWr = tiebreaks > 0 ? (tiebreakWins / tiebreaks) * 100 : 50.0;
      const bpSavedRate = bpFaced > 0 ? (bpSaved / bpFaced) * 100 : 62.0;
      const bpConvRate = bpOppFaced > 0 ? (bpConverted / bpOppFaced) * 100 : 38.0;

      const clutchIndex = Math.round(
        (decidingWr * 0.35 + tbWr * 0.25 + bpSavedRate * 0.25 + bpConvRate * 0.15) * 10
      ) / 10;

      return {
        decidingSetWinRatePct: Math.round(decidingWr * 10) / 10,
        tiebreakWinRatePct: Math.round(tbWr * 10) / 10,
        breakPointsSavedPct: Math.round(bpSavedRate * 10) / 10,
        breakPointsConvertedPct: Math.round(bpConvRate * 10) / 10,
        clutchIndexScore: clutchIndex,
      };
    };

    const p1Clutch = computeClutch(p1Matches, p1Clean);
    const p2Clutch = computeClutch(p2Matches, p2Clean);

    // Helper: Compute Matchup Gaps
    const calcServeReturnEdge = (pServeMatches: any[], pRetMatches: any[], pServeClean: string, pRetClean: string) => {
      const pServeWinRate = pServeMatches.length > 0
        ? pServeMatches.reduce((acc, m) => {
            const isWin = cleanName(m.winner_name) === pServeClean;
            const svWon = isWin ? m.w_1stWon || 30 : m.l_1stWon || 25;
            const svIn = isWin ? m.w_1stIn || 45 : m.l_1stIn || 40;
            return acc + (svWon / Math.max(1, svIn));
          }, 0) / pServeMatches.length
        : 0.70;

      const pRetWinRate = pRetMatches.length > 0
        ? pRetMatches.reduce((acc, m) => {
            const isWin = cleanName(m.winner_name) === pRetClean;
            const opp1stIn = isWin ? m.l_1stIn || 45 : m.w_1stIn || 45;
            const opp1stWon = isWin ? m.l_1stWon || 28 : m.w_1stWon || 32;
            const retPtsWon = Math.max(0, opp1stIn - opp1stWon);
            return acc + (retPtsWon / Math.max(1, opp1stIn));
          }, 0) / pRetMatches.length
        : 0.30;

      return Math.round((pServeWinRate - pRetWinRate) * 1000) / 10;
    };

    const p1Aces = p1Matches.length > 0 ? p1Matches.reduce((acc, m) => acc + (cleanName(m.winner_name) === p1Clean ? m.w_ace || 5 : m.l_ace || 3), 0) / p1Matches.length : 4.5;
    const p2Aces = p2Matches.length > 0 ? p2Matches.reduce((acc, m) => acc + (cleanName(m.winner_name) === p2Clean ? m.w_ace || 5 : m.l_ace || 3), 0) / p2Matches.length : 4.5;
    const p1Df = p1Matches.length > 0 ? p1Matches.reduce((acc, m) => acc + (cleanName(m.winner_name) === p1Clean ? m.w_df || 2 : m.l_df || 3), 0) / p1Matches.length : 2.5;
    const p2Df = p2Matches.length > 0 ? p2Matches.reduce((acc, m) => acc + (cleanName(m.winner_name) === p2Clean ? m.w_df || 2 : m.l_df || 3), 0) / p2Matches.length : 2.5;

    const p1Rank = p1Matches[0] ? (cleanName(p1Matches[0].winner_name) === p1Clean ? p1Matches[0].winner_rank : p1Matches[0].loser_rank) || 50 : 50;
    const p2Rank = p2Matches[0] ? (cleanName(p2Matches[0].winner_name) === p2Clean ? p2Matches[0].winner_rank : p2Matches[0].loser_rank) || 50 : 50;

    const matchupGaps: MatchupGapMetrics = {
      p1ServeVsP2ReturnEdge: calcServeReturnEdge(p1Matches, p2Matches, p1Clean, p2Clean),
      p2ServeVsP1ReturnEdge: calcServeReturnEdge(p2Matches, p1Matches, p2Clean, p1Clean),
      p1AceAvg: Math.round(p1Aces * 10) / 10,
      p2AceAvg: Math.round(p2Aces * 10) / 10,
      p1DfAvg: Math.round(p1Df * 10) / 10,
      p2DfAvg: Math.round(p2Df * 10) / 10,
      rankDelta: p2Rank - p1Rank,
    };

    // 4. Generate Human-Readable Analytical Explanation Cards for UI
    const explanationCards: MatchDeepAnalyticsReport['explanationCards'] = [];

    // Card 1: Form & Momentum
    if (p1RollingForm.last5WinRatePct >= 80) {
      explanationCards.push({
        title: `${player1Name} in Peak Form`,
        tag: '🔥 Red-Hot Momentum',
        description: `${player1Name} enters on a strong ${p1RollingForm.currentStreak} run with ${p1RollingForm.last5WinRatePct}% win rate over their last 5 matches.`,
        confidence: 'HIGH',
      });
    } else if (p2RollingForm.last5WinRatePct >= 80) {
      explanationCards.push({
        title: `${player2Name} in Peak Form`,
        tag: '🔥 Red-Hot Momentum',
        description: `${player2Name} has won ${p2RollingForm.last5WinRatePct}% of their last 5 encounters (${p2RollingForm.currentStreak}).`,
        confidence: 'HIGH',
      });
    }

    // Card 2: Surface Specialization
    if (Math.abs(p1SurfaceMastery.winRatePct - p2SurfaceMastery.winRatePct) >= 15 && (p1SurfaceMastery.matchesCount >= 3 || p2SurfaceMastery.matchesCount >= 3)) {
      const advPlayer = p1SurfaceMastery.winRatePct > p2SurfaceMastery.winRatePct ? player1Name : player2Name;
      const advRate = Math.max(p1SurfaceMastery.winRatePct, p2SurfaceMastery.winRatePct);
      explanationCards.push({
        title: `${advPlayer} Surface Mastery`,
        tag: `⚡ ${surface} Specialist`,
        description: `${advPlayer} holds an outstanding ${advRate}% Bayesian-adjusted win rate on ${surface} courts (TSI: ${Math.max(p1SurfaceMastery.totalSynergyIndex, p2SurfaceMastery.totalSynergyIndex)}).`,
        confidence: 'HIGH',
      });
    }

    // Card 3: Fatigue / Recovery Edge
    if (Math.abs(p1Workload.energyTankPct - p2Workload.energyTankPct) >= 15) {
      const fresherPlayer = p1Workload.energyTankPct > p2Workload.energyTankPct ? player1Name : player2Name;
      const tiredPlayer = p1Workload.energyTankPct > p2Workload.energyTankPct ? player2Name : player1Name;
      const energyDiff = Math.abs(p1Workload.energyTankPct - p2Workload.energyTankPct);
      explanationCards.push({
        title: `${fresherPlayer} Stamina Advantage`,
        tag: '🔋 Biological Recovery Edge',
        description: `${fresherPlayer} has a +${energyDiff}% physical energy advantage over ${tiredPlayer} following unrecovered match strain in recent rounds.`,
        confidence: 'MEDIUM',
      });
    }

    // Card 4: Pressure / Clutch
    if (Math.abs(p1Clutch.clutchIndexScore - p2Clutch.clutchIndexScore) >= 10) {
      const clutchPlayer = p1Clutch.clutchIndexScore > p2Clutch.clutchIndexScore ? player1Name : player2Name;
      explanationCards.push({
        title: `${clutchPlayer} Pressure Composure`,
        tag: '🎯 High-Stakes Resilience',
        description: `${clutchPlayer} excels in deciding sets and tiebreaks with a ${Math.max(p1Clutch.clutchIndexScore, p2Clutch.clutchIndexScore)} composite pressure rating.`,
        confidence: 'MEDIUM',
      });
    }

    // Card 5: H2H Historical Dynamic
    if (h2hSummary.totalPreMatchEncounters >= 2) {
      const leader = h2hSummary.p1Wins > h2hSummary.p2Wins ? player1Name : (h2hSummary.p2Wins > h2hSummary.p1Wins ? player2Name : 'Tied');
      explanationCards.push({
        title: 'Head-to-Head History',
        tag: '⚔️ Historical Rivalry',
        description: leader === 'Tied'
          ? `All-square at ${h2hSummary.p1Wins}-${h2hSummary.p2Wins} across ${h2hSummary.totalPreMatchEncounters} past pre-match meetings.`
          : `${leader} leads head-to-head ${Math.max(h2hSummary.p1Wins, h2hSummary.p2Wins)}-${Math.min(h2hSummary.p1Wins, h2hSummary.p2Wins)} in official tour encounters.`,
        confidence: 'HIGH',
      });
    }

    return {
      matchInfo: {
        player1: player1Name,
        player2: player2Name,
        surface,
        asOfCutoff: cutoffDate,
        dataCompletenessPct: Math.round(((Math.min(10, p1Matches.length) + Math.min(10, p2Matches.length)) / 20) * 100),
      },
      p1RollingForm,
      p2RollingForm,
      h2hSummary,
      p1SurfaceMastery,
      p2SurfaceMastery,
      p1Workload,
      p2Workload,
      p1Clutch,
      p2Clutch,
      matchupGaps,
      explanationCards,
    };
  },
};
