import type Database from 'better-sqlite3';

export const initGoldSchema = (db: Database.Database): void => {
  db.exec(`
    -- 1. Gold Matches Validated: Durable Single Source of Truth for 57,977 Ingested Matches
    CREATE TABLE IF NOT EXISTS gold_matches_validated (
      rapid_event_id INTEGER PRIMARY KEY,
      canonical_match_id TEXT UNIQUE,
      match_date TEXT NOT NULL,
      start_utc TEXT,
      tour TEXT NOT NULL,
      tourney_name TEXT NOT NULL,
      tourney_id TEXT,
      surface_raw TEXT NOT NULL,
      surface TEXT NOT NULL,
      round_name TEXT,
      winner_name TEXT NOT NULL,
      loser_name TEXT NOT NULL,
      winner_id INTEGER,
      loser_id INTEGER,
      score TEXT NOT NULL,
      winner_rank INTEGER,
      loser_rank INTEGER,
      winner_odds REAL,
      loser_odds REAL,
      has_odds INTEGER DEFAULT 0,
      has_stats_bundle INTEGER DEFAULT 0,
      has_pbp_bundle INTEGER DEFAULT 0,
      bundle_storage_path TEXT,
      w_svpt INTEGER,
      w_1stIn INTEGER,
      w_1stWon INTEGER,
      w_2ndWon INTEGER,
      w_SvGms INTEGER,
      w_bpSaved INTEGER,
      w_bpFaced INTEGER,
      l_svpt INTEGER,
      l_1stIn INTEGER,
      l_1stWon INTEGER,
      l_2ndWon INTEGER,
      l_SvGms INTEGER,
      l_bpSaved INTEGER,
      l_bpFaced INTEGER,
      is_placeholder_serve INTEGER DEFAULT 0,
      is_retirement_or_wo INTEGER DEFAULT 0,
      is_non_singles INTEGER DEFAULT 0,
      is_speculative_draw INTEGER DEFAULT 0,
      source_presence TEXT NOT NULL,
      has_p1_history INTEGER DEFAULT 0,
      has_p2_history INTEGER DEFAULT 0,
      p1_prior_matches_count INTEGER DEFAULT 0,
      p2_prior_matches_count INTEGER DEFAULT 0,
      max_as_of_date TEXT,
      is_pit_safe INTEGER DEFAULT 1,
      final_status TEXT NOT NULL,
      exclusion_reason TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_validated_at TEXT NOT NULL,
      last_run_id TEXT NOT NULL,
      row_hash TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_gold_matches_date ON gold_matches_validated(match_date);
    CREATE INDEX IF NOT EXISTS idx_gold_matches_status ON gold_matches_validated(final_status);
    CREATE INDEX IF NOT EXISTS idx_gold_matches_winner ON gold_matches_validated(winner_name);
    CREATE INDEX IF NOT EXISTS idx_gold_matches_loser ON gold_matches_validated(loser_name);
    CREATE INDEX IF NOT EXISTS idx_gold_matches_surface ON gold_matches_validated(surface);
    CREATE INDEX IF NOT EXISTS idx_gold_matches_tour ON gold_matches_validated(tour);
    CREATE INDEX IF NOT EXISTS idx_gold_matches_canonical ON gold_matches_validated(canonical_match_id);

    -- 2. Clean Modeling View: Exposes strictly READY matches for Backtest and Prediction
    CREATE VIEW IF NOT EXISTS gold_matches_ready_view AS
    SELECT *
    FROM gold_matches_validated
    WHERE final_status = 'READY';

    -- 3. Rolling 3-Year Prior History Layer (Isolates 2021-2023 history-only rows)
    CREATE TABLE IF NOT EXISTS gold_player_history_3y (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_name TEXT NOT NULL,
      clean_player_name TEXT NOT NULL,
      match_date TEXT NOT NULL,
      surface TEXT NOT NULL,
      won INTEGER NOT NULL,
      rapid_event_id INTEGER,
      canonical_match_id TEXT,
      opponent_name TEXT NOT NULL,
      score TEXT,
      is_gold_target_match INTEGER NOT NULL,
      is_history_only INTEGER NOT NULL,
      has_serve_stats INTEGER DEFAULT 0,
      svpt INTEGER,
      first_in INTEGER,
      first_won INTEGER,
      second_won INTEGER,
      bp_saved INTEGER,
      bp_faced INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_gold_history_player ON gold_player_history_3y(clean_player_name, match_date);
    CREATE INDEX IF NOT EXISTS idx_gold_history_date ON gold_player_history_3y(match_date);
    CREATE INDEX IF NOT EXISTS idx_gold_history_surface ON gold_player_history_3y(clean_player_name, surface);
    CREATE INDEX IF NOT EXISTS idx_gold_history_target ON gold_player_history_3y(is_gold_target_match);

    -- 4. Daily Update State: Tracks execution runs, timestamps, match counts, and idempotency
    CREATE TABLE IF NOT EXISTS daily_update_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT UNIQUE NOT NULL,
      run_type TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      matches_fetched INTEGER DEFAULT 0,
      matches_inserted INTEGER DEFAULT 0,
      matches_updated INTEGER DEFAULT 0,
      matches_validated INTEGER DEFAULT 0,
      ready_count INTEGER DEFAULT 0,
      errors_count INTEGER DEFAULT 0,
      log_summary TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_daily_update_run_id ON daily_update_state(run_id);
    CREATE INDEX IF NOT EXISTS idx_daily_update_time ON daily_update_state(started_at);
  `);
};
