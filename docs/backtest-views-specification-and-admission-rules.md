# Specification: Backtest Views Architecture & Admission Rule Matrix

**Document Role:** Authoritative Architectural Design, SQL Definition, and Admission Governance for Backtest Views  
**Status:** `DRAFT_SPECIFICATION` (Pre-Implementation Review)  
**Related Milestone:** Post-Milestone 27 / Phase 8 Entry Gate Preparation  
**Target Environments:**  
- **Desktop:** `G:/state football/data/tennis_gold.sqlite`  
- **Backend:** `G:/telegram-backend/data/database.sqlite`  

---

## 1. Context & Motivation

Following the successful synchronization of the 154 US Open 2026 fixtures (Commit: `40c347c`), the primary match table `gold_matches_validated` has achieved **100% parity** across Desktop and Backend:
$$\text{Row Count}(\text{Desktop}) = \text{Row Count}(\text{Backend}) = 58,131\text{ rows}$$

However, the existing backtest view `gold_matches_ready_view` exhibits a **7,356-row divergence**:
- **Desktop `gold_matches_ready_view`:** **46,076 rows**
- **Backend `gold_matches_ready_view`:** **38,720 rows**
- **Divergence:** Exactly **7,356 rows**

Forensic analysis revealed that this difference is not random or caused by data corruption; it is a fundamental **policy divergence**:
- **Desktop** executed an offline model-enrichment pass (`scripts/enrichGoldOddsAndExpandPool.ts`) that synthesized match lines via a DTMC Markov engine (`exclusion_reason = 'Model-fair odds synthesized via DTMC Markov engine'`) and forced `final_status = 'READY'`.
- **Backend** enforces a strict raw gatekeeper policy, preserving the pre-enrichment reason codes (`MISSING_PBP`, `MISSING_HISTORY`, etc.).

---

## 2. Current SQL Definition Audit

In both database environments, the legacy view is currently defined identically:

```sql
CREATE VIEW gold_matches_ready_view AS
    SELECT *
    FROM gold_matches_validated
    WHERE final_status = 'READY';
```

Because `final_status` in Desktop was mutated during the enrichment run, the exact same SQL expression yields two completely different sets of rows. This conflation between **raw admission** and **enriched admission** introduces ambiguity into backtest baselines.

---

## 3. Rule Diff Matrix for the 7,356 Divergent Matches

Across the 58,131 shared matches, exactly **7,356 rows** have `final_status = 'READY'` in Desktop, but remain strictly quarantined in Backend:

| Backend `final_status` | Affected Rows | Description & Raw Gatekeeper Rule | Desktop DTMC Markov Override Rationale |
| :--- | :---: | :--- | :--- |
| **`MISSING_PBP`** | **3,359** | Official point-by-point JSON bundle missing on disk (`has_pbp_bundle = 0`). | Desktop Markov engine estimates game/set point distributions analytically, bypassing disk PBP dependency. |
| **`MISSING_HISTORY`** | **1,891** | Insufficient prior match history for one or both players ($<3$ matches in 3-year window). | Desktop models permit zero-history priors with tour-average hold/break baselines. |
| **`MISSING_STATS_AND_PBP`** | **1,656** | Neither official statistics nor point-by-point bundles exist on disk. | Desktop synthesizes synthetic serve/return statistics from player rankings and surface priors. |
| **`INVALID_SURFACE`** | **441** | Surface string not recognized in standard canonical surface enum (`HARD`, `CLAY`, `GRASS`, `CARPET`). | Desktop normalized non-standard surface tags to nearest equivalent. |
| **`MISSING_STATS`** | **9** | Statistics bundle missing on disk (`has_stats_bundle = 0`). | Desktop utilized fallback serve percentages. |
| **Total Divergent Matches** | **7,356** | **100% Accounted For** | **All 7,356 matches promoted to `READY` in Desktop via Markov synthesis.** |

> [!IMPORTANT]
> **Data Governance Invariant:** The 7,356 enriched rows must **NEVER** be conflated with raw authentic telemetry. Any experiment, backtest, or parity verification must explicitly declare whether it was evaluated against the **Raw Admission Baseline** or the **Enriched Admission Baseline**.

---

## 4. Proposed View Architecture (Three-Tier Strategy)

To resolve the divergence without mutating raw records, without breaking existing consumers, and with full mathematical traceability, we propose establishing three formal views in `database.sqlite`:

```
                               ┌────────────────────────────────┐
                               │     gold_matches_validated    │
                               │        (58,131 rows)           │
                               └──────────────┬─────────────────┘
                                              │
                     ┌────────────────────────┴────────────────────────┐
                     ▼                                                 ▼
      ┌─────────────────────────────┐                   ┌─────────────────────────────┐
      │ gold_matches_ready_raw_view │                   │gold_matches_enriched_table  │
      │        (38,720 rows)        │                   │        (7,356 IDs)          │
      │  Strict raw authentic PIT   │                   │    Markov Admission Ledger  │
      └──────────────┬──────────────┘                   └──────────────┬──────────────┘
                     │                                                 │
                     │                 ┌───────────────────────────────┘
                     │                 ▼
                     │  ┌────────────────────────────────┐
                     │  │gold_matches_ready_enriched_view│
                     │  │         (46,076 rows)          │
                     │  │ Exact parity with Desktop      │
                     │  └────────────────────────────────┘
                     ▼
      ┌─────────────────────────────┐
      │   gold_matches_ready_view   │
      │     (38,720 rows Facade)    │
      │  Preserves 100% consumers   │
      └─────────────────────────────┘
```

### 4.1. View 1: `gold_matches_ready_raw_view` (Strict Raw Baseline)
- **Target Count:** Exactly **38,720 rows** (38,566 historical matches + 154 US Open 2026 matches).
- **SQL Definition:**
  ```sql
  CREATE VIEW gold_matches_ready_raw_view AS
      SELECT *
      FROM gold_matches_validated
      WHERE final_status = 'READY';
  ```
- **Governance Role:** Gold-standard, zero-synthesis baseline for production models that require authentic point-by-point telemetry and verified player history.

### 4.2. View 2: `gold_matches_ready_enriched_view` (Markov Enriched Baseline)
- **Target Count:** Exactly **46,076 rows** (100% row-for-row match with Desktop's `gold_matches_ready_view`).
- **Implementation Mechanism:**
  To guarantee 0-byte mutation of `gold_matches_validated`, an auxiliary immutable ledger table `gold_matches_enriched_admissions` is established:
  ```sql
  CREATE TABLE IF NOT EXISTS gold_matches_enriched_admissions (
      rapid_event_id INTEGER PRIMARY KEY,
      enrichment_type TEXT NOT NULL,
      original_status TEXT NOT NULL,
      created_at TEXT NOT NULL
  );
  ```
  The view joins this table cleanly:
  ```sql
  CREATE VIEW gold_matches_ready_enriched_view AS
      SELECT *
      FROM gold_matches_validated
      WHERE final_status = 'READY'
         OR rapid_event_id IN (SELECT rapid_event_id FROM gold_matches_enriched_admissions);
  ```
- **Governance Role:** Used exclusively by experimental models and backtesters that tolerate DTMC Markov synthesized fair odds to maximize training sample volume.

### 4.3. View 3: `gold_matches_ready_view` (Legacy Consumer Facade)
- **Target Count:** Exactly **38,720 rows** (points directly to `gold_matches_ready_raw_view`).
- **SQL Definition:**
  ```sql
  DROP VIEW IF EXISTS gold_matches_ready_view;
  CREATE VIEW gold_matches_ready_view AS
      SELECT *
      FROM gold_matches_ready_raw_view;
  ```
- **Governance Role:** Preserves 100% existing consumer compatibility. Any existing controller, endpoint (`GET /api/web/tournaments/today`), test suite, or pipeline referencing `gold_matches_ready_view` continues functioning without alteration.

---

## 5. Execution & Quality Acceptance Gates

| Gate | Title | Acceptance Criteria |
| :---: | :--- | :--- |
| **BV-G1** | **Raw View Verification** | `SELECT COUNT(*) FROM gold_matches_ready_raw_view` equals exactly **38,720**. |
| **BV-G2** | **Enriched View Parity** | `SELECT COUNT(*) FROM gold_matches_ready_enriched_view` equals exactly **46,076** (0 false positives, 0 false negatives vs Desktop). |
| **BV-G3** | **Legacy Facade Integrity** | `SELECT COUNT(*) FROM gold_matches_ready_view` equals `SELECT COUNT(*) FROM gold_matches_ready_raw_view` (38,720). |
| **BV-G4** | **Zero Table Mutation** | `gold_matches_validated` row count remains invariant at **58,131** with 0 schema modifications. |
| **BV-G5** | **Zero Consumer Regression** | All 26 backend tests in `src/test_backend_full.ts` pass with 100% success. |
| **BV-G6** | **Phase 8 Entry Gate Invariance** | `scripts/verify-phase-8-entry-gate.cjs` passes 6/6 gates cleanly. |

---

## 6. Safe Execution Sequence

1. **Step 1:** Review and approve this specification.
2. **Step 2:** Generate the immutable ledger seed script `scripts/seed-enriched-admissions-ledger.cjs` to populate `gold_matches_enriched_admissions` with the 7,356 IDs.
3. **Step 3:** Deploy the three views in `database.sqlite` via a single atomic transaction with pre-write backup.
4. **Step 4:** Execute the independent verification script `scripts/verify-backtest-views-parity.cjs` to certify gates BV-G1 through BV-G6.
5. **Step 5:** Commit the changes and update project memory (`progress.md`, `risks.md`, `notes.md`).
