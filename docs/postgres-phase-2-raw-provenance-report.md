# PostgreSQL Phase 2: Raw Evidence & Provenance Migration Report

**Document Role:** Authoritative Migration Verification & Quality Gate Audit Report  
**Execution Timestamp:** 2026-09-11T00:29:31Z  
**Target Environment:** Disposable Local PostgreSQL Staging Cluster (Port 54345)  
**Execution Script:** [`scripts/run-postgres-phase-2-raw-provenance.cjs`](file:///G:/telegram-backend/scripts/run-postgres-phase-2-raw-provenance.cjs)  
**Machine-Readable Summary:** [`scratch/postgres-phase-2-raw-provenance/migration-summary.json`](file:///G:/telegram-backend/scratch/postgres-phase-2-raw-provenance/migration-summary.json)  
**Overall Verdict:** **PASS (9/9 Quality Acceptance Gates Passed)**

---

## 1. Executive Summary

PostgreSQL Phase 2 Raw Evidence and Provenance Migration has successfully completed against the local disposable staging cluster. Exactly **18,479** evidence, link, field provenance, and review queue records were ingested into their respective canonical PostgreSQL tables with complete integrity, natural key deduplication, authentic NULL preservation, and zero mutation to live systems.

A full two-pass execution was performed:
- **Pass 1 (Initial Ingestion):** Inserted all **18,479** records across the 4 target tables.
- **Pass 2 (Idempotency Audit):** Successfully executed as a **100% No-Op** ($0$ rows inserted), maintaining identical table counts, column-level hashes, and catalog invariants.

---

## 2. Invariant Quality Gates (G1 – G9)

| Gate | Name | Status | Verified Details |
| :-: | :--- | :-: | :--- |
| **G1** | `raw.source_evidence` Accounted For | ✅ PASS | Exactly 13,263 / 13,263 source rows imported with 100% SHA-256 payload hash retention. |
| **G2** | `provenance.source_match_links` Accounted For | ✅ PASS | Exactly 3,807 / 3,807 source links imported: 2,129 confirmed canonical + 1,678 provisional candidate links (`match_id = NULL`). |
| **G3** | `provenance.field_provenance` Accounted For | ✅ PASS | Exactly 186 / 186 fill-null service telemetry field provenance records imported. |
| **G4** | `provenance.review_queue` Accounted For | ✅ PASS | Exactly 1,223 / 1,223 review queue items imported (917 stat conflicts, 211 challenger, 95 ongoing matches). |
| **G5** | Zero Canonical Entity Import | ✅ PASS | All 24 canonical player, tournament, match, and boxscore tables strictly verified at 0 rows. |
| **G6** | Second Run 100% No-Op Verified | ✅ PASS | Pass 2 inserted exactly 0 rows across all tables (pure idempotent no-op). |
| **G7** | Cryptographic Determinism & Hash Invariance | ✅ PASS | Table content MD5 digests between Pass 1 and Pass 2 are 100% bitwise identical. |
| **G8** | Zero SQLite Mutation | ✅ PASS | `data/database.sqlite` (544,415,744 B) and `tennis_gold.sqlite` (283,303,936 B) $\Delta = 0\text{ bytes}$. |
| **G9** | Zero Production Connection | ✅ PASS | Executed strictly on isolated loopback ephemeral port 54345; 0 production connections. |

---

## 3. Migration Inventory & Population Metrics

### 3.1. Target Table Breakdown

| Schema | Table Name | Pass 1 Count | Pass 2 Count | Pass 2 Delta | Status |
| :--- | :--- | :---: | :---: | :---: | :---: |
| `raw` | `source_evidence` | **13,263** | **13,263** | +0 | ✅ Complete |
| `provenance` | `source_match_links` | **3,807** | **3,807** | +0 | ✅ Complete |
| ↳ *Confirmed Links* | — | 2,129 | 2,129 | +0 | ✅ Linked |
| ↳ *Provisional Links* | — | 1,678 | 1,678 | +0 | ✅ `match_id = NULL` |
| `provenance` | `field_provenance` | **186** | **186** | +0 | ✅ Complete |
| `provenance` | `review_queue` | **1,223** | **1,223** | +0 | ✅ Complete |
| ↳ *Isolated Stat Conflicts* | — | 917 | 917 | +0 | ✅ Quarantined |
| ↳ *Tier 2 Challenger Approvals*| — | 211 | 211 | +0 | ✅ Queued |
| ↳ *Tier 3 Ongoing Approvals* | — | 95 | 95 | +0 | ✅ Queued |
| **Total Staging Records** | — | **18,479** | **18,479** | **+0** | ✅ **100% No-Op** |

### 3.2. Canonical Domain Boundary Protection (Zero Premature Ingestion)
The remaining 24 tables in the canonical schema were verified and confirmed at **0 rows**:
- `identity.players`: 0 rows
- `identity.player_aliases`: 0 rows
- `identity.tournaments`: 0 rows
- `identity.tournament_aliases`: 0 rows
- `competition.tournament_editions`: 0 rows
- `matches.matches`: 0 rows
- `matches.match_participants`: 0 rows
- `matches.match_results`: 0 rows
- `matches.match_sets`: 0 rows
- `matches.match_games`: 0 rows
- `matches.match_points`: 0 rows
- `statistics.match_player_statistics`: 0 rows
- `markets.bookmakers`, `markets.market_odds_ticks`: 0 rows
- `ai.prediction_runs`, `ai.agent_traces`: 0 rows
- `predictions.published_predictions`, `predictions.match_editorials`: 0 rows
- `backtest.cohorts`, `backtest.cohort_matches`, `backtest.runs`: 0 rows
- `app.users`, `app.referral_sites`, `app.settings`: 0 rows

---

## 4. Invariance & Integrity Verification

| Resource | Baseline State | Post-Migration State | Delta | Result |
| :--- | :--- | :--- | :---: | :---: |
| `data/database.sqlite` | 544,415,744 bytes | 544,415,744 bytes | **0 B** | Bitwise Intact |
| `tennis_gold.sqlite` | 283,303,936 bytes | 283,303,936 bytes | **0 B** | Bitwise Intact |
| `source-evidence-staging.jsonl` | 13,263 lines | 13,263 lines | **0 lines** | Untouched |
| `match-link-staging.jsonl` | 3,807 lines | 3,807 lines | **0 lines** | Untouched |
| `field-provenance-staging.jsonl` | 186 lines | 186 lines | **0 lines** | Untouched |
| `approval-queue.jsonl` | 1,223 lines | 1,223 lines | **0 lines** | Untouched |

---

## 5. Architectural Directives & Next Steps

> [!IMPORTANT]
> - **Provisional Link Integrity Preserved:** All 1,678 provisional match candidate links have `match_id = NULL`, strictly preserving the rule that candidate fixtures are not yet canonical matches.
> - **Production PG Offline:** Operations were conducted entirely on an ephemeral local staging PostgreSQL cluster. Zero production PostgreSQL instances were contacted.
> - **Live Runtime Unchanged:** SQLite continues serving all live application traffic (`canonical_matches_operational`). Cutover remains strictly blocked until Phase 10 parity validation.
