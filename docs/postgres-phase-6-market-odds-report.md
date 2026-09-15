# PostgreSQL Phase 6: Market Odds Migration & Comprehensive Audit Report

**Document Role:** Authoritative Migration Verification, Quality Gate Audit, and Contradiction Resolution Report  
**Audit Execution Timestamp:** 2026-09-11T01:33:00.000Z  
**Target Environment:** Isolated Disposable Local PostgreSQL Staging Cluster (Port 54349)  
**Execution Script:** [`scripts/run-postgres-phase-6-market-odds.cjs`](file:///g:/telegram-backend/scripts/run-postgres-phase-6-market-odds.cjs)  
**Reconciliation Manifest:** [`scratch/postgres-phase-6-market-odds/odds-reconciliation-manifest.json`](file:///g:/telegram-backend/scratch/postgres-phase-6-market-odds/odds-reconciliation-manifest.json)  
**Validation Report:** [`scratch/postgres-phase-6-market-odds/validation-report.md`](file:///g:/telegram-backend/scratch/postgres-phase-6-market-odds/validation-report.md)  

### Final Audit Verdict:
**`PASS — Canonical and quarantine integrity gates passed.`**  
> [!WARNING]
> **Conditional hold — Pre-match closing-line coverage is zero because all admitted timestamped records were retrieved after scheduled start. No verified closing-line dataset is available from Phase 6.**

---

## 1. Gate Crosswalk (Original Plan vs Remediated Audit Gate Alignment)

To maintain an unambiguous audit trail between the initial implementation plan, the migration runner, and this official audit report, the following crosswalk specifies the exact mapping and scope of each quality gate:

| Original Plan Gate | Remediated Audit Gate | Gate Title & Scope | Alignment Rationale & Verification Scope |
| :-: | :-: | :--- | :--- |
| **G1** | **G1** | **Parent Match Resolution** | 100% of admitted ticks resolve to canonical matches (`matches.matches`). Quarantined rows are independently classified by resolution status and are not claimed as resolved unless an explicit parent match exists. |
| **G2** | **G2** | **Canonical Bookmaker Key** | Exactly 4 active sportsbooks registered in `markets.bookmakers` (0 invalid bookmaker IDs). |
| **G3** | **G3** | **Decimal Odds Range Compliance** | 100% of admitted `market_odds_ticks` satisfy $1.001 \le \text{decimal\_odds} \le 1000.0$. Invalid candidates (154 rows) are excluded and accounted for separately under `INVALID_DECIMAL_ODDS`. |
| **G4** | **G4** | **Authentic Observation Timestamp Fidelity** | Decoupled: `captured_at_utc TIMESTAMPTZ NOT NULL` strictly enforced on `markets.market_odds_ticks`. Exactly 0 undated rows in canonical ticks; 100% of 656 ticks have valid UTC timestamps. |
| **G5** | **G5** | **Lookahead Anti-Leakage & Pre-Match Validation** | Decoupled: Anti-leakage verified (`is_closing_line = FALSE` across all 656 retrospective ticks). Verdict: **`PASS for anti-fabrication and no-lookahead enforcement. PRE-MATCH_CLOSING_LINE_COVERAGE = 0.`** |
| **G7** | **G6** | **Symmetrical Selection Side Invariant** | Participant selection mapping (Side 1 vs Side 2) is strictly winner-blind. Verified across settled matches to exactly 50/50 balance (328/328 ticks, 126,889/126,889 quarantine). |
| **G9** | **G7** | **Synthetic Model Fair Odds Rejection** | Complete rejection of simulated DTMC Markov fair odds (`model_fair_admitted = 0`). Side-by-side reconciliation of the 632 vs 14,997 cohort. |
| **G10** | **G8** | **Phase 2–5 Baseline Invariance** | Upstream tables 100% intact: Phase 2 (13,263 evidence), Phase 3 (1,765 players, 3,466 editions), Phase 4 (75,692 matches), Phase 5 (147,718 statistics, 60,994 sets, 1,278 games). |
| **G11** | **G9** | **Zero Premature Ingestion** | Strictly 0 rows in `matches.match_points`, `ai.prediction_runs`, and published predictions. |
| **G12** | **G10** | **Dual-Run Idempotency (Pass 2 No-Op)** | Pass 2 re-execution results in exactly 0 rows inserted across all tables (100% idempotent no-op). |
| *(Audit Invariant)* | **G11** | **Cryptographic Determinism & Hash Invariance** | Table MD5 hashes for bookmakers, ticks, quarantine, and review queue are bitwise identical across passes. |
| **G13** | **G12** | **Zero SQLite Mutation** | Source databases bitwise untouched (`database.sqlite` and `tennis_gold.sqlite` $\Delta = 0\text{ bytes}$). |
| **G14** | **G13** | **Zero Production Connection** | Execution strictly restricted to local disposable PostgreSQL staging cluster on port 54349. |
| **G8** | **G14** | **Review Queue Accounting** | Exactly 2,157 items in `provenance.review_queue` (1,389 P2–5 baseline + 768 unique Phase 6 conflict items). |

---

## 2. Invariant Quality Acceptance Gates Scorecard (G1 – G14)

All 14 quality acceptance gates were verified through dual-run staging execution:

| Gate | Criterion | Status | Verified Staging Metric |
| :-: | :--- | :---: | :--- |
| **G1** | **Parent Match Resolution** | ✅ PASS | 100% of admitted ticks resolve to canonical matches; quarantined rows are independently classified by resolution status and are not claimed as resolved unless an explicit parent match exists (0 orphan ticks). |
| **G2** | **Canonical Bookmaker Key** | ✅ PASS | Exactly 4 active sportsbooks registered in `markets.bookmakers` (0 invalid bookmaker IDs). |
| **G3** | **Decimal Odds Check Compliance** | ✅ PASS | 100% of admitted `market_odds_ticks` satisfy $1.001 \le \text{decimal\_odds} \le 1000.0$. Invalid candidates (154 rows) are excluded and accounted for separately under `INVALID_DECIMAL_ODDS`. |
| **G4** | **Authentic Observation Timestamp Fidelity** | ✅ PASS | Exactly 0 undated rows in canonical `markets.market_odds_ticks`. 100% of 656 admitted ticks have authentic NOT NULL UTC timestamp. |
| **G5** | **Lookahead Anti-Leakage & Pre-Match Validation** | ✅ PASS* | **`PASS for anti-fabrication and no-lookahead enforcement. PRE-MATCH_CLOSING_LINE_COVERAGE = 0.`** (Zero closing lines fabricated from retrospective fetches). |
| **G6** | **Symmetrical Selection Side Invariant** | ✅ PASS | 50/50 selection symmetry verified (328 side 1 / 328 side 2 in ticks; 126,889 side 1 / 126,889 side 2 in quarantine). Zero outcome bias. |
| **G7** | **Synthetic Model Fair Odds Rejection** | ✅ PASS | `model_fair_total = 14,997` \| `model_fair_matched_to_phase4 = 632` \| `model_fair_unresolved_before_phase6 = 14,365` \| `model_fair_admitted_to_market_odds_ticks = 0`. 100% of candidate Markov odds quarantined under `SYNTHETIC_MODEL_FAIR_ODDS`. |
| **G8** | **Phase 2–5 Baseline Invariance** | ✅ PASS | Phase 2 (13,263 ev), Phase 3 (1,765 pl, 3,466 ed), Phase 4 (75,692 m), Phase 5 (147,718 stats, 60,994 sets, 1,278 games) 100% intact. |
| **G9** | **Zero Premature Ingestion** | ✅ PASS | Strictly 0 rows in `matches.match_points`, `ai.prediction_runs`, and published predictions. |
| **G10** | **Dual-Run Idempotency (Pass 2 No-Op)** | ✅ PASS | Pass 2 executed as a 100% no-op (+0 rows inserted across all tables). |
| **G11** | **Cryptographic Determinism & Hash Invariance** | ✅ PASS | Table MD5 hashes for bookmakers, ticks, quarantine, and review queue bitwise identical across passes. |
| **G12** | **Zero SQLite Mutation** | ✅ PASS | `data/database.sqlite` and `tennis_gold.sqlite` bitwise untouched ($\Delta = 0\text{ bytes}$). |
| **G13** | **Zero Production Connection** | ✅ PASS | Execution strictly confined to local disposable staging cluster on port 54349. |
| **G14** | **Review Queue Accounting** | ✅ PASS | Exactly 2,157 total items in `provenance.review_queue` (+768 unique Phase 6 conflict items). |

---

## 3. Resolution of Specific Reporting Contradictions

### 3.1. G1 Scope: Quarantining Does Not Imply Resolution
- **Contradiction:** Stating that both admitted ticks and quarantined rows "resolve to matches.matches" was misleading because quarantined records originate from uncurated date-only sources and part of the 32,884 unresolved candidates were excluded upstream.
- **Remediated Formulation:** G1 now explicitly specifies:
  $$\text{100\% of admitted ticks resolve to canonical matches; quarantined rows are independently classified by resolution status and are not claimed as resolved unless an explicit parent match exists.}$$

### 3.2. G3 Scope: Range Check on Admitted Odds vs Invalid Candidates
- **Contradiction:** Reporting "100% of odds in [1.001, 1000.0]" suggested the candidate pool had no invalid odds, conflicting with the 154 quarantined records.
- **Remediated Formulation:** G3 explicitly defines its domain:
  $$\text{100\% of admitted \texttt{market\_odds\_ticks} satisfy } 1.001 \le \text{decimal\_odds} \le 1000.0\text{. Invalid candidates (154 rows) are excluded and accounted for separately under \texttt{INVALID\_DECIMAL\_ODDS}.}$$

### 3.3. G7 Synthetic Odds: Tracing Both Rejection Pathways (14,997 vs 632)
- **Primary Source Evidence:** In `G:\state football\data\tennis_gold.sqlite` (`gold_matches_validated`), there exist exactly **14,997** records with `odds_source = 'model_fair'`.
- **Dual Rejection Ledger:** None of the 14,997 records were lost or unaccounted for:
  $$\begin{aligned}
  \text{model\_fair\_total} &= 14,997 \\
  \text{model\_fair\_matched\_to\_phase4} &= 632 \quad (\text{quarantined to } \texttt{provenance.review\_queue}\text{ under } \texttt{SYNTHETIC\_MODEL\_FAIR\_ODDS}) \\
  \text{model\_fair\_unresolved\_before\_phase6} &= 14,365 \quad (\text{excluded upstream under } \texttt{UNRESOLVED\_PHASE3\_MATCH}) \\
  \text{model\_fair\_admitted\_to\_market\_odds\_ticks} &= 0 \quad (\mathbf{100\%\; Exclusion\; Enforced})
  \end{aligned}$$
  This accounts for 100% of the Markov simulation odds without ambiguity.

### 3.4. G5 Lookahead & Pre-Match Closing Line Coverage
- **Audit Reality:** The 656 authenticated ticks originated from retrospective Sofascore JSON cache requests executed in August 2026 for matches played in January 2024 (`captured_at_utc > scheduled_start_utc`).
- **Enforcement:** Zero closing lines were constructed from these retrospective fetches (`is_closing_line = FALSE`).
- **Verdict Clarification:**
  $$\mathbf{G5\text{ PASS for anti-fabrication and no-lookahead enforcement. PRE-MATCH\_CLOSING\_LINE\_COVERAGE = 0.}}$$
  This ensures downstream teams do not mistake Phase 6 as possessing historical pre-match closing lines for backtesting.

---

## 4. Quarantine Schema & Forensic Auditability

The quarantine table [`markets.legacy_undated_odds_quarantine`](file:///g:/telegram-backend/db/postgres-schema-v1.sql#L468-L485) has been provisioned with comprehensive forensic and replay attributes to support human inspection without contaminating canonical market tables:

```sql
CREATE TABLE IF NOT EXISTS markets.legacy_undated_odds_quarantine (
  quarantine_id BIGSERIAL PRIMARY KEY,
  source_name VARCHAR(100) NOT NULL,
  source_record_id VARCHAR(100) NULL,
  candidate_match_id UUID NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  bookmaker_id SMALLINT NOT NULL REFERENCES markets.bookmakers(bookmaker_id) ON DELETE RESTRICT,
  market_type markets.market_category NOT NULL,
  selection_side SMALLINT NULL CHECK (selection_side IS NULL OR selection_side IN (1, 2)),
  selection_player_id UUID NULL REFERENCES identity.players(player_id) ON DELETE RESTRICT,
  line NUMERIC(5, 2) NULL,
  decimal_odds NUMERIC(6, 3) NOT NULL CHECK (decimal_odds >= 1.001 AND decimal_odds <= 1000.0),
  reference_match_start_utc TIMESTAMPTZ NULL,
  raw_observation_date VARCHAR(50) NULL,
  quarantine_reason VARCHAR(100) NOT NULL DEFAULT 'UNKNOWN_TIMING_UNDATED_SNAPSHOT',
  evidence_hash CHAR(64) NULL,
  created_at_utc TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
```

### Forensic Replay Fields Preserved:
1. `source_name`: Explicit origin (`canonical_matches`, `historical_bet365_csv`, `desktop_gold_validated`).
2. `source_record_id`: Primary key in the source SQLite table.
3. `candidate_match_id`: Canonical match UUID in `matches.matches` when resolved.
4. `reference_match_start_utc`: Scheduled start timestamp boundary.
5. `raw_observation_date`: Match date string as recorded in legacy source.
6. `decimal_odds`: Exact observed decimal odds ratio.
7. `quarantine_reason`: Canonical reason (`UNKNOWN_TIMING_UNDATED_SNAPSHOT`).
8. `evidence_hash`: Deterministic SHA-256 payload digest for replay verification.
9. `created_at_utc`: Relational ingestion timestamp.

---

## 5. Independent Reconciliation Ledger & Mathematical Partition

Every candidate market odds observation has been independently traced from raw source files, manifest, and database state into an exact, non-overlapping partition:

$$\text{total\_candidate\_rows} = \sum \text{partition components} = 288,122$$

| Partition Component Name | Entity Storage Location | Exact Row Count | Percentage | Validation Invariant |
| :--- | :--- | :---: | :---: | :--- |
| `admitted_ticks_with_authentic_timestamp` | `markets.market_odds_ticks` | **656** | 0.23% | `captured_at_utc IS NOT NULL`; resolved to canonical match & player; 0 orphan FKs |
| `quarantined_unknown_timing_rows` | `markets.legacy_undated_odds_quarantine` | **253,778** | 88.08% | Undated closing quotes preserved; quarantined from canonical ticks; 0 orphans |
| `synthetic_model_fair_rows` | `provenance.review_queue` | **632** | 0.22% | 100% quarantined under `SYNTHETIC_MODEL_FAIR_ODDS` (of 14,997 source rows) |
| `invalid_decimal_odds` | `provenance.review_queue` | **154** | 0.05% | Odds $\le 1.000$ quarantined under `INVALID_DECIMAL_ODDS` |
| `duplicates` | Excluded Cache Artifacts | **18** | 0.01% | Exact duplicate payload entries across directory caches |
| `unresolved_rows` | Excluded / Staging Rejects | **32,884** | 11.41% | 32,770 unmapped fixtures (incl. 14,365 model fair) + 96 null odds + 28 mismatch + 8 player |
| **Total Candidate Pool Balance** | **Sum of all components** | **288,122** | **100.00%** | **Balanced Exactly to 0 Discrepancy** |

$$\begin{aligned}
\text{Total Candidate Pool} &= 656 + 253,778 + 632 + 154 + 18 + 32,884 \\
&= 288,122 \quad (\Delta = 0)
\end{aligned}$$

---

## 6. Entity Population Summary Table

| Schema | Table Name | Target Candidate | Pass 1 Admitted | Pass 2 Count | Pass 2 Delta | Invariant Status |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| `markets` | `bookmakers` | 4 | **4** | **4** | +0 | ✅ Complete |
| `markets` | `market_odds_ticks` (Dated) | 656 | **656** | **656** | +0 | ✅ Authentic Timestamps |
| ↳ *Moneyline* | `market_odds_ticks` | 328 | **328** | **328** | +0 | ✅ Symmetrical (164/164) |
| ↳ *Set 1 Winner* | `market_odds_ticks` | 328 | **328** | **328** | +0 | ✅ Symmetrical (164/164) |
| `markets` | `legacy_undated_odds_quarantine` | 253,778 | **253,778** | **253,778** | +0 | ✅ Forensic Quarantine |
| `provenance` | `review_queue` | 2,157 | **2,157** | **2,157** | +0 | ✅ +786 Conflicts (+768 net) |
| `statistics` (Phase 5) | `match_player_statistics` | 147,718 | **147,718** | **147,718** | +0 | ✅ Invariant |
| `matches` (Phase 5) | `match_sets` | 60,994 | **60,994** | **60,994** | +0 | ✅ Invariant |
| `matches` (Phase 5) | `match_games` | 1,278 | **1,278** | **1,278** | +0 | ✅ Invariant |
| `matches` (Phase 4) | `matches` | 75,692 | **75,692** | **75,692** | +0 | ✅ Invariant |
| `matches` (Phase 4) | `match_participants` | 151,384 | **151,384** | **151,384** | +0 | ✅ Invariant |
| `matches` (Phase 4) | `match_results` | 75,690 | **75,690** | **75,690** | +0 | ✅ Invariant |
| `raw` (Phase 2) | `source_evidence` | 13,263 | **13,263** | **13,263** | +0 | ✅ Invariant |
| `provenance` (Phase 2) | `source_match_links` | 3,807 | **3,807** | **3,807** | +0 | ✅ Invariant |
| `provenance` (Phase 2) | `field_provenance` | 186 | **186** | **186** | +0 | ✅ Invariant |
| `identity` (Phase 3) | `players` | 1,765 | **1,765** | **1,765** | +0 | ✅ Invariant |
| `identity` (Phase 3) | `player_aliases` | 2,833 | **2,833** | **2,833** | +0 | ✅ Invariant |
| `identity` (Phase 3) | `tournaments` | 1,183 | **1,183** | **1,183** | +0 | ✅ Invariant |
| `identity` (Phase 3) | `tournament_aliases` | 1,376 | **1,376** | **1,376** | +0 | ✅ Invariant |
| `competition` (Phase 3) | `tournament_editions` | 3,466 | **3,466** | **3,466** | +0 | ✅ Invariant |
| `matches` | `match_points` | 0 | **0** | **0** | +0 | ✅ Invariant |
| `ai` | `prediction_runs` | 0 | **0** | **0** | +0 | ✅ Untouched |

---

## 7. Authoritative Verdict & Phase 7 Transition Terms

### Verdict:
**`PASS — Canonical and quarantine integrity gates passed.`**  
> [!WARNING]
> **Conditional hold — Pre-match closing-line coverage is zero because all admitted timestamped records were retrieved after scheduled start. No verified closing-line dataset is available from Phase 6.**

### Operational Directives for Phase 7:
1. **Migration Pipeline Clearance:** Phase 7 is unblocked **exclusively for migration integrity**:
   - Provisioning `ai.prediction_runs` and `predictions.published_predictions`.
   - Ingesting model routing configurations, feature schema hashes, and cutoff timestamps.
   - Enforcing anti-lookahead boundary rules (`cutoff_timestamp_utc <= scheduled_start_utc`).
2. **Backtesting & Feature Engineering Hold:** Any backtest, feature pipeline, or machine learning evaluation that strictly requires historical pre-match closing odds must remain on **conditional hold** until authentic intraday point-in-time odds feeds are integrated.
