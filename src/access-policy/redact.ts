import type { Prediction } from '../types';
import type { MatchDeepAnalyticsReport } from '../services/match-analytics.service';
import { GUEST_STATS_LEVELS } from './types';
import type { ResolvedAccess } from './resolveAccess';

const SUMMARY_MAX = 220;

function truncateSummary(text: string | undefined | null, maxLen = SUMMARY_MAX): string | null {
  if (!text) return null;
  const cleaned = String(text).replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 1)}…`;
}

/**
 * Redacts a published match row for guests per access policy layers.
 * Verified members (or FREE mode) receive the full payload.
 */
export function redactMatchForAccess(
  match: Prediction,
  access: ResolvedAccess
): Prediction & {
  content_locked: boolean;
  access_mode: string;
  guest_stats_level: string;
} {
  if (access.isVerified) {
    return {
      ...match,
      content_locked: false,
      access_mode: access.access_mode,
      guest_stats_level: access.layers.guest_stats_level,
    };
  }

  const { layers } = access;
  const out: Prediction & {
    content_locked: boolean;
    access_mode: string;
    guest_stats_level: string;
  } = {
    ...match,
    content_locked: true,
    access_mode: access.access_mode,
    guest_stats_level: layers.guest_stats_level,
    key_factors: undefined,
    devils_advocate_risk: undefined,
    best_bet_selection: undefined,
    best_bet_market: undefined,
    best_bet_ev: undefined,
    best_bet_rationale: undefined,
    alt_bet_selection: undefined,
    alt_bet_market: undefined,
  };

  if (layers.guest_can_see_ai_full) {
    // Full AI allowed for guests
    out.ai_summary = match.ai_summary;
    out.key_factors = match.key_factors;
    out.devils_advocate_risk = match.devils_advocate_risk;
  } else if (layers.guest_can_see_summary) {
    out.ai_summary = truncateSummary(match.ai_summary) || undefined;
  } else {
    out.ai_summary = undefined;
  }

  // Deep stats / projected score stay hidden unless stats level is full for guests
  if (layers.guest_stats_level !== GUEST_STATS_LEVELS.FULL) {
    // predicted_score treated as light analysis — keep only when summary allowed
    if (!layers.guest_can_see_summary) {
      out.predicted_score = undefined;
    }
  }

  return out;
}

/**
 * Redacts deep-analytics report for guests.
 * - none: only matchInfo (+ locked flag)
 * - partial: form last-5 + H2H totals; no surface/fatigue/clutch/cards
 * - full: entire report
 */
export function redactDeepAnalyticsForAccess(
  report: MatchDeepAnalyticsReport,
  access: ResolvedAccess
): {
  locked: boolean;
  access_mode: string;
  guest_stats_level: string;
  data: MatchDeepAnalyticsReport | Record<string, unknown>;
} {
  if (access.isVerified || access.layers.guest_stats_level === GUEST_STATS_LEVELS.FULL) {
    return {
      locked: false,
      access_mode: access.access_mode,
      guest_stats_level: access.layers.guest_stats_level,
      data: report,
    };
  }

  if (access.layers.guest_stats_level === GUEST_STATS_LEVELS.PARTIAL) {
    return {
      locked: true,
      access_mode: access.access_mode,
      guest_stats_level: access.layers.guest_stats_level,
      data: {
        matchInfo: report.matchInfo,
        p1RollingForm: {
          playerName: report.p1RollingForm.playerName,
          matchesEvaluated: report.p1RollingForm.matchesEvaluated,
          last5WinRatePct: report.p1RollingForm.last5WinRatePct,
          last10WinRatePct: null,
          currentStreak: report.p1RollingForm.currentStreak,
          setsWinRatePct: null,
          recentScores: [],
        },
        p2RollingForm: {
          playerName: report.p2RollingForm.playerName,
          matchesEvaluated: report.p2RollingForm.matchesEvaluated,
          last5WinRatePct: report.p2RollingForm.last5WinRatePct,
          last10WinRatePct: null,
          currentStreak: report.p2RollingForm.currentStreak,
          setsWinRatePct: null,
          recentScores: [],
        },
        h2hSummary: {
          totalPreMatchEncounters: report.h2hSummary.totalPreMatchEncounters,
          p1Wins: report.h2hSummary.p1Wins,
          p2Wins: report.h2hSummary.p2Wins,
          surfaceH2H: [],
          recentEncounters: [],
        },
        p1SurfaceMastery: null,
        p2SurfaceMastery: null,
        p1Workload: null,
        p2Workload: null,
        p1Clutch: null,
        p2Clutch: null,
        matchupGaps: null,
        explanationCards: null,
      },
    };
  }

  // NONE — deep fields absent/null
  return {
    locked: true,
    access_mode: access.access_mode,
    guest_stats_level: access.layers.guest_stats_level,
    data: {
      matchInfo: report.matchInfo,
      p1RollingForm: null,
      p2RollingForm: null,
      h2hSummary: null,
      p1SurfaceMastery: null,
      p2SurfaceMastery: null,
      p1Workload: null,
      p2Workload: null,
      p1Clutch: null,
      p2Clutch: null,
      matchupGaps: null,
      explanationCards: null,
    },
  };
}
