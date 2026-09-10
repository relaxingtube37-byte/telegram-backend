# Phase 5: Odds & Market History Ingestion Specification (Corrected Architecture)
**Target Schemas:** `markets.bookmakers`, `markets.market_odds_ticks`  
**Pipeline Mode:** Offline / Dry-Run Draft Only  
**Temporal Window:** 2021 – 2026  
**Status:** SPECIFICATION & DRY-RUN APPROVED (CORRECTED)  

---

## 1. Executive Summary & Architectural Scope

Phase 5 defines the deterministic extraction, normalization, and temporal classification of tennis betting market telemetry for ingestion into PostgreSQL `markets.bookmakers` and `markets.market_odds_ticks`.

Following the frozen outputs of Phase 1 (Canonical Entities), Phase 2 (Tournament Editions), and Phase 3 (Canonical Matches, Participants & Results), Phase 5 enforces two strict architectural pillars:

1. **Participant-Side Independence (Zero Outcome Leakage):** Selection sides (`selection_side` 1 vs 2) are derived **exclusively from frozen Phase 3 participant ordering** (`player1_id` vs `player2_id`). Under no circumstances is the match outcome (`match_results.winner_player_id`) used to assign selection sides. The outcome dataset is restricted strictly to post-match settlement audit verification.
2. **True Capture Timestamp Fidelity (Lookahead-Free Backtesting):** `captured_at_utc` represents the exact timestamp of source observation. For undated closing snapshots where only the match date or scheduled start exists, **`captured_at_utc` is set to `NULL`** and the match start time is preserved in an independent `reference_match_start_utc` field. Substituting scheduled start for capture time is strictly prohibited.

---

## 2. Source Data Inventory & Quality Classification

| Tier | Source | Entity Count | Market Types | Timestamp Quality | Backtest Safe? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Tier 1** | Local Cached JSON (`scratch/cache/.../odds_*.json`) | 822 files | Moneyline (`Full time`) | High (`requestTimestamp` / `responseTimestamp` available) | Verified against match start; flagged as retrospective (`false`) if post-start |
| **Tier 2** | Desktop Gold DB (`gold_matches_validated` + `gold_match_telemetry`) | 58,131 rows | Moneyline (`winner_odds`, `loser_odds`), Set 1 (`w_odds_set1`, `l_odds_set1`) | Undated Snapshot (`captured_at_utc = NULL`) | Closing Line Only (`is_closing_line = TRUE`, `is_backtest_safe = FALSE`) |
| **Tier 3** | Backend DB (`canonical_matches` / `historical_matches`) | 140,432 rows | Moneyline (`w_odds_match`, `l_odds_match`), Set 1 (`w_odds_set1`, `l_odds_set1`) | Undated Snapshot (`captured_at_utc = NULL`) | Closing Line Only (`is_closing_line = TRUE`, `is_backtest_safe = FALSE`) |

### Quarantined Telemetry:
- **`model_fair` DTMC Fair Odds (14,997 rows in Gold DB):** Synthetic simulation odds generated via Markov chains ($1.63 - 1.92$) when bookmaker odds were missing. Excluded from canonical market ticks.
- **Degenerate / Broken Odds:** Records where decimal odds $\le 1.000$ (violates PostgreSQL check constraint).
- **Unlinked Events:** Source records whose tournament edition, players, or match date cannot be resolved to a frozen Phase 3 match fixture.

---

## 3. Strict Safety Invariants

1. **Zero Outcome Dependency:** Participant side assignment uses player canonical UUIDs matching `match.player1_id` and `match.player2_id`. Winner/loser columns from results are ignored during extraction.
2. **Zero Timestamp Fabrication:** Scheduled start time is NEVER injected into `captured_at_utc`. Undated snapshots have `captured_at_utc = NULL`.
3. **Zero PostgreSQL Connection:** 100% offline dry-run execution.
4. **Zero SQLite Mutation:** SQLite source files (`database.sqlite`, `tennis_gold.sqlite`) are opened exclusively with `{ readonly: true, fileMustExist: true }`. Zero writes, zero schema modifications, byte size validated before and after execution.
5. **Zero Network Calls:** No external HTTP, HTTPS, or API calls.
6. **Fail-Closed Execution:** Mandates `--dry-run` flag; immediately halts with exit code 1 if invoked without it.

---

## 4. Invariant Quality Gates (G1 – G10)

The pipeline enforces 10 automated invariant quality gates:

| Gate | Name | Rule / Specification | Threshold |
| :--- | :--- | :--- | :--- |
| **G1** | **Parent Match Resolution** | Every emitted tick must resolve to a valid Phase 3 `match_id`. | 100% PASS (0 orphaned ticks) |
| **G2** | **Canonical Bookmaker Key** | `bookmaker_id` must resolve to an active entry in `markets.bookmakers`. | 100% Valid |
| **G3** | **Symmetrical Participant Invariant** | `selection_side` derived purely from participant IDs; 50/50 win ratio verified in post-match audit. | 100% PASS |
| **G4** | **Positive Decimal Odds** | All odds must satisfy `decimal_odds > 1.000` (PostgreSQL DDL constraint). | 100% PASS (0 invalid odds) |
| **G5** | **Zero Timestamp Fabrication** | All undated closing snapshots have `captured_at_utc = null`; match start preserved separately. | 100% Verified |
| **G6** | **Lookahead Anti-Leakage** | Zero ticks post-dating match start are marked as `_is_backtest_safe = true`. | 100% PASS (0 leakage rows) |
| **G7** | **Synthetic Model Exclusion** | 100% of DTMC Markov fair odds (`odds_source = 'model_fair'`) must be quarantined. | 100% Quarantined |
| **G8** | **Comprehensive Quarantine** | All unresolved, broken, or unlinked records emitted to conflicts JSONL with diagnostic codes. | 100% Emitted |
| **G9** | **Zero SQLite Mutation** | Source SQLite database file sizes must have exactly 0 byte delta before and after dry-run. | 0 Bytes Changed |
| **G10** | **Fail-Closed Guard** | Execution without `--dry-run` must halt immediately with exit code 1. | 100% Verified |

---

## 5. Downstream Target Schema Alignment

```sql
-- Table: markets.bookmakers
CREATE TABLE IF NOT EXISTS markets.bookmakers (
  bookmaker_id SMALLSERIAL PRIMARY KEY,
  bookmaker_key VARCHAR(50) NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Table: markets.market_odds_ticks
CREATE TABLE IF NOT EXISTS markets.market_odds_ticks (
  tick_id BIGSERIAL PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  bookmaker_id SMALLINT NOT NULL REFERENCES markets.bookmakers(bookmaker_id) ON DELETE RESTRICT,
  market_type markets.market_category NOT NULL,
  selection_side SMALLINT NOT NULL CHECK (selection_side IN (1, 2)),
  line NUMERIC(5, 2) NULL,
  decimal_odds NUMERIC(7, 3) NOT NULL CHECK (decimal_odds > 1.000),
  is_closing_line BOOLEAN NOT NULL DEFAULT FALSE,
  is_live BOOLEAN NOT NULL DEFAULT FALSE,
  captured_at_utc TIMESTAMPTZ NULL,                     -- Authentic observation timestamp (NULL for undated snapshots)
  reference_match_start_utc TIMESTAMPTZ NOT NULL,       -- Scheduled match start reference anchor
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
```
