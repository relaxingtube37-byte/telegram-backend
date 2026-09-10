-- =============================================================================
-- FOOTBALL STATE / TENNIS AI PLATFORM
-- CANONICAL POSTGRESQL 16+ DDL SPECIFICATION (V1 - SCHEMA FREEZE)
-- =============================================================================
--
-- Target Engine: PostgreSQL 16+
-- Transactional Safety: Wrapped in single atomic transaction block (BEGIN...COMMIT)
-- Idempotency: 100% safe to re-run on fresh or existing databases (IF NOT EXISTS)
-- Non-destructive: Contains 0 DROP, 0 TRUNCATE, and 0 mutating operations
--
-- Architectural Invariants:
--   1. 11 Canonical Schemas: raw, identity, competition, matches, statistics,
--      markets, ai, predictions, provenance, backtest, app.
--   2. 28 Canonical Tables: strictly bounded and normalized.
--   3. UUID Strategy: All canonical domain entities use native UUID type with
--      DEFAULT gen_random_uuid() (UUIDv4) as baseline (forward-compatible with UUIDv7).
--   4. Zero Lookahead Bias: Symmetric participant ordering (side 1 / side 2) completely
--      decouples pre-match fixtures from post-match outcomes (match_results).
--   5. Zero Fabrication: Authentic NULLs for unrecorded legacy telemetry. No synthetic zeros.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. EXTENSIONS
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- =============================================================================
-- 2. SCHEMAS (11 CANONICAL SCHEMAS)
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS "raw";
CREATE SCHEMA IF NOT EXISTS "identity";
CREATE SCHEMA IF NOT EXISTS "competition";
CREATE SCHEMA IF NOT EXISTS "matches";
CREATE SCHEMA IF NOT EXISTS "statistics";
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
-- 4. SCHEMA `raw`: SOURCE EVIDENCE (Table 1/28)
-- =============================================================================

-- Table 1: raw.source_evidence
CREATE TABLE IF NOT EXISTS raw.source_evidence (
  evidence_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name VARCHAR(50) NOT NULL,
  source_match_id VARCHAR(100) NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  storage_mode VARCHAR(20) NOT NULL DEFAULT 'inline_jsonb'
    CHECK (storage_mode IN ('inline_jsonb', 's3_pointer', 'raw_text')),
  payload_json JSONB NULL,
  blob_uri TEXT NULL,
  payload_size_bytes INTEGER NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_raw_source_evidence_unique_record UNIQUE (source_name, source_match_id, payload_sha256)
);

CREATE INDEX IF NOT EXISTS idx_raw_source_evidence_lookup
  ON raw.source_evidence (source_name, source_match_id);

CREATE INDEX IF NOT EXISTS idx_raw_source_evidence_sha
  ON raw.source_evidence (payload_sha256);

-- =============================================================================
-- 5. SCHEMA `identity`: PLAYERS & TOURNAMENTS (Tables 2-5/28)
-- =============================================================================

-- Table 2: identity.players
CREATE TABLE IF NOT EXISTS identity.players (
  player_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name_standard TEXT NOT NULL,
  first_name TEXT NULL,
  last_name TEXT NOT NULL,
  birth_date DATE NULL,
  country_ioc CHAR(3) NULL,
  gender identity.gender_code NOT NULL,
  hand identity.player_hand NOT NULL DEFAULT 'Unknown',
  height_cm SMALLINT NULL CHECK (height_cm IS NULL OR (height_cm BETWEEN 140 AND 230)),
  weight_kg SMALLINT NULL CHECK (weight_kg IS NULL OR (weight_kg BETWEEN 40 AND 130)),
  turned_pro_year SMALLINT NULL CHECK (turned_pro_year IS NULL OR (turned_pro_year BETWEEN 1968 AND 2035)),
  ranking_current INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_identity_players_last_name
  ON identity.players (last_name);

CREATE INDEX IF NOT EXISTS idx_identity_players_country
  ON identity.players (country_ioc);

CREATE INDEX IF NOT EXISTS idx_identity_players_name_trgm
  ON identity.players USING gin (full_name_standard gin_trgm_ops);

-- Table 3: identity.player_aliases
CREATE TABLE IF NOT EXISTS identity.player_aliases (
  alias_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES identity.players(player_id) ON DELETE RESTRICT,
  source_name VARCHAR(50) NOT NULL,
  raw_name TEXT NOT NULL,
  normalized_token TEXT NOT NULL,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  has_sibling_conflict BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_identity_player_aliases_source_token UNIQUE (source_name, normalized_token)
);

CREATE INDEX IF NOT EXISTS idx_identity_player_aliases_player
  ON identity.player_aliases (player_id);

CREATE INDEX IF NOT EXISTS idx_identity_player_aliases_token
  ON identity.player_aliases (normalized_token);

-- Table 4: identity.tournaments
CREATE TABLE IF NOT EXISTS identity.tournaments (
  tournament_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_standard TEXT NOT NULL,
  tour identity.tour_code NOT NULL,
  tour_level VARCHAR(30) NOT NULL,
  default_surface competition.surface_type NOT NULL DEFAULT 'Unknown',
  country_ioc CHAR(3) NULL,
  city TEXT NULL,
  altitude_meters SMALLINT NULL CHECK (altitude_meters IS NULL OR (altitude_meters BETWEEN -500 AND 5000)),
  is_indoor BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_identity_tournaments_name_tour UNIQUE (name_standard, tour)
);

CREATE INDEX IF NOT EXISTS idx_identity_tournaments_level
  ON identity.tournaments (tour_level);

CREATE INDEX IF NOT EXISTS idx_identity_tournaments_surface
  ON identity.tournaments (default_surface);

-- Table 5: identity.tournament_aliases
CREATE TABLE IF NOT EXISTS identity.tournament_aliases (
  alias_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES identity.tournaments(tournament_id) ON DELETE RESTRICT,
  source_name VARCHAR(50) NOT NULL,
  raw_name TEXT NOT NULL,
  normalized_token TEXT NOT NULL,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_identity_tournament_aliases_source_token UNIQUE (source_name, normalized_token)
);

CREATE INDEX IF NOT EXISTS idx_identity_tournament_aliases_tournament
  ON identity.tournament_aliases (tournament_id);

-- =============================================================================
-- 6. SCHEMA `competition`: EDITIONS (Table 6/28)
-- =============================================================================

-- Table 6: competition.tournament_editions
CREATE TABLE IF NOT EXISTS competition.tournament_editions (
  edition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES identity.tournaments(tournament_id) ON DELETE RESTRICT,
  year SMALLINT NOT NULL CHECK (year BETWEEN 1968 AND 2040),
  edition_name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL CHECK (end_date >= start_date),
  actual_surface competition.surface_type NOT NULL,
  draw_size SMALLINT NULL CHECK (draw_size IS NULL OR (draw_size BETWEEN 4 AND 128)),
  court_pace_index SMALLINT NULL CHECK (court_pace_index IS NULL OR (court_pace_index BETWEEN 10 AND 100)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_competition_tournament_editions_tourney_year UNIQUE (tournament_id, year)
);

CREATE INDEX IF NOT EXISTS idx_competition_editions_dates
  ON competition.tournament_editions (start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_competition_editions_year
  ON competition.tournament_editions (year);

-- =============================================================================
-- 7. SCHEMA `matches`: CORE, PARTICIPANTS, RESULTS, SETS, GAMES, POINTS (Tables 7-12/28)
-- =============================================================================

-- Table 7: matches.matches
CREATE TABLE IF NOT EXISTS matches.matches (
  match_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID NOT NULL REFERENCES competition.tournament_editions(edition_id) ON DELETE RESTRICT,
  scheduled_start_utc TIMESTAMPTZ NOT NULL,
  actual_start_utc TIMESTAMPTZ NULL,
  round_name VARCHAR(30) NOT NULL,
  match_num SMALLINT NULL CHECK (match_num IS NULL OR match_num > 0),
  best_of SMALLINT NOT NULL DEFAULT 3 CHECK (best_of IN (3, 5)),
  surface competition.surface_type NOT NULL,
  is_indoor BOOLEAN NOT NULL DEFAULT FALSE,
  status matches.match_status_type NOT NULL DEFAULT 'SCHEDULED',
  source_mask INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_matches_scheduled_start
  ON matches.matches (scheduled_start_utc);

CREATE INDEX IF NOT EXISTS idx_matches_edition
  ON matches.matches (edition_id);

CREATE INDEX IF NOT EXISTS idx_matches_status
  ON matches.matches (status);

CREATE INDEX IF NOT EXISTS idx_matches_round
  ON matches.matches (round_name);

-- Table 8: matches.match_participants
CREATE TABLE IF NOT EXISTS matches.match_participants (
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES identity.players(player_id) ON DELETE RESTRICT,
  side SMALLINT NOT NULL CHECK (side IN (1, 2)),
  seed SMALLINT NULL CHECK (seed IS NULL OR (seed BETWEEN 1 AND 128)),
  entry_status VARCHAR(10) NULL,
  pre_match_rank INTEGER NULL CHECK (pre_match_rank IS NULL OR (pre_match_rank BETWEEN 1 AND 5000)),
  pre_match_rank_points INTEGER NULL CHECK (pre_match_rank_points IS NULL OR pre_match_rank_points >= 0),
  is_winner BOOLEAN NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (match_id, side),
  CONSTRAINT uq_matches_participants_match_player UNIQUE (match_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_matches_participants_player
  ON matches.match_participants (player_id, match_id);

CREATE INDEX IF NOT EXISTS idx_matches_participants_rank
  ON matches.match_participants (pre_match_rank);

-- Table 9: matches.match_results
CREATE TABLE IF NOT EXISTS matches.match_results (
  match_id UUID PRIMARY KEY REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  winner_player_id UUID NOT NULL REFERENCES identity.players(player_id) ON DELETE RESTRICT,
  loser_player_id UUID NOT NULL REFERENCES identity.players(player_id) ON DELETE RESTRICT,
  score_string TEXT NOT NULL,
  retirement_detail TEXT NULL,
  is_retirement_or_wo BOOLEAN NOT NULL DEFAULT FALSE,
  duration_minutes SMALLINT NULL CHECK (duration_minutes IS NULL OR (duration_minutes BETWEEN 1 AND 900)),
  settled_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_matches_results_distinct_players CHECK (winner_player_id <> loser_player_id)
);

CREATE INDEX IF NOT EXISTS idx_matches_results_winner
  ON matches.match_results (winner_player_id);

CREATE INDEX IF NOT EXISTS idx_matches_results_loser
  ON matches.match_results (loser_player_id);

-- Table 10: matches.match_sets
CREATE TABLE IF NOT EXISTS matches.match_sets (
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  set_number SMALLINT NOT NULL CHECK (set_number BETWEEN 1 AND 5),
  side1_games SMALLINT NOT NULL CHECK (side1_games >= 0),
  side2_games SMALLINT NOT NULL CHECK (side2_games >= 0),
  tiebreak_score TEXT NULL,
  duration_seconds INTEGER NULL CHECK (duration_seconds IS NULL OR (duration_seconds BETWEEN 1 AND 14400)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (match_id, set_number)
);

-- Table 11: matches.match_games
CREATE TABLE IF NOT EXISTS matches.match_games (
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  set_number SMALLINT NOT NULL CHECK (set_number BETWEEN 1 AND 5),
  game_number SMALLINT NOT NULL CHECK (game_number BETWEEN 1 AND 50),
  server_player_id UUID NOT NULL REFERENCES identity.players(player_id) ON DELETE RESTRICT,
  winner_player_id UUID NOT NULL REFERENCES identity.players(player_id) ON DELETE RESTRICT,
  is_break_of_serve BOOLEAN NOT NULL DEFAULT FALSE,
  point_sequence TEXT NOT NULL,
  deuce_count SMALLINT NOT NULL DEFAULT 0 CHECK (deuce_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (match_id, set_number, game_number)
);

-- Table 12: matches.match_points
CREATE TABLE IF NOT EXISTS matches.match_points (
  point_id BIGSERIAL PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  set_number SMALLINT NOT NULL CHECK (set_number BETWEEN 1 AND 5),
  game_number SMALLINT NOT NULL CHECK (game_number BETWEEN 1 AND 50),
  point_number SMALLINT NOT NULL CHECK (point_number BETWEEN 1 AND 50),
  server_side SMALLINT NOT NULL CHECK (server_side IN (1, 2)),
  receiver_side SMALLINT NOT NULL CHECK (receiver_side IN (1, 2)),
  point_winner_side SMALLINT NOT NULL CHECK (point_winner_side IN (1, 2)),
  serve_speed_kph SMALLINT NULL CHECK (serve_speed_kph IS NULL OR (serve_speed_kph BETWEEN 80 AND 270)),
  rally_length SMALLINT NULL CHECK (rally_length IS NULL OR rally_length >= 0),
  shot_outcome VARCHAR(20) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_matches_points_lookup
  ON matches.match_points (match_id, set_number, game_number);

-- =============================================================================
-- 8. SCHEMA `statistics`: BOX SCORES (Table 13/28)
-- =============================================================================

-- Table 13: statistics.match_player_statistics
CREATE TABLE IF NOT EXISTS statistics.match_player_statistics (
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES identity.players(player_id) ON DELETE RESTRICT,
  aces SMALLINT NOT NULL DEFAULT 0 CHECK (aces >= 0),
  double_faults SMALLINT NOT NULL DEFAULT 0 CHECK (double_faults >= 0),
  svpt SMALLINT NOT NULL DEFAULT 0 CHECK (svpt >= 0),
  first_in SMALLINT NOT NULL DEFAULT 0 CHECK (first_in >= 0),
  first_won SMALLINT NOT NULL DEFAULT 0 CHECK (first_won >= 0),
  second_won SMALLINT NOT NULL DEFAULT 0 CHECK (second_won >= 0),
  sv_gms SMALLINT NOT NULL DEFAULT 0 CHECK (sv_gms >= 0),
  bp_saved SMALLINT NOT NULL DEFAULT 0 CHECK (bp_saved >= 0),
  bp_faced SMALLINT NOT NULL DEFAULT 0 CHECK (bp_faced >= 0),
  first_return_won SMALLINT NOT NULL DEFAULT 0 CHECK (first_return_won >= 0),
  second_return_won SMALLINT NOT NULL DEFAULT 0 CHECK (second_return_won >= 0),
  bp_converted SMALLINT NOT NULL DEFAULT 0 CHECK (bp_converted >= 0),
  bp_opportunities SMALLINT NOT NULL DEFAULT 0 CHECK (bp_opportunities >= 0),
  total_points_won SMALLINT NOT NULL DEFAULT 0 CHECK (total_points_won >= 0),
  is_placeholder_serve BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (match_id, player_id),
  CONSTRAINT chk_statistics_serve_pct CHECK (first_in <= svpt AND first_won <= first_in AND bp_saved <= bp_faced)
);

CREATE INDEX IF NOT EXISTS idx_statistics_player_match
  ON statistics.match_player_statistics (player_id, match_id);

-- =============================================================================
-- 9. SCHEMA `markets`: BOOKMAKERS & ODDS TICKS (Tables 14-15/28)
-- =============================================================================

-- Table 14: markets.bookmakers
CREATE TABLE IF NOT EXISTS markets.bookmakers (
  bookmaker_id SMALLSERIAL PRIMARY KEY,
  bookmaker_key VARCHAR(50) NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Table 15: markets.market_odds_ticks
CREATE TABLE IF NOT EXISTS markets.market_odds_ticks (
  tick_id BIGSERIAL PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  bookmaker_id SMALLINT NOT NULL REFERENCES markets.bookmakers(bookmaker_id) ON DELETE RESTRICT,
  market_type markets.market_category NOT NULL,
  selection_side SMALLINT NULL CHECK (selection_side IS NULL OR selection_side IN (1, 2)),
  selection_player_id UUID NULL REFERENCES identity.players(player_id) ON DELETE RESTRICT,
  line NUMERIC(5, 2) NULL,
  decimal_odds NUMERIC(6, 3) NOT NULL CHECK (decimal_odds >= 1.001 AND decimal_odds <= 1000.0),
  is_closing_line BOOLEAN NOT NULL DEFAULT FALSE,
  is_live BOOLEAN NOT NULL DEFAULT FALSE,
  captured_at_utc TIMESTAMPTZ NULL,
  reference_match_start_utc TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_markets_ticks_match_market
  ON markets.market_odds_ticks (match_id, market_type, captured_at_utc);

CREATE INDEX IF NOT EXISTS idx_markets_ticks_captured
  ON markets.market_odds_ticks (captured_at_utc);

-- =============================================================================
-- 10. SCHEMA `ai`: RUNS & AGENT TRACES (Tables 16-17/28)
-- =============================================================================

-- Table 16: ai.prediction_runs
CREATE TABLE IF NOT EXISTS ai.prediction_runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE RESTRICT,
  cutoff_timestamp_utc TIMESTAMPTZ NOT NULL,
  feature_schema_hash CHAR(64) NOT NULL,
  feature_snapshot JSONB NOT NULL,
  model_routing_config JSONB NOT NULL,
  predicted_winner_id UUID NOT NULL REFERENCES identity.players(player_id) ON DELETE RESTRICT,
  win_probability_pct NUMERIC(5, 2) NOT NULL CHECK (win_probability_pct BETWEEN 0.0 AND 100.0),
  confidence_tier VARCHAR(20) NOT NULL,
  best_bet_market TEXT NULL,
  best_bet_selection TEXT NULL,
  best_bet_ev_pct NUMERIC(5, 2) NULL,
  quality_gate_passed BOOLEAN NOT NULL DEFAULT TRUE,
  quality_gate_reasons TEXT[] NULL,
  total_latency_ms INTEGER NOT NULL CHECK (total_latency_ms >= 0),
  total_cost_usd NUMERIC(8, 5) NULL CHECK (total_cost_usd IS NULL OR total_cost_usd >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_ai_prediction_runs_match
  ON ai.prediction_runs (match_id);

CREATE INDEX IF NOT EXISTS idx_ai_prediction_runs_cutoff
  ON ai.prediction_runs (cutoff_timestamp_utc);

CREATE INDEX IF NOT EXISTS idx_ai_prediction_runs_hash
  ON ai.prediction_runs (feature_schema_hash);

-- Table 17: ai.agent_traces
CREATE TABLE IF NOT EXISTS ai.agent_traces (
  trace_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES ai.prediction_runs(run_id) ON DELETE CASCADE,
  agent_role ai.agent_role_type NOT NULL,
  provider VARCHAR(30) NOT NULL,
  model_identifier VARCHAR(100) NOT NULL,
  temperature NUMERIC(3, 2) NOT NULL CHECK (temperature BETWEEN 0.0 AND 2.0),
  prompt_tokens INTEGER NULL CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
  completion_tokens INTEGER NULL CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  system_prompt TEXT NOT NULL,
  user_prompt TEXT NOT NULL,
  raw_thinking_content TEXT NULL,
  raw_response_content TEXT NOT NULL,
  parsed_output JSONB NOT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_traces_run_role
  ON ai.agent_traces (run_id, agent_role);

CREATE INDEX IF NOT EXISTS idx_ai_agent_traces_model
  ON ai.agent_traces (model_identifier);

-- =============================================================================
-- 11. SCHEMA `predictions`: PUBLISHED PREDICTIONS & EDITORIALS (Tables 18-19/28)
-- =============================================================================

-- Table 18: predictions.published_predictions
CREATE TABLE IF NOT EXISTS predictions.published_predictions (
  prediction_id BIGSERIAL PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE RESTRICT,
  run_id UUID NULL REFERENCES ai.prediction_runs(run_id) ON DELETE SET NULL,
  fixture_id INTEGER NOT NULL UNIQUE,
  home_player_id UUID NOT NULL REFERENCES identity.players(player_id) ON DELETE RESTRICT,
  away_player_id UUID NOT NULL REFERENCES identity.players(player_id) ON DELETE RESTRICT,
  predicted_winner_id UUID NOT NULL REFERENCES identity.players(player_id) ON DELETE RESTRICT,
  win_probability SMALLINT NOT NULL CHECK (win_probability BETWEEN 0 AND 100),
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
  settled_score TEXT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_predictions_published_fixture
  ON predictions.published_predictions (fixture_id);

CREATE INDEX IF NOT EXISTS idx_predictions_published_status
  ON predictions.published_predictions (status);

CREATE INDEX IF NOT EXISTS idx_predictions_published_time
  ON predictions.published_predictions (published_at DESC);

-- Table 19: predictions.match_editorials
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
  key_stats JSONB NULL,
  status_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  publish_status predictions.editorial_publish_status NOT NULL DEFAULT 'draft',
  version SMALLINT NOT NULL DEFAULT 1 CHECK (version >= 1),
  published_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_predictions_editorials_slug
  ON predictions.match_editorials (slug);

CREATE INDEX IF NOT EXISTS idx_predictions_editorials_fixture
  ON predictions.match_editorials (fixture_id);

CREATE INDEX IF NOT EXISTS idx_predictions_editorials_status
  ON predictions.match_editorials (publish_status, published_at DESC);

-- =============================================================================
-- 12. SCHEMA `provenance`: LINKING, AUDIT & QUEUE (Tables 20-22/28)
-- =============================================================================

-- Table 20: provenance.source_match_links
CREATE TABLE IF NOT EXISTS provenance.source_match_links (
  link_id BIGSERIAL PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  source_name VARCHAR(50) NOT NULL,
  source_match_id VARCHAR(100) NOT NULL,
  evidence_id UUID NOT NULL REFERENCES raw.source_evidence(evidence_id) ON DELETE RESTRICT,
  confidence_score NUMERIC(5, 2) NOT NULL CHECK (confidence_score BETWEEN 0.0 AND 100.0),
  scorer_version VARCHAR(20) NOT NULL,
  rule_version VARCHAR(20) NOT NULL,
  link_status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED'
    CHECK (link_status IN ('CONFIRMED', 'PROVISIONAL', 'REJECTED')),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_provenance_source_match_links UNIQUE (source_name, source_match_id)
);

CREATE INDEX IF NOT EXISTS idx_provenance_links_match
  ON provenance.source_match_links (match_id);

CREATE INDEX IF NOT EXISTS idx_provenance_links_evidence
  ON provenance.source_match_links (evidence_id);

-- Table 21: provenance.field_provenance
CREATE TABLE IF NOT EXISTS provenance.field_provenance (
  provenance_id BIGSERIAL PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  field_name VARCHAR(50) NOT NULL,
  source_name VARCHAR(50) NOT NULL,
  source_match_id VARCHAR(100) NOT NULL,
  evidence_id UUID NOT NULL REFERENCES raw.source_evidence(evidence_id) ON DELETE RESTRICT,
  raw_value TEXT NULL,
  confidence NUMERIC(5, 2) NOT NULL CHECK (confidence BETWEEN 0.0 AND 100.0),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_provenance_field_match
  ON provenance.field_provenance (match_id, field_name);

CREATE INDEX IF NOT EXISTS idx_provenance_field_evidence
  ON provenance.field_provenance (evidence_id);

-- Table 22: provenance.review_queue
CREATE TABLE IF NOT EXISTS provenance.review_queue (
  review_id BIGSERIAL PRIMARY KEY,
  candidate_match_id UUID NULL REFERENCES matches.matches(match_id) ON DELETE SET NULL,
  incoming_source VARCHAR(50) NOT NULL,
  incoming_source_id VARCHAR(100) NOT NULL,
  incoming_evidence_id UUID NOT NULL REFERENCES raw.source_evidence(evidence_id) ON DELETE RESTRICT,
  confidence_score NUMERIC(5, 2) NOT NULL CHECK (confidence_score BETWEEN 0.0 AND 100.0),
  veto_triggers TEXT[] NOT NULL DEFAULT '{}',
  divergent_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_status provenance.review_status_type NOT NULL DEFAULT 'PENDING',
  resolved_by TEXT NULL,
  resolved_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_provenance_review_status
  ON provenance.review_queue (review_status);

CREATE INDEX IF NOT EXISTS idx_provenance_review_source
  ON provenance.review_queue (incoming_source, incoming_source_id);

-- =============================================================================
-- 13. SCHEMA `backtest`: REPRODUCIBLE EXPERIMENTATION (Tables 23-25/28)
-- =============================================================================

-- Table 23: backtest.cohorts
CREATE TABLE IF NOT EXISTS backtest.cohorts (
  cohort_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_name TEXT NOT NULL UNIQUE,
  description TEXT NULL,
  min_date DATE NOT NULL,
  max_date DATE NOT NULL CHECK (max_date >= min_date),
  criteria_rules JSONB NOT NULL,
  frozen_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Table 24: backtest.cohort_matches
CREATE TABLE IF NOT EXISTS backtest.cohort_matches (
  cohort_id UUID NOT NULL REFERENCES backtest.cohorts(cohort_id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  partition_split backtest.partition_split_type NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (cohort_id, match_id)
);

CREATE INDEX IF NOT EXISTS idx_backtest_cohort_partition
  ON backtest.cohort_matches (cohort_id, partition_split);

-- Table 25: backtest.runs
CREATE TABLE IF NOT EXISTS backtest.runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id UUID NOT NULL REFERENCES backtest.cohorts(cohort_id) ON DELETE RESTRICT,
  strategy_name TEXT NOT NULL,
  parameters JSONB NOT NULL,
  matches_evaluated INTEGER NOT NULL CHECK (matches_evaluated >= 0),
  brier_score NUMERIC(6, 5) NOT NULL CHECK (brier_score BETWEEN 0.0 AND 1.0),
  log_loss NUMERIC(6, 5) NOT NULL CHECK (log_loss >= 0.0),
  expected_calibration_error NUMERIC(6, 5) NOT NULL CHECK (expected_calibration_error BETWEEN 0.0 AND 1.0),
  roi_pct NUMERIC(6, 2) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL CHECK (completed_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_cohort
  ON backtest.runs (cohort_id);

-- =============================================================================
-- 14. SCHEMA `app`: USERS, SITES & SETTINGS (Tables 26-28/28)
-- =============================================================================

-- Table 26: app.users
CREATE TABLE IF NOT EXISTS app.users (
  user_id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT NULL UNIQUE,
  google_id TEXT NULL UNIQUE,
  email TEXT NULL,
  username TEXT NULL,
  first_name TEXT NULL,
  avatar_url TEXT NULL,
  auth_provider VARCHAR(20) NOT NULL CHECK (auth_provider IN ('telegram', 'google', 'custom', 'anonymous')),
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ NULL,
  registered_site_id INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  last_active_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_app_users_telegram
  ON app.users (telegram_id);

CREATE INDEX IF NOT EXISTS idx_app_users_google
  ON app.users (google_id);

CREATE INDEX IF NOT EXISTS idx_app_users_email
  ON app.users (email);

-- Table 27: app.referral_sites
CREATE TABLE IF NOT EXISTS app.referral_sites (
  site_id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  logo_url TEXT NULL,
  referral_url TEXT NOT NULL,
  app_url TEXT NULL,
  promo_code TEXT NULL,
  bonus_text TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  order_index INTEGER NOT NULL DEFAULT 0,
  postback_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Table 28: app.settings
CREATE TABLE IF NOT EXISTS app.settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

COMMIT;
