/**
 * Builds a comparable historical feature snapshot for sentinel leakage tests.
 */
import { buildHistoricalMatchFeatureBundle } from '../features/historicalFeaturePipeline.service';
import { namesLikelyMatch } from '../scripts/historicalMatchKeys';
import { getPlayerAnalysisBundle, getHistoricalH2HBundle } from '../services/localPlayerAnalysis.service';
import { queryRecentHistoricalMatchRows } from '../services/playerHistoricalQuery.service';
import type { SentinelTargetMatch } from './sentinelValidatedStore';

export interface SentinelFeatureSnapshot {
  matchId: number;
  asOfDate: string;
  homePlayer: string;
  awayPlayer: string;
  features: Record<string, string | number | boolean | null>;
}

const EXCLUDED_COMPARE_PREFIXES = [
  'featureRegistry',
  'productRules',
  'featureRegistryVersion',
];

function daysBetween(earlier: string, later: string): number | null {
  const a = new Date(`${earlier.slice(0, 10)}T00:00:00.000Z`);
  const b = new Date(`${later.slice(0, 10)}T00:00:00.000Z`);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

function countMatchesInWindow(
  rows: Array<Record<string, unknown>>,
  playerName: string,
  asOfDate: string,
  windowDays: number,
): number {
  const asOfMs = new Date(`${asOfDate.slice(0, 10)}T00:00:00.000Z`).getTime();
  const minMs = asOfMs - windowDays * 24 * 60 * 60 * 1000;
  return rows.filter((row) => {
    const md = String(row.match_date || '').slice(0, 10);
    const ms = new Date(`${md}T00:00:00.000Z`).getTime();
    if (ms >= asOfMs || ms < minMs) return false;
    return (
      namesLikelyMatch(String(row.winner_name || ''), playerName) ||
      namesLikelyMatch(String(row.loser_name || ''), playerName)
    );
  }).length;
}

function computeRecentForm(
  playerName: string,
  asOfDate: string,
  excludeMatchId: number | null,
): {
  recentCount: number;
  recentWins: number;
  recentLosses: number;
  daysSinceLastMatch: number | null;
  matchesLast7: number;
  matchesLast14: number;
  matchesLast30: number;
} {
  const rows = queryRecentHistoricalMatchRows({
    playerName,
    beforeDate: asOfDate,
    limit: 80,
    excludeMatchId,
  });

  let recentWins = 0;
  let recentLosses = 0;
  for (const row of rows) {
    if (namesLikelyMatch(String(row.winner_name || ''), playerName)) recentWins += 1;
    else if (namesLikelyMatch(String(row.loser_name || ''), playerName)) recentLosses += 1;
  }

  const lastDate = rows[0]?.match_date ? String(rows[0].match_date).slice(0, 10) : null;
  return {
    recentCount: rows.length,
    recentWins,
    recentLosses,
    daysSinceLastMatch: lastDate ? daysBetween(lastDate, asOfDate) : null,
    matchesLast7: countMatchesInWindow(rows, playerName, asOfDate, 7),
    matchesLast14: countMatchesInWindow(rows, playerName, asOfDate, 14),
    matchesLast30: countMatchesInWindow(rows, playerName, asOfDate, 30),
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = (v as Record<string, unknown>)[key];
          return acc;
        }, {});
    }
    return v;
  });
}

function flattenForCompare(prefix: string, value: unknown, out: Record<string, string | number | boolean | null>): void {
  if (EXCLUDED_COMPARE_PREFIXES.some((p) => prefix === p || prefix.startsWith(`${p}.`))) return;

  if (value === null || value === undefined) {
    out[prefix] = null;
    return;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    out[prefix] = value;
    return;
  }
  if (Array.isArray(value)) {
    out[prefix] = stableStringify(value);
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const next = prefix ? `${prefix}.${key}` : key;
      flattenForCompare(next, child, out);
    }
    return;
  }
  out[prefix] = String(value);
}

export function buildSentinelFeatureSnapshot(target: SentinelTargetMatch): SentinelFeatureSnapshot {
  const asOfDate = target.matchDate;
  const bundle = buildHistoricalMatchFeatureBundle({
    homePlayerName: target.homePlayer,
    awayPlayerName: target.awayPlayer,
    asOfDate,
    matchId: target.matchId,
    homeEventRank: target.homeRank,
    awayEventRank: target.awayRank,
    oddsClassification: 'VERIFIED_PREMATCH',
    sourceTag: 'historical',
  });

  const homeAnalysis = getPlayerAnalysisBundle({
    playerName: target.homePlayer,
    beforeDate: asOfDate,
    yearsBack: 3,
    recentLimit: 20,
  });
  const awayAnalysis = getPlayerAnalysisBundle({
    playerName: target.awayPlayer,
    beforeDate: asOfDate,
    yearsBack: 3,
    recentLimit: 20,
  });
  const h2h = getHistoricalH2HBundle({
    player1: target.homePlayer,
    player2: target.awayPlayer,
    beforeDate: asOfDate,
  });

  const homeForm = computeRecentForm(target.homePlayer, asOfDate, target.matchId);
  const awayForm = computeRecentForm(target.awayPlayer, asOfDate, target.matchId);

  let h2hHomeWins = 0;
  let h2hAwayWins = 0;
  for (const row of h2h.matches) {
    if (namesLikelyMatch(String(row.winner_name || ''), target.homePlayer)) h2hHomeWins += 1;
    else if (namesLikelyMatch(String(row.winner_name || ''), target.awayPlayer)) h2hAwayWins += 1;
  }
  const lastH2HDate = h2h.matches[0]?.match_date ? String(h2h.matches[0].match_date).slice(0, 10) : null;

  const composite = {
    apiBundle: bundle,
    homeAnalysis: {
      rankAtDate: homeAnalysis.rankAtDate,
      totalLocalMatches: homeAnalysis.totalLocalMatches,
      surface: homeAnalysis.surface,
      recentMatches: homeAnalysis.recentMatches,
    },
    awayAnalysis: {
      rankAtDate: awayAnalysis.rankAtDate,
      totalLocalMatches: awayAnalysis.totalLocalMatches,
      surface: awayAnalysis.surface,
      recentMatches: awayAnalysis.recentMatches,
    },
    homeForm,
    awayForm,
    h2h: {
      homeWins: h2hHomeWins,
      awayWins: h2hAwayWins,
      lastMeetingDate: lastH2HDate,
      meetingCount: h2h.matches.length,
    },
  };

  const features: Record<string, string | number | boolean | null> = {};
  flattenForCompare('', composite, features);

  return {
    matchId: target.matchId,
    asOfDate,
    homePlayer: target.homePlayer,
    awayPlayer: target.awayPlayer,
    features,
  };
}
