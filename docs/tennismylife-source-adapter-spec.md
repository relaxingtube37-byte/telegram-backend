# TennisMyLife Source Adapter Specification: Read-Only Dry-Run Pipeline

## 1. Executive Summary & Architectural Scope

This specification establishes the architectural, mathematical, and data integrity standards for the **TennisMyLife Source Adapter and Dry-Run Linker** within the tennis predictive and analytical platform, immediately following the closure of **Phase 5: Matches & Outcomes** (Commit `022571f`, Quality Gates 11/11 PASS, 75,692 canonical fixtures, 81,554 admitted observations, 66,383 quarantined observations, baseline reconciliation $\Delta = 0$).

### 1.1 Secondary Source Authority Mandate
TennisMyLife (`https://stats.tennismylife.org/tennis-match-database`) provides valuable historical and ongoing tournament match CSV datasets. However, its authority is secondary to canonical consensus and historical baselines:
- **Secondary Validation & Enrichment Source Only:** TennisMyLife cannot act as an autonomous canonical source.
- **No Canonical Creation:** It cannot create new canonical players or canonical tournaments/editions automatically.
- **No Canonical Overwrite:** It cannot overwrite existing canonical match outcomes, scores, winners, or statistics.
- **Not a Point-by-Point (PBP) Source:** TennisMyLife datasets provide match-level and set/game box scores; they do not contain point-by-point telemetry.
- **Not an Odds Source:** TennisMyLife datasets do not provide market odds.
- **Zero Database Mutation:** Strictly read-only offline dry-run. Zero SQLite database writes (`0 bytes delta`, identical SHA-256). Zero PostgreSQL connections attempted.
- **Preservation of Raw & Normalized Evidence:** Full traceability from raw row bytes and hashes to candidate links, enrichments, conflicts, and quarantine records.

---

## 2. Source Acquisition & Manifest Normalization

### 2.1 Manifest Endpoint
The adapter dynamically queries the official manifest endpoint:
```text
https://stats.tennismylife.org/api/data-files
```
Guarantees:
1. **Verbatim Raw Retention:** The exact HTTP payload is preserved byte-for-byte as `manifest.raw.json`.
2. **Deterministic Manifest Normalization:** Normalized into `manifest.json` recording:
   - `source_name`: `TENNISMYLIFE`
   - `source_url`: `https://stats.tennismylife.org/api/data-files`
   - `retrieval_timestamp_utc`: ISO 8601 UTC timestamp.
   - `http_status`: HTTP response status code (assert 200).
   - `content_type`: HTTP Content-Type header.
   - `total_advertised_files`: Count of advertised files.
   - `files`: Deterministically sorted array by advertised filename.
3. **Bounded Retries & Fail-Closed Behavior:** Supports 3 retry attempts with exponential backoff. Fails closed immediately on non-2xx responses, network timeouts, malformed JSON, missing download URLs, or duplicate filenames. Guessed URLs are strictly forbidden.

### 2.2 Dataset Scope & CLI Controls
To ensure focused and bounded evaluation, the default scope targets modern competition seasons (2021 through 2026):
- **ATP Tour yearly datasets:** `2021.csv` through `2026.csv` (6 files)
- **WTA Tour yearly datasets:** `2021_wta.csv` through `2026_wta.csv` (6 files)
- **ATP Challenger yearly datasets:** `2021_challenger.csv` through `2026_challenger.csv` (6 files)
- **ATP Qualifying yearly datasets:** `atp_quali/2021_atp_quali.csv` through `atp_quali/2026_atp_quali.csv` (6 files)
Total default scope: **24 yearly files**.

Supported CLI options:
- `--all`: Select all advertised datasets (including full archives to 1967).
- `--atp`: Restrict selection to ATP Tour.
- `--wta`: Restrict selection to WTA Tour.
- `--challenger`: Restrict selection to ATP Challenger.
- `--qualifying`: Restrict selection to ATP Qualifying.
- `--from-year YYYY`: Minimum competition year filter (default: 2021).
- `--to-year YYYY`: Maximum competition year filter (default: 2026).
- `--include-ongoing`: Include real-time ongoing tournament files (`ongoing_tourneys.csv`, etc.).
- `--dry-run`: Mandatory flag enforcing read-only execution. Fails closed if omitted.
- `--output-dir PATH`: Target output directory (default: `scratch/tennismylife-source-output`).
- `--cache-dir PATH`: Target raw files cache directory (default: `scratch/tennismylife-source-output/raw_files`).
- `--offline`: Use locally cached files without remote network calls (for reproducible test runs).

---

## 3. Cryptographic Integrity & RFC 4180 CSV Parsing

### 3.1 File Profiling & Invariance
Every downloaded source file is retained in original binary form and cryptographically audited:
- Original bytes preserved in `rawCacheDir`.
- SHA-256 digest of entire file.
- Byte size.
- Raw row count and data row count.
- Header string SHA-256 hash.
- Detected encoding (UTF-8).
- Line ending format (`CRLF` vs `LF`).
- Delimiter verification (comma `,`).
- Malformed row count, blank line count, and duplicate physical row count.
Stored in `file-inventory.json` and `file-hashes.json`.

### 3.2 Robust RFC 4180 CSV State Machine
Naive comma-splitting is strictly forbidden. The adapter uses a deterministic RFC 4180 compliant character state machine:
- Manages double-quoted fields containing embedded commas, escaped double-quotes (`""`), and multiline strings.
- Validates header presence and flags duplicate column names.
- Validates mandatory match identity columns: `tourney_name`, `tourney_date`, `winner_id` or `winner_name`, `loser_id` or `loser_name`, `round`, `score`.
- Emits schema profiles per dataset into `schema-profiles.json`.

### 3.3 The Zero-Coercion Invariant (G17 Guard)
A critical rule of the PostgreSQL migration pipeline:
$$\text{Missing or unrecorded numeric values} \longrightarrow \mathbf{NULL} \quad (\text{NEVER } 0)$$
Coercing missing serve telemetry (e.g. `w_ace`, `w_df`, `w_svpt`) to zero corrupts historical serve percentages and biases machine learning models. Empty strings, whitespace, `NA`, `N/A`, `-`, and invalid values are converted strictly to `null`.

---

## 4. Source Identity & Deterministic Normalization

### 4.1 Namespace & Source Record Key
To guarantee 100% collision-free traceability, every row receives a stable, deterministic identifier:
```text
tml_source_record_id = TENNISMYLIFE:<category>:<filename>:<tourney_id>:<tourney_date>:<match_num>:<winner_id>:<loser_id>
```
If a key element is missing, an explicit documented fallback tag is used (e.g. `NAME_<normalized_name>`), confidence is reduced, and the row is routed to quarantine. Array index is never used as an identity.

### 4.2 Lossless Normalization Standards
For every record, the adapter retains both the raw row dictionary and the normalized row:
- **Dates:** ISO `YYYY-MM-DD` (converting `YYYYMMDD` integers).
- **Surface:** Controlled enum: `Hard`, `Clay`, `Grass`, `Carpet`, `Unknown`.
- **Indoor:** Boolean (`true` for `I`/`1`, `false` for `O`/`0`, `null` if blank).
- **Rounds:** Canonical uppercase codes (`F`, `SF`, `QF`, `R16`, `R32`, `R64`, `R128`, `RR`, `Q1`, `Q2`, `Q3`).
- **Best Of:** Integer (`3` or `5`).
- **Duration:** Integer minutes or `null`.
- **Player Names:** Unicode NFD normalized, accents stripped, alphanumeric spaces cleaned.
- **Biometrics:** Cleaned integers/floats for height (cm), hand (`R`/`L`/`A`/`U`), IOC code, age, rank, rank points, seed, entry status.
- **Service Telemetry:** 18 physical fields (`w_ace`..`w_bpFaced`, `l_ace`..`l_bpFaced`) as integers or `null`.

---

## 5. Read-Only Linkage & Match Fingerprinting

### 5.1 Player Resolution Precedence
Linkage against frozen Phase 3 registries (`identity_players.jsonl`, `identity_player_aliases.jsonl`) enforces strict precedence:
1. `RESOLVED_EXACT_SOURCE_ID`: Exact source player code match (ATP alphanumeric code or verified numeric ID).
2. `RESOLVED_VERIFIED_ALIAS`: Exact match against a verified alias in `identity_player_aliases` where `is_verified = true` and `has_sibling_conflict = false`.
3. `RESOLVED_NAME_COUNTRY`: Exact normalized name match + matching IOC country code.
4. `CANDIDATE_REVIEW`: Multiple potential candidates or ambiguous homonyms (e.g. `has_sibling_conflict = true`).
5. `UNRESOLVED`: Competitor not present in canonical registry.

> [!WARNING]
> Ambiguous homonyms and unmapped lower-tier competitors are never automatically linked. They are strictly routed to `unresolved-players.jsonl` or candidate review.

### 5.2 Tournament & Edition Resolution Precedence
Linkage against Phase 3 tournaments and Phase 4 editions (`competition_tournament_editions.jsonl`):
1. `RESOLVED_EXISTING_EDITION`: Match against verified tournament alias + tour + year + surface yielding a unique Phase 4 `edition_id`.
2. `RESOLVED_EXISTING_TOURNAMENT_NEW_EDITION_CANDIDATE`: Tournament recognized, but specific annual edition not present in Phase 4.
3. `QUALIFICATION_EVENT`: Pre-tournament qualifying draws (e.g. `atp_quali`, `round = Q1/Q2/Q3`).
4. `TEAM_OR_EXHIBITION_EVENT`: Davis Cup, United Cup, Laver Cup, or non-tour exhibitions.
5. `UNRESOLVED_TOURNAMENT`: Unmapped tournament names routed to `unresolved-tournaments.jsonl`.

### 5.3 Natural Match Fingerprint & Classification
Where an edition and both competitors are resolved ($p_1 \ne p_2$):
```text
Fingerprint := edition_id ":" scheduled_date ":" round ":" player_id_low ":" player_id_high
```
where $\text{player\_id\_low} = \min(p_1, p_2)$ and $\text{player\_id\_high} = \max(p_1, p_2)$.

Match Classifications:
- `EXISTING_CANONICAL_MATCH`: Matches an established Phase 5 fixture with consistent outcome.
- `POSSIBLE_EXISTING_MATCH`: Matches within $\pm 2$ day schedule tolerance.
- `NEW_MATCH_CANDIDATE`: Edition and players resolved, but no Phase 5 match exists (potential gap fill).
- `DUPLICATE_WITHIN_TML`: Identical fingerprint observed within TennisMyLife datasets.
- `CONFLICT_WITH_CANONICAL`: Contradicts canonical outcome (winner or score contradiction).
- `UNRESOLVED_PLAYER`: One or both players unresolved.
- `UNRESOLVED_EDITION`: Tournament edition unresolved.
- `NON_SINGLES_OR_UNSUPPORTED`: Qualifying, team, or exhibition matches.
- `INVALID_ROW`: Missing critical identity or date fields.

---

## 6. Safe Enrichment & Telemetry Audits

### 6.1 Safe Enrichment Policy
For matches resolving to `EXISTING_CANONICAL_MATCH`, candidate enrichments are generated in `enrichment-candidates.jsonl`:
- **Allowed Fields:** `duration_minutes`, `score_string`, `winner_ht`, `loser_ht`, `winner_hand`, `loser_hand`, `winner_age`, `loser_age`, `winner_rank`, `loser_rank`, `winner_rank_points`, `loser_rank_points`, `winner_seed`, `loser_seed`, `winner_entry`, `loser_entry`, and all 18 service telemetry fields.
- **Agreement Statuses:**
  - `AGREES`: Existing canonical value matches TML value.
  - `FILL_NULL_CANDIDATE`: Existing canonical field is NULL; TML provides authentic telemetry.
  - `CONFLICT_REVIEW`: Values diverge; flagged for review queue.
  - `SOURCE_INVALID`: Violates physical invariants.
  - `NOT_COMPARABLE`: Field schema mismatch.

### 6.2 Phase 6 Statistics & Telemetry Audit
The adapter performs a dedicated diagnostic audit to inform Phase 6:
- Count of rows with score and duration.
- Count of rows with service statistics (winner complete, loser complete, partial).
- Validation of physical invariants:
  $$\text{ace} \ge 0, \quad \text{df} \ge 0, \quad \text{svpt} \ge 0, \quad \text{1stIn} \ge 0, \quad \text{1stWon} \ge 0$$
  $$\text{1stWon} \le \text{1stIn}$$
  $$\text{bpSaved} \le \text{bpFaced}$$
  $$\text{2ndWon} \le (\text{svpt} - \text{1stIn})$$
  Any violation is flagged as `STATISTICAL_INVARIANT_VIOLATION` and quarantined from Phase 6 admission.

---

## 7. Conflict Handling & Quarantine Taxonomy

### 7.1 Conflict Candidates (`conflict-candidates.jsonl`)
Every divergent outcome is captured with full context:
- `conflict_id`: Deterministic hash.
- `source_record_id`: TML record ID.
- `canonical_match_id`: Associated Phase 5 canonical fixture.
- `field`: Divergent field (`winner_player_id`, `score_string`, `duration_minutes`).
- `canonical_value`: Current canonical value.
- `tennismylife_value`: TML incoming value.
- `severity`: `HIGH` (winner mismatch) or `MEDIUM` (score/date discrepancy).
- `suggested_disposition`: `MANUAL_REVIEW_REQUIRED`.

### 7.2 Quarantine Registry (`quarantine.jsonl`)
Every non-admitted source observation is logged with an explicit, traceable reason:
- `UNRESOLVED_PLAYER`
- `UNRESOLVED_EDITION`
- `NON_SINGLES_OR_UNSUPPORTED`
- `DUPLICATE_WITHIN_TML`
- `STATISTICAL_INVARIANT_VIOLATION`
- `INVALID_ROW`
No source row is silently discarded.

---

## 8. Twenty Safety Quality Gates (G1–G20)

| Gate ID | Name | Pass Condition |
| :--- | :--- | :--- |
| **G1** | Manifest Retrieval Succeeded | HTTP 200 response from manifest endpoint. |
| **G2** | Manifest Schema Valid | JSON parsed with valid `files` array. |
| **G3** | Selected Files Acquired | 100% of selected files downloaded or loaded from cache. |
| **G4** | File Cryptographic Integrity | Every acquired file has SHA-256 and positive byte size. |
| **G5** | CSV Schema Profiles Generated | Every file has a complete schema profile in `schema-profiles.json`. |
| **G6** | Zero Silent Row Loss | Total source rows = valid rows + empty/invalid rows. |
| **G7** | No Silent Malformed Rows | Malformed row count tracked; malformed rows quarantined. |
| **G8** | Zero Canonical Writes | No INSERT/UPDATE to canonical tables. |
| **G9** | Zero SQLite Mutation | Source SQLite databases verified bit-for-bit unchanged ($\Delta = 0$ bytes). |
| **G10** | Zero PostgreSQL Mutation | 0 queries or connections attempted. |
| **G11** | Zero Ambiguous Player Auto-Links | Ambiguous homonyms and unknown players isolated to review/quarantine. |
| **G12** | Zero Ambiguous Tourney Auto-Links | City/sponsor collisions isolated; qualifying/exhibition distinguished. |
| **G13** | Explicit Disposition Balance | Every row accounted for in links, conflicts, or quarantine. |
| **G14** | Bitwise Deterministic Hashes | Two successive executions yield bit-for-bit identical hashes. |
| **G15** | Phase 5 Coverage Audit | Detailed coverage breakdown generated. |
| **G16** | Phase 6 Statistics Audit | Detailed telemetry and invariant audit generated. |
| **G17** | Missing-to-Zero Prevention | Missing numerical values remain NULL; 0 zeros imputed. |
| **G18** | Conflict Candidates Preserved | All conflicting rows preserved in `conflict-candidates.jsonl`. |
| **G19** | Explainable Quarantine | 100% of quarantine records contain a documented reason. |
| **G20** | Output Manifest Reproducibility | All artifact sizes and SHA-256 hashes published in `output-manifest.json`. |

---

## 9. Permanent Regression Fixtures

The adapter enforces regression verification against the four Phase 5 conflict fixtures and five lower-tier player test cases:
1. **Hua Hin 2024 (WTA):** Two separate editions (January and September) with opposite winners must not collapse into one match.
2. **Australian Open 2026 Qualifying:** Qualifying draw matches must remain separate from main draw fixtures.
3. **Davis Cup 2023:** Separate team ties must remain distinct.
4. **Shanghai Asian Challenger 2023:** Adjacent-day matches must remain distinct.
5. **Lower-Tier Players:**
   - Leite W.
   - Jorda Sanchis D.
   - Barton H.
   - Dalla Valle E.
   - Trotter J. K.
   These competitors must remain `UNRESOLVED` or `CANDIDATE_REVIEW` and must never be auto-linked as canonical.

---

## 10. Official Binding Statement

> “TennisMyLife dry-run evidence was acquired and evaluated as a secondary validation/enrichment source. No canonical database or production runtime was modified.”
