import type Database from 'better-sqlite3';
import type { CanonicalMatchCandidate, ResolvedMatchContext } from './types';

export function findCandidatesForMatch(
  db: Database.Database,
  ctx: ResolvedMatchContext,
  canonicalTableName: string = 'canonical_matches'
): CanonicalMatchCandidate[] {
  const table = canonicalTableName === 'canonical_matches_v2' ? 'canonical_matches_v2' : 'canonical_matches';
  // Query strictly on symmetric pair (player_low_id, player_high_id) within +/- 1 day
  const sql = `
    SELECT 
      canonical_match_id AS canonicalMatchId,
      match_date AS matchDate,
      tour,
      canonical_tourney_id AS canonicalTourneyId,
      surface,
      round_name AS roundName,
      player_low_id AS playerLowId,
      player_high_id AS playerHighId,
      match_status AS matchStatus,
      winner_canonical_id AS winnerCanonicalId,
      loser_canonical_id AS loserCanonicalId,
      canonical_score AS canonicalScore,
      source_mask AS sourceMask,
      evidence_count AS evidenceCount,
      version
    FROM ${table}
    WHERE player_low_id = @playerLowId
      AND player_high_id = @playerHighId
      AND match_date BETWEEN date(@matchDate, '-1 day') AND date(@matchDate, '+1 day')
    ORDER BY ABS(julianday(match_date) - julianday(@matchDate)) ASC
  `;

  return db.prepare(sql).all({
    playerLowId: ctx.playerLowId,
    playerHighId: ctx.playerHighId,
    matchDate: ctx.incoming.matchDate,
  }) as CanonicalMatchCandidate[];
}
