# PostgreSQL Phase 5: Statistics, Sets, Games & PBP Migration Specification

**Document Role:** Authoritative Architectural Design, Ingestion Strategy & Data Dictionary  
**Target Engine:** Disposable Local PostgreSQL Staging Cluster (Port 54348)  
**Execution Script:** [`scripts/run-postgres-phase-5-statistics-pbp.cjs`](file:///G:/telegram-backend/scripts/run-postgres-phase-5-statistics-pbp.cjs)  
**Phase Status:** PHASE 5 COMPLETE (14/14 GATES PASS)

---

## 1. Executive Summary & Migration Scope

The objective of **PostgreSQL Phase 5: Statistics, Sets, Games and PBP Migration** is to establish the detailed performance telemetry and match progression layer in the canonical PostgreSQL relational architecture.

Phase 5 imports box scores into `statistics.match_player_statistics`, set progression into `matches.match_sets`, and game summaries into `matches.match_games`, while keeping raw Point-by-Point JSON payloads immutable in separate storage and isolating point-level records (`matches.match_points`) for a dedicated telemetry stage.

### Target Schemas & Tables:
1. **`statistics.match_player_statistics`:** Exactly **147,718** admitted player match statistic records:
   - 100% resolve to valid `matches.matches` and `identity.players`.
   - **161** out-of-range negative statistic rows ($second\_return\_won < 0$) identified, rejected, and quarantined to `provenance.review_queue`.
   - **96,368** placeholder serve records clearly flagged with `is_placeholder_serve = true` (authentic NULLs preserved, zero synthetic zeros substituted).
2. **`matches.match_sets`:** Exactly **60,994** set rows:
   - Symmetrically mapped to `side1_games` and `side2_games` matching Phase 4 participant order.
   - All check constraints (`set_number BETWEEN 1 AND 5`, `side1_games >= 0`, `side2_games >= 0`) verified.
3. **`matches.match_games`:** Exactly **1,278** game summaries:
   - Server player and winner player resolved to canonical players.
   - Verified check constraints (`game_number BETWEEN 1 AND 50`, `deuce_count >= 0`).
4. **`provenance.review_queue`:** Exactly **1,389** items:
   - Phase 2–4 baseline: 1,228 items
   - Phase 5 additions: **161** quarantined negative statistic rows under status `'ISOLATED_CONFLICT_REVIEW'`.
5. **Phase 2, 3 & 4 Baselines:** Preserved 100% intact:
   - `raw.source_evidence` (13,263 rows)
   - `provenance.source_match_links` (3,807 rows)
   - `provenance.field_provenance` (186 rows)
   - `identity.players` (1,765 rows)
   - `identity.player_aliases` (2,833 rows)
   - `identity.tournaments` (1,183 rows)
   - `identity.tournament_aliases` (1,376 rows)
   - `competition.tournament_editions` (3,466 rows)
   - `matches.matches` (75,692 rows)
   - `matches.match_participants` (151,384 rows)
   - `matches.match_results` (75,690 rows)
6. **Zero Premature Ingestion:** Exactly **0** rows in `matches.match_points`, `markets.market_odds_ticks`, `ai.prediction_runs`, `predictions.published_predictions`, and editorials.

---

## 2. Pre-Migration Statistics Reconciliation Manifest

Prior to database ingestion, a comprehensive mathematical reconciliation audit was computed against candidate performance sources:

```
Total Source Stat Observations:     173,354 rows
 ├── Quarantined Upstream Unmapped:   74,405 rows
 └── Candidate Player Stat Rows:     147,879 rows

Candidate Player Stat Rows:         147,879 rows
 ├── Quarantined Negative Stats:         161 rows (second_return_won < 0)
 └── Admitted Player Stat Rows:      147,718 rows
     ├── Placeholder Serve Records:   96,368 rows (is_placeholder_serve = true)
     └── Authentic Telemetry Stats:   51,350 rows (is_placeholder_serve = false)

Candidate Match Sets:                60,994 rows ──► Admitted: 60,994 (0 violations)
Candidate Match Games:                1,278 rows ──► Admitted:  1,278 (0 violations)
Deferred Match Points:                6,992 rows ──► Isolated for Point Telemetry Stage
```

### 2.1. Domain Constraint Quarantine: 161 Negative Stat Rows
- **Violating Field:** `second_return_won < 0` (values ranging from $-1$ to $-15$ resulting from raw arithmetic discrepancies in legacy data sources).
- **PostgreSQL Constraint:** `second_return_won SMALLINT NOT NULL DEFAULT 0 CHECK (second_return_won >= 0)`.
- **Handling:** Rather than coercing negative numbers to fabricated zeros, all 161 violating rows were quarantined and routed to `provenance.review_queue` with status `'ISOLATED_CONFLICT_REVIEW'` and veto triggers `['NEGATIVE_VALUE_VIOLATION', 'OUT_OF_RANGE_STATISTIC']`.

### 2.2. Derived PBP Coverage & Game Summaries
- **Admitted PBP Match Bundles:** 49 matches.
- **Derived Game Summaries:** 1,278 games with full server, winner, break-of-serve, point sequence, and deuce counts.
- **Raw PBP Payloads:** Kept immutable in object storage / raw evidence, adhering to architectural separation of massive telemetry payloads from structured PostgreSQL tables.

---

## 3. Data Dictionary & Field Mapping Specifications

### 3.1. `statistics.match_player_statistics` (Box Scores)

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `match_id` | `UUID` | `REFERENCES matches.matches(match_id) ON DELETE CASCADE` | Target canonical match UUID. |
| `player_id` | `UUID` | `REFERENCES identity.players(player_id) ON DELETE RESTRICT` | Competitor player UUID. |
| `aces` | `SMALLINT` | `CHECK (aces >= 0)` | Total service aces. |
| `double_faults` | `SMALLINT` | `CHECK (double_faults >= 0)` | Total double faults. |
| `svpt` | `SMALLINT` | `CHECK (svpt >= 0)` | Total serve points played. |
| `first_in` | `SMALLINT` | `CHECK (first_in >= 0)` | First serves landed in court. |
| `first_won` | `SMALLINT` | `CHECK (first_won >= 0)` | Points won on first serve. |
| `second_won` | `SMALLINT` | `CHECK (second_won >= 0)` | Points won on second serve. |
| `sv_gms` | `SMALLINT` | `CHECK (sv_gms >= 0)` | Service games played. |
| `bp_saved` | `SMALLINT` | `CHECK (bp_saved >= 0)` | Break points saved. |
| `bp_faced` | `SMALLINT` | `CHECK (bp_faced >= 0)` | Break points faced. |
| `first_return_won` | `SMALLINT` | `CHECK (first_return_won >= 0)` | Return points won on opponent first serve. |
| `second_return_won`| `SMALLINT` | `CHECK (second_return_won >= 0)`| Return points won on opponent second serve. |
| `bp_converted` | `SMALLINT` | `CHECK (bp_converted >= 0)` | Break points converted. |
| `bp_opportunities` | `SMALLINT` | `CHECK (bp_opportunities >= 0)` | Break point opportunities. |
| `total_points_won` | `SMALLINT` | `CHECK (total_points_won >= 0)` | Total match points won. |
| `is_placeholder_serve`| `BOOLEAN` | `NOT NULL DEFAULT FALSE` | Flag indicating legacy estimated or placeholder serve stats. |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | Ingestion timestamp. |

- **Natural Primary Key:** `PRIMARY KEY (match_id, player_id)`.
- **Relational Check:** `CONSTRAINT chk_statistics_serve_pct CHECK (first_in <= svpt AND first_won <= first_in AND bp_saved <= bp_faced)`.

---

### 3.2. `matches.match_sets` (Set Scores)

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `match_id` | `UUID` | `REFERENCES matches.matches(match_id) ON DELETE CASCADE` | Match UUID. |
| `set_number` | `SMALLINT` | `CHECK (set_number BETWEEN 1 AND 5)` | Sequential set index. |
| `side1_games` | `SMALLINT` | `CHECK (side1_games >= 0)` | Games won by entrant on side 1. |
| `side2_games` | `SMALLINT` | `CHECK (side2_games >= 0)` | Games won by entrant on side 2. |
| `tiebreak_score` | `TEXT` | `NULL` | Tiebreak score string if applicable. |
| `duration_seconds` | `INTEGER` | `CHECK (duration_seconds BETWEEN 1 AND 14400)` | Set duration in seconds. |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | Ingestion timestamp. |

- **Natural Primary Key:** `PRIMARY KEY (match_id, set_number)`.

---

### 3.3. `matches.match_games` (Game Summaries)

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `match_id` | `UUID` | `REFERENCES matches.matches(match_id) ON DELETE CASCADE` | Match UUID. |
| `set_number` | `SMALLINT` | `CHECK (set_number BETWEEN 1 AND 5)` | Set index. |
| `game_number` | `SMALLINT` | `CHECK (game_number BETWEEN 1 AND 50)` | Sequential game index. |
| `server_player_id` | `UUID` | `REFERENCES identity.players(player_id) ON DELETE RESTRICT` | Server player UUID. |
| `winner_player_id` | `UUID` | `REFERENCES identity.players(player_id) ON DELETE RESTRICT` | Game winner player UUID. |
| `is_break_of_serve`| `BOOLEAN` | `NOT NULL DEFAULT FALSE` | Break of serve flag. |
| `point_sequence` | `TEXT` | `NOT NULL` | Point-by-point binary sequence (e.g. "1222112"). |
| `deuce_count` | `SMALLINT` | `CHECK (deuce_count >= 0)` | Number of deuces. |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | Ingestion timestamp. |

- **Natural Primary Key:** `PRIMARY KEY (match_id, set_number, game_number)`.

---

## 4. Quality Acceptance Gates (14/14)

| Gate | Criterion | Target Value | Verification Details |
| :-: | :--- | :---: | :--- |
| **G1** | Player Statistics Ingested | **147,718** | Exactly 147,718 valid stat rows in `statistics.match_player_statistics`. |
| **G2** | Negative Statistics Quarantined | **161** | 161 negative stat rows routed to review_queue; 0 negative values in DB. |
| **G3** | Match Sets Ingested | **60,994** | Exactly 60,994 rows in `matches.match_sets` with verified set bounds. |
| **G4** | Match Games Ingested | **1,278** | Exactly 1,278 game summaries in `matches.match_games`. |
| **G5** | Foreign Key Integrity | **0 Orphans** | 0 orphan statistics, 0 orphan sets, 0 orphan games. |
| **G6** | Check Constraint Compliance | **100% Compliant** | Zero violations of `chk_statistics_serve_pct` or game checks. |
| **G7** | Review Queue Accounting | **1,389** | 1,228 baseline + 161 negative stat items = 1,389. |
| **G8** | Phase 2, 3 & 4 Baseline Invariance | **100% Intact** | All Phase 2 provenance, Phase 3 identity, and Phase 4 match rows intact. |
| **G9** | Zero Premature Ingestion | **0 Rows** | `match_points`, odds, predictions, editorials strictly 0 rows. |
| **G10** | Dual-Run Idempotency | **+0 Rows** | Pass 2 inserts exactly 0 rows across all tables (pure no-op). |
| **G11** | Cryptographic Determinism | **Bitwise Match** | MD5 content digests identical between Pass 1 and Pass 2. |
| **G12** | Zero SQLite Mutation | **$\Delta = 0$ B** | `database.sqlite` and `tennis_gold.sqlite` 100% bitwise intact. |
| **G13** | Zero Production Connection | **Port 54348** | Strictly isolated to disposable local PostgreSQL staging cluster. |
| **G14** | Derived PBP Metrics Isolated | **Compliant** | Raw PBP payloads kept immutable in storage; points table isolated. |
