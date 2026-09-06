import { db } from '../db/connection';
import { PlayerMatchIndexRepo } from '../db/repositories/playerMatchIndex.repo';
import {
  patchHistoricalMatchGaps,
  type HistoricalMatchRecord,
  type HistoricalMatchRow,
} from '../scripts/historicalMatchInsert';
import { namesLikelyMatch } from '../scripts/historicalMatchKeys';

function sameMatchPlayers(
  a: Pick<HistoricalMatchRecord, 'winner_name' | 'loser_name'>,
  b: Pick<HistoricalMatchRecord, 'winner_name' | 'loser_name'>,
): boolean {
  return (
    namesLikelyMatch(a.winner_name, b.winner_name) && namesLikelyMatch(a.loser_name, b.loser_name)
  );
}

/** Copy rank / event id from API-style duplicate rows onto CSV-linked rows. */
export function mergeApiMetadataOntoCsvRows(trackedPlayerId: number, sinceDate: string): number {
  const linked = db
    .prepare(
      `
    SELECT
      pmi.id AS index_id,
      h.id AS csv_id,
      h.tour,
      h.match_date,
      h.winner_name,
      h.loser_name,
      h.winner_rank,
      h.loser_rank,
      h.rapid_event_id
    FROM player_match_index pmi
    JOIN historical_matches h ON h.id = pmi.historical_match_id
    WHERE pmi.tracked_player_id = @trackedPlayerId
      AND pmi.match_date >= @sinceDate
      AND pmi.has_csv_stats = 1
      AND (
        (COALESCE(h.winner_rank, 0) = 0 AND COALESCE(h.loser_rank, 0) = 0)
        OR h.rapid_event_id IS NULL
      )
  `,
    )
    .all({ trackedPlayerId, sinceDate }) as Array<{
    index_id: number;
    csv_id: number;
    tour: 'ATP' | 'WTA';
    match_date: string;
    winner_name: string;
    loser_name: string;
    winner_rank: number;
    loser_rank: number;
    rapid_event_id: number | null;
  }>;

  if (!linked.length) return 0;

  let merged = 0;

  for (const row of linked) {
    const candidates = db
      .prepare(
        `
      SELECT *
      FROM historical_matches
      WHERE tour = @tour
        AND match_date = @match_date
        AND id != @csv_id
        AND (
          COALESCE(winner_rank, 0) > 0
          OR COALESCE(loser_rank, 0) > 0
          OR rapid_event_id IS NOT NULL
        )
    `,
      )
      .all({
        tour: row.tour,
        match_date: row.match_date,
        csv_id: row.csv_id,
      }) as HistoricalMatchRow[];

    const sibling = candidates.find((candidate) => sameMatchPlayers(candidate, row));
    if (!sibling) continue;

    const patch: Partial<HistoricalMatchRecord> = {};
    if (row.winner_rank <= 0 && sibling.winner_rank > 0) patch.winner_rank = sibling.winner_rank;
    if (row.loser_rank <= 0 && sibling.loser_rank > 0) patch.loser_rank = sibling.loser_rank;
    if (!row.rapid_event_id && sibling.rapid_event_id) {
      patch.rapid_event_id = sibling.rapid_event_id;
    }

    if (!Object.keys(patch).length) continue;
    if (!patchHistoricalMatchGaps(row.csv_id, patch)) continue;

    if (patch.rapid_event_id) {
      PlayerMatchIndexRepo.updateBundleFlags(row.index_id, {
        rapid_event_id: patch.rapid_event_id,
      });
    }
    merged += 1;
  }

  return merged;
}
