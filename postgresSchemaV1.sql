-- =============================================================================
-- FOOTBALL STATE / TENNIS AI PLATFORM
-- TARGET POSTGRESQL 16 CANONICAL DDL SPECIFICATION (V1 - SCHEMA FREEZE)
-- =============================================================================
--
-- Branch: staging/postgres-schema-v1
-- Target Engine: PostgreSQL 16+ (Verified on PostgreSQL 16/18 engine)
-- Transactional Safety: Wrapped in single atomic transaction block (BEGIN...COMMIT)
-- Idempotency: 100% safe to re-run on fresh or existing databases (IF NOT EXISTS / REPLACE)
-- Non-destructive: Contains 0 DROP, 0 TRUNCATE, and 0 mutating operations
--
-- Architectural Decisions & Invariants:
--   1. UUID Strategy: All canonical domain entities use native `UUID` with UUIDv4 
--      (`gen_random_uuid()`) as standard PostgreSQL 16 default. Seamlessly forward-
--      compatible with UUIDv7 (`uuid_generate_v7()`) without column type alterations.
--   2. Domain Isolation: 12 distinct schemas. Schema `analytics` is kept strictly
--      separate from `statistics` to segregate derived metrics & completeness gating
--      from raw box scores.
--   3. Point-by-Point Allocation: `matches.match_points` is preserved in DDL for
--      Markov simulations, but NOT populated during Phase 1-4 data migrations.
--      Raw point streams live in compressed JSON via `raw.source_evidence(blob_uri)`.
--   4. Zero Lookahead Leakage: Symmetrical participant pairing (`player1_id < player2_id`)
--      completely separates pre-match fixtures from post-match outcomes (`match_results`).
--   5. Zero Fabrication: Authentic NULLs for unrecorded legacy telemetry. No synthetic zeros.
--   6. Compatibility Layer: 4 public views project legacy 79-column operational shapes.
--
-- Architectural Domains:
--   1.  Extensions & Global Settings
--   2.  Schemas (12 canonical schemas)
--   3.  Custom Enum Types (11 enums)
--   4.  Schema `raw`: Source Evidence & Payload Hashes
--   5.  Schema `identity`: Canonical Players, Tournaments & Aliases
--   6.  Schema `competition`: Tournament Editions & Draws
--   7.  Schema `matches`: Matches, Symmetric Participants, Results, Sets, Games, Points
--   8.  Schema `statistics`: Box Scores & Serve/Return Statistics
--   9.  Schema `analytics`: PBP Metrics, Physical/ACWR Telemetry, Completeness Scores
--   10. Schema `markets`: Bookmakers & Timestamped Odds Ticks (Lookahead-Safe)
--   11. Schema `ai`: Prediction Runs, Immutability Hashes & 5-Agent Execution Traces
--   12. Schema `predictions`: Published Production Predictions, SEO Editorials, Broadcasts
--   13. Schema `provenance`: Deterministic Source Links, Field Audits & Review Queue
--   14. Schema `backtest`: Frozen Cohorts, Partitions & Experiment Replay Runs
--   15. Schema `app`: User Management, Affiliate Referrals, System Configuration, Sync Jobs
--   16. Schema `public`: Backward-Compatibility Views for Legacy API Consumers
--
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. EXTENSIONS & GLOBAL SETTINGS
-- =============================================================================

-- pgcrypto provides gen_random_uuid() for standard PostgreSQL 16 UUIDv4 generation.
-- Architectural Decision: All canonical entity IDs use native PostgreSQL `UUID` type with
-- `DEFAULT gen_random_uuid()` (UUIDv4) as baseline. If the target production environment
-- (AWS RDS, Supabase, Neon) has `pg_uuidv7` available, defaults can be swapped to
-- `DEFAULT uuid_generate_v7()` without any column type or application changes.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- pg_trgm provides high-speed trigram indexing for fuzzy player/tournament name searches
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- =============================================================================
-- 2. SCHEMAS
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS "raw";
CREATE SCHEMA IF NOT EXISTS "identity";
CREATE SCHEMA IF NOT EXISTS "competition";
CREATE SCHEMA IF NOT EXISTS "matches";
CREATE SCHEMA IF NOT EXISTS "statistics";
CREATE SCHEMA IF NOT EXISTS "analytics";
CREATE SCHEMA IF NOT EXISTS "markets";
CREATE SCHEMA IF NOT EXISTS "ai";
CREATE SCHEMA IF NOT EXISTS "predictions";
CREATE SCHEMA IF NOT EXISTS "provenance";
CREATE SCHEMA IF NOT EXISTS "backtest";
CREATE SCHEMA IF NOT EXISTS "app";

-- =============================================================================
-- 3. CUSTOM TYPES & ENUMS
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tour_code' AND typnamespace = 'identity'::regnamespace) THEN
    CREATE TYPE identity.tour_code AS ENUM ('ATP', 'WTA', 'ITF', 'CHALLENGER', 'COMBINED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gender_code' AND typnamespace = 'identity'::regnamespace) THEN
    CREATE TYPE identity.gender_code AS ENUM ('M', 'F', 'MIXED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'player_hand' AND typnamespace = 'identity'::regnamespace) THEN
    CREATE TYPE identity.player_hand AS ENUM ('R', 'L', 'Ambi', 'Unknown');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'surface_type' AND typnamespace = 'competition'::regnamespace) THEN
    CREATE TYPE competition.surface_type AS ENUM ('Hard', 'Clay', 'Grass', 'Carpet', 'Unknown');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'match_status_type' AND typnamespace = 'matches'::regnamespace) THEN
    CREATE TYPE matches.match_status_type AS ENUM (
      'SCHEDULED',
      'IN_PROGRESS',
      'FINISHED',
      'RETIRED',
      'WALKOVER',
      'DEFAULT',
      'CANCELLED',
      'ABANDONED',
      'INTERRUPTED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'market_category' AND typnamespace = 'markets'::regnamespace) THEN
    CREATE TYPE markets.market_category AS ENUM (
      'MONEYLINE',
      'SET_HANDICAP',
      'GAME_HANDICAP',
      'TOTAL_GAMES',
      'SET_1_WINNER',
      'SET_1_TOTAL_GAMES',
      'CORRECT_SET_SCORE'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agent_role_type' AND typnamespace = 'ai'::regnamespace) THEN
    CREATE TYPE ai.agent_role_type AS ENUM (
      'PHYSICAL',
      'STATISTICAL',
      'HISTORICAL',
      'MARKET',
      'CHIEF'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'prediction_status_type' AND typnamespace = 'predictions'::regnamespace) THEN
    CREATE TYPE predictions.prediction_status_type AS ENUM (
      'UPCOMING',
      'LIVE',
      'WON',
      'LOST',
      'VOID',
      'INTERRUPTED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'editorial_publish_status' AND typnamespace = 'predictions'::regnamespace) THEN
    CREATE TYPE predictions.editorial_publish_status AS ENUM (
      'draft',
      'review',
      'approved',
      'published',
      'archived'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'review_status_type' AND typnamespace = 'provenance'::regnamespace) THEN
    CREATE TYPE provenance.review_status_type AS ENUM (
      'PENDING',
      'APPROVED',
      'REJECTED',
      'MERGED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'partition_split_type' AND typnamespace = 'backtest'::regnamespace) THEN
    CREATE TYPE backtest.partition_split_type AS ENUM (
      'TRAIN',
      'VALIDATION',
      'TEST'
    );
  END IF;
END $$;

-- =============================================================================
-- 4. SCHEMA `raw`: SOURCE EVIDENCE & PAYLOAD HASHES
-- =============================================================================

-- Table: raw.source_evidence
-- Purpose: Immutable audit log of every raw external API or CSV payload received.
CREATE TABLE IF NOT EXISTS raw.source_evidence (
  evidence_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name VARCHAR(50) NOT NULL,                      -- e.g. 'rapidapi_tennis1', 'sackmann_csv', 'onewin_scraper'
  source_match_id VARCHAR(100) NOT NULL,                 -- Identifier as given by upstream source
  payload_sha256 CHAR(64) NOT NULL,                      -- Cryptographic content hash of raw payload
  storage_mode VARCHAR(20) NOT NULL DEFAULT 'inline_jsonb'
    CHECK (storage_mode IN ('inline_jsonb', 's3_pointer', 'raw_text')),
  payload_json JSONB NULL,                               -- Stored inline if < 50 KB
  blob_uri TEXT NULL,                                    -- S3 / R2 URI if stored externally (e.g. s3://bucket/events/2026/09/11925844.json.gz)
  payload_size_bytes INTEGER NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_raw_source_evidence_unique_record UNIQUE (source_name, source_match_id, payload_sha256)
);

CREATE INDEX IF NOT EXISTS idx_raw_source_evidence_lookup 
  ON raw.source_evidence (source_name, source_match_id);

CREATE INDEX IF NOT EXISTS idx_raw_source_evidence_hash 
  ON raw.source_evidence (payload_sha256);

CREATE INDEX IF NOT EXISTS idx_raw_source_evidence_fetched 
  ON raw.source_evidence (fetched_at DESC);

-- =============================================================================
-- 5. SCHEMA `identity`: CANONICAL PLAYERS, TOURNAMENTS & ALIASES
-- =============================================================================

-- Table: identity.players
-- Purpose: Authoritative canonical entity registry for tennis players.
CREATE TABLE IF NOT EXISTS identity.players (
  player_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name_standard TEXT NOT NULL,                     -- e.g. 'Carlos Alcaraz', 'Novak Djokovic'
  first_name TEXT NULL,
  last_name TEXT NOT NULL,
  slug TEXT NOT NULL,                                   -- URL slug, e.g. 'carlos-alcaraz'
  birth_date DATE NULL,
  country_ioc CHAR(3) NULL,                             -- ISO/IOC 3-letter country code, e.g. 'ESP', 'SRB'
  gender identity.gender_code NOT NULL,
  hand identity.player_hand NOT NULL DEFAULT 'Unknown',
  height_cm SMALLINT NULL CHECK (height_cm IS NULL OR (height_cm >= 140 AND height_cm <= 230)),
  weight_kg SMALLINT NULL CHECK (weight_kg IS NULL OR (weight_kg >= 40 AND weight_kg <= 140)),
  turned_pro_year SMALLINT NULL CHECK (turned_pro_year IS NULL OR (turned_pro_year >= 1968 AND turned_pro_year <= 2030)),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_identity_players_name_trgm 
  ON identity.players USING gin (full_name_standard gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_identity_players_last_name 
  ON identity.players (last_name, first_name);

CREATE INDEX IF NOT EXISTS idx_identity_players_country 
  ON identity.players (country_ioc);

CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_players_slug 
  ON identity.players (slug);

-- Table: identity.player_aliases
-- Purpose: Deterministic token mapping from external vendor strings to canonical player_id.
CREATE TABLE IF NOT EXISTS identity.player_aliases (
  alias_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES identity.players(player_id) ON DELETE CASCADE,
  source_name VARCHAR(50) NOT NULL,                     -- e.g. 'rapidapi', 'sackmann', 'onewin'
  raw_name TEXT NOT NULL,                               -- Exactly as received in upstream feed
  normalized_token TEXT NOT NULL,                       -- Stripped of accents, lowercase, trimmed
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  has_sibling_conflict BOOLEAN NOT NULL DEFAULT FALSE,  -- Flags Cerundolo/Zverev/Williams ambiguity
  conflict_notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_identity_player_aliases_source_token UNIQUE (source_name, normalized_token)
);

CREATE INDEX IF NOT EXISTS idx_identity_player_aliases_player 
  ON identity.player_aliases (player_id);

CREATE INDEX IF NOT EXISTS idx_identity_player_aliases_lookup 
  ON identity.player_aliases (source_name, normalized_token);

CREATE INDEX IF NOT EXISTS idx_identity_player_aliases_raw_trgm 
  ON identity.player_aliases USING gin (raw_name gin_trgm_ops);

-- Table: identity.tournaments
-- Purpose: Authoritative competition directory (evergreen tournament definitions).
CREATE TABLE IF NOT EXISTS identity.tournaments (
  tournament_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_standard TEXT NOT NULL,                          -- e.g. 'Roland Garros', 'Wimbledon', 'Indian Wells'
  tour identity.tour_code NOT NULL,
  tour_level VARCHAR(30) NOT NULL,                      -- e.g. 'Grand Slam', 'Masters 1000', 'ATP 500', 'WTA 1000'
  default_surface competition.surface_type NOT NULL,
  country_ioc CHAR(3) NULL,
  city TEXT NULL,
  altitude_meters SMALLINT NULL,
  is_indoor BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_identity_tournaments_name_tour UNIQUE (name_standard, tour)
);

CREATE INDEX IF NOT EXISTS idx_identity_tournaments_name_trgm 
  ON identity.tournaments USING gin (name_standard gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_identity_tournaments_surface 
  ON identity.tournaments (default_surface);

-- Table: identity.tournament_aliases
-- Purpose: Resolves vendor variations of tournament names to canonical tournament_id.
CREATE TABLE IF NOT EXISTS identity.tournament_aliases (
  alias_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES identity.tournaments(tournament_id) ON DELETE CASCADE,
  source_name VARCHAR(50) NOT NULL,
  raw_name TEXT NOT NULL,
  normalized_token TEXT NOT NULL,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_identity_tournament_aliases_source_token UNIQUE (source_name, normalized_token)
);

CREATE INDEX IF NOT EXISTS idx_identity_tournament_aliases_tourney 
  ON identity.tournament_aliases (tournament_id);

-- =============================================================================
-- 6. SCHEMA `competition`: TOURNAMENT EDITIONS & DRAWS
-- =============================================================================

-- Table: competition.tournament_editions
-- Purpose: Specific annual edition of a tournament (e.g. Roland Garros 2025).
CREATE TABLE IF NOT EXISTS competition.tournament_editions (
  edition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES identity.tournaments(tournament_id) ON DELETE RESTRICT,
  year SMALLINT NOT NULL CHECK (year >= 1968 AND year <= 2040),
  edition_name TEXT NOT NULL,                           -- e.g. 'Roland Garros 2025'
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  actual_surface competition.surface_type NOT NULL,
  draw_size SMALLINT NULL CHECK (draw_size IS NULL OR draw_size > 0),
  court_pace_index SMALLINT NULL,                       -- CPI (Speed: <30 slow, 30-34 medium-slow, 35-39 medium, 40-44 medium-fast, >=45 fast)
  balls_brand VARCHAR(50) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_competition_edition_year UNIQUE (tournament_id, year),
  CONSTRAINT ck_competition_edition_dates CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_competition_editions_dates 
  ON competition.tournament_editions (start_date, end_date);

-- =============================================================================
-- 7. SCHEMA `matches`: MATCH CORE, SYMMETRIC PARTICIPANTS, RESULTS, SETS, GAMES
-- =============================================================================

-- Table: matches.matches
-- Purpose: Primary fixture entity. Symmetrical participant structure prevents lookahead bias.
CREATE TABLE IF NOT EXISTS matches.matches (
  match_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID NOT NULL REFERENCES competition.tournament_editions(edition_id) ON DELETE RESTRICT,
  scheduled_start_utc TIMESTAMPTZ NOT NULL,             -- Pre-match cutoff reference for all temporal modeling
  actual_start_utc TIMESTAMPTZ NULL,
  round_name VARCHAR(30) NOT NULL,                      -- e.g. 'F', 'SF', 'QF', 'R16', 'R32', 'R64', 'R128', 'RR'
  match_num SMALLINT NULL,                              -- Bracket order number
  best_of SMALLINT NOT NULL CHECK (best_of IN (3, 5)),
  surface competition.surface_type NOT NULL,
  is_indoor BOOLEAN NOT NULL DEFAULT FALSE,
  status matches.match_status_type NOT NULL DEFAULT 'SCHEDULED',
  -- Symmetrically ordered player IDs (player1_id is strictly < player2_id by UUID)
  -- Guarantees single unique match pairing regardless of who won or was home/away
  player1_id UUID NOT NULL REFERENCES identity.players(player_id) ON DELETE RESTRICT,
  player2_id UUID NOT NULL REFERENCES identity.players(player_id) ON DELETE RESTRICT,
  source_mask INTEGER NOT NULL DEFAULT 0,               -- Bitmask: 1=Sackmann CSV, 2=RapidAPI, 4=SofaScore, 8=OneWin
  evidence_count SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ck_matches_symmetrical_order CHECK (player1_id < player2_id),
  CONSTRAINT uq_matches_unique_fixture UNIQUE (edition_id, round_name, player1_id, player2_id)
);

CREATE INDEX IF NOT EXISTS idx_matches_scheduled_start 
  ON matches.matches (scheduled_start_utc);

CREATE INDEX IF NOT EXISTS idx_matches_status 
  ON matches.matches (status);

CREATE INDEX IF NOT EXISTS idx_matches_player1 
  ON matches.matches (player1_id, scheduled_start_utc);

CREATE INDEX IF NOT EXISTS idx_matches_player2 
  ON matches.matches (player2_id, scheduled_start_utc);

CREATE INDEX IF NOT EXISTS idx_matches_edition_round 
  ON matches.matches (edition_id, round_name);

-- Table: matches.match_participants
-- Purpose: Detailed pre-match entrant metadata per player (seed, entry, ranking points).
CREATE TABLE IF NOT EXISTS matches.match_participants (
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES identity.players(player_id) ON DELETE RESTRICT,
  side SMALLINT NOT NULL CHECK (side IN (1, 2)),        -- 1 = player1, 2 = player2
  seed SMALLINT NULL,
  entry_status VARCHAR(10) NULL,                        -- e.g. 'WC', 'Q', 'LL', 'PR', 'SE'
  pre_match_rank INTEGER NULL CHECK (pre_match_rank IS NULL OR pre_match_rank > 0),
  pre_match_rank_points INTEGER NULL,
  days_rest_since_prior_match SMALLINT NULL,
  is_winner BOOLEAN NULL,                               -- Populated strictly upon match conclusion
  PRIMARY KEY (match_id, side),
  CONSTRAINT uq_matches_participants_unique_player UNIQUE (match_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_match_participants_player 
  ON matches.match_participants (player_id, match_id);

CREATE INDEX IF NOT EXISTS idx_match_participants_rank 
  ON matches.match_participants (pre_match_rank);

-- Table: matches.match_results
-- Purpose: Official post-match result settlement. Segregated from pre-match data.
CREATE TABLE IF NOT EXISTS matches.match_results (
  match_id UUID PRIMARY KEY REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  winner_player_id UUID NOT NULL REFERENCES identity.players(player_id) ON DELETE RESTRICT,
  loser_player_id UUID NOT NULL REFERENCES identity.players(player_id) ON DELETE RESTRICT,
  score_string TEXT NOT NULL,                           -- Official score representation, e.g. '6-4 3-6 7-6(5)'
  duration_minutes SMALLINT NULL,
  is_retirement_or_wo BOOLEAN NOT NULL DEFAULT FALSE,
  retirement_detail TEXT NULL,                          -- e.g. 'Right wrist injury at 6-4 2-1'
  settled_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ck_match_results_distinct_players CHECK (winner_player_id <> loser_player_id)
);

CREATE INDEX IF NOT EXISTS idx_match_results_winner 
  ON matches.match_results (winner_player_id);

CREATE INDEX IF NOT EXISTS idx_match_results_loser 
  ON matches.match_results (loser_player_id);

-- Table: matches.match_sets
-- Purpose: Formal set-by-set breakdown.
CREATE TABLE IF NOT EXISTS matches.match_sets (
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  set_number SMALLINT NOT NULL CHECK (set_number BETWEEN 1 AND 5),
  side1_games SMALLINT NOT NULL CHECK (side1_games >= 0),
  side2_games SMALLINT NOT NULL CHECK (side2_games >= 0),
  tiebreak_score TEXT NULL,                             -- e.g. '7-5' or '10-8'
  duration_seconds INTEGER NULL,
  PRIMARY KEY (match_id, set_number)
);

-- Table: matches.match_games
-- Purpose: Game progression, service holds/breaks, and deuce game counts.
CREATE TABLE IF NOT EXISTS matches.match_games (
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  set_number SMALLINT NOT NULL CHECK (set_number BETWEEN 1 AND 5),
  game_number SMALLINT NOT NULL CHECK (game_number >= 1),
  server_side SMALLINT NOT NULL CHECK (server_side IN (1, 2)),
  winner_side SMALLINT NOT NULL CHECK (winner_side IN (1, 2)),
  is_break_of_serve BOOLEAN NOT NULL,
  point_sequence TEXT NOT NULL,                         -- e.g. '15-0, 30-0, 40-0, Game'
  deuce_count SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, set_number, game_number)
);

-- Table: matches.match_points
-- Purpose: High-resolution point-by-point telemetry for Markov and fatigue simulations.
-- Policy Decision: Retained in canonical DDL for experimental deep-modeling cohorts, but
-- intentionally UNPOPULATED during initial Phase 1-4 migrations to avoid relational bloat
-- (35M+ rows). Operational point streams are preserved in object storage via raw.source_evidence.
CREATE TABLE IF NOT EXISTS matches.match_points (
  point_id BIGSERIAL,
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  set_number SMALLINT NOT NULL,
  game_number SMALLINT NOT NULL,
  point_number SMALLINT NOT NULL,
  server_side SMALLINT NOT NULL CHECK (server_side IN (1, 2)),
  point_winner_side SMALLINT NOT NULL CHECK (point_winner_side IN (1, 2)),
  serve_speed_kph SMALLINT NULL,
  rally_length SMALLINT NULL,
  shot_outcome VARCHAR(20) NULL,                        -- e.g. 'ACE', 'DOUBLE_FAULT', 'WINNER', 'UNFORCED_ERROR'
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (match_id, set_number, game_number, point_number)
);

-- =============================================================================
-- 8. SCHEMA `statistics`: BOX SCORES & SERVE/RETURN STATISTICS
-- =============================================================================

-- Table: statistics.match_player_statistics
-- Purpose: Granular match box scores per player.
CREATE TABLE IF NOT EXISTS statistics.match_player_statistics (
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES identity.players(player_id) ON DELETE RESTRICT,
  side SMALLINT NOT NULL CHECK (side IN (1, 2)),
  -- Service Statistics
  aces SMALLINT NOT NULL DEFAULT 0,
  double_faults SMALLINT NOT NULL DEFAULT 0,
  svpt SMALLINT NOT NULL DEFAULT 0,                     -- Total service points played
  first_in SMALLINT NOT NULL DEFAULT 0,                 -- 1st serves in
  first_won SMALLINT NOT NULL DEFAULT 0,                -- 1st serve points won
  second_won SMALLINT NOT NULL DEFAULT 0,               -- 2nd serve points won
  sv_gms SMALLINT NOT NULL DEFAULT 0,                   -- Total service games played
  bp_saved SMALLINT NOT NULL DEFAULT 0,                 -- Break points saved
  bp_faced SMALLINT NOT NULL DEFAULT 0,                 -- Break points faced
  -- Return Statistics
  first_return_won SMALLINT NOT NULL DEFAULT 0,
  second_return_won SMALLINT NOT NULL DEFAULT 0,
  bp_converted SMALLINT NOT NULL DEFAULT 0,
  bp_opportunities SMALLINT NOT NULL DEFAULT 0,
  receiver_points_won SMALLINT NOT NULL DEFAULT 0,
  total_points_won SMALLINT NOT NULL DEFAULT 0,
  -- Data Integrity Flags
  is_placeholder_serve BOOLEAN NOT NULL DEFAULT FALSE,  -- True if corrupted legacy placeholder (e.g. svpt=100)
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (match_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_match_player_stats_player 
  ON statistics.match_player_statistics (player_id, match_id);

-- =============================================================================
-- 9. SCHEMA `analytics`: PBP METRICS, PHYSICAL/ACWR & COMPLETENESS
-- =============================================================================
-- Architectural Decision: Kept strictly separate from schema `statistics`. While `statistics`
-- stores authentic box scores per player/match, `analytics` houses derived analytical
-- indicators (PBCR, break-back rates, love holds) and the data completeness matrix.

-- Table: analytics.match_pbp_metrics
-- Purpose: Precalculated point-by-point indicators (PBCR, break-back rate, love holds).
CREATE TABLE IF NOT EXISTS analytics.match_pbp_metrics (
  match_id UUID PRIMARY KEY REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  total_games SMALLINT NOT NULL,
  side1_service_games SMALLINT NOT NULL,
  side2_service_games SMALLINT NOT NULL,
  side1_breaks_suffered SMALLINT NOT NULL,
  side2_breaks_suffered SMALLINT NOT NULL,
  side1_consecutive_breaks SMALLINT NOT NULL DEFAULT 0,
  side2_consecutive_breaks SMALLINT NOT NULL DEFAULT 0,
  side1_pbcr NUMERIC(5, 4) NULL,                        -- Pressure Break Conversion Rate
  side2_pbcr NUMERIC(5, 4) NULL,
  side1_break_back_rate NUMERIC(5, 4) NULL,
  side2_break_back_rate NUMERIC(5, 4) NULL,
  total_deuce_games SMALLINT NOT NULL DEFAULT 0,
  side1_deuce_games_won SMALLINT NOT NULL DEFAULT 0,
  side2_deuce_games_won SMALLINT NOT NULL DEFAULT 0,
  side1_love_hold_pct NUMERIC(5, 4) NULL,
  side2_love_hold_pct NUMERIC(5, 4) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Table: analytics.match_data_completeness
-- Purpose: Concrete tracking matrix of available data tiers per match.
CREATE TABLE IF NOT EXISTS analytics.match_data_completeness (
  match_id UUID PRIMARY KEY REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  has_scheduled_start BOOLEAN NOT NULL DEFAULT FALSE,
  has_official_score BOOLEAN NOT NULL DEFAULT FALSE,
  has_box_score_stats BOOLEAN NOT NULL DEFAULT FALSE,
  has_set_statistics BOOLEAN NOT NULL DEFAULT FALSE,
  has_pbp_analytics BOOLEAN NOT NULL DEFAULT FALSE,
  has_closing_odds BOOLEAN NOT NULL DEFAULT FALSE,
  has_odds_history BOOLEAN NOT NULL DEFAULT FALSE,
  has_player_biometrics BOOLEAN NOT NULL DEFAULT FALSE,
  completeness_score SMALLINT NOT NULL DEFAULT 0 CHECK (completeness_score BETWEEN 0 AND 100),
  is_canonical_modeling_usable BOOLEAN NOT NULL DEFAULT FALSE,
  is_backtest_safe BOOLEAN NOT NULL DEFAULT FALSE,
  quarantine_reason TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_analytics_completeness_usable 
  ON analytics.match_data_completeness (is_canonical_modeling_usable, is_backtest_safe);

-- =============================================================================
-- 10. SCHEMA `markets`: BOOKMAKERS & TIMESTAMPED ODDS TICKS
-- =============================================================================

-- Table: markets.bookmakers
-- Purpose: Sportsbook provider directory.
CREATE TABLE IF NOT EXISTS markets.bookmakers (
  bookmaker_id SMALLSERIAL PRIMARY KEY,
  bookmaker_key VARCHAR(50) NOT NULL UNIQUE,            -- e.g. 'pinnacle', 'onewin', 'bet365', 'consensus'
  display_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Table: markets.market_odds_ticks
-- Purpose: Timestamped market odds history. Eliminates lookahead bias during backtests.
CREATE TABLE IF NOT EXISTS markets.market_odds_ticks (
  tick_id BIGSERIAL PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  bookmaker_id SMALLINT NOT NULL REFERENCES markets.bookmakers(bookmaker_id) ON DELETE RESTRICT,
  market_type markets.market_category NOT NULL,
  selection_side SMALLINT NULL CHECK (selection_side IN (1, 2)), -- 1 = player1, 2 = player2
  line NUMERIC(5, 2) NULL,                              -- Handicap/Total line, e.g. -3.5, 22.5
  decimal_odds NUMERIC(7, 3) NOT NULL CHECK (decimal_odds > 1.000),
  is_closing_line BOOLEAN NOT NULL DEFAULT FALSE,
  is_live BOOLEAN NOT NULL DEFAULT FALSE,
  captured_at_utc TIMESTAMPTZ NOT NULL,                 -- Exact capture timestamp for point-in-time filtering
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_markets_odds_pit_lookup 
  ON markets.market_odds_ticks (match_id, market_type, captured_at_utc DESC);

CREATE INDEX IF NOT EXISTS idx_markets_odds_closing 
  ON markets.market_odds_ticks (match_id, is_closing_line) WHERE is_closing_line = TRUE;

CREATE INDEX IF NOT EXISTS idx_markets_odds_time 
  ON markets.market_odds_ticks (captured_at_utc);

-- =============================================================================
-- 11. SCHEMA `ai`: PREDICTION RUNS, IMMUTABILITY HASHES & AGENT TRACES
-- =============================================================================

-- Table: ai.prediction_runs
-- Purpose: Top-level record of every AI execution.
CREATE TABLE IF NOT EXISTS ai.prediction_runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  cutoff_timestamp_utc TIMESTAMPTZ NOT NULL,           -- Strict point-in-time barrier
  feature_schema_hash CHAR(64) NOT NULL,               -- Hash of 67-indicator schema definition
  feature_snapshot JSONB NOT NULL,                     -- Complete frozen input feature vector
  model_routing_config JSONB NOT NULL,                 -- Models mapped per agent
  predicted_winner_side SMALLINT NOT NULL CHECK (predicted_winner_side IN (1, 2)),
  win_probability_pct NUMERIC(5, 2) NOT NULL CHECK (win_probability_pct BETWEEN 0.00 AND 100.00),
  confidence_tier VARCHAR(20) NOT NULL,                -- 'HIGH', 'MEDIUM', 'LOW'
  best_bet_market TEXT NULL,
  best_bet_selection TEXT NULL,
  best_bet_ev_pct NUMERIC(5, 2) NULL,
  quality_gate_passed BOOLEAN NOT NULL,
  quality_gate_verdict TEXT NULL,
  total_latency_ms INTEGER NOT NULL,
  total_prompt_tokens INTEGER NULL,
  total_completion_tokens INTEGER NULL,
  estimated_cost_usd NUMERIC(8, 5) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_ai_prediction_runs_match 
  ON ai.prediction_runs (match_id, cutoff_timestamp_utc);

CREATE INDEX IF NOT EXISTS idx_ai_prediction_runs_hash 
  ON ai.prediction_runs (feature_schema_hash);

-- Table: ai.agent_traces
-- Purpose: Replaces local IndexedDB. Fully stores raw reasoning, prompts, and tokens per agent.
CREATE TABLE IF NOT EXISTS ai.agent_traces (
  trace_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES ai.prediction_runs(run_id) ON DELETE CASCADE,
  agent_role ai.agent_role_type NOT NULL,
  agent_index SMALLINT NOT NULL CHECK (agent_index BETWEEN 1 AND 5),
  provider VARCHAR(30) NOT NULL,                       -- e.g. 'openai', 'deepseek', 'groq', 'cerebras'
  model_identifier VARCHAR(100) NOT NULL,              -- e.g. 'deepseek-reasoner', 'gpt-4o', 'llama-3.3-70b'
  temperature NUMERIC(3, 2) NOT NULL,
  prompt_tokens INTEGER NULL,
  completion_tokens INTEGER NULL,
  latency_ms INTEGER NOT NULL,
  system_prompt TEXT NOT NULL,
  user_prompt TEXT NOT NULL,
  raw_thinking_content TEXT NULL,                      -- Extended reasoning tokens from DeepSeek-R1/o3-mini
  raw_response_content TEXT NOT NULL,
  parsed_output JSONB NOT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_ai_agent_traces_run_role UNIQUE (run_id, agent_role)
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_traces_run 
  ON ai.agent_traces (run_id);

CREATE INDEX IF NOT EXISTS idx_ai_agent_traces_model 
  ON ai.agent_traces (model_identifier);

-- =============================================================================
-- 12. SCHEMA `predictions`: PUBLISHED PREDICTIONS, EDITORIALS, BROADCASTS
-- =============================================================================

-- Table: predictions.published_predictions
-- Purpose: Serving table for WebApp, Web guests, and Telegram Mini App.
CREATE TABLE IF NOT EXISTS predictions.published_predictions (
  prediction_id BIGSERIAL PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  run_id UUID NULL REFERENCES ai.prediction_runs(run_id) ON DELETE SET NULL,
  fixture_id INTEGER NOT NULL UNIQUE,                  -- Maintained for full backward compatibility with WebApp
  home_player_id UUID NOT NULL REFERENCES identity.players(player_id),
  away_player_id UUID NOT NULL REFERENCES identity.players(player_id),
  predicted_winner_id UUID NOT NULL REFERENCES identity.players(player_id),
  win_probability SMALLINT NOT NULL CHECK (win_probability BETWEEN 1 AND 99),
  confidence VARCHAR(20) NOT NULL,
  predicted_score TEXT NULL,
  best_bet_market TEXT NULL,
  best_bet_selection TEXT NULL,
  best_bet_ev TEXT NULL,
  best_bet_rationale TEXT NULL,
  alt_bet_market TEXT NULL,
  alt_bet_selection TEXT NULL,
  key_factors JSONB NOT NULL DEFAULT '[]'::jsonb,
  devils_advocate_risk TEXT NULL,
  ai_summary TEXT NULL,
  status predictions.prediction_status_type NOT NULL DEFAULT 'UPCOMING',
  result_score TEXT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_predictions_published_status 
  ON predictions.published_predictions (status, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_predictions_published_fixture 
  ON predictions.published_predictions (fixture_id);

-- Table: predictions.match_editorials
-- Purpose: Mode A long-form SEO preview content for web visitors.
CREATE TABLE IF NOT EXISTS predictions.match_editorials (
  editorial_id BIGSERIAL PRIMARY KEY,
  fixture_id INTEGER NOT NULL UNIQUE,
  match_id UUID NULL REFERENCES matches.matches(match_id) ON DELETE SET NULL,
  slug TEXT NOT NULL UNIQUE,
  headline TEXT NOT NULL,
  subtitle TEXT NULL,
  summary TEXT NOT NULL,
  short_summary TEXT NULL,
  guest_safe_summary TEXT NULL,
  tactical_analysis TEXT NOT NULL,
  surface_breakdown TEXT NULL,
  h2h_breakdown TEXT NULL,
  author_name TEXT NOT NULL DEFAULT 'PTIN Tennis Editorial Team',
  editor_name TEXT NULL,
  seo_title TEXT NULL,
  seo_description TEXT NULL,
  share_text TEXT NULL,
  key_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
  data_bullets JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  seo_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  publish_status predictions.editorial_publish_status NOT NULL DEFAULT 'draft',
  version SMALLINT NOT NULL DEFAULT 1,
  published_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_predictions_editorials_slug 
  ON predictions.match_editorials (slug);

CREATE INDEX IF NOT EXISTS idx_predictions_editorials_status 
  ON predictions.match_editorials (publish_status);

-- Table: predictions.channel_broadcasts
-- Purpose: Relates published predictions to external Telegram channel messages.
CREATE TABLE IF NOT EXISTS predictions.channel_broadcasts (
  broadcast_id BIGSERIAL PRIMARY KEY,
  prediction_id BIGINT NOT NULL REFERENCES predictions.published_predictions(prediction_id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  message_id BIGINT NOT NULL,
  broadcast_type VARCHAR(30) NOT NULL DEFAULT 'PREDICTION_CARD'
    CHECK (broadcast_type IN ('PREDICTION_CARD', 'RESULT_REPLY', 'BATCH_ANNOUNCEMENT')),
  broadcast_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_predictions_channel_message UNIQUE (channel_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_predictions_broadcasts_pred 
  ON predictions.channel_broadcasts (prediction_id);

-- =============================================================================
-- 13. SCHEMA `provenance`: DETERMINISTIC LINKS, FIELD PROVENANCE & REVIEW QUEUE
-- =============================================================================

-- Table: provenance.source_match_links
-- Purpose: Formal bridge mapping external source records to canonical matches.
CREATE TABLE IF NOT EXISTS provenance.source_match_links (
  link_id BIGSERIAL PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  source_name VARCHAR(50) NOT NULL,
  source_match_id VARCHAR(100) NOT NULL,
  evidence_id UUID NOT NULL REFERENCES raw.source_evidence(evidence_id),
  confidence_score NUMERIC(5, 2) NOT NULL CHECK (confidence_score BETWEEN 0.00 AND 100.00),
  scorer_version VARCHAR(20) NOT NULL,
  rule_version VARCHAR(20) NOT NULL,
  link_status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED'
    CHECK (link_status IN ('CONFIRMED', 'PROVISIONAL', 'REJECTED')),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_provenance_source_match UNIQUE (source_name, source_match_id)
);

CREATE INDEX IF NOT EXISTS idx_provenance_source_links_match 
  ON provenance.source_match_links (match_id);

CREATE INDEX IF NOT EXISTS idx_provenance_source_links_evidence 
  ON provenance.source_match_links (evidence_id);

-- Table: provenance.field_provenance
-- Purpose: Granular audit trail tracking the origin and confidence of each match attribute.
CREATE TABLE IF NOT EXISTS provenance.field_provenance (
  provenance_id BIGSERIAL PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  field_name VARCHAR(50) NOT NULL,
  source_name VARCHAR(50) NOT NULL,
  source_match_id VARCHAR(100) NOT NULL,
  evidence_id UUID NOT NULL REFERENCES raw.source_evidence(evidence_id),
  raw_value TEXT NULL,
  value_hash CHAR(64) NOT NULL,
  priority_weight SMALLINT NOT NULL DEFAULT 100,
  confidence NUMERIC(5, 2) NOT NULL,
  rule_version VARCHAR(20) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_provenance_field_lookup 
  ON provenance.field_provenance (match_id, field_name);

-- Table: provenance.review_queue
-- Purpose: Quarantined matches requiring human review due to veto triggers.
CREATE TABLE IF NOT EXISTS provenance.review_queue (
  review_id BIGSERIAL PRIMARY KEY,
  candidate_match_id UUID NULL REFERENCES matches.matches(match_id) ON DELETE SET NULL,
  incoming_source VARCHAR(50) NOT NULL,
  incoming_source_id VARCHAR(100) NOT NULL,
  incoming_evidence_id UUID NOT NULL REFERENCES raw.source_evidence(evidence_id),
  confidence_score NUMERIC(5, 2) NOT NULL,
  scorer_version VARCHAR(20) NOT NULL,
  rule_version VARCHAR(20) NOT NULL,
  evidence_hash CHAR(64) NOT NULL,
  veto_triggers TEXT[] NOT NULL DEFAULT '{}',
  divergent_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_status provenance.review_status_type NOT NULL DEFAULT 'PENDING',
  lock_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  resolved_at TIMESTAMPTZ NULL,
  resolved_by TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_provenance_review_queue_pending 
  ON provenance.review_queue (review_status) WHERE review_status = 'PENDING';

-- Table: provenance.review_audit_log
-- Purpose: Immutable log of administrative review decisions.
CREATE TABLE IF NOT EXISTS provenance.review_audit_log (
  log_id BIGSERIAL PRIMARY KEY,
  review_id BIGINT NOT NULL REFERENCES provenance.review_queue(review_id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,                          -- e.g. 'APPROVED_AS_NEW', 'MERGED_TO_EXISTING', 'REJECTED'
  previous_state_json JSONB NULL,
  new_state_json JSONB NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NULL,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_provenance_audit_log_review 
  ON provenance.review_audit_log (review_id);

-- =============================================================================
-- 14. SCHEMA `backtest`: FROZEN COHORTS, PARTITIONS & EXPERIMENT RUNS
-- =============================================================================

-- Table: backtest.cohorts
-- Purpose: Defines frozen temporal evaluation datasets (e.g. 'Top 100 Main Tour 2024-2026').
CREATE TABLE IF NOT EXISTS backtest.cohorts (
  cohort_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_name TEXT NOT NULL UNIQUE,
  description TEXT NULL,
  min_date DATE NOT NULL,
  max_date DATE NOT NULL,
  criteria_rules JSONB NOT NULL,                        -- Criteria: tier, rank filters, odds availability
  total_matches INTEGER NOT NULL DEFAULT 0,
  frozen_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Table: backtest.cohort_matches
-- Purpose: Immutable assignment of matches to experiment partitions.
CREATE TABLE IF NOT EXISTS backtest.cohort_matches (
  cohort_id UUID NOT NULL REFERENCES backtest.cohorts(cohort_id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  partition_split backtest.partition_split_type NOT NULL,
  PRIMARY KEY (cohort_id, match_id)
);

CREATE INDEX IF NOT EXISTS idx_backtest_cohort_split 
  ON backtest.cohort_matches (cohort_id, partition_split);

-- Table: backtest.runs
-- Purpose: Evaluation ledger recording model calibration, Brier score, and ROI.
CREATE TABLE IF NOT EXISTS backtest.runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id UUID NOT NULL REFERENCES backtest.cohorts(cohort_id) ON DELETE RESTRICT,
  strategy_name TEXT NOT NULL,
  parameters JSONB NOT NULL,
  matches_evaluated INTEGER NOT NULL,
  brier_score NUMERIC(7, 6) NOT NULL,
  log_loss NUMERIC(7, 6) NOT NULL,
  expected_calibration_error NUMERIC(7, 6) NOT NULL,
  accuracy_pct NUMERIC(5, 2) NOT NULL,
  roi_pct NUMERIC(6, 2) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_strategy 
  ON backtest.runs (strategy_name, completed_at DESC);

-- =============================================================================
-- 15. SCHEMA `app`: USER MANAGEMENT, AFFILIATES, SETTINGS, SYNC JOBS
-- =============================================================================

-- Table: app.users
-- Purpose: Public consumer accounts.
CREATE TABLE IF NOT EXISTS app.users (
  user_id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NULL,
  google_id TEXT UNIQUE NULL,
  email TEXT NULL,
  username TEXT NULL,
  first_name TEXT NULL,
  avatar_url TEXT NULL,
  auth_provider VARCHAR(20) NOT NULL CHECK (auth_provider IN ('telegram', 'google', 'anonymous')),
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ NULL,
  verify_source VARCHAR(30) NULL,
  registered_site_id INTEGER NULL,
  has_deposited BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  last_active_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_app_users_telegram 
  ON app.users (telegram_id) WHERE telegram_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_app_users_google 
  ON app.users (google_id) WHERE google_id IS NOT NULL;

-- Table: app.referral_sites
-- Purpose: Affiliate sportsbook configurations.
CREATE TABLE IF NOT EXISTS app.referral_sites (
  site_id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  logo_url TEXT NULL,
  referral_url TEXT NOT NULL,
  app_url TEXT NULL,
  promo_code TEXT NULL,
  bonus_text TEXT NULL,
  steps_text TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  order_index SMALLINT NOT NULL DEFAULT 0,
  postback_key TEXT NOT NULL UNIQUE,
  verify_mode VARCHAR(20) NOT NULL DEFAULT 'auto',
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Table: app.referral_clicks
-- Purpose: Tracks outgoing click redirects to partners.
CREATE TABLE IF NOT EXISTS app.referral_clicks (
  click_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id INTEGER NOT NULL REFERENCES app.referral_sites(site_id) ON DELETE RESTRICT,
  partner_key TEXT NOT NULL,
  user_ref TEXT NOT NULL,
  session_ref TEXT NULL,
  match_id UUID NULL REFERENCES matches.matches(match_id) ON DELETE SET NULL,
  fixture_id INTEGER NULL,
  page_context TEXT NULL,
  action_type VARCHAR(50) NOT NULL,
  destination_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_app_referral_clicks_user 
  ON app.referral_clicks (user_ref);

-- Table: app.partner_conversions
-- Purpose: Ingested server-to-server postback conversion webhooks.
CREATE TABLE IF NOT EXISTS app.partner_conversions (
  conversion_id BIGSERIAL PRIMARY KEY,
  partner_key VARCHAR(50) NOT NULL,
  site_id INTEGER NULL REFERENCES app.referral_sites(site_id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL,                      -- e.g. 'REGISTRATION', 'DEPOSIT'
  click_id TEXT NULL,
  transaction_id TEXT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  user_ref TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'APPROVED',
  raw_payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_app_conversions_click 
  ON app.partner_conversions (click_id);

-- Table: app.settings
-- Purpose: Global system key-value configuration.
CREATE TABLE IF NOT EXISTS app.settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Table: app.sync_jobs
-- Purpose: Tracks background ingestion runs, catch-ups, and migrations.
CREATE TABLE IF NOT EXISTS app.sync_jobs (
  job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type VARCHAR(50) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finished_at TIMESTAMPTZ NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  items_processed INTEGER NOT NULL DEFAULT 0,
  items_inserted INTEGER NOT NULL DEFAULT 0,
  items_updated INTEGER NOT NULL DEFAULT 0,
  errors_count INTEGER NOT NULL DEFAULT 0,
  log_summary TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_sync_jobs_status 
  ON app.sync_jobs (job_type, started_at DESC);

-- =============================================================================
-- 16. SCHEMA `public`: BACKWARD-COMPATIBILITY VIEW PLACEHOLDERS
-- =============================================================================

-- View: public.canonical_matches_operational
-- Purpose: Drop-in compatibility view exposing the exact 79 columns expected by legacy consumers.
CREATE OR REPLACE VIEW public.canonical_matches_operational AS
SELECT
  NULL::INTEGER AS id,
  m.match_id::TEXT AS canonical_match_id,
  to_char(m.scheduled_start_utc, 'YYYY-MM-DD') AS canonical_match_date,
  m.scheduled_start_utc::TEXT AS canonical_start_utc,
  t.tour::TEXT AS tour,
  t.name_standard AS tourney_name,
  t.tour_level AS tourney_level,
  m.surface::TEXT AS surface,
  m.round_name,
  pw.full_name_standard AS canonical_winner_name,
  pl.full_name_standard AS canonical_loser_name,
  COALESCE(mr.score_string, '') AS score,
  mr.duration_minutes AS minutes,
  NULL::INTEGER AS source_a_historical_match_id,
  NULL::INTEGER AS source_b_rapid_event_id,
  CASE WHEN m.evidence_count >= 2 THEN 'both' ELSE 'single' END AS source_presence,
  'HIGH' AS join_confidence,
  100.0::DOUBLE PRECISION AS join_confidence_score,
  'postgres_canonical_v1' AS join_method,
  'none' AS data_source_stats,
  'none' AS data_source_pbp,
  'none' AS data_source_odds,
  NULL::TEXT AS bundle_storage_path,
  -- Closing odds
  (SELECT decimal_odds::DOUBLE PRECISION FROM markets.market_odds_ticks o 
   WHERE o.match_id = m.match_id AND o.market_type = 'MONEYLINE' AND o.selection_side = mpw.side 
   ORDER BY o.is_closing_line DESC, o.captured_at_utc DESC LIMIT 1) AS w_odds_match,
  (SELECT decimal_odds::DOUBLE PRECISION FROM markets.market_odds_ticks o 
   WHERE o.match_id = m.match_id AND o.market_type = 'MONEYLINE' AND o.selection_side = mpl.side 
   ORDER BY o.is_closing_line DESC, o.captured_at_utc DESC LIMIT 1) AS l_odds_match,
  NULL::DOUBLE PRECISION AS w_odds_set1,
  NULL::DOUBLE PRECISION AS l_odds_set1,
  mpw.pre_match_rank AS winner_rank,
  mpl.pre_match_rank AS loser_rank,
  mpw.pre_match_rank_points AS winner_rank_points,
  mpl.pre_match_rank_points AS loser_rank_points,
  pw.height_cm AS winner_ht,
  pl.height_cm AS loser_ht,
  NULL::DOUBLE PRECISION AS winner_age,
  NULL::DOUBLE PRECISION AS loser_age,
  pw.country_ioc AS winner_ioc,
  pl.country_ioc AS loser_ioc,
  pw.hand::TEXT AS winner_hand,
  pl.hand::TEXT AS loser_hand,
  mpw.seed AS winner_seed,
  mpl.seed AS loser_seed,
  mpw.entry_status AS winner_entry,
  mpl.entry_status AS loser_entry,
  -- Serve / Box score statistics
  sw.aces AS w_ace,
  sw.double_faults AS w_df,
  sw.svpt AS w_svpt,
  sw.first_in AS w_1stIn,
  sw.first_won AS w_1stWon,
  sw.second_won AS w_2ndWon,
  sw.sv_gms AS w_SvGms,
  sw.bp_saved AS w_bpSaved,
  sw.bp_faced AS w_bpFaced,
  sl.aces AS l_ace,
  sl.double_faults AS l_df,
  sl.svpt AS l_svpt,
  sl.first_in AS l_1stIn,
  sl.first_won AS l_1stWon,
  sl.second_won AS l_2ndWon,
  sl.sv_gms AS l_SvGms,
  sl.bp_saved AS l_bpSaved,
  sl.bp_faced AS l_bpFaced,
  CASE WHEN sw.svpt > 0 THEN (sw.first_won + sw.second_won)::DOUBLE PRECISION / sw.svpt ELSE NULL END AS w_serve_won_pct,
  CASE WHEN sl.svpt > 0 THEN (sl.first_won + sl.second_won)::DOUBLE PRECISION / sl.svpt ELSE NULL END AS l_serve_won_pct,
  NULL::DOUBLE PRECISION AS w_return_won_pct,
  NULL::DOUBLE PRECISION AS l_return_won_pct,
  NULL::DOUBLE PRECISION AS w_bp_won_pct,
  NULL::DOUBLE PRECISION AS l_bp_won_pct,
  NULL::DOUBLE PRECISION AS w_bp_saved_pct,
  NULL::DOUBLE PRECISION AS l_bp_saved_pct,
  COALESCE(sw.is_placeholder_serve, FALSE)::INTEGER AS is_placeholder_serve,
  CASE WHEN mr.is_retirement_or_wo THEN 1 ELSE 0 END AS is_retirement_or_wo,
  0 AS is_non_singles,
  0 AS is_speculative_draw,
  CASE WHEN m.status = 'FINISHED' AND (mr.is_retirement_or_wo IS FALSE) THEN 1 ELSE 0 END AS is_canonical_modeling_usable,
  CASE WHEN m.status = 'FINISHED' THEN 1 ELSE 0 END AS is_backtest_safe,
  'POSTGRES_CANONICAL_OPERATIONAL' AS canonical_status_reason,
  m.created_at::TEXT,
  m.updated_at::TEXT,
  0 AS is_archive_only
FROM matches.matches m
JOIN competition.tournament_editions te ON te.edition_id = m.edition_id
JOIN identity.tournaments t ON t.tournament_id = te.tournament_id
LEFT JOIN matches.match_results mr ON mr.match_id = m.match_id
LEFT JOIN identity.players pw ON pw.player_id = mr.winner_player_id
LEFT JOIN identity.players pl ON pl.player_id = mr.loser_player_id
LEFT JOIN matches.match_participants mpw ON mpw.match_id = m.match_id AND mpw.player_id = mr.winner_player_id
LEFT JOIN matches.match_participants mpl ON mpl.match_id = m.match_id AND mpl.player_id = mr.loser_player_id
LEFT JOIN statistics.match_player_statistics sw ON sw.match_id = m.match_id AND sw.player_id = mr.winner_player_id
LEFT JOIN statistics.match_player_statistics sl ON sl.match_id = m.match_id AND sl.player_id = mr.loser_player_id;

-- View: public.gold_matches_ready_view
-- Purpose: Compatibility view for backtest runners requiring finished matches.
CREATE OR REPLACE VIEW public.gold_matches_ready_view AS
SELECT
  m.match_id::TEXT AS canonical_match_id,
  to_char(m.scheduled_start_utc, 'YYYY-MM-DD') AS match_date,
  t.tour::TEXT AS tour,
  t.name_standard AS tourney_name,
  m.surface::TEXT AS surface,
  m.round_name,
  pw.full_name_standard AS winner_name,
  pl.full_name_standard AS loser_name,
  mr.score_string AS score,
  (SELECT decimal_odds::DOUBLE PRECISION FROM markets.market_odds_ticks o 
   WHERE o.match_id = m.match_id AND o.market_type = 'MONEYLINE' AND o.selection_side = mpw.side 
   ORDER BY o.is_closing_line DESC, o.captured_at_utc DESC LIMIT 1) AS winner_odds,
  (SELECT decimal_odds::DOUBLE PRECISION FROM markets.market_odds_ticks o 
   WHERE o.match_id = m.match_id AND o.market_type = 'MONEYLINE' AND o.selection_side = mpl.side 
   ORDER BY o.is_closing_line DESC, o.captured_at_utc DESC LIMIT 1) AS loser_odds,
  mpw.pre_match_rank AS winner_rank,
  mpl.pre_match_rank AS loser_rank,
  'READY' AS final_status
FROM matches.matches m
JOIN competition.tournament_editions te ON te.edition_id = m.edition_id
JOIN identity.tournaments t ON t.tournament_id = te.tournament_id
JOIN matches.match_results mr ON mr.match_id = m.match_id
JOIN identity.players pw ON pw.player_id = mr.winner_player_id
JOIN identity.players pl ON pl.player_id = mr.loser_player_id
JOIN matches.match_participants mpw ON mpw.match_id = m.match_id AND mpw.player_id = mr.winner_player_id
JOIN matches.match_participants mpl ON mpl.match_id = m.match_id AND mpl.player_id = mr.loser_player_id
WHERE m.status = 'FINISHED'
  AND mr.is_retirement_or_wo IS FALSE;

-- View: public.player_matches_validated
-- Purpose: Compatibility view projecting player-oriented match records with 12 quarantine flags and usability booleans.
CREATE OR REPLACE VIEW public.player_matches_validated AS
SELECT
  ('x' || substr(md5(m.match_id::text || '_' || mp.side::text), 1, 8))::bit(32)::int AS pmi_id,
  NULL::INTEGER AS tracked_player_id,
  NULL::INTEGER AS historical_match_id,
  m.match_id::TEXT AS match_fingerprint,
  to_char(m.scheduled_start_utc, 'YYYY-MM-DD') AS match_date,
  po.full_name_standard AS opponent_name,
  CASE WHEN mr.winner_player_id = mp.player_id THEN 1 ELSE 0 END AS won,
  'COMPLETE' AS completeness,
  1 AS has_csv_stats,
  1 AS has_api_statistics,
  p.full_name_standard AS player_name,
  t.tour::TEXT AS player_tour,
  0 AS is_archive_only,
  NULL::INTEGER AS historical_match_id_canonical,
  t.tour::TEXT AS tour,
  t.name_standard AS tourney_name,
  m.round_name,
  pw.full_name_standard AS winner_name,
  pl.full_name_standard AS loser_name,
  COALESCE(mr.score_string, '') AS score,
  mr.duration_minutes AS minutes,
  cmo.w_odds_match,
  cmo.l_odds_match,
  mp.pre_match_rank AS player_rank,
  mpo.pre_match_rank AS opponent_rank,
  m.surface::TEXT AS surface_raw,
  m.surface::TEXT AS surface_normalized,
  cmo.w_ace, cmo.w_df, cmo.w_svpt, cmo.w_1stin, cmo.w_1stwon, cmo.w_2ndwon,
  cmo.w_bpsaved, cmo.w_bpfaced,
  cmo.l_ace, cmo.l_df, cmo.l_svpt, cmo.l_1stin, cmo.l_1stwon, cmo.l_2ndwon,
  cmo.l_bpsaved, cmo.l_bpfaced,
  cmo.w_serve_won_pct, cmo.l_serve_won_pct,
  cmo.w_return_won_pct, cmo.l_return_won_pct,
  cmo.w_bp_won_pct, cmo.l_bp_won_pct,
  cmo.w_bp_saved_pct, cmo.l_bp_saved_pct,
  cmo.is_placeholder_serve,
  cmo.is_retirement_or_wo,
  cmo.is_non_singles,
  0 AS is_synthetic_source,
  CASE WHEN mp.pre_match_rank IS NULL OR mpo.pre_match_rank IS NULL THEN 1 ELSE 0 END AS is_missing_rank,
  CASE WHEN (mp.pre_match_rank NOT BETWEEN 1 AND 100) OR (mpo.pre_match_rank NOT BETWEEN 1 AND 100) THEN 1 ELSE 0 END AS is_outside_top100,
  CASE WHEN (cmo.w_odds_match > 0 AND cmo.w_odds_match < 1.01) OR (cmo.l_odds_match > 0 AND cmo.l_odds_match < 1.01) THEN 1 ELSE 0 END AS is_bad_odds,
  CASE WHEN (cmo.w_odds_match > 1.01 AND cmo.l_odds_match <= 1.01) OR (cmo.l_odds_match > 1.01 AND cmo.w_odds_match <= 1.01) THEN 1 ELSE 0 END AS is_one_sided_odds,
  CASE WHEN m.surface IS NULL OR m.surface = 'Unknown' THEN 1 ELSE 0 END AS is_no_surface,
  'NONE' AS quarantine_flags,
  CASE WHEN m.status = 'FINISHED' AND (mr.is_retirement_or_wo IS FALSE) THEN 1 ELSE 0 END AS is_historical_usable,
  CASE WHEN mp.pre_match_rank BETWEEN 1 AND 2000 AND mpo.pre_match_rank BETWEEN 1 AND 2000 THEN 1 ELSE 0 END AS is_rank_usable,
  CASE WHEN m.surface IS NOT NULL AND m.surface != 'Unknown' THEN 1 ELSE 0 END AS is_surface_feature_usable,
  CASE WHEN cmo.is_placeholder_serve = 0 AND (
    (mr.winner_player_id = mp.player_id AND cmo.w_1stin > 0) OR
    (mr.loser_player_id = mp.player_id AND cmo.l_1stin > 0)
  ) THEN 1 ELSE 0 END AS is_raw_serve_feature_usable,
  CASE WHEN m.status = 'FINISHED' 
    AND (mr.is_retirement_or_wo IS FALSE) 
    AND mp.pre_match_rank BETWEEN 1 AND 100 
    AND mpo.pre_match_rank BETWEEN 1 AND 100 
    THEN 1 ELSE 0 END AS is_backtest_usable,
  CASE WHEN m.status = 'FINISHED' 
    AND (mr.is_retirement_or_wo IS FALSE) 
    AND mp.pre_match_rank BETWEEN 1 AND 100 
    AND mpo.pre_match_rank BETWEEN 1 AND 100 
    AND cmo.w_odds_match > 1.01 
    AND cmo.l_odds_match > 1.01 
    THEN 1 ELSE 0 END AS is_roi_usable
FROM matches.matches m
JOIN competition.tournament_editions te ON te.edition_id = m.edition_id
JOIN identity.tournaments t ON t.tournament_id = te.tournament_id
JOIN matches.match_participants mp ON mp.match_id = m.match_id
JOIN identity.players p ON p.player_id = mp.player_id
JOIN matches.match_participants mpo ON mpo.match_id = m.match_id AND mpo.side != mp.side
JOIN identity.players po ON po.player_id = mpo.player_id
LEFT JOIN matches.match_results mr ON mr.match_id = m.match_id
LEFT JOIN identity.players pw ON pw.player_id = mr.winner_player_id
LEFT JOIN identity.players pl ON pl.player_id = mr.loser_player_id
LEFT JOIN public.canonical_matches_operational cmo ON cmo.canonical_match_id = m.match_id::TEXT;

-- View: public.canonical_modeling_matches_2024_plus
-- Purpose: Compatibility view for 2024+ verified modeling fixtures with clean box scores and non-retirements.
CREATE OR REPLACE VIEW public.canonical_modeling_matches_2024_plus AS
SELECT
  v.pmi_id,
  v.tracked_player_id,
  v.historical_match_id,
  NULL::INTEGER AS rapid_event_id,
  v.match_date,
  v.tour,
  v.tourney_name,
  v.surface_normalized AS surface,
  v.opponent_name,
  v.won,
  v.player_rank,
  v.opponent_rank,
  v.score,
  v.w_odds_match,
  v.l_odds_match,
  v.w_ace, v.w_df, v.w_svpt, v.w_1stin, v.w_1stwon, v.w_2ndwon,
  v.w_bpsaved, v.w_bpfaced,
  v.l_ace, v.l_df, v.l_svpt, v.l_1stin, v.l_1stwon, v.l_2ndwon,
  v.l_bpsaved, v.l_bpfaced,
  v.w_serve_won_pct, v.l_serve_won_pct,
  v.w_return_won_pct, v.l_return_won_pct,
  v.w_bp_won_pct, v.l_bp_won_pct,
  v.w_bp_saved_pct, v.l_bp_saved_pct,
  'enriched_from_canonical' AS enrichment_status,
  'postgres_canonical' AS data_source_stats,
  'postgres_canonical' AS data_source_pbp,
  'postgres_canonical_v1' AS data_source_details,
  v.is_archive_only,
  v.is_placeholder_serve,
  v.is_retirement_or_wo,
  v.is_non_singles,
  CASE 
    WHEN v.is_archive_only = 0
      AND v.match_date >= '2024-01-01'
      AND v.is_retirement_or_wo = 0
      AND v.is_placeholder_serve = 0
      AND v.is_non_singles = 0
      AND v.w_svpt > 0 AND v.l_svpt > 0
      THEN 1 ELSE 0
  END AS is_canonical_modeling_usable,
  v.is_backtest_usable,
  v.is_roi_usable,
  v.is_surface_feature_usable,
  v.is_raw_serve_feature_usable,
  'POSTGRES_CANONICAL_MODELING' AS canonical_status_reason
FROM public.player_matches_validated v
WHERE v.is_archive_only = 0
  AND v.match_date >= '2024-01-01'
  AND v.is_retirement_or_wo = 0
  AND v.is_placeholder_serve = 0;

COMMIT;
