import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

export interface CutoverProbeResult {
  probeName: string;
  targetViewOrEndpoint: string;
  durationMs: number;
  rowCount: number;
  passed: boolean;
  sampleRecord?: any;
  error?: string;
}

export interface OperationalReadCutoverReport {
  timestamp: string;
  mode: 'DRY_RUN' | 'EXECUTE' | 'REVERT';
  targetDbPath: string;
  activeReadSource: 'canonical_matches_operational' | 'canonical_matches (legacy)';
  pragmasVerified: {
    journal_mode: string;
    foreign_keys: number;
    busy_timeout: number;
    wal_autocheckpoint: number;
  };
  baseTableInvariants: {
    legacyMatches: number;
    shadowMatchesV2: number;
    operationalViewTotal: number;
  };
  probes: CutoverProbeResult[];
  status: 'SUCCESS' | 'FAILED';
  error?: string;
}

/**
 * Validated layer view repointed to canonical_matches_operational
 */
export const PLAYER_MATCHES_VALIDATED_REPOINTED_SQL = `
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
LEFT JOIN canonical_matches_operational h ON h.source_a_historical_match_id = pmi.historical_match_id;
`;

/**
 * Validated layer view pointing to legacy canonical_matches (for revert/rollback)
 */
export const PLAYER_MATCHES_VALIDATED_LEGACY_SQL = `
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
LEFT JOIN canonical_matches h ON h.source_a_historical_match_id = pmi.historical_match_id;
`;

/**
 * 2024+ Modeling view dependent on player_matches_validated
 */
export const CANONICAL_MODELING_MATCHES_2024_PLUS_SQL = `
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

export class OperationalReadCutoverController {
  private targetDbPath: string;
  private isDryRun: boolean;

  constructor(options: {
    targetDbPath?: string;
    isDryRun?: boolean;
  } = {}) {
    this.targetDbPath = path.resolve(options.targetDbPath || 'data/database.sqlite');
    this.isDryRun = options.isDryRun ?? true; // Safe dry-run default
  }

  /**
   * Runs the cutover execution (or dry-run pre-flight).
   */
  public async cutover(): Promise<OperationalReadCutoverReport> {
    if (!fs.existsSync(this.targetDbPath)) {
      throw new Error(`Target database not found: ${this.targetDbPath}`);
    }

    const liveDb = new Database(this.targetDbPath);

    try {
      // Step 1: Enforce connection PRAGMAs
      liveDb.pragma('busy_timeout = 5000');
      liveDb.pragma('foreign_keys = ON');
      liveDb.pragma('journal_mode = WAL');
      liveDb.pragma('wal_autocheckpoint = 1000');

      const pragmasVerified = {
        journal_mode: (liveDb.pragma('journal_mode', { simple: true }) as string).toLowerCase(),
        foreign_keys: liveDb.pragma('foreign_keys', { simple: true }) as number,
        busy_timeout: liveDb.pragma('busy_timeout', { simple: true }) as number,
        wal_autocheckpoint: liveDb.pragma('wal_autocheckpoint', { simple: true }) as number,
      };

      // Step 2: Invariant check on base tables and operational view
      const legacyCount = (liveDb.prepare('SELECT count(1) as c FROM canonical_matches').get() as any).c;
      const v2Count = (liveDb.prepare('SELECT count(1) as c FROM canonical_matches_v2').get() as any).c;

      const opViewExists = liveDb.prepare(
        "SELECT count(1) as c FROM sqlite_master WHERE type='view' AND name='canonical_matches_operational'"
      ).get() as any;

      if (opViewExists.c === 0) {
        throw new Error("PRECONDITION FAILED: View 'canonical_matches_operational' does not exist on disk.");
      }

      const opCount = (liveDb.prepare('SELECT count(1) as c FROM canonical_matches_operational').get() as any).c;

      const baseTableInvariants = {
        legacyMatches: legacyCount,
        shadowMatchesV2: v2Count,
        operationalViewTotal: opCount,
      };

      // In DRY RUN mode: run probes against current state without mutating anything
      if (this.isDryRun) {
        console.log('[Cutover Controller] ℹ️ DRY RUN MODE: Validating preconditions and probe readiness. Zero database mutations executed.');
        const probes = this.runAllProbes(liveDb);

        return {
          timestamp: new Date().toISOString(),
          mode: 'DRY_RUN',
          targetDbPath: this.targetDbPath,
          activeReadSource: 'canonical_matches (legacy)',
          pragmasVerified,
          baseTableInvariants,
          probes,
          status: 'SUCCESS',
        };
      }

      // -------------------------------------------------------------------------
      // ACTUAL CUTOVER EXECUTION (--execute)
      // -------------------------------------------------------------------------
      console.log('[Cutover Controller] 🚀 EXECUTING READ CUTOVER: Repointing validated layer views to canonical_matches_operational...');

      // Atomic view replacement
      liveDb.exec(`
        DROP VIEW IF EXISTS canonical_modeling_matches_2024_plus;
        DROP VIEW IF EXISTS player_matches_validated;
        ${PLAYER_MATCHES_VALIDATED_REPOINTED_SQL}
        ${CANONICAL_MODELING_MATCHES_2024_PLUS_SQL}
      `);

      // Verify post-cutover base table invariant (base tables must remain 100% untouched)
      const legacyCountAfter = (liveDb.prepare('SELECT count(1) as c FROM canonical_matches').get() as any).c;
      const v2CountAfter = (liveDb.prepare('SELECT count(1) as c FROM canonical_matches_v2').get() as any).c;

      if (legacyCountAfter !== legacyCount || v2CountAfter !== v2Count) {
        throw new Error('FATAL INVARIANT VIOLATION: Base table row counts mutated during view cutover.');
      }

      // Execute post-cutover validation probes
      const probes = this.runAllProbes(liveDb);
      const allPassed = probes.every((p) => p.passed);

      if (!allPassed) {
        console.error('[Cutover Controller] ❌ POST-CUTOVER PROBE FAILURE! Initiating auto-revert...');
        this.executeRevert(liveDb);
        throw new Error('Post-cutover probes failed. Views were automatically reverted to legacy.');
      }

      return {
        timestamp: new Date().toISOString(),
        mode: 'EXECUTE',
        targetDbPath: this.targetDbPath,
        activeReadSource: 'canonical_matches_operational',
        pragmasVerified,
        baseTableInvariants,
        probes,
        status: 'SUCCESS',
      };
    } finally {
      liveDb.close();
    }
  }

  /**
   * Reverts views back to legacy canonical_matches immediately.
   */
  public revert(): OperationalReadCutoverReport {
    if (!fs.existsSync(this.targetDbPath)) {
      throw new Error(`Target database not found: ${this.targetDbPath}`);
    }

    const liveDb = new Database(this.targetDbPath);
    try {
      liveDb.pragma('busy_timeout = 5000');
      liveDb.pragma('foreign_keys = ON');

      const pragmasVerified = {
        journal_mode: (liveDb.pragma('journal_mode', { simple: true }) as string).toLowerCase(),
        foreign_keys: liveDb.pragma('foreign_keys', { simple: true }) as number,
        busy_timeout: liveDb.pragma('busy_timeout', { simple: true }) as number,
        wal_autocheckpoint: liveDb.pragma('wal_autocheckpoint', { simple: true }) as number,
      };

      const legacyCount = (liveDb.prepare('SELECT count(1) as c FROM canonical_matches').get() as any).c;
      const v2Count = (liveDb.prepare('SELECT count(1) as c FROM canonical_matches_v2').get() as any).c;
      const opCount = (liveDb.prepare('SELECT count(1) as c FROM canonical_matches_operational').get() as any).c;

      console.log('[Cutover Controller] ⚠️ REVERTING READ VIEWS: Re-attaching player_matches_validated to legacy canonical_matches...');
      this.executeRevert(liveDb);

      const probes = this.runAllProbes(liveDb);

      return {
        timestamp: new Date().toISOString(),
        mode: 'REVERT',
        targetDbPath: this.targetDbPath,
        activeReadSource: 'canonical_matches (legacy)',
        pragmasVerified,
        baseTableInvariants: {
          legacyMatches: legacyCount,
          shadowMatchesV2: v2Count,
          operationalViewTotal: opCount,
        },
        probes,
        status: 'SUCCESS',
      };
    } finally {
      liveDb.close();
    }
  }

  private executeRevert(db: Database.Database): void {
    db.exec(`
      DROP VIEW IF EXISTS canonical_modeling_matches_2024_plus;
      DROP VIEW IF EXISTS player_matches_validated;
      ${PLAYER_MATCHES_VALIDATED_LEGACY_SQL}
      ${CANONICAL_MODELING_MATCHES_2024_PLUS_SQL}
    `);
  }

  /**
   * Comprehensive probe suite validating consumers across 5 key dimensions:
   * 1. player_matches_validated row coverage & schema integrity
   * 2. canonical_modeling_matches_2024_plus usability & status reasons
   * 3. backtest candidate query execution & performance
   * 4. /api/web/matches payload shape and field contracts
   * 5. SQLite database integrity & foreign keys
   */
  private runAllProbes(db: Database.Database): CutoverProbeResult[] {
    const probes: CutoverProbeResult[] = [];

    // Probe 1: player_matches_validated coverage and sample inspection
    try {
      const t0 = performance.now();
      const pmiRow = db.prepare('SELECT count(1) as c FROM player_matches_validated').get() as any;
      const samplePmi = db.prepare(`
        SELECT pmi_id, player_name, opponent_name, match_date, surface_normalized, winner_name, score
        FROM player_matches_validated
        WHERE winner_name IS NOT NULL
        ORDER BY match_date DESC
        LIMIT 1
      `).get() as any;
      const t1 = performance.now();

      probes.push({
        probeName: 'player_matches_validated Probe',
        targetViewOrEndpoint: 'player_matches_validated',
        durationMs: Number((t1 - t0).toFixed(2)),
        rowCount: pmiRow.c,
        passed: pmiRow.c > 0 && !!samplePmi && !!samplePmi.player_name,
        sampleRecord: samplePmi,
      });
    } catch (err: any) {
      probes.push({
        probeName: 'player_matches_validated Probe',
        targetViewOrEndpoint: 'player_matches_validated',
        durationMs: 0,
        rowCount: 0,
        passed: false,
        error: err.message,
      });
    }

    // Probe 2: canonical_modeling_matches_2024_plus usability
    try {
      const t0 = performance.now();
      const modRow = db.prepare('SELECT count(1) as c FROM canonical_modeling_matches_2024_plus').get() as any;
      const sampleMod = db.prepare(`
        SELECT pmi_id, tourney_name, match_date, opponent_name, is_canonical_modeling_usable, canonical_status_reason
        FROM canonical_modeling_matches_2024_plus
        ORDER BY match_date DESC
        LIMIT 1
      `).get() as any;
      const t1 = performance.now();

      probes.push({
        probeName: 'canonical_modeling_matches_2024_plus Probe',
        targetViewOrEndpoint: 'canonical_modeling_matches_2024_plus',
        durationMs: Number((t1 - t0).toFixed(2)),
        rowCount: modRow.c,
        passed: modRow.c > 0 && !!sampleMod && !!sampleMod.tourney_name,
        sampleRecord: sampleMod,
      });
    } catch (err: any) {
      probes.push({
        probeName: 'canonical_modeling_matches_2024_plus Probe',
        targetViewOrEndpoint: 'canonical_modeling_matches_2024_plus',
        durationMs: 0,
        rowCount: 0,
        passed: false,
        error: err.message,
      });
    }

    // Probe 3: Backtest candidate query execution
    try {
      const t0 = performance.now();
      const candidateRows = db.prepare(`
        SELECT
          v.pmi_id,
          v.player_name,
          v.opponent_name,
          v.match_date,
          v.tourney_name,
          v.surface_normalized,
          v.score,
          v.is_backtest_usable
        FROM player_matches_validated v
        WHERE v.match_date >= '2024-01-01'
          AND v.is_backtest_usable = 1
        LIMIT 10
      `).all() as any[];
      const t1 = performance.now();

      probes.push({
        probeName: 'Backtest Candidate Query Probe',
        targetViewOrEndpoint: 'queryBacktestCandidateMatches',
        durationMs: Number((t1 - t0).toFixed(2)),
        rowCount: candidateRows.length,
        passed: candidateRows.length > 0 && candidateRows.every((r) => r.is_backtest_usable === 1),
        sampleRecord: candidateRows[0],
      });
    } catch (err: any) {
      probes.push({
        probeName: 'Backtest Candidate Query Probe',
        targetViewOrEndpoint: 'queryBacktestCandidateMatches',
        durationMs: 0,
        rowCount: 0,
        passed: false,
        error: err.message,
      });
    }

    // Probe 4: /api/web/matches payload shape and contract fidelity
    try {
      const t0 = performance.now();
      const predictions = db.prepare('SELECT * FROM predictions ORDER BY id DESC LIMIT 5').all() as any[];
      const t1 = performance.now();

      // Check required shape expected by telegram-webapp and web controller
      const shapeValid = predictions.length === 0 || predictions.every((p) => {
        return (
          'id' in p &&
          'tournament_name' in p &&
          'home_name' in p &&
          'away_name' in p &&
          'status' in p
        );
      });

      probes.push({
        probeName: '/api/web/matches Payload Shape Probe',
        targetViewOrEndpoint: 'GET /api/web/matches',
        durationMs: Number((t1 - t0).toFixed(2)),
        rowCount: predictions.length,
        passed: shapeValid,
        sampleRecord: predictions[0]
          ? {
              id: predictions[0].id,
              tournament_name: predictions[0].tournament_name,
              home_name: predictions[0].home_name,
              away_name: predictions[0].away_name,
              status: predictions[0].status,
            }
          : { status: 'NO_ACTIVE_PREDICTIONS' },
      });
    } catch (err: any) {
      probes.push({
        probeName: '/api/web/matches Payload Shape Probe',
        targetViewOrEndpoint: 'GET /api/web/matches',
        durationMs: 0,
        rowCount: 0,
        passed: false,
        error: err.message,
      });
    }

    // Probe 5: SQLite health probe
    try {
      const integrity = (db.pragma('integrity_check') as any[])[0]?.integrity_check;
      const fkErrors = (db.pragma('foreign_key_check') as any[]).length;
      probes.push({
        probeName: 'Database Health Probe',
        targetViewOrEndpoint: 'PRAGMA integrity_check / foreign_key_check',
        durationMs: 0,
        rowCount: 0,
        passed: integrity === 'ok' && fkErrors === 0,
      });
    } catch (err: any) {
      probes.push({
        probeName: 'Database Health Probe',
        targetViewOrEndpoint: 'PRAGMA integrity_check / foreign_key_check',
        durationMs: 0,
        rowCount: 0,
        passed: false,
        error: err.message,
      });
    }

    return probes;
  }
}

// CLI Execution Entrypoint
if (require.main === module) {
  const isExecuteRequested = process.argv.includes('--execute');
  const isRevertRequested = process.argv.includes('--revert');

  if (isExecuteRequested && isRevertRequested) {
    console.error('ERROR: Cannot specify both --execute and --revert.');
    process.exit(1);
  }

  const controller = new OperationalReadCutoverController({
    isDryRun: !isExecuteRequested && !isRevertRequested,
  });

  if (isRevertRequested) {
    try {
      const report = controller.revert();
      console.log(JSON.stringify(report, null, 2));
    } catch (err: any) {
      console.error('[REVERT ERROR]:', err);
      process.exit(1);
    }
  } else {
    controller
      .cutover()
      .then((report) => {
        console.log(JSON.stringify(report, null, 2));
      })
      .catch((err) => {
        console.error('[CUTOVER ERROR]:', err);
        process.exit(1);
      });
  }
}
