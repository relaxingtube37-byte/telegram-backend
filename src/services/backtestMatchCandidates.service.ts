import { db } from '../db/connection';

export interface BacktestCandidateSettlement {
  winnerSide: 'home' | 'away';
  winnerName: string;
  loserName: string;
  homeSetsWon: number;
  awaySetsWon: number;
  setScores: string | null;
  scoreString: string | null;
}

export interface BacktestCandidateMatch {
  historicalMatchId: number;
  matchDate: string;
  tour: string | null;
  tourneyName: string | null;
  roundName: string | null;
  surface: string | null;
  minutes: number | null;
  homeTrackedPlayerId: number;
  awayTrackedPlayerId: number;
  homePlayerName: string;
  awayPlayerName: string;
  homeRank: number | null;
  awayRank: number | null;
  homeOdds: number | null;
  awayOdds: number | null;
  settlement: BacktestCandidateSettlement;
  dataSource: 'player_matches_validated' | 'gold_matches_ready_view';
}

function tourClause(category: 'both' | 'atp' | 'wta'): string {
  if (category === 'atp') return "AND UPPER(COALESCE(h.tour, w.player_tour, '')) = 'ATP'";
  if (category === 'wta') return "AND UPPER(COALESCE(h.tour, w.player_tour, '')) = 'WTA'";
  return '';
}

function countSetsWon(score: string | null, winnerIsHome: boolean): { home: number; away: number } {
  if (!score?.trim()) return { home: 0, away: 0 };
  let home = 0;
  let away = 0;
  const tokens = score.match(/\d+\s*-\s*\d+/g) || [];
  for (const token of tokens) {
    const parts = token.replace(/\([^)]*\)/g, '').trim().split('-');
    if (parts.length !== 2) continue;
    const a = parseInt(parts[0], 10);
    const b = parseInt(parts[1], 10);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (winnerIsHome) {
      if (a > b) home += 1;
      else if (b > a) away += 1;
    } else {
      if (a > b) away += 1;
      else if (b > a) home += 1;
    }
  }
  return { home, away };
}

function mapRowToCandidate(row: Record<string, unknown>): BacktestCandidateMatch {
  const winnerTrackedId = Number(row.winner_tracked_player_id);
  const loserTrackedId = Number(row.loser_tracked_player_id);
  const winnerName = String(row.winner_name || '');
  const loserName = String(row.loser_name || '');
  const score = row.score != null ? String(row.score) : null;

  const homeTrackedPlayerId = Math.min(winnerTrackedId, loserTrackedId);
  const awayTrackedPlayerId = Math.max(winnerTrackedId, loserTrackedId);
  const homeIsWinner = winnerTrackedId === homeTrackedPlayerId;
  const homePlayerName = homeIsWinner ? winnerName : loserName;
  const awayPlayerName = homeIsWinner ? loserName : winnerName;
  const winnerSide: 'home' | 'away' = homeIsWinner ? 'home' : 'away';

  const winnerOdds = row.winner_odds != null ? Number(row.winner_odds) : null;
  const loserOdds = row.loser_odds != null ? Number(row.loser_odds) : null;
  const homeOdds = homeIsWinner ? winnerOdds : loserOdds;
  const awayOdds = homeIsWinner ? loserOdds : winnerOdds;

  const winnerRank = row.winner_rank != null ? Number(row.winner_rank) : null;
  const loserRank = row.loser_rank != null ? Number(row.loser_rank) : null;
  const homeRank = homeIsWinner ? winnerRank : loserRank;
  const awayRank = homeIsWinner ? loserRank : winnerRank;

  const sets = countSetsWon(score, homeIsWinner);

  return {
    historicalMatchId: Number(row.historical_match_id),
    matchDate: String(row.match_date),
    tour: row.tour != null ? String(row.tour) : null,
    tourneyName: row.tourney_name != null ? String(row.tourney_name) : null,
    roundName: row.round_name != null ? String(row.round_name) : null,
    surface: row.surface != null ? String(row.surface) : null,
    minutes: row.minutes != null ? Number(row.minutes) : null,
    homeTrackedPlayerId,
    awayTrackedPlayerId,
    homePlayerName,
    awayPlayerName,
    homeRank,
    awayRank,
    homeOdds,
    awayOdds,
    settlement: {
      winnerSide,
      winnerName,
      loserName,
      homeSetsWon: sets.home,
      awaySetsWon: sets.away,
      setScores: score,
      scoreString: score,
    },
    dataSource: 'gold_matches_ready_view',
  };
}

export function queryBacktestCandidateMatches(options: {
  limit: number;
  category?: 'both' | 'atp' | 'wta';
  maxDaysBack?: number;
  beforeDate?: string;
  tier?: 'main_tour' | 'all';
  maxRank?: number;
  bothRanked?: boolean;
}): BacktestCandidateMatch[] {
  const limit = Math.min(Math.max(options.limit || 10, 1), 500);
  const category = options.category || 'both';
  const beforeDate = (options.beforeDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const maxDaysBack = options.maxDaysBack && options.maxDaysBack > 0 ? options.maxDaysBack : undefined;
  const tier = options.tier || 'main_tour';
  const maxRank = options.maxRank !== undefined ? options.maxRank : 200;
  const bothRanked = options.bothRanked ?? false;

  let minDate = '2024-01-01';
  if (maxDaysBack) {
    const d = new Date(`${beforeDate}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - maxDaysBack);
    minDate = d.toISOString().slice(0, 10);
  }
  if (minDate < '2024-01-01') {
    minDate = '2024-01-01';
  }

  let tierClause = '';
  if (tier === 'main_tour') {
    tierClause = `
      AND gm.tourney_name NOT LIKE 'ITF%'
      AND gm.tourney_name NOT LIKE '%Futures%'
      AND gm.tourney_name NOT LIKE '%Qualifying%'
      AND (gm.round_name IS NULL OR (gm.round_name NOT LIKE '%Qualif%' AND gm.round_name NOT LIKE 'Q-%'))
    `;
  }

  let rankClause = '';
  if (maxRank > 0) {
    if (bothRanked) {
      rankClause = `
        AND gm.winner_rank IS NOT NULL AND gm.winner_rank <= @maxRank
        AND gm.loser_rank IS NOT NULL AND gm.loser_rank <= @maxRank
      `;
    } else {
      rankClause = `
        AND (
          (gm.winner_rank IS NOT NULL AND gm.winner_rank <= @maxRank) OR
          (gm.loser_rank IS NOT NULL AND gm.loser_rank <= @maxRank)
        )
      `;
    }
  }

  const rows = db
    .prepare(
      `
    SELECT
      gm.rapid_event_id AS historical_match_id,
      gm.canonical_match_id,
      gm.match_date,
      gm.tour,
      gm.tourney_name,
      gm.round_name,
      gm.surface,
      gm.score,
      NULL AS minutes,
      gm.winner_name,
      gm.loser_name,
      gm.winner_rank,
      gm.loser_rank,
      gm.winner_odds,
      gm.loser_odds,
      pmi_w.tracked_player_id AS winner_tracked_player_id,
      pmi_l.tracked_player_id AS loser_tracked_player_id
    FROM gold_matches_ready_view gm
    LEFT JOIN player_match_index pmi_w 
      ON pmi_w.rapid_event_id = gm.rapid_event_id AND pmi_w.won = 1
    LEFT JOIN player_match_index pmi_l 
      ON pmi_l.rapid_event_id = gm.rapid_event_id AND pmi_l.won = 0
    WHERE gm.match_date >= @minDate
      AND gm.match_date < @beforeDate
      AND gm.has_odds = 1
      AND gm.winner_odds IS NOT NULL
      AND gm.loser_odds IS NOT NULL
      ${tourClause(category)}
      ${tierClause}
      ${rankClause}
    ORDER BY gm.match_date DESC, gm.rapid_event_id DESC
    LIMIT @limit
  `,
    )
    .all({ minDate, beforeDate, limit, maxRank }) as Array<Record<string, unknown>>;

  return rows.map(mapRowToCandidate);
}

export function countBacktestCandidateMatches(options?: {
  category?: 'both' | 'atp' | 'wta';
  beforeDate?: string;
  requireOdds?: boolean;
  tier?: 'main_tour' | 'all';
  maxRank?: number;
  bothRanked?: boolean;
}): number {
  const category = options?.category || 'both';
  const beforeDate = (options?.beforeDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const oddsClause = options?.requireOdds === false ? '' : 'AND gm.has_odds = 1 AND gm.winner_odds IS NOT NULL AND gm.loser_odds IS NOT NULL';
  const tier = options?.tier || 'main_tour';
  const maxRank = options?.maxRank !== undefined ? options.maxRank : 200;
  const bothRanked = options?.bothRanked ?? false;

  let tierClause = '';
  if (tier === 'main_tour') {
    tierClause = `
      AND gm.tourney_name NOT LIKE 'ITF%'
      AND gm.tourney_name NOT LIKE '%Futures%'
      AND gm.tourney_name NOT LIKE '%Qualifying%'
      AND (gm.round_name IS NULL OR (gm.round_name NOT LIKE '%Qualif%' AND gm.round_name NOT LIKE 'Q-%'))
    `;
  }

  let rankClause = '';
  if (maxRank > 0) {
    if (bothRanked) {
      rankClause = `
        AND gm.winner_rank IS NOT NULL AND gm.winner_rank <= @maxRank
        AND gm.loser_rank IS NOT NULL AND gm.loser_rank <= @maxRank
      `;
    } else {
      rankClause = `
        AND (
          (gm.winner_rank IS NOT NULL AND gm.winner_rank <= @maxRank) OR
          (gm.loser_rank IS NOT NULL AND gm.loser_rank <= @maxRank)
        )
      `;
    }
  }

  const row = db
    .prepare(
      `
    SELECT COUNT(*) AS c
    FROM gold_matches_ready_view gm
    WHERE gm.match_date >= '2024-01-01'
      AND gm.match_date < @beforeDate
      ${oddsClause}
      ${tourClause(category)}
      ${tierClause}
      ${rankClause}
  `,
    )
    .get({ beforeDate, maxRank }) as { c: number };
  return Number(row?.c || 0);
}

