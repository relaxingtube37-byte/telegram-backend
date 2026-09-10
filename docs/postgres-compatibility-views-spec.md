# PostgreSQL Compatibility Views Specification
**Document Role:** Authoritative Backward-Compatibility Layer Specification
**Target Engine:** PostgreSQL 16+
**Views Defined:** 5 Canonical Projections (with 4 Un-underscored Aliases, 9 Total)
**Status:** SPECIFICATION & VALIDATED (GATE G9 PASS)

---

## 1. Executive Summary & Architectural Mandate

To allow the tennis platform to migrate gradually from SQLite to PostgreSQL without requiring coordinated client-side releases or downtime, the database layer provides high-performance **Compatibility Views**.

These views reconstruct legacy operational shapes directly from normalized canonical tables (`matches.matches`, `matches.match_participants`, `matches.match_results`, `statistics.match_player_statistics`, `markets.market_odds_ticks`, `predictions.*`), guaranteeing:
1. **100% Contract Backward-Compatibility:** Existing endpoints (`/api/web/matches`, `/api/webapp/predictions`, `/api/web/editorials/:idOrSlug`) query these views without modifying application DTO interfaces.
2. **Anti-Lookahead Integrity:** Winner/loser outcomes remain strictly isolated in `matches.match_results`; odds and pre-match features are projected symmetrically.
3. **Zero Modification to Application Runtime:** Application code in `src/` and `server/` remains untouched during this phase.

---

## 2. Compatibility Views Dictionary

### 2.1. `public.canonicalmatchesoperational` (and `public.canonical_matches_operational`)
- **Consumer Targets:** `GET /api/web/matches`, desktop analytical tools (`state football`).
- **Column Count:** 79 operational columns.
- **Key Columns:**
  - `canonical_match_id`: Stringified match UUID.
  - `match_date`, `scheduled_start_utc`, `actual_start_utc`.
  - `tour`, `tourney_name`, `tourney_year`, `surface`, `round_name`, `best_of`, `match_status`.
  - `winner_id`, `winner_name`, `loser_id`, `loser_name`.
  - `score`, `retirement_detail`, `is_retirement_or_wo`, `duration_minutes`.
  - `winner_rank`, `loser_rank`, `winner_seed`, `loser_seed`.
  - `w_odds_match`, `l_odds_match` (closing moneyline odds).
  - Serve and box score metrics: `w_ace`, `w_df`, `w_svpt`, `w_1stIn`, `w_1stWon`, `w_2ndWon`, `w_SvGms`, `w_bpSaved`, `w_bpFaced`, etc.
  - Usability indicators: `is_canonical_modeling_usable`, `is_backtest_safe`.

### 2.2. `public.playermatchesvalidated` (and `public.player_matches_validated`)
- **Consumer Targets:** Player analytical dossiers, H2H rollups, surface form indicators.
- **Structure:** Player-centric perspective (two rows emitted per match, one for each participant).
- **Key Columns:**
  - `pmi_id`: Deterministic hash integer.
  - `match_fingerprint`: Stringified match UUID.
  - `match_date`, `player_name`, `opponent_name`, `won` (1 or 0).
  - `completeness`, `player_rank`, `opponent_rank`, `surface_raw`, `surface_normalized`.
  - 12 Quarantine & Usability Booleans: `is_synthetic_source`, `is_missing_rank`, `is_outside_top100`, `is_bad_odds`, `is_one_sided_odds`, `is_no_surface`, `quarantine_flags`, `is_historical_usable`, `is_rank_usable`, `is_surface_feature_usable`, `is_raw_serve_feature_usable`, `is_backtest_usable`, `is_roi_usable`.

### 2.3. `public.goldmatchesreadyview` (and `public.gold_matches_ready_view`)
- **Consumer Targets:** Quantitative model backtesters and machine learning feature extractors.
- **Filter Invariant:** Strictly filters to `status = 'FINISHED'` and `is_retirement_or_wo IS FALSE`.
- **Key Columns:** `canonical_match_id`, `match_date`, `tour`, `tourney_name`, `surface`, `round_name`, `winner_name`, `loser_name`, `score`, `winner_odds`, `loser_odds`, `winner_rank`, `loser_rank`, `final_status = 'READY'`.

### 2.4. `predictions.published_predictions_view` (and `predictions.v_webapp_predictions`)
- **Consumer Targets:** `GET /api/webapp/predictions`.
- **Key Columns:** `id`, `fixture_id`, `tournament_name`, `round_name`, `surface`, `match_date`, `home_name`, `away_name`, `home_odds`, `away_odds`, `predicted_winner`, `win_probability`, `confidence`, `predicted_score`, `best_bet_selection`, `best_bet_market`, `best_bet_ev`, `best_bet_rationale`, `alt_bet_selection`, `alt_bet_market`, `key_factors`, `devils_advocate_risk`, `ai_summary`, `home_image`, `away_image`, `home_id`, `away_id`, `status`, `result_score`, `published_at`, `created_at`.

### 2.5. `predictions.match_editorials_view`
- **Consumer Targets:** `GET /api/web/editorials/:idOrSlug` & `/api/webapp/matches/:idOrSlug/editorial`.
- **Dual-JSON Strategy:** Provides both structured PostgreSQL `JSONB` native arrays and backward-compatible stringified `*_json` columns (`key_facts_json`, `data_bullets_json`, `tags_json`, `seo_metadata_json`, `key_stats_json`, `status_history_json`).
- **Title Alias:** Emits `title := headline` ensuring seamless client UI rendering.

---

## 3. Dependency & Execution Order

```
[db/postgres-schema-v1.sql]  (Creates 11 schemas, 28 tables, indexes, constraints)
           |
           v
  [Schema Validation]        (Verifies 9/9 acceptance quality gates)
           |
           v
[db/postgres-compatibility-views-v1.sql]  (Builds 9 compatibility views)
```

Compatibility views must be created strictly after canonical tables are instantiated. Running views against an incomplete schema is strictly prohibited.

---

## 4. Architectural Scope & Cutover Mandates

> [!IMPORTANT]
> - **Validation Scope:** Schema validated on local/staging PostgreSQL only; production runtime unchanged; SQLite untouched; cutover prohibited until Phase 10 parity.
> - **Contract Parity vs. Production Parity:** این فاز contract parity را ثابت می‌کند، نه production read parity را. production parity طبق برنامه در Phase 10 و با canary comparator سنجیده می‌شود. *(This phase validates contract parity, not live production read parity. Production parity is measured in Phase 10 via canary comparator).*
> - **No-Cutover Gate Enforced:** قبولی 10/10 به معنی آمادگی برای ادامه‌ی فاز 8 و 9 است، نه مجوز cutover. خود برنامه صریحاً NO-GO می‌دهد تا وقتی Phase 10 parity روی ترافیک واقعی تأیید نشده باشد. *(Passing gates signifies readiness to advance to Phase 8 and Phase 9, never authorization for cutover. The program enforces an absolute NO-GO until Phase 10 shadow/canary parity is confirmed).*
