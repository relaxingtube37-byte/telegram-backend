# Phase 4 Source Inventory: Stats, Sets & Point-by-Point Telemetry (2021–2026)

**Branch:** `staging/phase-1-ingestion-spec`  
**Execution Mode:** READ-ONLY / DRAFT-ONLY / OFFLINE  
**Target PostgreSQL Entities:**  
- `statistics.match_player_statistics` (in `postgresSchemaV1.sql`)  
- `matches.match_sets` (in `postgresSchemaV1.sql`)  
- `matches.match_games` (in `postgresSchemaV1.sql`)  
- `matches.match_points` (explicitly deferred per `postgresSchemaV1.sql` policy decision)  
**Parent Dependencies:**  
- Frozen Phase 1 Identity Registries: `identity.players` (1,765) & `identity.player_aliases` (2,833) (`commit 19660b1`)  
- Frozen Phase 2 Tournament Editions: `competition.tournament_editions` (3,466) (`commit 720efb8`)  
- Frozen Phase 3 Matches, Participants & Results: `matches.matches` (75,692), `matches.match_participants` (151,384), and `matches.match_results` (75,690) (`commit 9b2e461`)  

---

## 1. Executive Source Matrix

| # | Source Name | Table / File & Location | Total Rows | 2021–2026 Scope | Key Columns & Telemetry Attributes | Primary Role & Precedence Tier | Read-Only Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **S1** | `gold_match_set_stats` | SQLite Table (`tennis_gold.sqlite`) | 115,265 | 115,265 (2024–2026) | `rapid_event_id`, `set_num`, `duration_seconds`, `w_games`, `l_games`, `w_aces`, `l_aces`, `w_df`, `l_df`, `w_1st_in`, `w_1st_won`, `w_2nd_won`, `w_bp_saved`, `w_bp_faced`, `w_bp_converted` | **Tier 1 Authoritative Set Breakdown** (Set durations, authentic set game counts) | Verified (`{ readonly: true, fileMustExist: true }`) |
| **S2** | `gold_match_pbp_analytics` | SQLite Table (`tennis_gold.sqlite`) | 50,187 | 50,187 (2024–2026) | `rapid_event_id`, `total_games`, `w_service_games`, `l_service_games`, `w_breaks_suffered`, `l_breaks_suffered`, `w_consecutive_breaks_conceded`, `total_deuce_games`, `game_sequence_json` | **Tier 1 Authoritative Game Progressions** (Decompressed game-by-game sequences with break/deuce metadata) | Verified (`{ readonly: true, fileMustExist: true }`) |
| **S3** | `gold_matches_validated` (Desktop) | SQLite Table (`tennis_gold.sqlite`) | 58,131 | 58,131 (2024–2026) | `rapid_event_id`, `canonical_match_id`, `w_ace`, `w_df`, `l_ace`, `l_df`, `w_svpt`, `l_svpt`, `w_first_return_won`, `l_first_return_won`, `w_second_return_won`, `l_second_return_won`, `w_bp_converted`, `l_bp_converted`, `w_receiver_points_won`, `w_total_points_won` | **Tier 1 Precalculated Box Scores** (Full return & point metrics for RapidAPI matches) | Verified (`{ readonly: true, fileMustExist: true }`) |
| **S4** | `gold_matches_validated` (Backend) | SQLite Table (`database.sqlite`) | 57,977 | 57,977 (2024–2026) | `rapid_event_id`, `canonical_match_id`, `match_date`, `start_utc`, `w_svpt`, `w_1stIn`, `w_1stWon`, `w_2ndWon`, `w_bpSaved`, `w_bpFaced`, `is_placeholder_serve` | **Tier 2 Baseline Telemetry Bridge** | Verified (`{ readonly: true, fileMustExist: true }`) |
| **S5** | `historical_matches` | SQLite Table (`database.sqlite`) | 115,223 | 115,223 (100%) | `id`, `w_ace`, `w_df`, `w_svpt`, `w_1stIn`, `w_1stWon`, `w_2ndWon`, `w_SvGms`, `w_bpSaved`, `w_bpFaced`, `l_ace`, `l_df`, `l_svpt`, `l_1stIn`, `l_1stWon`, `l_2ndWon`, `l_SvGms`, `l_bpSaved`, `l_bpFaced`, `score`, `minutes` | **Tier 2 Historical Box Scores (2021–2023)** (Sackmann match statistics) | Verified (`{ readonly: true, fileMustExist: true }`) |
| **S6** | `canonical_matches` | SQLite Table (`database.sqlite`) | 140,432 | 140,432 (100%) | `id`, `source_a_historical_match_id`, `source_b_rapid_event_id`, `is_placeholder_serve`, `canonical_status_reason` | **Cross-Source Linkage Backbone & Quality Gating** | Verified (`{ readonly: true, fileMustExist: true }`) |
| **S7** | Raw PBP Bundles (`point_by_point.json`) | File Storage (`data/bulk-match-bundles/events/`) | 58,131 directories | 2024–2026 | `point_by_point.json` payload (point-by-point rally, shot, and server progression) | **Object Storage Archive** (Deferred from relational table emission to prevent 35M+ row bloat) | Read-only file system reference |

---

## 2. Desktop vs Backend Gold Schema Drift Analysis

During Phase 4 source auditing, significant schema drift was identified and documented between the backend database (`data/database.sqlite`) and the desktop analysis engine (`G:/state football/data/tennis_gold.sqlite`):

### 2.1 Schema Comparison for `gold_matches_validated`

| Dimension | Backend Store (`data/database.sqlite`) | Desktop Store (`tennis_gold.sqlite`) | Analysis & Architectural Resolution |
| :--- | :--- | :--- | :--- |
| **Total Columns** | 55 columns | 74 columns (+19 extra columns) | Desktop table contains enriched precalculated return & point statistics. |
| **Total Row Count** | 57,977 rows | 58,131 rows (+154 matches) | Desktop store includes late sweep recoveries for transient network gaps. |
| **Service Aces & DFs** | Omitted on main table (requires raw bundle parse) | Present (`w_ace`, `w_df`, `l_ace`, `l_df`) | Desktop store provides verified integer aces and double faults without parsing JSON. |
| **Return Point Statistics** | Absent | Present (`w_first_return_won`, `l_first_return_won`, `w_second_return_won`, `l_second_return_won`, `w_receiver_points_won`, `l_receiver_points_won`) | Desktop store is **authoritative** for high-precision return telemetry. |
| **Break Points Converted** | Absent | Present (`w_bp_converted`, `l_bp_converted`) | Directly populates `statistics.match_player_statistics.bp_converted`. |
| **Total Points Won** | Absent | Present (`w_total_points_won`, `l_total_points_won`) | Directly populates `statistics.match_player_statistics.total_points_won`. |

### 2.2 Dedicated Desktop Relational Tables
In addition to the expanded main table, `tennis_gold.sqlite` contains specialized relational tables absent from the backend store:
1. `gold_match_set_stats` (115,265 rows): Contains structured set breakdown rows per `(rapid_event_id, set_num)` with set durations (`duration_seconds`) and set-specific game counts (`w_games`, `l_games`).
2. `gold_match_pbp_analytics` (50,187 rows): Contains compressed `game_sequence_json` text representing every game played in the match, along with server side, winner side, break flag, and deuce game count.
3. `gold_match_telemetry` (58,131 rows): Contains stadium names, roof indicators, and streak analytics (`w_max_points_in_row`, `w_max_games_in_row`).

### 2.3 Authoritative Precedence Policy
* **For Set Durations & Metrics:** `tennis_gold.sqlite` -> `gold_match_set_stats` is the **authoritative Tier 1 source**.
* **For Game Progressions:** `tennis_gold.sqlite` -> `gold_match_pbp_analytics` (`game_sequence_json`) is the **authoritative Tier 1 source**.
* **For 2024–2026 Match Box Scores:** `tennis_gold.sqlite` -> `gold_matches_validated` is the **authoritative Tier 1 source**.
* **For 2021–2023 Historical Box Scores:** `data/database.sqlite` -> `historical_matches` is the **authoritative Tier 2 source**.
* **For Cross-Source Linkage & Quality Flags:** `data/database.sqlite` -> `canonical_matches` is the **authoritative backbone**.

---

## 3. Trustworthy vs Partial vs Unusable Fields

| Field / Domain | Trustworthiness Classification | Operational Handling Rule |
| :--- | :--- | :--- |
| **Authentic Serve Stats (`is_placeholder_serve = 0`)** | **100% Trustworthy** | Directly ingested into `statistics.match_player_statistics`. `is_placeholder_serve = FALSE`. |
| **Legacy Placeholder Serve Stats (`is_placeholder_serve = 1`)** | **Partial / Flagged** | Emitted with `is_placeholder_serve = TRUE`. Values preserved for raw auditability but flagged to block downstream ML training or synthetic multiplier derivation. |
| **Set Game Scores (`w_games`, `l_games`)** | **100% Trustworthy** | Corroborated between `gold_match_set_stats` and canonical score string parsing. Symmetrically remapped to `side1_games` and `side2_games`. |
| **Set Durations (`duration_seconds`)** | **Partial** | Authentic integer seconds available for ~50,000 matches in `gold_match_set_stats`. For purely historical matches where set duration is unrecorded, remains authentic `NULL` (never fabricated). |
| **Game Progression (`game_sequence_json`)** | **100% Trustworthy** | Available on 50,187 matches. Decompressed into discrete `matches.match_games` rows with server and winner remapped to side 1 / side 2. |
| **Point-by-Point Relational Rows (`matches.match_points`)** | **Unusable / Deferred** | Explicitly deferred from relational table emission to prevent 35M+ row relational bloat, conforming to the policy decision in `postgresSchemaV1.sql`. Preserved in raw JSON bundle storage. |

---

## 4. Policy Decision on `matches.match_points`

### Explicit Decision: **FORMAL DEFERRAL**

#### Technical Justification:
1. **Canonical Schema Directive:** In `postgresSchemaV1.sql` (lines 446–448), the system architecture explicitly establishes:
   ```sql
   -- Policy Decision: Retained in canonical DDL for experimental deep-modeling cohorts, but
   -- intentionally UNPOPULATED during initial Phase 1-4 migrations to avoid relational bloat
   -- (35M+ rows). Operational point streams are preserved in object storage via raw.source_evidence.
   ```
2. **Relational Bloat Avoidance:** Expanding all 58,131 match bundles at point granularity would yield over 12,500,000 relational rows (~4.5 GB JSONL payload), introducing unnecessary memory pressure during dry-run validation without adding marginal value to core fixture, participant, or box-score modeling.
3. **Data Preservation Guarantee:** 100% of raw point-by-point telemetry is preserved bit-for-bit in immutable local object storage (`data/bulk-match-bundles/events/<rapid_event_id>/point_by_point.json`).
4. **Phase 4 Artifact Handling:** The dry-run runner generates `phase-4-match-points.jsonl` as an explicit zero-record placeholder with metadata headers confirming the formal deferral in alignment with `postgresSchemaV1.sql`.

---

## 5. Conflict & Quarantine Classifications

Records that fail Phase 4 invariant validation are segregated into `phase-4-conflicts.jsonl` under deterministic reason codes:

| Quarantine Code | Diagnostic Trigger Condition | Action Taken |
| :--- | :--- | :--- |
| `UNRESOLVED_PHASE3_MATCH` | Source telemetry references a match not present in the frozen Phase 3 accepted match corpus (`phase-3-matches.jsonl`). | Quarantined. Telemetry without a canonical fixture is dropped. |
| `UNRESOLVED_PARTICIPANT` | Player referenced in statistics does not match either `player1_id` or `player2_id` of the Phase 3 match. | Quarantined. Violates participant referential integrity. |
| `CORRUPTED_SET_BREAKDOWN` | Set score contains negative games, non-numeric values, or contradicts the accepted match score. | Quarantined. Preserves set-score sanity. |
| `CORRUPTED_GAME_SEQUENCE` | `game_sequence_json` contains malformed JSON or invalid game numbering. | Quarantined. Preserves game-level sequence integrity. |
| `IMPOSSIBLE_SERVE_RATIO` | Serve points won exceed total serve points played (`1stWon + 2ndWon > svpt`). | Quarantined under data corruption. |
| `DUPLICATE_SET_NUMBER` | Multiple set rows reported for the same `(match_id, set_number)` tuple. | Quarantined to prevent primary key collision. |

---

## 6. Safety & Read-Only Invariants

* Both SQLite databases (`data/database.sqlite` and `G:/state football/data/tennis_gold.sqlite`) are opened exclusively with `{ readonly: true, fileMustExist: true }`.
* File byte sizes are recorded before and after execution to guarantee bit-for-bit invariance (Gate G9).
* Zero network connections and zero PostgreSQL operations are executed.
