# Phase 5: Odds & Market History Source Inventory (Corrected Architecture)
**Scope:** Tennis Betting Market Telemetry (2021 – 2026)  
**Authoritative Sources:** SQLite Stores & Local JSON Responses  
**Audit Date:** 2026-09-10  

---

## 1. Overview & Source Ecosystem

This document audits all sources of betting odds and sportsbook market data available within the repository ecosystem. Ingestion into `markets.market_odds_ticks` requires separating authentic, verifiable market ticks from retrospective closing snapshots and synthetic simulation artifacts.

---

## 2. Source Inventory & Detailed Metrics

### Source A: Desktop Gold Database (`tennis_gold.sqlite`)
- **Location:** `G:/state football/data/tennis_gold.sqlite`
- **Total Records:** 58,131 matches in `gold_matches_validated` and `gold_match_telemetry`.
- **Columns Audited:**
  - `winner_odds` (REAL): Decimal odds for the participant listed under `winner_name`.
  - `loser_odds` (REAL): Decimal odds for the participant listed under `loser_name`.
  - `has_odds` (INTEGER 0/1): Binary indicator of odds presence.
  - `odds_source` (TEXT): Classification of the odds origin (`'bookmaker'` vs `'model_fair'`).
  - `w_odds_set1`, `l_odds_set1` (REAL in `gold_match_telemetry`): Set 1 winner odds.
- **Breakdown:**
  - `odds_source = 'bookmaker'` & `has_odds = 1`: **31,685 matches** (Authentic closing bookmaker odds from RapidAPI / Sofascore Provider 1).
  - `odds_source = 'model_fair'` & `has_odds = 1`: **14,997 matches** (Synthetic DTMC Markov simulation fair odds, range 1.63 – 1.92).
  - `has_odds = 0`: **11,449 matches** (No odds available; 152 contain stale/degenerate values).
- **Timestamp Quality:** Undated Closing Snapshot. No intra-day quote timestamp is preserved in the table schema.
- **Timestamp Policy:** `captured_at_utc = NULL`. The match's scheduled start time is preserved strictly in `reference_match_start_utc` as a reference anchor.

### Source B: Backend Canonical Matches (`database.sqlite`)
- **Location:** `data/database.sqlite` -> `canonical_matches`
- **Total Records:** 140,432 matches.
- **Columns Audited:**
  - `data_source_odds` (TEXT): Provenance identifier (`'historical_bet365_csv'` vs `'none'`).
  - `w_odds_match`, `l_odds_match` (REAL): Decimal match moneyline odds for participants in `canonical_winner_name` and `canonical_loser_name`.
  - `w_odds_set1`, `l_odds_set1` (REAL): Decimal Set 1 winner moneyline odds.
- **Breakdown:**
  - `data_source_odds = 'historical_bet365_csv'`: **99,446 matches** with match odds; **97,162 matches** with Set 1 odds.
  - `data_source_odds = 'none'`: **40,986 matches** (929 rows have degenerate values $\le 1.01$).
- **Timestamp Quality:** Undated Legacy Snapshot. Collected from Tennis-Data.co.uk historical match archives.
- **Timestamp Policy:** `captured_at_utc = NULL`. `reference_match_start_utc` records match start date.

### Source C: Local Cached Odds Responses (JSON)
- **Locations:**
  - `G:/state football/scratch/cache/frozen_week_2026_08_11/` (~900 files)
  - `G:/state football/scratch/cache/pilot_2024_01_01/` (97 files)
  - `G:/state football/scratch/cache/tennis_history_2024_2026/` (596 files)
- **Total Files:** 822 unique `odds_<rapid_event_id>.json` files.
- **Payload Structure:**
  ```json
  {
    "eventId": 11925844,
    "endpoint": "/api/tennis/event/11925844/provider/1/winning-odds",
    "requestTimestamp": "2026-08-24T18:04:27.113Z",
    "responseTimestamp": "2026-08-24T18:04:27.616Z",
    "rawPayload": {
      "home": { "fractionalValue": "10/3", "expected": 23, "actual": 17 },
      "away": { "fractionalValue": "11/50", "expected": 82, "actual": 82 }
    },
    "parsedOdds": {
      "homeOdds": 4.333,
      "awayOdds": 1.22,
      "providerId": 1,
      "marketName": "Full time"
    }
  }
  ```
- **Timestamp Quality:**
  - 656 files contain explicit `requestTimestamp` / `responseTimestamp`.
  - Because these requests were executed in August 2026 for January 2024 matches, they represent **Retrospective Archival Batches** ($T_{\text{request}} > T_{\text{start}}$).
  - Classified as `RETROSPECTIVE_ARCHIVAL_FETCH` with `_is_backtest_safe = false` to prevent lookahead contamination.

---

## 3. Participant-Side Independence Invariant

### Elimination of Outcome Leakage
In legacy source databases, participants and odds are organized under winner and loser columns.  
**Critical Rule:** Selection side assignment (`selection_side = 1` vs `2`) must be derived **purely from participant player identities** matching `match.player1_id` and `match.player2_id`.
- If participant $A$ resolves to `match.player1_id`, participant $A$'s odds are assigned to `selection_side = 1`.
- If participant $B$ resolves to `match.player2_id`, participant $B$'s odds are assigned to `selection_side = 2`.
- The match result (`match_results.winner_player_id`) is NEVER consulted during extraction or assignment.

---

## 4. Synthetic Model Odds Poisoning Risk (Model Rule 10)

In `tennis_gold.sqlite`, 14,997 records contain `odds_source = 'model_fair'`. These values were generated by an internal DTMC Markov chain model to simulate fair odds when sportsbook lines were missing.
- **Decision:** Synthetic fair odds are strictly excluded from `markets.market_odds_ticks`.
- Conflating simulated model probabilities with real sportsbook liquidity distorts market efficiency studies and CLV calculations.
- All 14,997 rows are diverted to `phase-5-odds-conflicts.jsonl` with reason `SYNTHETIC_MODEL_ODDS_REJECTED`.

---

## 5. Trustworthiness & Hierarchy Matrix

| Tier | Source | Bookmaker Key | Primary Use Case | Timestamp State | Backtest Safe? |
| :---: | :--- | :--- | :--- | :---: | :---: |
| **1** | Local JSON (`odds_*.json`) | `sofascore_consensus` | Point-in-time / Retrospective fetch | Real Timestamp | Only if $T_{\text{capture}} \le T_{\text{start}}$ |
| **2** | Desktop Gold DB | `bet365` | Verified sportsbook closing line | `NULL` | Closing Benchmark Only (`false`) |
| **3** | Historical CSV | `bet365` | Historical baseline closing line | `NULL` | Closing Benchmark Only (`false`) |
