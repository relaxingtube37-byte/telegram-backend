# TennisMyLife Source Inventory & Architectural Profiling Report

## 1. Executive Summary & Source Role

This report provides a formal, read-only source inventory, dataset categorization, and structural schema profile of **TennisMyLife** (\`https://stats.tennismylife.org/tennis-match-database\`).

### 1.1 Architectural Status & Operating Constraints
- **Role:** Secondary validation and telemetry enrichment source.
- **Authority:** Non-canonical. TennisMyLife cannot autonomously create canonical players, tournaments, or matches, nor can it mutate canonical outcomes.
- **Read-Only Dry-Run Invariants:**
  - **Zero PostgreSQL Writes:** No database connection or write query attempted.
  - **Zero SQLite Mutations:** Bit-for-bit file size and SHA-256 hash invariance verified on \`data/database.sqlite\` and \`tennis_gold.sqlite\` ($\Delta = 0$ bytes).
  - **Zero Production Changes:** No modification to production runtime code (\`src/\`, \`server/\`).
  - **Zero Value Coercion:** Missing numeric attributes remain strictly \`NULL\` (never converted to \`0\`).

---

## 2. Manifest Acquisition & Category Breakdown

The official manifest endpoint (\`https://stats.tennismylife.org/api/data-files\`) was queried live. The exact raw response is preserved as \`scratch/tennismylife-inventory/manifest.raw.json\`, and the normalized catalog is saved as \`scratch/tennismylife-inventory/manifest.json\`.

### 2.1 File Counts by Category
A total of **203 advertised datasets** are cataloged across 5 primary operational categories:

| Category | Advertised File Count | Temporal Coverage | Example Datasets | Description & Scope |
| :--- | :---: | :---: | :--- | :--- |
| **ATP Tour** | **62** | 1967–2026 | \`2024.csv\`, \`1968.csv\`, \`ATP_Database.csv\` | Complete historical and modern seasonal ATP tour-level match records. |
| **WTA Tour** | **37** | 1990–2026 | \`2024_wta.csv\`, \`1990_wta.csv\`, \`2026_wta.csv\` | Historical and seasonal WTA tour-level match records. |
| **Challenger Tour** | **49** | 1978–2026 | \`2024_challenger.csv\`, \`1978_challenger.csv\` | ATP Challenger tier seasonal records. |
| **ATP Qualifying** | **20** | 2007–2026 | \`atp_quali/2024_atp_quali.csv\` | ATP qualification draw records. |
| **Ongoing Tournaments** | **3** | Active Season | \`ongoing_tourneys.csv\`, \`wta_ongoing_tourneys.csv\`, \`challenger_ongoing_tourneys.csv\` | In-flight, active tournament draw and match updates. |
| **Audit Backups** | **31** | 1968–2026 | \`backup_ll_audit_20260906_044746/...\` | Server-side point-in-time audit snapshots. |
| **Rankings / Reference** | **1** | Current | \`atp_rankings_2026-08-31.csv\` | Weekly ranking snapshots. |
| **Total** | **203** | **1967–2026** | — | — |

---

## 3. Sample Dataset Profiling

To evaluate physical structural integrity, five representative archetypes were downloaded into \`scratch/tennismylife-inventory/samples/\` and profiled:

| Archetype | File Name | Byte Size | Data Rows | Header Cols | Malformed Rows | Duplicate Rows | Missing Cols | Extra Cols |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **ATP Tour Yearly** | \`2024.csv\` | 656,519 | 3,076 | 50 | 0 | 0 | None | None |
| **WTA Tour Yearly** | \`2024_wta.csv\` | 552,309 | 2,658 | 50 | 0 | 0 | None | None |
| **Challenger Yearly** | \`2024_challenger.csv\` | 1,234,305 | 6,063 | 50 | 0 | 0 | None | None |
| **ATP Qualifying** | \`atp_quali/2024_atp_quali.csv\` | 278,494 | 1,342 | 50 | 0 | 0 | None | None |
| **Ongoing Live** | \`ongoing_tourneys.csv\` | 27,236 | 124 | 50 | 0 | 0 | None | None |

### 3.1 Structural Invariants Confirmed
1. **100% Homogeneous Header Definition:** All five dataset archetypes share the exact same 50 column headers in identical order.
2. **Zero Malformed Records:** Across all 13,263 sampled data rows, 100% of rows have exactly 50 comma-delimited fields (0 width variations, 0 truncation).
3. **Zero Physical Duplicate Rows:** Every row represents a distinct physical line.
4. **RFC 4180 Compliance:** Quoted fields with embedded commas (e.g. tournament names) parse without row corruption.

---

## 4. Header Columns & Inferred Data Types

The 50 columns present in all TennisMyLife match datasets are typed as follows:

| # | Column Name | Inferred Type | Null Rate (2024 ATP) | Sample Value | Description |
| :---: | :--- | :---: | :---: | :--- | :--- |
| 1 | \`tourney_id\` | string | 0.0% | \`2024-807\` | Annual tournament unique identifier. |
| 2 | \`tourney_name\` | string | 0.0% | \`Brisbane\` | Display tournament name. |
| 3 | \`surface\` | string | 0.0% | \`Hard\` | Court surface (\`Hard\`, \`Clay\`, \`Grass\`, \`Carpet\`). |
| 4 | \`draw_size\` | integer | 0.0% | \`32\` | Tournament draw size (e.g. 32, 64, 128). |
| 5 | \`tourney_level\` | string | 0.0% | \`A\` | Tier code (\`G\`=Grand Slam, \`M\`=Masters, \`A\`=250/500, \`C\`=Challenger). |
| 6 | \`indoor\` | string/boolean | 0.0% | \`O\` | Indoor/Outdoor flag (\`I\`=Indoor, \`O\`=Outdoor). |
| 7 | \`tourney_date\` | date | 0.0% | \`20240101\` | Tournament start date (\`YYYYMMDD\`). |
| 8 | \`match_num\` | integer | 0.0% | \`300\` | Bracket sequence match number. |
| 9 | \`winner_id\` | string | 0.0% | \`D875\` | ATP alphanumeric code or WTA numeric ID. |
| 10 | \`winner_seed\` | integer | 73.1% | \`2\` | Bracket seed position (if seeded). |
| 11 | \`winner_entry\` | string | 87.5% | \`WC\` | Entrant classification (\`WC\`, \`Q\`, \`LL\`, \`PR\`, \`SE\`). |
| 12 | \`winner_name\` | string | 0.0% | \`Grigor Dimitrov\` | Competitor standard full name. |
| 13 | \`winner_hand\` | string | 0.0% | \`R\` | Dominant hand (\`R\`=Right, \`L\`=Left, \`A\`=Ambidextrous, \`U\`=Unknown). |
| 14 | \`winner_ht\` | integer | 0.3% | \`191\` | Competitor height in centimeters. |
| 15 | \`winner_ioc\` | string | 0.0% | \`BUL\` | 3-letter Olympic / ISO country code. |
| 16 | \`winner_age\` | float | 0.0% | \`32.641\` | Exact age at tournament start. |
| 17 | \`winner_rank\` | integer | 0.2% | \`14\` | ATP/WTA singles ranking position. |
| 18 | \`winner_rank_points\` | integer | 0.2% | \`2570\` | ATP/WTA ranking points total. |
| 19 | \`loser_id\` | string | 0.0% | \`H432\` | ATP alphanumeric code or WTA numeric ID. |
| 20 | \`loser_seed\` | integer | 74.2% | \`1\` | Bracket seed position (if seeded). |
| 21 | \`loser_entry\` | string | 85.9% | \`Q\` | Entrant classification. |
| 22 | \`loser_name\` | string | 0.0% | \`Holger Rune\` | Competitor standard full name. |
| 23 | \`loser_hand\` | string | 0.0% | \`R\` | Dominant hand. |
| 24 | \`loser_ht\` | integer | 0.5% | \`188\` | Competitor height in centimeters. |
| 25 | \`loser_ioc\` | string | 0.0% | \`DEN\` | 3-letter country code. |
| 26 | \`loser_age\` | float | 0.0% | \`20.676\` | Exact age at tournament start. |
| 27 | \`loser_rank\` | integer | 0.3% | \`8\` | ATP/WTA singles ranking position. |
| 28 | \`loser_rank_points\` | integer | 0.3% | \`3660\` | ATP/WTA ranking points total. |
| 29 | \`score\` | string | 0.0% | \`7-6(5) 6-4\` | Formatted match set score string. |
| 30 | \`best_of\` | integer | 0.0% | \`3\` | Match maximum set format (3 or 5). |
| 31 | \`round\` | string | 0.0% | \`F\` | Round code (\`F\`, \`SF\`, \`QF\`, \`R16\`, \`R32\`, \`R64\`, \`R128\`, \`RR\`, \`Q1\`..\`Q3\`). |
| 32 | \`minutes\` | integer | 2.1% | \`136\` | Official match duration in minutes. |
| 33 | \`w_ace\` | integer | 2.2% | \`8\` | Winner aces count. |
| 34 | \`w_df\` | integer | 2.2% | \`1\` | Winner double faults count. |
| 35 | \`w_svpt\` | integer | 2.2% | \`74\` | Winner total service points played. |
| 36 | \`w_1stIn\` | integer | 2.2% | \`52\` | Winner first serves in. |
| 37 | \`w_1stWon\` | integer | 2.2% | \`40\` | Winner points won on first serve. |
| 38 | \`w_2ndWon\` | integer | 2.2% | \`14\` | Winner points won on second serve. |
| 39 | \`w_SvGms\` | integer | 2.2% | \`11\` | Winner service games held/played. |
| 40 | \`w_bpSaved\` | integer | 2.2% | \`3\` | Winner break points saved. |
| 41 | \`w_bpFaced\` | integer | 2.2% | \`3\` | Winner break points faced. |
| 42 | \`l_ace\` | integer | 2.2% | \`9\` | Loser aces count. |
| 43 | \`l_df\` | integer | 2.2% | \`2\` | Loser double faults count. |
| 44 | \`l_svpt\` | integer | 2.2% | \`77\` | Loser total service points played. |
| 45 | \`l_1stIn\` | integer | 2.2% | \`50\` | Loser first serves in. |
| 46 | \`l_1stWon\` | integer | 2.2% | \`38\` | Loser points won on first serve. |
| 47 | \`l_2ndWon\` | integer | 2.2% | \`14\` | Loser points won on second serve. |
| 48 | \`l_SvGms\` | integer | 2.2% | \`11\` | Loser service games held/played. |
| 49 | \`l_bpSaved\` | integer | 2.2% | \`1\` | Loser break points saved. |
| 50 | \`l_bpFaced\` | integer | 2.2% | \`2\` | Loser break points faced. |

---

## 5. Usefulness & Target Domain Assessment

### 5.1 Player Biometrics & Rankings Enrichment (\`HIGH\`)
- **Strengths:** Provides authentic biographical attributes (\`height\`, \`hand\`, \`ioc\`, \`age\`) and historical ranking positions/points at match time.
- **Application:** Ideal for populating missing attributes in \`identity.players\` and pre-match participant entries in \`matches.match_participants\`.

### 5.2 Tournament & Edition Matching (\`HIGH\`)
- **Strengths:** Explicitly tracks tournament surface, indoor/outdoor indicator, draw size, and tournament level.
- **Application:** Corroborates annual edition definitions in \`competition.tournament_editions\`. Allows separation of main draw vs qualification rounds.

### 5.3 Match Resolution & Validation (\`HIGH\`)
- **Strengths:** High score completeness (100% of rows have a score string), match duration, round nomenclature, and settled winner/loser records.
- **Application:** Verifies canonical match outcomes in \`matches.match_results\`. Flags score or winner discrepancies for review.

### 5.4 Service Statistics Telemetry Enrichment (\`VERY HIGH\`)
- **Strengths:** 97.8% of modern tour-level matches contain complete 18-variable box score service telemetry (\`ace\`, \`df\`, \`svpt\`, \`1stIn\`, \`1stWon\`, \`2ndWon\`, \`SvGms\`, \`bpSaved\`, \`bpFaced\`).
- **Application:** Serves as a primary cross-source enrichment pool for Phase 6 (\`statistics.player_match_stats\`), enabling true serve percentage modeling without synthetic multipliers.

### 5.5 Betting Market Odds (\`NOT SUITABLE\`)
- **Findings:** **Zero odds coverage.** TennisMyLife CSVs do not provide bookmaker odds (Pinnacle, Bet365, etc.), closing prices, or market margins. Market data must continue to be sourced exclusively from existing odds databases.

### 5.6 Point-by-Point (PBP) Telemetry (\`NOT SUITABLE\`)
- **Findings:** **Zero point-by-point telemetry.** Datasets contain final set scores (e.g. \`6-4 3-6 7-6(5)\`) and cumulative match totals, but do not record point-by-point point logs, rally shot counts, or serve placement coordinates. PBP data must remain sourced from RapidAPI event bundles.

---

## 6. Verification of Safety Gates & Data Invariants

1. **G9 (Zero SQLite Mutation):**
   - \`data/database.sqlite\`: 544,415,744 bytes (SHA-256: \`ff2ce30427e93db0...\`) — $\Delta = 0$ bytes.
   - \`G:/state football/data/tennis_gold.sqlite\`: 283,303,936 bytes (SHA-256: \`2951176b1fc7da0d...\`) — $\Delta = 0$ bytes.
2. **G10 (Zero PostgreSQL Mutation):** 0 queries executed, 0 connections opened.
3. **G17 (No Missing-to-Zero Imputation):** Missing serve fields strictly evaluate to \`null\`.
4. **All Outputs Generated:** All 5 required scratch artifacts generated and validated in \`scratch/tennismylife-inventory/\`.
