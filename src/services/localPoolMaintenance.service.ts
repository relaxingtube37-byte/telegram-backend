import { db } from '../db/connection';
import { Logger } from '../utils/logger';
import { removeDuplicateHistoricalMatches } from '../scripts/historicalMatchInsert';

/** Remove pre-2021 rows and old-format rows that block clean CSV coverage stats. */
export function purgeLegacyHistoricalPool(): {
  removedBefore2021: number;
  removedOldFormat: number;
  removedApiShells: number;
  removedEventDupes: number;
  removedInferiorDupes: number;
  indexRowsRemoved: number;
  remaining: number;
} {
  const countBefore = () =>
    (db.prepare('SELECT COUNT(*) as c FROM historical_matches').get() as { c: number }).c;

  const before = countBefore();

  const indexRemoved = db
    .prepare(
      `
    DELETE FROM player_match_index
    WHERE historical_match_id IN (
      SELECT id FROM historical_matches
      WHERE match_date < '2021-01-01'
         OR (
           w_serve_won_pct IS NULL
           AND w_odds_match IS NULL
           AND (COALESCE(w_svpt, 0) > 0 OR rapid_event_id IS NOT NULL)
         )
    )
  `,
    )
    .run().changes;

  const removedBefore2021 = db.prepare(`DELETE FROM historical_matches WHERE match_date < '2021-01-01'`).run()
    .changes;

  const removedOldFormat = db
    .prepare(
      `
    DELETE FROM historical_matches
    WHERE w_serve_won_pct IS NULL
      AND w_odds_match IS NULL
      AND COALESCE(w_svpt, 0) > 0
  `,
    )
    .run().changes;

  const removedApiShells = db
    .prepare(
      `
    DELETE FROM historical_matches
    WHERE rapid_event_id IS NOT NULL
      AND w_serve_won_pct IS NULL
      AND w_odds_match IS NULL
  `,
    )
    .run().changes;

  const removedEventDupes = db
    .prepare(
      `
    DELETE FROM historical_matches
    WHERE w_serve_won_pct IS NULL
      AND w_odds_match IS NULL
      AND rapid_event_id IS NOT NULL
      AND rapid_event_id IN (
        SELECT rapid_event_id FROM historical_matches
        WHERE w_serve_won_pct IS NOT NULL OR w_odds_match IS NOT NULL
      )
  `,
    )
    .run().changes;

  const removedInferiorDupes = db
    .prepare(
      `
    DELETE FROM historical_matches
    WHERE id IN (
      SELECT h1.id FROM historical_matches h1
      INNER JOIN historical_matches h2
        ON h1.tour = h2.tour
       AND h1.match_date = h2.match_date
       AND h1.winner_name = h2.winner_name
       AND h1.loser_name = h2.loser_name
       AND h1.id != h2.id
      WHERE h1.w_serve_won_pct IS NULL
        AND h1.w_odds_match IS NULL
        AND (h2.w_serve_won_pct IS NOT NULL OR h2.w_odds_match IS NOT NULL)
    )
  `,
    )
    .run().changes;

  const duplicatesRemoved = removeDuplicateHistoricalMatches();
  const remaining = countBefore();

  Logger.info(
    `Purged legacy pool rows: before2021=${removedBefore2021}, oldFormat=${removedOldFormat}, apiShells=${removedApiShells}, eventDupes=${removedEventDupes}, inferiorDupes=${removedInferiorDupes}, index=${indexRemoved}, dupes=${duplicatesRemoved}, remaining=${remaining} (was ${before})`,
  );

  return {
    removedBefore2021,
    removedOldFormat,
    removedApiShells,
    removedEventDupes,
    removedInferiorDupes,
    indexRowsRemoved: indexRemoved ?? 0,
    remaining,
  };
}
