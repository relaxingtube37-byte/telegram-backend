/**
 * Diff engine for sentinel leakage snapshots.
 */
import type { SentinelFeatureSnapshot } from './sentinelFeatureSnapshot';

export type SuspectedLeakCategory =
  | 'FUTURE_ROW_ACCESS'
  | 'TARGET_MATCH_INCLUDED'
  | 'POST_MATCH_FIELD_USED'
  | 'LIVE_SOURCE_REACHED'
  | 'CACHE_OR_FALLBACK_LEAK'
  | 'IMPROPER_JOIN_WINDOW'
  | 'RANK_LOOKUP_LEAK'
  | 'ODDS_SOURCE_LEAK';

export interface SentinelFeatureDiff {
  path: string;
  baseline: string | number | boolean | null;
  mutated: string | number | boolean | null;
  category: SuspectedLeakCategory;
  suspectedSource: string;
}

export interface SentinelDiffResult {
  matchId: number;
  asOfDate: string;
  homePlayer: string;
  awayPlayer: string;
  diffs: SentinelFeatureDiff[];
}

function categorizeDiff(path: string): { category: SuspectedLeakCategory; suspectedSource: string } {
  if (path.includes('rankAtDate') || path.includes('event_time_rank')) {
    return {
      category: 'RANK_LOOKUP_LEAK',
      suspectedSource: 'localPlayerAnalysis.service.ts resolveRankAtDate / queryRecentHistoricalMatchRows',
    };
  }
  if (path.includes('h2h') || path.includes('H2H')) {
    return {
      category: 'FUTURE_ROW_ACCESS',
      suspectedSource: 'playerHistoricalQuery.service.ts queryH2HHistoricalMatchRows',
    };
  }
  if (path.includes('odds') || path.includes('Odds')) {
    return {
      category: 'ODDS_SOURCE_LEAK',
      suspectedSource: 'historicalFeaturePipeline.service.ts / historical_matches odds columns',
    };
  }
  if (path.includes('placeholderServe') || path.includes('estimatedServe')) {
    return {
      category: 'POST_MATCH_FIELD_USED',
      suspectedSource: 'historicalFeaturePipeline.service.ts serveRowQuality assessment',
    };
  }
  if (path.includes('priorMatchCount') || path.includes('recentCount') || path.includes('matchesLast')) {
    return {
      category: 'IMPROPER_JOIN_WINDOW',
      suspectedSource: 'pointInTimeFilter.ts / queryHistoricalStatsRowsForPlayer date window',
    };
  }
  if (path.includes('surfaces') || path.includes('surface')) {
    return {
      category: 'FUTURE_ROW_ACCESS',
      suspectedSource: 'historicalPlayerStats.service.ts aggregatePlayerSurfaceStatsFromRows',
    };
  }
  if (path.includes('validation') || path.includes('flags')) {
    return {
      category: 'POST_MATCH_FIELD_USED',
      suspectedSource: 'historicalFeatureValidator.ts / validationFlags.ts',
    };
  }
  return {
    category: 'FUTURE_ROW_ACCESS',
    suspectedSource: 'historicalFeaturePipeline.service.ts buildHistoricalMatchFeatureBundle',
  };
}

export function diffSentinelSnapshots(
  baseline: SentinelFeatureSnapshot,
  mutated: SentinelFeatureSnapshot,
): SentinelDiffResult {
  const paths = new Set([...Object.keys(baseline.features), ...Object.keys(mutated.features)]);
  const diffs: SentinelFeatureDiff[] = [];

  for (const path of paths) {
    const baseVal = baseline.features[path] ?? null;
    const mutVal = mutated.features[path] ?? null;
    if (baseVal === mutVal) continue;
    const { category, suspectedSource } = categorizeDiff(path);
    diffs.push({
      path,
      baseline: baseVal,
      mutated: mutVal,
      category,
      suspectedSource,
    });
  }

  return {
    matchId: baseline.matchId,
    asOfDate: baseline.asOfDate,
    homePlayer: baseline.homePlayer,
    awayPlayer: baseline.awayPlayer,
    diffs,
  };
}

export function summarizeDiffs(results: SentinelDiffResult[]): {
  totalRowsTested: number;
  totalRowsFailed: number;
  changedFeatures: string[];
  affectedMatchIds: number[];
  findings: SentinelFeatureDiff[];
} {
  const failed = results.filter((r) => r.diffs.length > 0);
  const changedFeatures = new Set<string>();
  const findings: SentinelFeatureDiff[] = [];

  for (const result of failed) {
    for (const diff of result.diffs) {
      changedFeatures.add(diff.path);
      findings.push(diff);
    }
  }

  return {
    totalRowsTested: results.length,
    totalRowsFailed: failed.length,
    changedFeatures: Array.from(changedFeatures).sort(),
    affectedMatchIds: failed.map((r) => r.matchId),
    findings,
  };
}
