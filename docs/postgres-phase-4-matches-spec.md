# PostgreSQL Phase 4: Match Migration Specification

**Document Role:** Authoritative Architectural Design, Ingestion Strategy & Data Dictionary  
**Target Engine:** Disposable Local PostgreSQL Staging Cluster (Port 54347)  
**Execution Script:** [`scripts/run-postgres-phase-4-matches.cjs`](file:///G:/telegram-backend/scripts/run-postgres-phase-4-matches.cjs)  
**Phase Status:** PHASE 4 COMPLETE (13/13 GATES PASS)

---

## 1. Executive Summary & Migration Scope

The objective of **PostgreSQL Phase 4: Match Migration** is to establish the core fixture, participant, and settled outcome relational layer in the canonical PostgreSQL schema (`matches` schema).

Phase 4 imports exactly **75,692** canonical matches, **151,384** symmetrically ordered participants, **75,690** settled match results, and routes **4** cross-tier conflict items into `provenance.review_queue`, while preserving all Phase 2 and Phase 3 records with 100% integrity, zero lookahead bias, and zero modification to authoritative SQLite databases.

### Target Schemas & Tables:
1. **`matches.matches`:** Exactly **75,692** canonical match fixtures:
   - **Tier 1 (`canonical_matches_v2`):** 7,499 high-authority fixtures ingested first.
   - **Tier 2 (Legacy Chronological):** 68,193 fixtures ingested in chronological batches (2021 through 2026).
2. **`matches.match_participants`:** Exactly **151,384** symmetric entrants:
   - Symmetrically ordered by natural primary key: `side 1` and `side 2` where `player1_id < player2_id`.
   - **Zero Lookahead Bias:** `is_winner IS NULL` by contract across all 151,384 participant rows.
3. **`matches.match_results`:** Exactly **75,690** post-match settled outcomes:
   - Winner and loser decoupled exclusively into `match_results` (`winner_player_id`, `loser_player_id`).
   - Authentic score strings, retirement details, and duration.
   - Exactly 2 scheduled matches remain unsettled without results.
4. **`provenance.review_queue`:** Exactly **1,228** items:
   - Phase 2 baseline: 1,223 items
   - Phase 3 identity collision: 1 item (`jovic i`)
   - Phase 4 match conflicts: 4 items (cross-tier winner/date discrepancies)
5. **Phase 2 & Phase 3 Baselines:** Preserved 100% intact:
   - `raw.source_evidence` (13,263 rows)
   - `provenance.source_match_links` (3,807 rows)
   - `provenance.field_provenance` (186 rows)
   - `identity.players` (1,765 rows)
   - `identity.player_aliases` (2,833 rows)
   - `identity.tournaments` (1,183 rows)
   - `identity.tournament_aliases` (1,376 rows)
   - `competition.tournament_editions` (3,466 rows)
6. **Zero Premature Ingestion:** Strictly **0** rows in sets, games, points, statistics, odds, predictions, and editorials.

---

## 2. Pre-Migration Reconciliation Manifest

Prior to database ingestion, a comprehensive mathematical reconciliation audit was computed against the operational baseline:

```
Operational Baseline View: 147,937 rows
 ├── Admitted Source Observations:    81,554 rows
 └── Quarantined Source Observations: 66,383 rows
     ──────────────────────────────────────────
     Total Reconciled Sum:           147,937 rows (Exact Delta = 0)

Admitted Source Observations:        81,554 rows
 ├── Cross-Tier Deduplicated:          5,856 rows
 └── Intra-Tier Deduplicated:              6 rows
     ──────────────────────────────────────────
     Total Deduplicated Rows:          5,862 rows
     Canonical Unique Matches:        75,692 rows (81,554 - 5,862)
```

### 2.1. Candidate Duplicate Groups
- **Cross-Tier Deduplication (5,856 rows):** Multi-source overlaps between Tier 1 (`canonical_matches_v2`), Tier 2 (`canonical_matches`), and Tier 3 (`historical_matches`).
- **Intra-Tier Deduplication (6 rows):** Duplicate fixture occurrences resolved via natural tournament-round-player fingerprint.

### 2.2. Unresolved Entity Quarantine Breakdown (66,383 rows)
- **Player-Level Quarantine (35,589 occurrences):**
  - `UNRESOLVED_LOSER`: 18,333 rows (lower-tier ITF / satellite players outside canonical registry)
  - `UNRESOLVED_WINNER`: 9,635 rows
  - `UNRESOLVED_BOTH_PLAYERS`: 7,593 rows
  - `IDENTICAL_PLAYERS`: 28 rows (parsing anomalies where player 1 = player 2)
- **Edition-Level Quarantine (30,794 occurrences):**
  - `UNRESOLVED_EDITION`: 25,956 rows (including 25,209 "Unknown Tournament" rows)
  - `QUALIFICATION_DRAWS`: 3,525 rows (preliminary qualification draws)
  - `EXHIBITION_OR_TEAM`: 1,167 rows (Hopman Cup, Laver Cup, exhibitions)
  - `SPECULATIVE_DRAW`: 89 rows
  - `NON_SINGLES_MATCH`: 57 rows

### 2.3. Conflicting Discrepancies Routed to `provenance.review_queue`
Exactly 4 matches exhibited cross-tier outcome or date divergence and were quarantined with status `ISOLATED_CONFLICT_REVIEW`:
1. `23975330-fa50-5ba2-bd02-b5f13b7e53e8`: Katie Volynets vs Tamara Zidansek (`VETO_WINNER_MISMATCH`)
2. `7e33a8fd-c6a3-5fc7-84dd-8d24afb69711`: Bai Z. vs Vidmanova D. (`VETO_WINNER_MISMATCH`)
3. `8b0e2916-0b54-5226-8cfa-db84ccf750fa`: De Minaur A. vs Huesler M. (`VETO_WINNER_MISMATCH`)
4. `ea002da5-64e0-53ef-88ba-7d2212b4c0c5`: Li Z. vs Wang X. (`VETO_WINNER_MISMATCH`)

---

## 3. Data Dictionary & Field Mapping Specifications

### 3.1. `matches.matches` (Core Fixture Registry)

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `match_id` | `UUID` | `PRIMARY KEY` | Deterministic UUIDv5 (`edition_id:round:p1_id:p2_id`). |
| `edition_id` | `UUID` | `NOT NULL REFERENCES competition.tournament_editions(edition_id)` | Foreign key to Phase 3 calendar tournament edition. |
| `scheduled_start_utc` | `TIMESTAMPTZ` | `NOT NULL` | Scheduled start time. |
| `actual_start_utc` | `TIMESTAMPTZ` | `NULL` | Actual match start time if recorded. |
| `round_name` | `VARCHAR(30)` | `NOT NULL` | Normalized round enum string (`F`, `SF`, `QF`, `R16`, `R32`, `R64`, `R128`, `RR`, `Q1`, `Q2`, `Q3`). |
| `match_num` | `SMALLINT` | `CHECK (match_num > 0)` | Draw match index if recorded. |
| `best_of` | `SMALLINT` | `NOT NULL CHECK (best_of IN (3, 5))` | 5 for ATP Grand Slams, 3 for all others. |
| `surface` | `competition.surface_type` | `NOT NULL` | Court surface (`Hard`, `Clay`, `Grass`, `Carpet`, `Unknown`). |
| `is_indoor` | `BOOLEAN` | `NOT NULL DEFAULT FALSE` | Indoor/outdoor indicator. |
| `status` | `matches.match_status_type` | `NOT NULL DEFAULT 'SCHEDULED'` | Match status (`FINISHED`, `RETIRED`, `WALKOVER`, `SCHEDULED`, `DEFAULT`). |
| `source_mask` | `INTEGER` | `NOT NULL DEFAULT 0` | Bitmask of contributing source providers. |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | Ingestion timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL` | Last update timestamp. |

---

### 3.2. `matches.match_participants` (Symmetric Entrant Layer)

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `match_id` | `UUID` | `NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE` | Foreign key to parent match. |
| `player_id` | `UUID` | `NOT NULL REFERENCES identity.players(player_id) ON DELETE RESTRICT` | Foreign key to canonical player. |
| `side` | `SMALLINT` | `NOT NULL CHECK (side IN (1, 2))` | Symmetrical entrant side: `side 1` for lower `player_id`, `side 2` for higher. |
| `seed` | `SMALLINT` | `CHECK (seed BETWEEN 1 AND 128)` | Tournament seeding. |
| `entry_status` | `VARCHAR(10)` | `NULL` | Entry status (`WC`, `Q`, `LL`, `PR`, `SE`, `ALT`). |
| `pre_match_rank` | `INTEGER` | `CHECK (pre_match_rank BETWEEN 1 AND 5000)` | ATP/WTA ranking prior to fixture. |
| `pre_match_rank_points` | `INTEGER` | `CHECK (pre_match_rank_points >= 0)` | ATP/WTA ranking points prior to fixture. |
| `is_winner` | `BOOLEAN` | `NULL` | **STRICTLY NULL BY ARCHITECTURAL CONTRACT.** Zero lookahead leakage. |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | Ingestion timestamp. |

- **Natural Primary Key:** `PRIMARY KEY (match_id, side)`.
- **Unique Constraint:** `CONSTRAINT uq_matches_participants_match_player UNIQUE (match_id, player_id)`.

---

### 3.3. `matches.match_results` (Settled Outcome Layer)

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `match_id` | `UUID` | `PRIMARY KEY REFERENCES matches.matches(match_id) ON DELETE CASCADE` | 1-to-1 link to settled match. |
| `winner_player_id` | `UUID` | `NOT NULL REFERENCES identity.players(player_id) ON DELETE RESTRICT` | Canonical winner UUID. |
| `loser_player_id` | `UUID` | `NOT NULL REFERENCES identity.players(player_id) ON DELETE RESTRICT` | Canonical loser UUID. |
| `score_string` | `TEXT` | `NOT NULL` | Standard set score sequence (e.g. "6-4 3-6 7-6(5)"). |
| `retirement_detail` | `TEXT` | `NULL` | Retirement reason (`RET`, `W/O`, `DEF`). |
| `is_retirement_or_wo` | `BOOLEAN` | `NOT NULL DEFAULT FALSE` | Boolean retirement/walkover indicator. |
| `duration_minutes` | `SMALLINT` | `CHECK (duration_minutes BETWEEN 1 AND 900)` | Match duration in minutes. |
| `settled_at` | `TIMESTAMPTZ` | `NOT NULL` | Settlement timestamp. |

- **Distinct Competitors Check:** `CONSTRAINT chk_matches_results_distinct_players CHECK (winner_player_id <> loser_player_id)`.

---

## 4. Ingestion Order & Chronological Batching

To ensure strict compliance with tier priority and temporal sequence:
1. **Tier 1 Batch:** `canonical_matches_v2` (7,499 matches, 14,998 participants, 7,499 results).
2. **Tier 2 Batches (Chronological by Year):**
   - Season 2021: 8,945 matches, 17,890 participants, 8,945 results.
   - Season 2022: 10,475 matches, 20,950 participants, 10,475 results.
   - Season 2023: 12,057 matches, 24,114 participants, 12,057 results.
   - Season 2024: 12,428 matches, 24,856 participants, 12,428 results.
   - Season 2025: 13,221 matches, 26,442 participants, 13,220 results (1 scheduled match unsettled).
   - Season 2026: 11,067 matches, 22,134 participants, 11,066 results (1 scheduled match unsettled).
3. **Conflicts Batch:** 4 items routed to `provenance.review_queue`.

---

## 5. Quality Acceptance Gates (13/13)

| Gate | Criterion | Target Value | Verification Invariant |
| :-: | :--- | :---: | :--- |
| **G1** | Canonical Matches Ingested | **75,692** | Exactly 75,692 matches in `matches.matches`. |
| **G2** | Tier 1 Priority & Order | **7,499** | `canonical_matches_v2` ingested first, then chronological legacy batches. |
| **G3** | Symmetric Participants Ingested | **151,384** | Exactly 2 participants per match (side 1 & side 2). |
| **G4** | Settled Results Ingested | **75,690** | Exactly 75,690 outcomes (2 scheduled matches unsettled). |
| **G5** | Zero Lookahead Bias | **100% NULL** | `is_winner IS NULL` on 100% of rows in `matches.match_participants`. |
| **G6** | Foreign Key Integrity | **0 Orphans** | 0 orphan matches, 0 orphan participants, 0 orphan results. |
| **G7** | Conflicts Routed to Queue | **1,228** | 4 match conflicts routed to `review_queue` (1,224 + 4 = 1,228). |
| **G8** | Phase 2 & 3 Invariance | **100% Intact** | All Phase 2 provenance and Phase 3 identity rows unchanged. |
| **G9** | Zero Premature Ingestion | **0 Rows** | Sets, games, points, statistics, odds, predictions strictly 0 rows. |
| **G10** | Dual-Run Idempotency | **+0 Rows** | Pass 2 inserts exactly 0 rows across all tables (pure no-op). |
| **G11** | Cryptographic Determinism | **Bitwise Identical** | Table content MD5 digests match 100% between Pass 1 and Pass 2. |
| **G12** | Zero SQLite Mutation | **$\Delta = 0$ B** | `database.sqlite` and `tennis_gold.sqlite` 100% bitwise intact. |
| **G13** | Zero Production Contact | **Port 54347** | Strictly isolated to disposable local PostgreSQL staging cluster. |
