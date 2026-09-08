import { db } from './connection';
import { ensurePlayerMatchesValidatedView } from '../validation/playerMatchesValidated.view';
import { initGoldSchema } from './goldSchema';

export const initSchema = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE NOT NULL,
      is_verified INTEGER DEFAULT 0,
      verified_at TEXT,
      registered_site_id INTEGER,
      verify_status TEXT DEFAULT 'none',
      verify_source TEXT DEFAULT '',
      has_deposited INTEGER DEFAULT 0,
      pending_site_id INTEGER,
      screenshot_file_id TEXT,
      created_at TEXT NOT NULL,
      last_active_at TEXT
    );

    CREATE TABLE IF NOT EXISTS referral_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      logo_url TEXT,
      referral_url TEXT NOT NULL,
      app_url TEXT DEFAULT '',
      promo_code TEXT,
      bonus_text TEXT,
      steps_text TEXT,
      is_active INTEGER DEFAULT 1,
      order_index INTEGER DEFAULT 0,
      postback_key TEXT,
      verify_mode TEXT DEFAULT 'postback',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS referral_clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      click_id TEXT UNIQUE NOT NULL,
      site_id INTEGER,
      partner_key TEXT NOT NULL,
      user_ref TEXT NOT NULL,
      session_ref TEXT,
      match_id INTEGER,
      fixture_id INTEGER,
      page_context TEXT,
      action_type TEXT NOT NULL,
      destination_url TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS partner_conversions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_key TEXT NOT NULL,
      site_id INTEGER,
      event_type TEXT NOT NULL,
      click_id TEXT,
      transaction_id TEXT,
      dedupe_key TEXT UNIQUE NOT NULL,
      user_ref TEXT,
      status TEXT NOT NULL,
      raw_payload TEXT NOT NULL,
      received_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id INTEGER UNIQUE,
      tournament_name TEXT,
      round_name TEXT,
      surface TEXT,
      match_date TEXT,
      home_name TEXT NOT NULL,
      away_name TEXT NOT NULL,
      home_odds TEXT,
      away_odds TEXT,
      predicted_winner TEXT NOT NULL,
      win_probability INTEGER NOT NULL,
      confidence TEXT NOT NULL,
      predicted_score TEXT,
      best_bet_selection TEXT,
      best_bet_market TEXT,
      best_bet_ev TEXT,
      best_bet_rationale TEXT,
      alt_bet_selection TEXT,
      alt_bet_market TEXT,
      key_factors TEXT,
      devils_advocate_risk TEXT,
      ai_summary TEXT,
      home_image TEXT,
      away_image TEXT,
      home_id INTEGER,
      away_id INTEGER,
      status TEXT DEFAULT 'UPCOMING',
      result_score TEXT,
      channel_message_id INTEGER,
      published_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS channel_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prediction_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      posted_at TEXT NOT NULL,
      FOREIGN KEY(prediction_id) REFERENCES predictions(id)
    );

    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER UNIQUE NOT NULL,
      slug TEXT NOT NULL,
      full_name TEXT NOT NULL,
      short_name TEXT,
      country_code TEXT,
      country_name TEXT,
      ranking INTEGER,
      gender TEXT DEFAULT 'M',
      image_url TEXT,
      bio TEXT,
      playstyle TEXT,
      surface_stats_json TEXT,
      recent_matches_json TEXT,
      ai_dossier_json TEXT,
      is_featured INTEGER DEFAULT 0,
      is_published INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS website_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS match_editorials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id INTEGER UNIQUE NOT NULL,
      slug TEXT NOT NULL,
      headline TEXT NOT NULL,
      summary TEXT NOT NULL,
      tactical_analysis TEXT NOT NULL,
      surface_breakdown TEXT,
      h2h_breakdown TEXT,
      key_stats_json TEXT,
      author_name TEXT DEFAULT 'PTIN Tennis Editorial Team',
      seo_title TEXT,
      seo_description TEXT,
      ai_assisted INTEGER DEFAULT 1,
      is_published INTEGER DEFAULT 1,
      subtitle TEXT,
      short_summary TEXT,
      key_facts_json TEXT,
      data_bullets_json TEXT,
      tags_json TEXT,
      seo_metadata_json TEXT,
      share_text TEXT,
      guest_safe_summary TEXT,
      publish_status TEXT DEFAULT 'draft',
      version INTEGER DEFAULT 1,
      editor_name TEXT,
      published_at TEXT,
      status_history_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS historical_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tour TEXT NOT NULL,
      tourney_id TEXT,
      tourney_name TEXT NOT NULL,
      tourney_level TEXT,
      draw_size INTEGER,
      surface TEXT NOT NULL,
      match_date TEXT NOT NULL,
      match_num INTEGER,
      round_name TEXT,
      winner_id INTEGER,
      winner_seed INTEGER,
      winner_entry TEXT,
      winner_name TEXT NOT NULL,
      winner_hand TEXT,
      winner_ht INTEGER,
      winner_ioc TEXT,
      winner_age REAL,
      winner_rank INTEGER,
      winner_rank_points INTEGER,
      loser_id INTEGER,
      loser_seed INTEGER,
      loser_entry TEXT,
      loser_name TEXT NOT NULL,
      loser_hand TEXT,
      loser_ht INTEGER,
      loser_ioc TEXT,
      loser_age REAL,
      loser_rank INTEGER,
      loser_rank_points INTEGER,
      score TEXT NOT NULL,
      best_of INTEGER DEFAULT 3,
      minutes INTEGER,
      w_ace INTEGER,
      w_df INTEGER,
      w_svpt INTEGER,
      w_1stIn INTEGER,
      w_1stWon INTEGER,
      w_2ndWon INTEGER,
      w_SvGms INTEGER,
      w_bpSaved INTEGER,
      w_bpFaced INTEGER,
      l_ace INTEGER,
      l_df INTEGER,
      l_svpt INTEGER,
      l_1stIn INTEGER,
      l_1stWon INTEGER,
      l_2ndWon INTEGER,
      l_SvGms INTEGER,
      l_bpSaved INTEGER,
      l_bpFaced INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_hist_matches_date ON historical_matches(match_date);
    CREATE INDEX IF NOT EXISTS idx_hist_matches_winner ON historical_matches(winner_name);
    CREATE INDEX IF NOT EXISTS idx_hist_matches_loser ON historical_matches(loser_name);
    CREATE INDEX IF NOT EXISTS idx_hist_matches_tourney ON historical_matches(tourney_name);

    CREATE TABLE IF NOT EXISTS ingestion_sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pool_cache (
      cache_key TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      source TEXT DEFAULT 'rapidapi',
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pool_cache_namespace ON pool_cache(namespace);
    CREATE INDEX IF NOT EXISTS idx_pool_cache_expires ON pool_cache(expires_at);

    CREATE TABLE IF NOT EXISTS tracked_players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rapid_player_id INTEGER UNIQUE NOT NULL,
      tour TEXT NOT NULL,
      full_name TEXT NOT NULL,
      short_name TEXT,
      country_code TEXT,
      current_rank INTEGER,
      gender TEXT DEFAULT 'M',
      sync_status TEXT DEFAULT 'pending',
      sync_error TEXT,
      last_sync_at TEXT,
      last_match_date TEXT,
      matches_in_db INTEGER DEFAULT 0,
      matches_with_stats INTEGER DEFAULT 0,
      last_sync_pages INTEGER DEFAULT 0,
      added_by TEXT DEFAULT 'manual',
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tracked_players_tour ON tracked_players(tour);
    CREATE INDEX IF NOT EXISTS idx_tracked_players_name ON tracked_players(full_name);
    CREATE INDEX IF NOT EXISTS idx_tracked_players_status ON tracked_players(sync_status);

    CREATE TABLE IF NOT EXISTS player_match_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tracked_player_id INTEGER NOT NULL,
      historical_match_id INTEGER,
      rapid_event_id INTEGER,
      match_fingerprint TEXT NOT NULL,
      match_date TEXT NOT NULL,
      opponent_name TEXT NOT NULL,
      won INTEGER NOT NULL DEFAULT 0,
      tour TEXT,
      tourney_name TEXT,
      surface TEXT,
      score TEXT,
      completeness TEXT NOT NULL DEFAULT 'csv_only',
      has_csv_stats INTEGER NOT NULL DEFAULT 0,
      has_api_details INTEGER NOT NULL DEFAULT 0,
      has_api_statistics INTEGER NOT NULL DEFAULT 0,
      has_api_pbp INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(tracked_player_id, match_fingerprint)
    );

    CREATE INDEX IF NOT EXISTS idx_pmi_player ON player_match_index(tracked_player_id);
    CREATE INDEX IF NOT EXISTS idx_pmi_event ON player_match_index(rapid_event_id);
    CREATE INDEX IF NOT EXISTS idx_pmi_hist ON player_match_index(historical_match_id);
    CREATE INDEX IF NOT EXISTS idx_pmi_date ON player_match_index(match_date);

    CREATE TABLE IF NOT EXISTS match_analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id INTEGER UNIQUE NOT NULL,
      tournament_name TEXT,
      round_name TEXT,
      match_date TEXT,
      home_id INTEGER,
      away_id INTEGER,
      home_name TEXT NOT NULL,
      away_name TEXT NOT NULL,
      surface TEXT,
      status TEXT DEFAULT 'SUCCESS',
      error_message TEXT,
      energy_json TEXT,
      surface_kpis_json TEXT,
      synergy_json TEXT,
      tactical_json TEXT,
      markov_odds_json TEXT,
      raw_result_json TEXT,
      computed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_match_analytics_fixture ON match_analytics(fixture_id);
    CREATE INDEX IF NOT EXISTS idx_match_analytics_date ON match_analytics(match_date);
    CREATE INDEX IF NOT EXISTS idx_match_analytics_status ON match_analytics(status);
    CREATE TABLE IF NOT EXISTS ml_monitoring_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_version TEXT NOT NULL,
      feature_schema_hash TEXT NOT NULL,
      prediction_count INTEGER NOT NULL,
      prediction_mean REAL NOT NULL,
      prediction_distribution_json TEXT NOT NULL,
      psi_per_feature_json TEXT NOT NULL,
      calibration_ece REAL NOT NULL,
      brier_score REAL NOT NULL,
      realized_accuracy_30d REAL,
      latency_p50_ms REAL,
      latency_p95_ms REAL,
      latency_p99_ms REAL,
      gate_pass_rate_pct REAL,
      rollout_stage TEXT DEFAULT 'CANARY_10',
      system_health_status TEXT DEFAULT 'HEALTHY',
      incident_flag INTEGER DEFAULT 0,
      captured_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ml_incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_code TEXT UNIQUE NOT NULL,
      severity TEXT NOT NULL,
      reason TEXT NOT NULL,
      metrics_snapshot_json TEXT,
      affected_channels_json TEXT,
      action_taken TEXT NOT NULL,
      is_resolved INTEGER DEFAULT 0,
      resolved_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ml_model_registry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT UNIQUE NOT NULL,
      is_active_prod INTEGER DEFAULT 0,
      is_canary INTEGER DEFAULT 0,
      canary_percentage INTEGER DEFAULT 0,
      training_window TEXT NOT NULL,
      feature_schema_hash TEXT NOT NULL,
      threshold_balanced REAL DEFAULT 0.50,
      threshold_high_conf REAL DEFAULT 0.58,
      baseline_auc REAL NOT NULL,
      baseline_brier REAL NOT NULL,
      baseline_ece REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ml_snapshots_time ON ml_monitoring_snapshots(captured_at);
    CREATE INDEX IF NOT EXISTS idx_ml_incidents_status ON ml_incidents(is_resolved, severity);
    CREATE INDEX IF NOT EXISTS idx_ml_registry_active ON ml_model_registry(is_active_prod);

    CREATE TABLE IF NOT EXISTS canonical_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_match_id TEXT UNIQUE NOT NULL,
      canonical_match_date TEXT NOT NULL,
      canonical_start_utc TEXT,
      tour TEXT NOT NULL,
      tourney_name TEXT NOT NULL,
      tourney_level TEXT,
      surface TEXT NOT NULL,
      round_name TEXT,
      canonical_winner_name TEXT NOT NULL,
      canonical_loser_name TEXT NOT NULL,
      score TEXT NOT NULL,
      minutes INTEGER,
      source_a_historical_match_id INTEGER,
      source_b_rapid_event_id INTEGER,
      source_presence TEXT NOT NULL,
      join_confidence TEXT NOT NULL,
      join_confidence_score REAL NOT NULL,
      join_method TEXT NOT NULL,
      data_source_stats TEXT DEFAULT 'none',
      data_source_pbp TEXT DEFAULT 'none',
      data_source_odds TEXT DEFAULT 'none',
      bundle_storage_path TEXT,
      w_odds_match REAL,
      l_odds_match REAL,
      w_odds_set1 REAL,
      l_odds_set1 REAL,
      winner_rank INTEGER,
      loser_rank INTEGER,
      winner_rank_points INTEGER,
      loser_rank_points INTEGER,
      winner_ht INTEGER,
      loser_ht INTEGER,
      winner_age REAL,
      loser_age REAL,
      winner_ioc TEXT,
      loser_ioc TEXT,
      winner_hand TEXT,
      loser_hand TEXT,
      winner_seed INTEGER,
      loser_seed INTEGER,
      winner_entry TEXT,
      loser_entry TEXT,
      w_ace INTEGER,
      w_df INTEGER,
      w_svpt INTEGER,
      w_1stIn INTEGER,
      w_1stWon INTEGER,
      w_2ndWon INTEGER,
      w_SvGms INTEGER,
      w_bpSaved INTEGER,
      w_bpFaced INTEGER,
      l_ace INTEGER,
      l_df INTEGER,
      l_svpt INTEGER,
      l_1stIn INTEGER,
      l_1stWon INTEGER,
      l_2ndWon INTEGER,
      l_SvGms INTEGER,
      l_bpSaved INTEGER,
      l_bpFaced INTEGER,
      w_serve_won_pct REAL,
      l_serve_won_pct REAL,
      w_return_won_pct REAL,
      l_return_won_pct REAL,
      w_bp_won_pct REAL,
      l_bp_won_pct REAL,
      w_bp_saved_pct REAL,
      l_bp_saved_pct REAL,
      is_placeholder_serve INTEGER DEFAULT 0,
      is_retirement_or_wo INTEGER DEFAULT 0,
      is_non_singles INTEGER DEFAULT 0,
      is_speculative_draw INTEGER DEFAULT 0,
      is_archive_only INTEGER DEFAULT 0,
      is_canonical_modeling_usable INTEGER DEFAULT 0,
      is_backtest_safe INTEGER DEFAULT 0,
      canonical_status_reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_canonical_matches_date ON canonical_matches(canonical_match_date);
    CREATE INDEX IF NOT EXISTS idx_canonical_matches_winner ON canonical_matches(canonical_winner_name);
    CREATE INDEX IF NOT EXISTS idx_canonical_matches_loser ON canonical_matches(canonical_loser_name);
    CREATE INDEX IF NOT EXISTS idx_canonical_matches_source_a ON canonical_matches(source_a_historical_match_id);
    CREATE INDEX IF NOT EXISTS idx_canonical_matches_source_b ON canonical_matches(source_b_rapid_event_id);
    CREATE INDEX IF NOT EXISTS idx_canonical_matches_modeling ON canonical_matches(is_canonical_modeling_usable);
    CREATE INDEX IF NOT EXISTS idx_canonical_matches_backtest ON canonical_matches(is_backtest_safe);
    CREATE INDEX IF NOT EXISTS idx_canonical_matches_archive ON canonical_matches(is_archive_only);
  `);

  // Run migration for existing table columns if needed
  const newCols = [
    { name: 'draw_size', type: 'INTEGER' },
    { name: 'winner_seed', type: 'INTEGER' },
    { name: 'winner_entry', type: 'TEXT' },
    { name: 'winner_ht', type: 'INTEGER' },
    { name: 'winner_age', type: 'REAL' },
    { name: 'winner_rank_points', type: 'INTEGER' },
    { name: 'loser_seed', type: 'INTEGER' },
    { name: 'loser_entry', type: 'TEXT' },
    { name: 'loser_ht', type: 'INTEGER' },
    { name: 'loser_age', type: 'REAL' },
    { name: 'loser_rank_points', type: 'INTEGER' },
  ];

  try {
    const existingCols = (db.prepare("PRAGMA table_info('historical_matches')").all() as any[]).map(c => c.name);
    for (const col of newCols) {
      if (!existingCols.includes(col.name)) {
        db.exec(`ALTER TABLE historical_matches ADD COLUMN ${col.name} ${col.type}`);
      }
    }
    const histExtraCols = [
      { name: 'rapid_event_id', type: 'INTEGER' },
      { name: 'w_odds_match', type: 'REAL' },
      { name: 'l_odds_match', type: 'REAL' },
      { name: 'w_odds_set1', type: 'REAL' },
      { name: 'l_odds_set1', type: 'REAL' },
      { name: 'w_serve_won_pct', type: 'REAL' },
      { name: 'l_serve_won_pct', type: 'REAL' },
      { name: 'w_return_won_pct', type: 'REAL' },
      { name: 'l_return_won_pct', type: 'REAL' },
      { name: 'w_bp_won_pct', type: 'REAL' },
      { name: 'l_bp_won_pct', type: 'REAL' },
      { name: 'w_bp_saved_pct', type: 'REAL' },
      { name: 'l_bp_saved_pct', type: 'REAL' },
      { name: 'is_archive_only', type: 'INTEGER DEFAULT 0' },
    ];
    for (const col of histExtraCols) {
      if (!existingCols.includes(col.name)) {
        db.exec(`ALTER TABLE historical_matches ADD COLUMN ${col.name} ${col.type}`);
      }
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_hist_matches_rapid_event ON historical_matches(rapid_event_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_hist_matches_archive ON historical_matches(is_archive_only)');

    const cmCols = (db.prepare("PRAGMA table_info('canonical_matches')").all() as any[]).map(c => c.name);
    if (!cmCols.includes('is_archive_only')) {
      db.exec('ALTER TABLE canonical_matches ADD COLUMN is_archive_only INTEGER DEFAULT 0');
      db.exec('CREATE INDEX IF NOT EXISTS idx_canonical_matches_archive ON canonical_matches(is_archive_only)');
    }
  } catch (err: any) {
    console.warn('schema migration note:', err.message);
  }

  try {
    ensurePlayerMatchesValidatedView(db);
  } catch (err: any) {
    console.warn('player_matches_validated view note:', err.message);
  }

  try {
    initGoldSchema(db);
  } catch (err: any) {
    console.warn('gold schema initialization note:', err.message);
  }

  // Resilient Seed: ensure Render ephemeral restarts always have active baseline data
  try {
    const refCount = (db.prepare('SELECT count(*) as c FROM referral_sites').get() as { c: number })?.c || 0;
    if (refCount === 0) {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO referral_sites (name, logo_url, referral_url, app_url, promo_code, bonus_text, steps_text, is_active, order_index, postback_key, verify_mode, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        '1win',
        '',
        'https://r1wvvyb.life/betting?open=register&p=5ccv',
        '',
        '',
        '',
        '',
        1,
        0,
        '1win-key-ctsi8',
        'postback',
        now
      );
    }
  } catch (err: any) {
    console.warn('referral_sites seed note:', err.message);
  }

  try {
    const predCount = (db.prepare('SELECT count(*) as c FROM predictions').get() as { c: number })?.c || 0;
    if (predCount === 0) {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO predictions (
          fixture_id, tournament_name, round_name, surface, match_date,
          home_name, away_name, home_odds, away_odds,
          predicted_winner, win_probability, confidence, predicted_score,
          best_bet_selection, best_bet_market, best_bet_ev, best_bet_rationale,
          alt_bet_selection, alt_bet_market, key_factors, devils_advocate_risk,
          ai_summary, status, published_at, created_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?
        )
      `).run(
        16901525, 'US Open, New York, USA', 'Round of 16', 'Hardcourt outdoor', '2026-09-06T23:00:00.000Z',
        'Ben Shelton', 'Stefanos Tsitsipas', '1.4', '3',
        'Ben Shelton', 62, 'MODERATE', '3:1',
        'Ben Shelton', 'Match Winner', 'NEUTRAL', 'Synthesis: Strong winner consensus for Ben Shelton @ 1.40 (P=62%, 2/3 specialists).',
        'NO BET / PASS', 'NO_BET',
        JSON.stringify([
          "Shelton's elite serve hold rate (88%) on fast hardcourt",
          'Ranking and ELO gap (359 points) favoring Shelton',
          "Tsitsipas's chronic back strain and moderate return vulnerability"
        ]),
        "Tsitsipas's superior mental readiness and all-court versatility could exploit Shelton's aggressive errors in extended rallies.",
        'Consensus Bet: Ben Shelton (Synthesis: Strong winner consensus for Ben Shelton @ 1.40 (P=62%, 2/3 specialists).)',
        'UPCOMING', now, now
      );
    }
  } catch (err: any) {
    console.warn('predictions seed note:', err.message);
  }

  try {
    const accSetting = db.prepare("SELECT value FROM settings WHERE key = 'access_mode'").get();
    if (!accSetting) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('access_mode', 'REGISTRATION_REQUIRED')").run();
    }
  } catch (err: any) {
    console.warn('settings seed note:', err.message);
  }
};
