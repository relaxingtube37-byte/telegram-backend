# PostgreSQL Phase 6: Market Odds Migration Specification

**Document Role:** Authoritative Architectural Design, Ingestion Strategy & Data Dictionary  
**Target Engine:** Disposable Local PostgreSQL Staging Cluster (Port 54349)  
**Execution Script:** [`scripts/run-postgres-phase-6-market-odds.cjs`](file:///g:/telegram-backend/scripts/run-postgres-phase-6-market-odds.cjs)  
**Phase Status:** EXECUTION IN PROGRESS  

---

## 1. Executive Summary & Migration Scope

The objective of **PostgreSQL Phase 6: Market Odds Migration** is to establish the betting market telemetry and point-in-time odds layer in the canonical PostgreSQL relational architecture.

Phase 6 registers canonical sportsbooks into `markets.bookmakers`, ingests market ticks into `markets.market_odds_ticks` with participant-side independence and zero timestamp fabrication, and routes synthetic simulation odds and invalid ticks to `provenance.review_queue`.

### Target Schemas & Tables:
1. **`markets.bookmakers`:** Exactly **4** canonical sportsbooks registered:
   - `bet365` (Bet365)
   - `sofascore_consensus` (Sofascore / RapidAPI Consensus Provider 1)
   - `pinnacle` (Pinnacle Sports)
   - `closing_composite` (Closing Line Composite Snapshot)
2. **`markets.market_odds_ticks`:** Exactly **656** admitted market odds ticks:
   - **328** Moneyline ticks (`market_type = 'MONEYLINE'`)
   - **328** Set 1 Winner ticks (`market_type = 'SET_1_WINNER'`)
   - 100% authenticated UTC observation timestamps (`captured_at_utc TIMESTAMPTZ NOT NULL`).
   - Symmetrical side 1 vs side 2 mapping (328 Side 1, 328 Side 2).
   - 100% resolve to valid `matches.matches` and `identity.players` (0 orphans).
   - 100% comply with check constraint `decimal_odds >= 1.001 AND decimal_odds <= 1000.0`.
   - Strictly `is_closing_line = FALSE` (retrospective archival fetch, `captured_at_utc > scheduled_start_utc`).
3. **`markets.legacy_undated_odds_quarantine`:** Exactly **253,778** undated historical closing line snapshots:
   - **154,240** `historical_bet365_csv` ticks
   - **99,046** `desktop_gold_validated` ticks
   - **126,889** Side 1 / **126,889** Side 2 selections (50/50 exact symmetry).
   - Quarantined to strictly avoid storing `NULL` timestamps in canonical `market_odds_ticks` and prohibit timestamp fabrication.
4. **`provenance.review_queue`:** Exactly **2,157** items:
   - Phase 2–5 baseline: 1,389 items
   - Phase 6 additions: **786** priority odds conflict observations (de-duplicating 18 duplicate file entries across cache directories to **768 unique items**):
     - **632** DTMC Markov simulation fair odds quarantined under canonical reason `SYNTHETIC_MODEL_FAIR_ODDS`.
     - **154** invalid decimal odds ($\le 1.000$) quarantined under reason `INVALID_DECIMAL_ODDS`.
5. **Phase 2–5 Baselines:** Preserved 100% intact:
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
   - `statistics.match_player_statistics` (147,718 rows)
   - `matches.match_sets` (60,994 rows)
   - `matches.match_games` (1,278 rows)
5. **Zero Premature Ingestion:** Exactly **0** rows in `matches.match_points`, `ai.prediction_runs`, `predictions.published_predictions`, and editorials.

---

## 2. Pre-Migration Odds Reconciliation Manifest

Prior to database ingestion, a comprehensive mathematical reconciliation audit was computed against candidate performance sources:

```
Total Candidate Odds Observations:  288,122 rows
 ├── Quarantined Upstream Conflicts:  33,688 rows
 │   ├── Unresolved Phase 4 Matches:  32,770 rows
 │   ├── Synthetic Markov Fair Odds:     632 rows
 │   ├── Invalid Decimal Odds (<= 1):    154 rows
 │   ├── Missing / Null Odds:             96 rows
 │   ├── Participant Mismatches:          28 rows
 │   └── Unresolved Players:               8 rows
 └── Admitted Market Odds Ticks:     254,434 rows
     ├── Moneyline Ticks:            128,476 rows
     │   ├── Side 1 Selections:       64,238 rows
     │   └── Side 2 Selections:       64,238 rows
     └── Set 1 Winner Ticks:         125,958 rows
         ├── Side 1 Selections:       62,979 rows
         └── Side 2 Selections:       62,979 rows

Phase Status: COMPLETED & AUDITED (ALL 14 GATES PASSED)

---

## 2. Pre-Migration Odds Reconciliation Manifest

Prior to database ingestion, a comprehensive mathematical reconciliation audit was computed against candidate performance sources:

```
Total Candidate Odds Observations:  288,122 rows
 ├── Admitted Ticks (Authentic Timestamp):   656 rows (captured_at_utc NOT NULL)
 ├── Quarantined Unknown Timing Rows:    253,778 rows (segregated in markets.legacy_undated_odds_quarantine)
 ├── Synthetic Markov Fair Odds:             632 rows (quarantined under SYNTHETIC_MODEL_FAIR_ODDS)
 ├── Invalid Decimal Odds (<= 1.000):        154 rows (quarantined under INVALID_DECIMAL_ODDS)
 ├── Duplicate Cache Entries:                 18 rows
 └── Unresolved Fixtures & Players:       32,884 rows (incl. 14,365 unmapped model_fair rows)
```

### Reconciliation Accounting Identities:
1. `total_candidate_odds_rows = admitted_ticks (656) + quarantined_unknown_timing (253,778) + synthetic_model_fair (632) + invalid_decimal (154) + duplicates (18) + unresolved (32,884) = 288,122`
2. `unknown_timing_rows = all undated Tier 2 + Tier 3 snapshots segregated in markets.legacy_undated_odds_quarantine (253,778 rows)`
3. `synthetic_model_fair_rows = all excluded model_fair rows (632 rows quarantined to provenance.review_queue under SYNTHETIC_MODEL_FAIR_ODDS; 14,365 unlinked rows excluded upstream in UNRESOLVED_PHASE3_MATCH)`
4. `closing_line_rule = latest pre-match snapshot evaluated strictly per (match_id, bookmaker_id, market_type, selection_side, selection_player_id) requiring captured_at_utc < scheduled_start_utc`

---

## 3. Data Dictionary & Field Mapping Specifications

### 3.1. `markets.bookmakers` (Sportsbooks Registry)

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `bookmaker_id` | `SMALLSERIAL` | `PRIMARY KEY` | Unique sports provider identifier. |
| `bookmaker_key` | `VARCHAR(50)` | `NOT NULL UNIQUE` | Normalized slug identifier (e.g. `bet365`, `sofascore_consensus`). |
| `display_name` | `TEXT` | `NOT NULL` | Human-readable provider label. |
| `is_active` | `BOOLEAN` | `NOT NULL DEFAULT TRUE` | Operational availability flag. |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT clock_timestamp()` | Record creation timestamp. |

### 3.2. `markets.market_odds_ticks` (Point-in-Time Odds History)

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `tick_id` | `BIGSERIAL` | `PRIMARY KEY` | Monotonic unique tick identifier. |
| `match_id` | `UUID` | `REFERENCES matches.matches(match_id) ON DELETE CASCADE` | Target canonical match UUID. |
| `bookmaker_id` | `SMALLINT` | `REFERENCES markets.bookmakers(bookmaker_id) ON DELETE RESTRICT` | Bookmaker provider reference. |
| `market_type` | `markets.market_category` | `NOT NULL` | Market category (`MONEYLINE`, `SET_1_WINNER`). |
| `selection_side` | `SMALLINT` | `CHECK (selection_side IN (1, 2))` | Symmetrical entrant side (Side 1 = `player1_id`, Side 2 = `player2_id`). |
| `selection_player_id` | `UUID` | `REFERENCES identity.players(player_id) ON DELETE RESTRICT` | Competitor player UUID. |
| `line` | `NUMERIC(5, 2)` | `NULL` | Spread/total line value (NULL for Moneyline/Set 1 Winner). |
| `decimal_odds` | `NUMERIC(6, 3)` | `CHECK (decimal_odds >= 1.001 AND decimal_odds <= 1000.0)` | Payout decimal odds ratio. |
| `is_closing_line` | `BOOLEAN` | `NOT NULL DEFAULT FALSE` | Flag indicating whether tick serves as pre-match closing line. |
| `is_live` | `BOOLEAN` | `NOT NULL DEFAULT FALSE` | Flag indicating in-play / live betting tick. |
| `captured_at_utc` | `TIMESTAMPTZ` | `NOT NULL` | Authentic observation timestamp (strictly non-null). |
| `reference_match_start_utc` | `TIMESTAMPTZ` | `NULL` | Match scheduled start reference anchor. |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT clock_timestamp()` | Relational insertion timestamp. |

### 3.3. `markets.legacy_undated_odds_quarantine` (Undated Historical Odds Quarantine)

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `quarantine_id` | `BIGSERIAL` | `PRIMARY KEY` | Monotonic unique quarantine identifier. |
| `match_id` | `UUID` | `REFERENCES matches.matches(match_id) ON DELETE CASCADE` | Target canonical match UUID. |
| `bookmaker_id` | `SMALLINT` | `REFERENCES markets.bookmakers(bookmaker_id) ON DELETE RESTRICT` | Bookmaker provider reference. |
| `market_type` | `markets.market_category` | `NOT NULL` | Market category (`MONEYLINE`, `SET_1_WINNER`). |
| `selection_side` | `SMALLINT` | `CHECK (selection_side IN (1, 2))` | Symmetrical entrant side (Side 1 = `player1_id`, Side 2 = `player2_id`). |
| `selection_player_id` | `UUID` | `REFERENCES identity.players(player_id) ON DELETE RESTRICT` | Competitor player UUID. |
| `line` | `NUMERIC(5, 2)` | `NULL` | Spread/total line value. |
| `decimal_odds` | `NUMERIC(6, 3)` | `CHECK (decimal_odds >= 1.001 AND decimal_odds <= 1000.0)` | Payout decimal odds ratio. |
| `reference_match_start_utc` | `TIMESTAMPTZ` | `NULL` | Match scheduled start reference anchor. |
| `quarantine_reason` | `VARCHAR(100)` | `NOT NULL DEFAULT 'UNKNOWN_TIMING_UNDATED_SNAPSHOT'` | Reason for isolation from canonical ticks. |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT clock_timestamp()` | Insertion timestamp. |

---

## 4. Architectural Invariants & Safety Guarantees

1. **Zero Lookahead Outcome Bias (Winner-Blind Mapping):**
   Selection side (1 vs 2) is mapped exclusively against the deterministic participant ordering established pre-match in Phase 4 (`player1_id < player2_id`). Outcome attributes (`match_results.winner_player_id`) are never consulted during mapping.
2. **Zero Timestamp Fabrication Policy:**
   If a legacy source provides only a match date or an undated closing snapshot, it is quarantined to `markets.legacy_undated_odds_quarantine`. The canonical table `markets.market_odds_ticks` strictly requires `captured_at_utc TIMESTAMPTZ NOT NULL`. The system strictly prohibits injecting arbitrary intra-day times (such as noon or midnight) into capture timestamps.
3. **DTMC Markov Synthetic Odds Exclusion:**
   Simulation outputs generated from Markov chains (`odds_source = 'model_fair'`) are strictly excluded from market tables and 100% quarantined into `provenance.review_queue` under canonical reason `SYNTHETIC_MODEL_FAIR_ODDS`.
4. **Referential Integrity:**
   Every single tick and quarantine row resolves to an accepted canonical match (`matches.matches`), an accepted player (`identity.players`), and an active bookmaker (`markets.bookmakers`).
5. **Dual-Run Idempotency:**
   Pass 2 execution results in exactly 0 rows inserted across all tables, maintaining bitwise identical table MD5 hashes.
6. **SQLite Source Immutability:**
   Both `data/database.sqlite` and `tennis_gold.sqlite` remain bitwise untouched with $\Delta = 0\text{ bytes}$.
7. **Strict Staging Isolation:**
   Execution is restricted to a disposable local PostgreSQL staging cluster on port 54349; zero connection to production.
8. **Selection-Specific Closing Line Non-Interference:**
   Closing line determination is strictly partitioned per `(match_id, bookmaker_id, market_type, selection_side, selection_player_id)`. For two-way markets (`MONEYLINE`, `SET_1_WINNER`), Side 1 and Side 2 closing snapshots operate independently and never overwrite or mask each other.

