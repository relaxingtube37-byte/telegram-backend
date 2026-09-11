# Forensic Audit Report: `gold_matches_validated` & Backtest View Disparities

**Document Role:** Root-Cause Differential Audit, Dataset Forensics, and Resolution Specification  
**Audit Date:** 2026-09-11  
**Source Environments:**  
- **Desktop Environment:** `G:/state football/data/tennis_gold.sqlite`  
- **Backend Environment:** `G:/telegram-backend/data/database.sqlite`  

---

## 1. Executive Summary & Forensic Findings

| Metric / Table | Desktop (`state football`) | Backend (`telegram-backend`) | Delta ($\Delta$) | Root Cause Classification |
| :--- | :---: | :---: | :---: | :--- |
| **`gold_matches_validated` Total Rows** | **58,131** | **57,977** | **+154** (Desktop) | **Cutoff Temporal Horizon Gap:** Desktop captured live 2026 US Open matches (Sep 2–10, 2026) post-dating Backend's Sep 1 cutoff. |
| **Only in Desktop (Unique IDs)** | **154** | — | +154 | Exactly 154 US Open 2026 fixtures absent from Backend. |
| **Only in Backend (Unique IDs)** | — | **0** | 0 | Zero orphan fixtures in Backend; Backend is a strict temporal subset of Desktop. |
| **`gold_matches_ready_view` Rows** | **46,076** | **38,566** | **+7,510** (Desktop) | **Dual-Factor Divergence:** (1) 154 new US Open matches + (2) 7,356 shared matches promoted via DTMC Markov odds synthesis on Desktop. |

---

## 2. Forensic Audit of the 154-Row Discrepancy

### 2.1. Temporal Boundary Analysis
- **Backend Cutoff:** The maximum match date in `telegram-backend/data/database.sqlite` is **`2026-09-01`** (25 matches).
- **Desktop Coverage:** Continues from **`2026-09-02` through `2026-09-10`**.

### 2.2. Tournament & Date Distribution of the 154 Rows
Every single one of the 154 missing matches belongs to **US Open, New York, USA**:

| Match Date | Missing Match Count | Round / Stage |
| :---: | :---: | :--- |
| **2026-09-02** | 20 | Round 2 / Early Main Draw |
| **2026-09-03** | 46 | Round 2 & Round 3 |
| **2026-09-04** | 32 | Round 3 |
| **2026-09-05** | 25 | Round 3 & Round of 16 |
| **2026-09-06** | 10 | Round of 16 |
| **2026-09-07** | 5 | Quarterfinals |
| **2026-09-08** | 8 | Quarterfinals |
| **2026-09-09** | 4 | Semifinals |
| **2026-09-10** | 4 | Semifinals / Finals Lead-in |
| **Total** | **154** | **100% US Open 2026** |

### 2.3. Sample Records (First 5 Rows)
```
1. 16939110 | 2026-09-02 | WTA | Andreeva M. vs Tjen J. (Finished) | Score: Finished | Status: READY
2. 16940129 | 2026-09-02 | ATP | Cerundolo F. vs Misolic F. (Finished) | Score: Finished | Status: READY
3. 16940130 | 2026-09-02 | ATP | Struff J. vs Ugo Carabelli C. (Finished) | Score: Finished | Status: READY
4. 16940133 | 2026-09-02 | ATP | Monfils G. vs Daniel Vallejo A. (3-1) | Score: 3-1 | Status: READY
5. 16940145 | 2026-09-02 | ATP | Musetti L. vs Fery A. (Finished) | Score: Finished | Status: READY
```

---

## 3. Forensic Audit of the 7,510-Row Backtest View Disparity

Both databases define the backtest view identically:
```sql
CREATE VIEW gold_matches_ready_view AS
    SELECT * FROM gold_matches_validated WHERE final_status = 'READY';
```

### 3.1. Mathematical Accounting
$$\Delta_{\text{Backtest}} = 46,076 - 38,566 = 7,510$$
$$\Delta_{\text{Backtest}} = 154\text{ (New 2026 US Open Matches)} + 7,356\text{ (Shared Matches Promoted in Desktop)}$$

### 3.2. Status Divergence Matrix on Shared Fixtures
Across the 57,977 shared fixtures present in both databases, exactly **7,356 matches** hold a different `final_status`:

| Desktop `final_status` | Backend `final_status` | Affected Matches | Diagnostic Cause |
| :--- | :--- | :---: | :--- |
| **`READY`** | **`MISSING_PBP`** | **3,359** | Desktop synthesized point-by-point / service distributions or bypassed PBP requirement. |
| **`READY`** | **`MISSING_HISTORY`** | **1,891** | Desktop enriched prior player history via `gold_player_history_3y`. |
| **`READY`** | **`MISSING_STATS_AND_PBP`** | **1,656** | Desktop generated synthetic Markov stats or bypassed stats filter. |
| **`READY`** | **`INVALID_SURFACE`** | **441** | Desktop standardized or normalized non-standard surface tags. |
| **`READY`** | **`MISSING_STATS`** | **9** | Desktop filled missing serve percentages. |
| **Total Divergent Shared Rows** | | **7,356** | |

### 3.3. Schema Difference Evidence
Notice that Desktop's table schema includes 19 additional columns not present in Backend:
```sql
odds_source TEXT DEFAULT 'bookmaker',
fair_total_games_lines TEXT,
fair_handicap_lines TEXT,
fair_set_scores TEXT,
w_ace INTEGER, w_df INTEGER, l_ace INTEGER, l_df INTEGER,
minutes INTEGER, w_bp_converted INTEGER, l_bp_converted INTEGER,
w_first_return_won INTEGER, l_first_return_won INTEGER,
w_second_return_won INTEGER, l_second_return_won INTEGER,
w_receiver_points_won INTEGER, l_receiver_points_won INTEGER,
w_total_points_won INTEGER, l_total_points_won INTEGER
```
Desktop ran an offline Markov DTMC synthesis pass (`exclusion_reason = 'Model-fair odds synthesized via DTMC Markov engine'`) which promoted 7,356 matches that Backend strictly quarantined under raw data quality gates.

---

## 4. Architectural Conclusions & Remediation Options

1. **The 154-Row Difference is Legitimate Live Ingestion Data:**
   - The 154 matches in Desktop are authentic US Open 2026 fixtures collected between Sep 2 and Sep 10.
   - They represent zero risk of corruption; Backend simply needs a controlled sync from Desktop to catch up to Sep 10, 2026.

2. **The 7,356 Status Disparity is a Policy Divergence (Enriched vs. Raw Strict):**
   - **Backend Stance:** Strict raw gatekeeper (`MISSING_PBP`, `MISSING_HISTORY` are excluded from backtest).
   - **Desktop Stance:** Enriched modeling view (synthesizes fair lines to maximize training corpus size to 46,076).
   - Neither database is "corrupt"—they reflect two distinct stages of the modeling pipeline: raw validated vs. model-enriched.

---

## 5. Recommended Resolution Steps (Prior to Phase 8 Staging Execution)

1. **Step 1 (Ingest 154 Live Matches):** Synchronize the 154 US Open matches into Backend `database.sqlite` under strict immutable transaction, bringing `gold_matches_validated` to parity at 58,131 rows.
2. **Step 2 (Establish Explicit View Naming):**
   - Preserve `gold_matches_ready_raw_view` (38,566 rows) for strict raw fidelity.
   - Define `gold_matches_ready_enriched_view` (46,076 rows) for Markov-synthesized model training.
3. **Step 3 (Re-Audit Staging Baseline):** Verify 100% ID parity across Desktop and Backend before executing any repository shadow comparisons.
