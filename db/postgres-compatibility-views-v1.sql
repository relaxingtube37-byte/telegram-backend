-- =============================================================================
-- FOOTBALL STATE / TENNIS AI PLATFORM
-- POSTGRESQL 16+ COMPATIBILITY VIEWS SPECIFICATION (V1)
-- =============================================================================
--
-- Target Engine: PostgreSQL 16+
-- Transactional Safety: Wrapped in single atomic transaction block (BEGIN...COMMIT)
-- Idempotency: 100% safe to re-run on fresh or existing databases (CREATE OR REPLACE VIEW)
-- Prerequisite: db/postgres-schema-v1.sql must be executed successfully before this script.
--
-- Views Created:
--   1. public.canonicalmatchesoperational (and alias public.canonical_matches_operational)
--   2. public.playermatchesvalidated (and alias public.player_matches_validated)
--   3. public.goldmatchesreadyview (and alias public.gold_matches_ready_view)
--   4. predictions.published_predictions_view (and alias predictions.v_webapp_predictions)
--   5. predictions.match_editorials_view
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. VIEW: public.canonicalmatchesoperational & public.canonical_matches_operational
-- Purpose: 79-column legacy operational match feed for /api/web/matches and desktop tools
-- =============================================================================

CREATE OR REPLACE VIEW public.canonical_matches_operational AS
SELECT
  m.match_id::TEXT AS canonical_match_id,
  to_char(m.scheduled_start_utc, 'YYYY-MM-DD') AS match_date,
  m.scheduled_start_utc,
  m.actual_start_utc,
  t.tour::TEXT AS tour,
  t.name_standard AS tourney_name,
  te.year AS tourney_year,
  m.surface::TEXT AS surface,
  m.is_indoor,
  m.round_name,
  m.best_of,
  m.status::TEXT AS match_status,
  m.source_mask,
  pw.player_id::TEXT AS winner_id,
  pw.full_name_standard AS winner_name,
  pl.player_id::TEXT AS loser_id,
  pl.full_name_standard AS loser_name,
  mr.score_string AS score,
  mr.retirement_detail,
  mr.is_retirement_or_wo,
  mr.duration_minutes,
  mpw.pre_match_rank AS winner_rank,
  mpl.pre_match_rank AS loser_rank,
  mpw.seed AS winner_seed,
  mpl.seed AS loser_seed,
  mpw.entry_status AS winner_entry,
  mpl.entry_status AS loser_entry,
  -- Odds metrics
  (SELECT o.decimal_odds::DOUBLE PRECISION FROM markets.market_odds_ticks o
   WHERE o.match_id = m.match_id AND o.market_type = 'MONEYLINE' AND o.selection_side = mpw.side
   ORDER BY o.is_closing_line DESC, o.captured_at_utc DESC LIMIT 1) AS w_odds_match,
  (SELECT o.decimal_odds::DOUBLE PRECISION FROM markets.market_odds_ticks o
   WHERE o.match_id = m.match_id AND o.market_type = 'MONEYLINE' AND o.selection_side = mpl.side
   ORDER BY o.is_closing_line DESC, o.captured_at_utc DESC LIMIT 1) AS l_odds_match,
  -- Serve & return statistics
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
  COALESCE(sw.is_placeholder_serve, FALSE)::INTEGER AS is_placeholder_serve,
  CASE WHEN mr.is_retirement_or_wo THEN 1 ELSE 0 END AS is_retirement_or_wo_int,
  0 AS is_non_singles,
  0 AS is_speculative_draw,
  CASE WHEN m.status = 'FINISHED' AND (mr.is_retirement_or_wo IS FALSE) THEN 1 ELSE 0 END AS is_canonical_modeling_usable,
  CASE WHEN m.status = 'FINISHED' THEN 1 ELSE 0 END AS is_backtest_safe,
  'POSTGRES_CANONICAL_OPERATIONAL' AS canonical_status_reason,
  m.created_at,
  m.updated_at
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

-- Exact un-underscored alias required by specification
CREATE OR REPLACE VIEW public.canonicalmatchesoperational AS
SELECT * FROM public.canonical_matches_operational;

-- =============================================================================
-- 2. VIEW: public.playermatchesvalidated & public.player_matches_validated
-- Purpose: Player-oriented match records with 12 quarantine flags and usability booleans
-- =============================================================================

CREATE OR REPLACE VIEW public.player_matches_validated AS
SELECT
  ('x' || substr(md5(m.match_id::text || '_' || mp.side::text), 1, 8))::bit(32)::int AS pmi_id,
  m.match_id::TEXT AS match_fingerprint,
  to_char(m.scheduled_start_utc, 'YYYY-MM-DD') AS match_date,
  p.full_name_standard AS player_name,
  po.full_name_standard AS opponent_name,
  CASE WHEN mr.winner_player_id = mp.player_id THEN 1 ELSE 0 END AS won,
  'COMPLETE' AS completeness,
  1 AS has_csv_stats,
  1 AS has_api_statistics,
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
  cmo.w_ace, cmo.w_df, cmo.w_svpt, cmo.w_1stIn, cmo.w_1stWon, cmo.w_2ndWon,
  cmo.w_bpSaved, cmo.w_bpFaced,
  cmo.l_ace, cmo.l_df, cmo.l_svpt, cmo.l_1stIn, cmo.l_1stWon, cmo.l_2ndWon,
  cmo.l_bpSaved, cmo.l_bpFaced,
  cmo.w_serve_won_pct, cmo.l_serve_won_pct,
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
    (mr.winner_player_id = mp.player_id AND cmo.w_1stIn > 0) OR
    (mr.loser_player_id = mp.player_id AND cmo.l_1stIn > 0)
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

-- Exact un-underscored alias required by specification
CREATE OR REPLACE VIEW public.playermatchesvalidated AS
SELECT * FROM public.player_matches_validated;

-- =============================================================================
-- 3. VIEW: public.goldmatchesreadyview & public.gold_matches_ready_view
-- Purpose: Compatibility view for backtest runners requiring finished matches
-- =============================================================================

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
  (SELECT o.decimal_odds::DOUBLE PRECISION FROM markets.market_odds_ticks o
   WHERE o.match_id = m.match_id AND o.market_type = 'MONEYLINE' AND o.selection_side = mpw.side
   ORDER BY o.is_closing_line DESC, o.captured_at_utc DESC LIMIT 1) AS winner_odds,
  (SELECT o.decimal_odds::DOUBLE PRECISION FROM markets.market_odds_ticks o
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

-- Exact un-underscored alias required by specification
CREATE OR REPLACE VIEW public.goldmatchesreadyview AS
SELECT * FROM public.gold_matches_ready_view;

-- =============================================================================
-- 4. VIEW: predictions.published_predictions_view
-- Purpose: Direct projection for GET /api/webapp/predictions
-- =============================================================================

CREATE OR REPLACE VIEW predictions.published_predictions_view AS
SELECT
  p.prediction_id AS id,
  p.fixture_id,
  t.name_standard AS tournament_name,
  m.round_name,
  m.surface::TEXT AS surface,
  to_char(m.scheduled_start_utc, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS match_date,
  p1.full_name_standard AS home_name,
  p2.full_name_standard AS away_name,
  (SELECT o.decimal_odds FROM markets.market_odds_ticks o WHERE o.match_id = m.match_id AND o.selection_side = 1 ORDER BY o.is_closing_line DESC, o.captured_at_utc DESC LIMIT 1) AS home_odds,
  (SELECT o.decimal_odds FROM markets.market_odds_ticks o WHERE o.match_id = m.match_id AND o.selection_side = 2 ORDER BY o.is_closing_line DESC, o.captured_at_utc DESC LIMIT 1) AS away_odds,
  pw.full_name_standard AS predicted_winner,
  p.win_probability,
  p.confidence,
  p.predicted_score,
  p.best_bet_selection,
  p.best_bet_market,
  p.best_bet_ev,
  p.best_bet_rationale,
  p.alt_bet_selection,
  p.alt_bet_market,
  p.key_factors,
  p.devils_advocate_risk,
  p.ai_summary,
  '/api/webapp/players/' || p1.player_id::TEXT || '/image?size=80' AS home_image,
  '/api/webapp/players/' || p2.player_id::TEXT || '/image?size=80' AS away_image,
  p.home_player_id::TEXT AS home_id,
  p.away_player_id::TEXT AS away_id,
  p.status::TEXT AS status,
  mr.score_string AS result_score,
  p.published_at,
  p.created_at
FROM predictions.published_predictions p
JOIN matches.matches m ON m.match_id = p.match_id
JOIN competition.tournament_editions te ON te.edition_id = m.edition_id
JOIN identity.tournaments t ON t.tournament_id = te.tournament_id
JOIN identity.players p1 ON p1.player_id = p.home_player_id
JOIN identity.players p2 ON p2.player_id = p.away_player_id
JOIN identity.players pw ON pw.player_id = p.predicted_winner_id
LEFT JOIN matches.match_results mr ON mr.match_id = m.match_id
ORDER BY p.published_at DESC;

-- Compatibility alias
CREATE OR REPLACE VIEW predictions.v_webapp_predictions AS
SELECT * FROM predictions.published_predictions_view;

-- =============================================================================
-- 5. VIEW: predictions.match_editorials_view
-- Purpose: Direct projection for GET /api/web/editorials/:idOrSlug
-- =============================================================================

CREATE OR REPLACE VIEW predictions.match_editorials_view AS
SELECT
  e.editorial_id AS id,
  e.fixture_id,
  e.slug,
  e.headline,
  e.headline AS title,
  e.subtitle,
  e.summary,
  COALESCE(e.short_summary, e.summary) AS short_summary,
  e.guest_safe_summary,
  e.tactical_analysis,
  e.surface_breakdown,
  e.h2h_breakdown,
  e.key_facts,
  e.key_facts::TEXT AS key_facts_json,
  e.data_bullets,
  e.data_bullets::TEXT AS data_bullets_json,
  e.tags,
  e.tags::TEXT AS tags_json,
  e.seo_metadata,
  e.seo_metadata::TEXT AS seo_metadata_json,
  e.key_stats,
  CASE WHEN e.key_stats IS NOT NULL THEN e.key_stats::TEXT ELSE NULL END AS key_stats_json,
  e.status_history,
  e.status_history::TEXT AS status_history_json,
  e.share_text,
  e.author_name,
  e.editor_name,
  e.seo_title,
  e.seo_description,
  e.publish_status::TEXT AS publish_status,
  e.version,
  1 AS ai_assisted,
  CASE WHEN e.publish_status = 'published' THEN 1 ELSE 0 END AS is_published,
  e.published_at,
  e.created_at,
  e.updated_at
FROM predictions.match_editorials e;

COMMIT;
