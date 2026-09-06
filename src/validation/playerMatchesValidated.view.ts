/**
 * Read-only validated layer: player_match_index ⨝ historical_matches
 * with quarantine flags and usability booleans.
 */

export const PLAYER_MATCHES_VALIDATED_VIEW_SQL = `
CREATE VIEW IF NOT EXISTS player_matches_validated AS
SELECT
  pmi.id AS pmi_id,
  pmi.tracked_player_id,
  pmi.historical_match_id,
  pmi.match_fingerprint,
  COALESCE(h.canonical_match_date, pmi.match_date) AS match_date,
  pmi.opponent_name,
  pmi.won,
  pmi.completeness,
  pmi.has_csv_stats,
  pmi.has_api_statistics,
  tp.full_name AS player_name,
  tp.tour AS player_tour,
  COALESCE(h.is_archive_only, CASE WHEN COALESCE(h.canonical_match_date, pmi.match_date) < '2024-01-01' THEN 1 ELSE 0 END) AS is_archive_only,
  h.source_a_historical_match_id AS historical_match_id_canonical,
  h.tour AS tour,
  h.tourney_name,
  h.round_name,
  h.canonical_winner_name AS winner_name,
  h.canonical_loser_name AS loser_name,
  h.score,
  h.minutes,
  h.w_odds_match,
  h.l_odds_match,
  CASE WHEN pmi.won = 1 THEN h.winner_rank ELSE h.loser_rank END AS player_rank,
  CASE WHEN pmi.won = 1 THEN h.loser_rank ELSE h.winner_rank END AS opponent_rank,
  COALESCE(h.surface, pmi.surface) AS surface_raw,
  CASE
    WHEN COALESCE(h.surface, pmi.surface) IS NULL
      OR TRIM(COALESCE(h.surface, pmi.surface, '')) = ''
      OR LOWER(TRIM(COALESCE(h.surface, pmi.surface, ''))) IN ('no surface', 'unknown', 'n/a')
      THEN 'Unknown'
    WHEN LOWER(COALESCE(h.surface, pmi.surface, '')) LIKE '%clay%'
      OR LOWER(COALESCE(h.surface, pmi.surface, '')) = 'red clay'
      THEN 'Clay'
    WHEN LOWER(COALESCE(h.surface, pmi.surface, '')) LIKE '%grass%'
      THEN 'Grass'
    WHEN LOWER(COALESCE(h.surface, pmi.surface, '')) LIKE '%carpet%'
      OR LOWER(COALESCE(h.surface, pmi.surface, '')) LIKE '%indoor%'
      THEN 'Carpet/Indoor'
    WHEN LOWER(COALESCE(h.surface, pmi.surface, '')) LIKE '%hard%'
      THEN 'Hard'
    ELSE 'Unknown'
  END AS surface_normalized,
  h.w_ace, h.w_df, h.w_svpt, h.w_1stIn, h.w_1stWon, h.w_2ndWon,
  h.w_bpSaved, h.w_bpFaced,
  h.l_ace, h.l_df, h.l_svpt, h.l_1stIn, h.l_1stWon, h.l_2ndWon,
  h.l_bpSaved, h.l_bpFaced,
  h.w_serve_won_pct, h.l_serve_won_pct,
  h.w_return_won_pct, h.l_return_won_pct,
  h.w_bp_won_pct, h.l_bp_won_pct,
  h.w_bp_saved_pct, h.l_bp_saved_pct,
  CASE WHEN COALESCE(h.w_svpt, 0) = 100 AND COALESCE(h.w_1stIn, 0) = 0 THEN 1 ELSE 0 END AS is_placeholder_serve,
  CASE
    WHEN h.score IS NULL OR TRIM(h.score) = ''
      OR UPPER(TRIM(h.score)) IN ('W/O', 'WO', 'DEF', 'RET', 'WALKOVER', 'DEFAULT')
      OR UPPER(h.score) LIKE '%RET%'
      OR UPPER(h.score) LIKE '%W/O%'
      THEN 1 ELSE 0
  END AS is_retirement_or_wo,
  CASE
    WHEN h.canonical_winner_name LIKE '%/%' OR h.canonical_loser_name LIKE '%/%' THEN 1 ELSE 0
  END AS is_non_singles,
  CASE
    WHEN pmi.historical_match_id IS NULL THEN 1
    WHEN pmi.has_csv_stats = 0 AND pmi.has_api_statistics = 0 AND COALESCE(h.w_svpt, 0) = 0
      AND COALESCE(h.w_serve_won_pct, 0) = 0 THEN 1
    ELSE 0
  END AS is_synthetic_source,
  CASE
    WHEN (CASE WHEN pmi.won = 1 THEN COALESCE(h.winner_rank, 0) ELSE COALESCE(h.loser_rank, 0) END) < 1
      OR (CASE WHEN pmi.won = 1 THEN COALESCE(h.loser_rank, 0) ELSE COALESCE(h.winner_rank, 0) END) < 1
      THEN 1 ELSE 0
  END AS is_missing_rank,
  CASE
    WHEN (CASE WHEN pmi.won = 1 THEN COALESCE(h.winner_rank, 0) ELSE COALESCE(h.loser_rank, 0) END) NOT BETWEEN 1 AND 100
      OR (CASE WHEN pmi.won = 1 THEN COALESCE(h.loser_rank, 0) ELSE COALESCE(h.winner_rank, 0) END) NOT BETWEEN 1 AND 100
      THEN 1 ELSE 0
  END AS is_outside_top100,
  CASE
    WHEN (COALESCE(h.w_odds_match, 0) > 0 AND COALESCE(h.w_odds_match, 0) < 1.01)
      OR (COALESCE(h.l_odds_match, 0) > 0 AND COALESCE(h.l_odds_match, 0) < 1.01)
      THEN 1 ELSE 0
  END AS is_bad_odds,
  CASE
    WHEN (COALESCE(h.w_odds_match, 0) > 1.01 AND COALESCE(h.l_odds_match, 0) <= 1.01)
      OR (COALESCE(h.l_odds_match, 0) > 1.01 AND COALESCE(h.w_odds_match, 0) <= 1.01)
      OR (COALESCE(h.w_odds_match, 0) <= 1.01 AND COALESCE(h.l_odds_match, 0) <= 1.01)
      THEN 1 ELSE 0
  END AS is_one_sided_odds,
  CASE
    WHEN COALESCE(h.surface, pmi.surface) IS NULL
      OR TRIM(COALESCE(h.surface, pmi.surface, '')) = ''
      OR LOWER(TRIM(COALESCE(h.surface, pmi.surface, ''))) IN ('no surface', 'unknown', 'n/a')
      THEN 1 ELSE 0
  END AS is_no_surface,
  TRIM(
    CASE WHEN COALESCE(h.w_svpt, 0) = 100 AND COALESCE(h.w_1stIn, 0) = 0
      THEN 'QUARANTINE_PLACEHOLDER_SERVE,' ELSE '' END
    || CASE WHEN (CASE WHEN pmi.won = 1 THEN COALESCE(h.winner_rank, 0) ELSE COALESCE(h.loser_rank, 0) END) < 1
      OR (CASE WHEN pmi.won = 1 THEN COALESCE(h.loser_rank, 0) ELSE COALESCE(h.winner_rank, 0) END) < 1
      THEN 'QUARANTINE_NO_RANK,' ELSE '' END
    || CASE WHEN (CASE WHEN pmi.won = 1 THEN COALESCE(h.winner_rank, 0) ELSE COALESCE(h.loser_rank, 0) END) NOT BETWEEN 1 AND 100
      OR (CASE WHEN pmi.won = 1 THEN COALESCE(h.loser_rank, 0) ELSE COALESCE(h.winner_rank, 0) END) NOT BETWEEN 1 AND 100
      THEN 'QUARANTINE_OUTSIDE_TOP100,' ELSE '' END
    || CASE WHEN (COALESCE(h.w_odds_match, 0) > 0 AND COALESCE(h.w_odds_match, 0) < 1.01)
      OR (COALESCE(h.l_odds_match, 0) > 0 AND COALESCE(h.l_odds_match, 0) < 1.01)
      THEN 'QUARANTINE_BAD_ODDS,' ELSE '' END
    || CASE WHEN (COALESCE(h.w_odds_match, 0) > 1.01 AND COALESCE(h.l_odds_match, 0) <= 1.01)
      OR (COALESCE(h.l_odds_match, 0) > 1.01 AND COALESCE(h.w_odds_match, 0) <= 1.01)
      OR (COALESCE(h.w_odds_match, 0) <= 1.01 AND COALESCE(h.l_odds_match, 0) <= 1.01)
      THEN 'QUARANTINE_ONE_SIDED_ODDS,' ELSE '' END
    || CASE WHEN COALESCE(h.surface, pmi.surface) IS NULL
      OR TRIM(COALESCE(h.surface, pmi.surface, '')) = ''
      OR LOWER(TRIM(COALESCE(h.surface, pmi.surface, ''))) IN ('no surface', 'unknown', 'n/a')
      THEN 'QUARANTINE_NO_SURFACE,' ELSE '' END
    || CASE WHEN h.score IS NULL OR TRIM(h.score) = ''
      OR UPPER(TRIM(h.score)) IN ('W/O', 'WO', 'DEF', 'RET', 'WALKOVER', 'DEFAULT')
      OR UPPER(h.score) LIKE '%RET%' OR UPPER(h.score) LIKE '%W/O%'
      THEN 'QUARANTINE_RETIREMENT_OR_WO,' ELSE '' END
    || CASE WHEN h.canonical_winner_name LIKE '%/%' OR h.canonical_loser_name LIKE '%/%'
      THEN 'QUARANTINE_NON_SINGLES,' ELSE '' END
    || CASE WHEN pmi.historical_match_id IS NULL
      OR (pmi.has_csv_stats = 0 AND pmi.has_api_statistics = 0
        AND COALESCE(h.w_svpt, 0) = 0 AND COALESCE(h.w_serve_won_pct, 0) = 0)
      THEN 'QUARANTINE_SYNTHETIC_SOURCE,' ELSE '' END
    || CASE WHEN COALESCE(h.is_archive_only, 0) = 1 OR COALESCE(h.canonical_match_date, pmi.match_date) < '2024-01-01'
      THEN 'QUARANTINE_PRE_2024_ARCHIVE,' ELSE '' END
    || 'QUARANTINE_POSTMATCH_ONLY,'
  , ',') AS quarantine_flags,
  CASE
    WHEN pmi.historical_match_id IS NOT NULL
      AND NOT (h.score IS NULL OR TRIM(h.score) = ''
        OR UPPER(TRIM(h.score)) IN ('W/O', 'WO', 'DEF', 'RET', 'WALKOVER', 'DEFAULT')
        OR UPPER(h.score) LIKE '%RET%' OR UPPER(h.score) LIKE '%W/O%')
      AND NOT (h.canonical_winner_name LIKE '%/%' OR h.canonical_loser_name LIKE '%/%')
      AND NOT (pmi.historical_match_id IS NULL
        OR (pmi.has_csv_stats = 0 AND pmi.has_api_statistics = 0
          AND COALESCE(h.w_svpt, 0) = 0 AND COALESCE(h.w_serve_won_pct, 0) = 0))
      THEN 1 ELSE 0
  END AS is_historical_usable,
  CASE
    WHEN (CASE WHEN pmi.won = 1 THEN COALESCE(h.winner_rank, 0) ELSE COALESCE(h.loser_rank, 0) END) BETWEEN 1 AND 2000
      AND (CASE WHEN pmi.won = 1 THEN COALESCE(h.loser_rank, 0) ELSE COALESCE(h.winner_rank, 0) END) BETWEEN 1 AND 2000
      THEN 1 ELSE 0
  END AS is_rank_usable,
  CASE
    WHEN COALESCE(h.surface, pmi.surface) IS NOT NULL
      AND TRIM(COALESCE(h.surface, pmi.surface, '')) != ''
      AND LOWER(TRIM(COALESCE(h.surface, pmi.surface, ''))) NOT IN ('no surface', 'unknown', 'n/a')
      AND (
        LOWER(COALESCE(h.surface, pmi.surface, '')) LIKE '%clay%'
        OR LOWER(COALESCE(h.surface, pmi.surface, '')) LIKE '%grass%'
        OR LOWER(COALESCE(h.surface, pmi.surface, '')) LIKE '%carpet%'
        OR LOWER(COALESCE(h.surface, pmi.surface, '')) LIKE '%indoor%'
        OR LOWER(COALESCE(h.surface, pmi.surface, '')) LIKE '%hard%'
      )
      THEN 1 ELSE 0
  END AS is_surface_feature_usable,
  CASE
    WHEN COALESCE(h.is_archive_only, 0) = 0
      AND COALESCE(h.canonical_match_date, pmi.match_date) >= '2024-01-01'
      AND NOT (COALESCE(h.w_svpt, 0) = 100 AND COALESCE(h.w_1stIn, 0) = 0)
      AND (
        (pmi.won = 1 AND COALESCE(h.w_1stIn, 0) > 0)
        OR (pmi.won = 0 AND COALESCE(h.l_1stIn, 0) > 0)
      )
      THEN 1 ELSE 0
  END AS is_raw_serve_feature_usable,
  CASE
    WHEN COALESCE(h.is_archive_only, 0) = 0
      AND COALESCE(h.canonical_match_date, pmi.match_date) >= '2024-01-01'
      AND pmi.historical_match_id IS NOT NULL
      AND NOT (h.score IS NULL OR TRIM(h.score) = ''
        OR UPPER(TRIM(h.score)) IN ('W/O', 'WO', 'DEF', 'RET', 'WALKOVER', 'DEFAULT')
        OR UPPER(h.score) LIKE '%RET%' OR UPPER(h.score) LIKE '%W/O%')
      AND NOT (h.canonical_winner_name LIKE '%/%' OR h.canonical_loser_name LIKE '%/%')
      AND (CASE WHEN pmi.won = 1 THEN COALESCE(h.winner_rank, 0) ELSE COALESCE(h.loser_rank, 0) END) BETWEEN 1 AND 100
      AND (CASE WHEN pmi.won = 1 THEN COALESCE(h.loser_rank, 0) ELSE COALESCE(h.winner_rank, 0) END) BETWEEN 1 AND 100
      AND NOT ((COALESCE(h.w_odds_match, 0) > 0 AND COALESCE(h.w_odds_match, 0) < 1.01)
        OR (COALESCE(h.l_odds_match, 0) > 0 AND COALESCE(h.l_odds_match, 0) < 1.01))
      THEN 1 ELSE 0
  END AS is_backtest_usable,
  CASE
    WHEN COALESCE(h.is_archive_only, 0) = 0
      AND COALESCE(h.canonical_match_date, pmi.match_date) >= '2024-01-01'
      AND pmi.historical_match_id IS NOT NULL
      AND NOT (h.score IS NULL OR TRIM(h.score) = ''
        OR UPPER(TRIM(h.score)) IN ('W/O', 'WO', 'DEF', 'RET', 'WALKOVER', 'DEFAULT')
        OR UPPER(h.score) LIKE '%RET%' OR UPPER(h.score) LIKE '%W/O%')
      AND NOT (h.canonical_winner_name LIKE '%/%' OR h.canonical_loser_name LIKE '%/%')
      AND (CASE WHEN pmi.won = 1 THEN COALESCE(h.winner_rank, 0) ELSE COALESCE(h.loser_rank, 0) END) BETWEEN 1 AND 100
      AND (CASE WHEN pmi.won = 1 THEN COALESCE(h.loser_rank, 0) ELSE COALESCE(h.winner_rank, 0) END) BETWEEN 1 AND 100
      AND COALESCE(h.w_odds_match, 0) > 1.01
      AND COALESCE(h.l_odds_match, 0) > 1.01
      THEN 1 ELSE 0
  END AS is_roi_usable
FROM player_match_index pmi
INNER JOIN tracked_players tp ON tp.id = pmi.tracked_player_id AND tp.is_active = 1
LEFT JOIN canonical_matches h ON h.source_a_historical_match_id = pmi.historical_match_id
`;

export const CANONICAL_MODELING_MATCHES_2024_PLUS_VIEW_SQL = `
CREATE VIEW IF NOT EXISTS canonical_modeling_matches_2024_plus AS
SELECT
  pmi.id AS pmi_id,
  pmi.tracked_player_id,
  pmi.historical_match_id,
  pmi.rapid_event_id,
  pmi.match_date,
  pmi.tour,
  pmi.tourney_name,
  v.surface_normalized AS surface,
  pmi.opponent_name,
  pmi.won,
  v.player_rank,
  v.opponent_rank,
  v.score,
  v.w_odds_match,
  v.l_odds_match,
  v.w_ace, v.w_df, v.w_svpt, v.w_1stIn, v.w_1stWon, v.w_2ndWon,
  v.w_bpSaved, v.w_bpFaced,
  v.l_ace, v.l_df, v.l_svpt, v.l_1stIn, v.l_1stWon, v.l_2ndWon,
  v.l_bpSaved, v.l_bpFaced,
  v.w_serve_won_pct, v.l_serve_won_pct,
  v.w_return_won_pct, v.l_return_won_pct,
  v.w_bp_won_pct, v.l_bp_won_pct,
  v.w_bp_saved_pct, v.l_bp_saved_pct,
  pmi.enrichment_status,
  pmi.data_source_stats,
  pmi.data_source_pbp,
  pmi.data_source_details,
  v.is_archive_only,
  v.is_placeholder_serve,
  v.is_retirement_or_wo,
  v.is_non_singles,
  -- Strict Modeling Gating Flags
  CASE 
    WHEN v.is_archive_only = 0
      AND pmi.match_date >= '2024-01-01'
      AND pmi.enrichment_status = 'enriched_from_api'
      AND v.is_retirement_or_wo = 0
      AND v.is_placeholder_serve = 0
      AND v.is_non_singles = 0
      AND pmi.has_api_statistics = 1
      AND COALESCE(v.w_svpt, 0) > 0
    THEN 1 ELSE 0 
  END AS is_canonical_modeling_usable,
  v.is_backtest_usable,
  v.is_roi_usable,
  v.is_surface_feature_usable,
  v.is_raw_serve_feature_usable,
  -- Audit & Exclusion Reasons
  CASE
    WHEN v.is_archive_only = 1 OR pmi.match_date < '2024-01-01' THEN 'EXCLUDED_PRE_2024_ARCHIVE'
    WHEN v.is_retirement_or_wo = 1 THEN 'EXCLUDED_RETIREMENT_OR_WALKOVER'
    WHEN pmi.match_date >= '2026-08-28' AND pmi.enrichment_status != 'enriched_from_api' THEN 'EXCLUDED_SPECULATIVE_DRAW'
    WHEN pmi.enrichment_status != 'enriched_from_api' THEN 'EXCLUDED_NO_API_BUNDLE'
    WHEN v.is_placeholder_serve = 1 THEN 'EXCLUDED_PLACEHOLDER_SERVE'
    WHEN v.is_non_singles = 1 THEN 'EXCLUDED_NON_SINGLES'
    ELSE 'APPROVED_CANONICAL'
  END AS canonical_status_reason
FROM player_match_index pmi
JOIN player_matches_validated v ON v.pmi_id = pmi.id
WHERE pmi.match_date >= '2024-01-01';
`;

export function ensurePlayerMatchesValidatedView(db: { exec: (sql: string) => void }): void {
  db.exec('DROP VIEW IF EXISTS canonical_modeling_matches_2024_plus');
  db.exec('DROP VIEW IF EXISTS player_matches_validated');
  db.exec(PLAYER_MATCHES_VALIDATED_VIEW_SQL);
  db.exec(CANONICAL_MODELING_MATCHES_2024_PLUS_VIEW_SQL);
}
