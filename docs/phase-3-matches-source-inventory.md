# Phase 3 Source Inventory: Matches, Participants & Results (2021–2026)

**Branch:** `staging/phase-1-ingestion-spec`  
**Execution Mode:** READ-ONLY / DRAFT-ONLY  
**Target PostgreSQL Entities:**  
- `matches.matches` (in `postgresSchemaV1.sql`)  
- `matches.match_participants` (in `postgresSchemaV1.sql`)  
- `matches.match_results` (in `postgresSchemaV1.sql`)  
**Scope:** Professional Singles Tennis Matches (ATP, WTA, Challenger) for Calendar Years 2021 through 2026  
**Parent Dependencies:**  
- Frozen Phase 1 Identity Registries (`commit 19660b1`): `identity.players` (1,765 players) and `identity.player_aliases` (2,833 aliases)  
- Frozen Phase 2 Tournament Editions (`commit 720efb8`): `competition.tournament_editions` (3,466 verified editions)  

---

## 1. Executive Source Matrix

| # | Source Name | Table / File & Location | Total Rows | 2021–2026 Scope | Key Entity & Mapping Fields | Primary Role & Tier | Read-Only Access Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **S1** | `canonical_matches_v2` | SQLite Table (`data/database.sqlite`) | 7,505 | 7,505 (100%) | `canonical_match_id`, `canonical_tourney_id`, `match_date`, `round_name`, `player_low_id`, `player_high_id`, `match_status`, `winner_canonical_id`, `loser_canonical_id`, `canonical_score`, `source_mask`, `evidence_count` | **Tier 1 Multi-Source Consensus Truth** (Vetted canonical player keys, normalized scores, pre-linked tournaments) | Verified (`{ readonly: true, fileMustExist: true }`) |
| **S2** | `canonical_matches` (v1) | SQLite Table (`data/database.sqlite`) | 140,432 | 140,432 (100%) | `canonical_match_id`, `canonical_match_date`, `canonical_start_utc`, `tour`, `tourney_name`, `tourney_level`, `surface`, `round_name`, `canonical_winner_name`, `canonical_loser_name`, `score`, `source_presence`, `source_a_historical_match_id`, `source_b_rapid_event_id` | **Tier 2 Operational Backbone** (Cross-source linkage backbone connecting Source A and Source B) | Verified (`{ readonly: true, fileMustExist: true }`) |
| **S3** | `historical_matches` | SQLite Table (`data/database.sqlite`) | 115,223 | 115,223 (100%) | `id`, `tour`, `tourney_id`, `tourney_name`, `surface`, `match_date`, `match_num`, `round_name`, `winner_id`, `winner_name`, `winner_rank`, `winner_rank_points`, `winner_seed`, `winner_entry`, `loser_id`, `loser_name`, `loser_rank`, `loser_rank_points`, `loser_seed`, `loser_entry`, `score`, `best_of`, `minutes` | **Tier 2 Rich Metadata & Entrant Telemetry** (Bracket numbers, match duration, entrant seeds, entries, ATP/WTA rankings) | Verified (`{ readonly: true, fileMustExist: true }`) |
| **S4** | `gold_matches_validated` | SQLite Table (`data/database.sqlite`) | 57,977 | 57,977 (2024–2026) | `rapid_event_id`, `canonical_match_id`, `match_date`, `start_utc`, `tour`, `tourney_name`, `surface`, `round_name`, `winner_name`, `loser_name`, `score`, `winner_rank`, `loser_rank`, `winner_odds`, `loser_odds`, `is_retirement_or_wo`, `final_status` | **Tier 2 High-Precision Scheduling & Score Recovery** (Exact `start_utc` timestamps, real scores for Source B only matches) | Verified (`{ readonly: true, fileMustExist: true }`) |

---

## 2. Granular Field-Level Source Analysis

### 2.1 Tier 1 Consensus Source: `canonical_matches_v2` (Source S1)
* **File:** `G:/telegram-backend/data/database.sqlite`
* **Table:** `canonical_matches_v2`
* **Row Count:** 7,505 rows (spanning 2021 through 2025)
* **Coverage:** 100% resolve to Phase 2 `competition.tournament_editions` (7,505 / 7,505) and 100% resolve to Phase 1 canonical player pairs (7,505 / 7,505).
* **Detailed Column Definitions:**
  * `canonical_match_id` (TEXT, PK): Unique multi-source deterministic hash string (e.g. `cm_2024-01-14_ctwtaaustralianopenmelbourneaus_cp_lesia_tsurenko_cp_lucia_bronzetti`).
  * `match_date` (TEXT, ISO `YYYY-MM-DD`): Vetted consensus match date.
  * `tour` (TEXT): `'ATP'` or `'WTA'`.
  * `canonical_tourney_id` (TEXT, FK): Direct link to `canonical_tournaments(canonical_tourney_id)` and Phase 2 parent edition.
  * `surface` (TEXT): Normalized uppercase surface (`'HARD'`, `'CLAY'`, `'GRASS'`, `'CARPET'`).
  * `round_name` (TEXT): Normalized bracket round (`'R128'`, `'R64'`, `'R32'`, `'R16'`, `'QF'`, `'SF'`, `'F'`, `'RR'`, `'Q1'`, `'Q2'`).
  * `player_low_id` (TEXT): Lexicographically smaller canonical player slug (`cp_*`), establishing symmetric identity.
  * `player_high_id` (TEXT): Lexicographically larger canonical player slug (`cp_*`).
  * `match_status` (TEXT): Status string (`'FINISHED'`, `'RETIRED'`, `'WALKOVER'`).
  * `winner_canonical_id` (TEXT): Winner canonical player slug (`cp_*`).
  * `loser_canonical_id` (TEXT): Loser canonical player slug (`cp_*`).
  * `canonical_score` (TEXT): Multi-source consensus score representation (e.g. `'3-6,7-5,6-3'`).
  * `source_mask` (INTEGER): Bitmask of verified sources (e.g. `1` = Sackmann, `2` = RapidAPI/PBP, `3` = Unified Consensus).
  * `evidence_count` (INTEGER): Number of corroborating physical evidence rows (1 or 2).
  * `version` (INTEGER): Linker schema iteration (v2).
* **Role in Phase 3:** Authoritative Tier 1 master record. Where present, its symmetric player pairing, round, status, and consensus score take absolute precedence.

---

### 2.2 Tier 2 Operational Backbone: `canonical_matches` (Source S2)
* **File:** `G:/telegram-backend/data/database.sqlite`
* **Table:** `canonical_matches`
* **Row Count:** 140,432 rows (100% within 2021–2026)
* **Source Breakdown:**
  * `BOTH_SOURCES`: 33,266 rows (linked to both `historical_matches` and `gold_matches_validated`)
  * `SOURCE_A_ONLY`: 81,957 rows (linked to `historical_matches`)
  * `SOURCE_B_ONLY`: 25,209 rows (linked to `gold_matches_validated`)
* **Detailed Column Definitions:**
  * `id` (INTEGER, PK): Primary key in legacy SQLite.
  * `canonical_match_id` (TEXT): Legacy canonical match identifier.
  * `canonical_match_date` (TEXT, ISO `YYYY-MM-DD`): Unified match date.
  * `canonical_start_utc` (TEXT NULL): Legacy start time column (consistently `NULL` in legacy store).
  * `tour` (TEXT): Tour code (`'ATP'`, `'WTA'`).
  * `tourney_name` (TEXT): Raw tournament string.
  * `tourney_level` (TEXT): Level code (`'G'`, `'M'`, `'A'`, `'B'`, `'C'`, `'D'`).
  * `surface` (TEXT): Surface string (`'Hard'`, `'Clay'`, `'Grass'`, `'Carpet'`).
  * `round_name` (TEXT): Round name in various notations (`'1/16-finals'`, `'R32'`, `'Quarter-finals'`, `'Qualifier'`, or `NULL` for 25,209 Source B rows).
  * `canonical_winner_name` (TEXT): Full name of winner.
  * `canonical_loser_name` (TEXT): Full name of loser.
  * `score` (TEXT): Score representation. *Crucial Observation:* In 25,209 `SOURCE_B_ONLY` rows, `canonical_matches.score` is empty (`''`), but the authentic score is 100% preserved in `gold_matches_validated.score` (e.g. `'6-7 6-4 10-2'`).
  * `minutes` (INTEGER NULL): Match duration in minutes.
  * `source_a_historical_match_id` (INTEGER NULL): Foreign key linking to `historical_matches.id`.
  * `source_b_rapid_event_id` (INTEGER NULL): Foreign key linking to `gold_matches_validated.rapid_event_id`.
  * `source_presence` (TEXT): Presence enum (`'BOTH_SOURCES'`, `'SOURCE_A_ONLY'`, `'SOURCE_B_ONLY'`).
  * `is_retirement_or_wo` (INTEGER): Flag `1` if retired, walkover, or defaulted; `0` otherwise.
  * `is_speculative_draw` (INTEGER): Flag `1` if future unplayed match; `0` otherwise.
  * `is_non_singles` (INTEGER): Flag `1` for doubles or team competitions; `0` otherwise.
  * `canonical_status_reason` (TEXT): Reason code for exclusions or approval.
* **Role in Phase 3:** Primary bridge enabling unified joins between Source A (`historical_matches`) and Source B (`gold_matches_validated`).

---

### 2.3 Tier 2 Entrant Telemetry & Durations: `historical_matches` (Source S3)
* **File:** `G:/telegram-backend/data/database.sqlite`
* **Table:** `historical_matches`
* **Row Count:** 115,223 rows (100% within 2021–2026)
* **Detailed Column Definitions:**
  * `id` (INTEGER, PK): Referenced by `canonical_matches.source_a_historical_match_id`.
  * `tour` (TEXT): Tour code (`'ATP'`, `'WTA'`).
  * `tourney_id` (TEXT): Annual tournament code (e.g. `'2021-0096'`).
  * `tourney_name` (TEXT): Tournament title.
  * `match_date` (TEXT, ISO `YYYY-MM-DD`): Match date.
  * `match_num` (INTEGER NULL): Bracket position / match order number.
  * `round_name` (TEXT): Round name (`'Qualifier'`, `'1/16-finals'`, `'Quarter-finals'`, `'Final'`, etc.).
  * `winner_id` (INTEGER NULL): Sackmann player ID for winner.
  * `winner_name` (TEXT): Winner full name.
  * `winner_rank` (INTEGER NULL): ATP/WTA singles ranking at event start.
  * `winner_rank_points` (INTEGER NULL): Ranking points at event start.
  * `winner_seed` (INTEGER NULL): Tournament seed number (sanitizing legacy `0` to `NULL`).
  * `winner_entry` (TEXT NULL): Entrant status code (`'WC'`, `'Q'`, `'LL'`, `'PR'`, `'SE'`, or empty string sanitized to `NULL`).
  * `loser_id` (INTEGER NULL): Sackmann player ID for loser.
  * `loser_name` (TEXT): Loser full name.
  * `loser_rank` (INTEGER NULL): ATP/WTA singles ranking at event start.
  * `loser_rank_points` (INTEGER NULL): Ranking points at event start.
  * `loser_seed` (INTEGER NULL): Tournament seed number (sanitizing legacy `0` to `NULL`).
  * `loser_entry` (TEXT NULL): Entrant status code.
  * `score` (TEXT): Raw score string including retirement tokens (e.g. `'6-4,0-0 Ret''d'`, `'W/O'`).
  * `best_of` (INTEGER): Match format (`3` or `5`).
  * `minutes` (INTEGER NULL): Official match duration in minutes.
* **Role in Phase 3:** Supplies pre-match participant metadata (`seed`, `entry_status`, `pre_match_rank`, `pre_match_rank_points`) and match format (`best_of`, `match_num`, `duration_minutes`).

---

### 2.4 Tier 2 High-Precision Scheduling & Telemetry: `gold_matches_validated` (Source S4)
* **File:** `G:/telegram-backend/data/database.sqlite` (also mirrored in `G:/state football/data/tennis_gold.sqlite`)
* **Table:** `gold_matches_validated`
* **Row Count:** 57,977 rows (2024–2026)
* **Detailed Column Definitions:**
  * `rapid_event_id` (INTEGER, PK): Referenced by `canonical_matches.source_b_rapid_event_id`.
  * `start_utc` (TEXT): Authentic ISO 8601 UTC timestamp of match start (e.g. `'2024-01-01T02:35:00.000Z'`). Available on 100% of rows (57,977 / 57,977).
  * `tourney_name` (TEXT): Raw vendor tournament string.
  * `surface_raw` (TEXT): Vendor surface description (e.g. `'Hardcourt outdoor'`, `'Red clay indoor'`).
  * `surface` (TEXT): Upper-cased surface enum (`'HARD'`, `'CLAY'`, `'GRASS'`).
  * `round_name` (TEXT): Standardized round name (`'Round of 32'`, `'Quarterfinals'`, `'Final'`).
  * `winner_name` (TEXT): Abbreviated or full winner name (e.g. `'Ruud C.'`).
  * `loser_name` (TEXT): Abbreviated or full loser name (e.g. `'Coric B.'`).
  * `score` (TEXT): Authentic set-by-set score string. *Crucial:* Provides score for 25,209 Source B matches where `canonical_matches.score` is blank.
  * `is_retirement_or_wo` (INTEGER): Flag `1` if retired/walkover; `0` otherwise.
  * `final_status` (TEXT): Validation status (`'READY'`, `'DOUBLES'`, `'RETIREMENT_OR_WALKOVER'`, etc.).
* **Role in Phase 3:** Supplies verified, authentic `start_utc` timestamps (populating `actual_start_utc` and high-precision `scheduled_start_utc`) and complete scores for RapidAPI matches.

---

## 3. Conflict, Ambiguity & Quarantine Classifications

Candidate match records that cannot satisfy all Phase 3 invariant rules are segregated into `phase-3-match-conflicts.jsonl` with structured diagnostic reasons:

| Quarantine Code | Diagnostic Trigger Condition | Action Taken |
| :--- | :--- | :--- |
| `UNRESOLVED_EDITION` | Match tournament/year cannot be resolved to any approved Phase 2 `edition_id`. | Quarantined. Match discarded from accepted set. |
| `QUALIFICATION_DRAWS` | Tournament title or match belongs to a qualifying event quarantined in Phase 2. | Quarantined per frozen Phase 2 qualification event rule. |
| `EXHIBITION_OR_TEAM` | Non-tour exhibition match or Davis/ATP Cup team competition. | Quarantined per non-tour competition rule. |
| `UNRESOLVED_PLAYER_1` | Entrant 1 name or slug cannot be resolved to any Phase 1 canonical player UUID. | Quarantined. Preserves 100% Phase 1 identity purity. |
| `UNRESOLVED_PLAYER_2` | Entrant 2 name or slug cannot be resolved to any Phase 1 canonical player UUID. | Quarantined. Preserves 100% Phase 1 identity purity. |
| `UNRESOLVED_BOTH_PLAYERS` | Neither player could be resolved to Phase 1 canonical identities. | Quarantined. |
| `IDENTICAL_PLAYERS` | Anomaly where player 1 and player 2 resolve to the same canonical UUID (`player1_id == player2_id`). | Quarantined. Violates distinct player constraint. |
| `NON_SINGLES_MATCH` | Match is flagged as doubles (`is_non_singles = 1` or `final_status = 'DOUBLES'`). | Quarantined. Singles-only scope enforcement. |
| `SPECULATIVE_DRAW` | Unplayed future speculative draw fixture without verified score or participants. | Quarantined. Zero-fabrication enforcement. |
| `TEMPORAL_OUT_OF_BOUNDS` | Match date falls outside `2021-01-01` to `2026-12-31`. | Quarantined. Strictly outside mandated scope. |
| `DUPLICATE_FIXTURE_CONFLICT` | Conflicting score or winner reported across sources for the same unique fixture identity. | Quarantined for manual review. |

---

## 4. Read-Only Safety Guarantees

1. **Zero Database Modifications:** SQLite connections are opened exclusively with `{ readonly: true, fileMustExist: true }`.
2. **Pre/Post File Size Audit:** Source database byte sizes on `data/database.sqlite` are checked before and after execution to guarantee zero physical mutation (Gate G9).
3. **Offline Isolation:** Zero connection attempts to remote or local PostgreSQL instances.
