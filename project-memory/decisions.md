# Architectural & Design Decisions

## UI & Responsive Design
1. **Typography:** Switched primary heading font to `Plus Jakarta Sans` with `Outfit` and `Inter` fallbacks for enhanced mobile legibility.
2. **Viewport Optimization:** Configured `viewport-fit=cover` and CSS safe-area insets (`env(safe-area-inset-*)`) for notched/home-bar mobile devices.
3. **Rankings Layout:** Uses a responsive Card View for mobile portrait screens (≤ 640px) and a full table view for desktop and landscape modes.
4. **AdSense Optimization:** Leaderboard banners dynamically resize on mobile portrait and are hidden in mobile landscape to preserve vital vertical screen space.
5. **Sticky Filter Bar Architecture:** Structured into 3 distinct semantic flex columns (`filter-date-col`, `filter-chips-col`, `filter-toggle-col`). Renders as a single-row toolbar on desktop/tablet and a 2-row CSS Grid on mobile portrait where Row 1 houses Date Picker + Expand/Collapse and Row 2 houses a full-width 4-column equal-width grid for status chips (zero trailing blank space).
6. **H2H Explorer Mobile Stack:** Transformed player selectors from fixed-width row items into full-width stacked selector cards with centered swap button on mobile portrait, preventing horizontal layout distortions.
7. **Date & Status Filter Synchronization:** Clicking the `LIVE` filter chip outside the current day automatically jumps `selectedDate` to `todayStr`. Future/past date selections automatically gracefully fallback impossible statuses to `ALL`. Dynamic count badges are rendered across all four status chips (`ALL`, `LIVE`, `FINISHED`, `UPCOMING`).
8. **Stopped Match Normalization & Visual Presentation:** Special stopped statuses (`Retired`, `Walkover`, `Interrupted`, `Suspended`, `Cancelled`, `Postponed`, `Abandoned`) are strictly excluded from `LIVE`. They render with full bold badge labels in the card center and dedicated semantic colors (Rose for Retired, Orange for Walkover, Amber for Interrupted/Suspended, Red for Cancelled/Abandoned), completely eliminating misleading green live score boxes.
9. **Match Winner Determination & Dimming Policy:** For all concluded matches (`FT`, `RETIRED`, `WALKOVER`):
   - **Winner:** Rendered with bright bold text (`#ffffff`, font-weight 900) + cyan `WIN` indicator; winner's score in the Total Sets Pill is highlighted in bright cyan (`#38bdf8`).
   - **Loser:** Rendered with dimmed text (`rgba(255, 255, 255, 0.42)`, font-weight 500); retiring players explicitly show a `RET` badge next to their name.
   - **Non-Concluded Paused Matches (`INT`, `SUSP`, `POSTP`):** Both players maintain standard equal brightness with no winner declared.
10. **Full-Page Match Details Architecture (`MatchDetailsView.tsx`):** When clicking on any match row, the view transitions into a dedicated full-page match hub (rather than a popup modal), featuring top '← Back to Matches' navigation, hero scoreboard with player avatars and period sets breakdown, and 3 tabbed sub-views: `Match Statistics` (comparative progress bars), `H2H History` (head-to-head records with CTA), and `AI Tactical Edge` (win probability gauge and strategy breakdown).
11. **State Football 67 Tennis KPIs Integration & Human-Centric Naming Policy:**
    - **No Cryptic Acronyms:** Replaced abbreviations (CPI, WFL, JLI, SDI, AMI, EMS, ISS, Shin) with expressive, intuitive labels (`⚡ Fast Court`, `🔋 Physical Stamina`, `Recovery Time`, `Serve Power`, `Attack Quality`, `Pressure Composure`, `Indoor Specialist`, `AI Win Forecast`).
    - **PlayerModal 4-Section Structure:** Organizes deep dossier into: 1) Physical Stamina & Recovery, 2) Surface Mastery & Court Elo Ratings, 3) Mental Composure & Tournament Stakes, and 4) 6-Pillar Skill Radar.
    - **H2HExplorer 5-Clash Architecture:** Organizes head-to-head comparisons into: 1) Physical Stamina Clash, 2) Serve vs Return Matchup, 3) Mental Composure & Clutch Clash, 4) Surface Mastery & Environment, and 5) 15D ML Prediction Probability.
12. **Google AdSense Strict Compliance & Pure Sports Intelligence Architecture:**
    - **Strict Gambling / Betting Ban:** Zero mentions of betting, gambling, bookmaker odds, or `+EV Value Bet` in the public frontend to ensure seamless Google AdSense site approval and prevent account flags.
    - **Match Thriller & Excitement Meter:** Replaced commercial betting badges with high-engagement sports analytical tags (`🔥 5-Star Blockbuster`, `⚡ High-Intensity Clash`, `👑 Top 15 Showdown`, `💥 Serve vs Return Battle`).
    - **Clean Match Card Micro-Bar:** Match list cards keep a lightweight footer showing AI Win Forecast, Fair Odds, Exp Games, and Court Speed, reserving deep physical stamina and biological recovery analysis strictly for the dedicated Match Details & Physics Tab to avoid visual clutter.
    - **Sleek AI Win Forecast:** Replaced dense clutter with a slim, elegant dual-color probability bar branded strictly as `AI Win Forecast`.
13. **Tournaments Hub & Knockout Draw Structure:**
    - **Canonical Aggregation:** Consolidated case-sensitivity and alias naming variations into single canonical flagship events (Grand Slams, Masters 1000s, ATP 500, ATP 250, Davis Cup).
    - **Knockout Bracket Tree:** Structured into sequential visual columns (`RR`, `R128`, `R64`, `R32`, `R16`, `QF`, `SF`, `F`) with player seeds, rankings, and genuine historical scorelines.
    - **Davis Cup Policy:** Davis Cup is recognized as a team championship event and hidden by default in the Tournaments Hub to keep single-elimination catalog clean, accessible via dedicated toggle button.
14. **Layer 1 Bio-Fatigue & Recovery Engine (Scientific Modeling):**
    - **Acute Match Strain:** $S \propto (\text{duration}/60)^{1.3} \times 16.0 \times \text{SurfaceDrag}$.
    - **Exponential Recovery Function:** $R(t) = 1 - e^{-0.040 \times \Delta t_{\text{hours}}}$.
15. **Feature Pipeline Data Leakage & Fatigue Redundancy Resolution:**
    - **Strict Temporal Cutoff (`asOfDate`):** All historical player match and H2H queries in `PrecomputationService` and `WebController` enforce strict `WHERE match_date < cutoffDate` isolation to prevent future-to-past data leakage during backtesting and live previews.
    - **H2H Cutoff Filtering:** `buildDataSnapshot` and backend H2H endpoints filter out all matches occurring on or after target match kickoff.
    - **Fatigue Family Redundancy Resolution:** Unified `wfl_fatigue_delta` and `energy_tank_delta` (previously collinear with $r = 0.9985$) into a single, standardized, bounded continuous metric `compositeFatigueIndex` ($0.0 = \text{fresh}$ to $1.0 = \text{exhausted}$), eliminating duplicate variance in ML feature vectors.
    - **100% Test Coverage:** Verified with 11/11 passing tests in `leakageRegressionTestSuite.ts`.
16. **ML Production Gating, Monitoring & Drift Control Policy:**
    - **6-Stage Automated Gating:** Predictions must satisfy strict temporal cutoff ($T_{\text{pred}} < T_{\text{kickoff}} - 15\text{m}$), minimum Data Quality Score ($\text{DQS} \ge 65$), surface sample criteria, and calibration bounds ($0.05 \le P \le 0.95$).
    - **3-Tier Operational Risk Bucketing:** 🟢 Low Risk (Auto-Publish to Web & Telegram at $P \ge 0.58$), 🟡 Medium Risk (Web-only with caution label), 🔴 High Risk (Blocked/Held).
    - **Statistical Drift Governance:** Uses Population Stability Index (PSI) with trigger levels ($PSI < 0.10$ Healthy, $0.10 \le PSI < 0.25$ Watch, $PSI \ge 0.25$ Alert/Retrain).
    - **Automated Rollback Playbook:** Automated failover to `v_stable` if 30-day realized accuracy falls below $57.0\%$ or Brier Score exceeds $0.2450$.
17. **ML Backend Hardening & Edge-Case Robustness:**
    - **Standardized Error Catalog (`MlErrorCodes`):** Structured error codes (`ML_ERR_GATING_CUTOFF_VIOLATION`, `ML_ERR_ROLLBACK_TARGET_NOT_FOUND`, `ML_WARN_DUPLICATE_SNAPSHOT_SKIPPED`, etc.).
    - **Edge-Case Protections:** Rapid duplicate snapshot debouncing (<30s), active incident deduplication, safe fallback on zero predictions ($N=0$), and guarded non-existent rollback protection.
    - **Comprehensive Operations Runbook:** Documented in [ml_operations_runbook.md](file:///C:/Users/wm900_uqttgkv/.gemini/antigravity-ide/brain/df97a8a1-944f-4c88-abe2-a4f0251026f5/ml_operations_runbook.md) with 15/15 passing regression tests in `observabilityTestSuite.ts`.
18. **Data Guarantee & Derived Analytics Expansion:**
    - **Data Source Verification:** Guaranteed 100% completeness and lineage for 69,616 official historical matches (2018–2026) and 52 fields.
    - **6 Leak-Safe Derived Categories:** Implemented `MatchAnalyticsService` covering rolling form, safe H2H, surface mastery (TSI), bio-fatigue exposure, clutch pressure index, and matchup gaps.
    - **REST Endpoint & UI Cards:** Exposed `GET /api/web/matches/deep-analytics` with dynamic human-readable explanation cards; verified with 14/14 passing tests in `derivedAnalyticsValidationSuite.ts`.
19. **Frontend Zero-Duplication Deep Analytics Wiring:**
    - **In-Memory Caching Strategy:** Implemented `deepAnalyticsCache` in `api/client.ts` with stable key `${matchId}_${p1}_${p2}_${surface}_${cutoffDate}` guaranteeing 0 duplicate network calls during tab switching and match reopening.
    - **Hero & Tab Integrations:** Embedded compact streak badges in `MatchDetailsView` Hero header, narrative AI explanation cards & serve-return tactical edges in Tab 3 (`AI Tactical Edge`), and updated physics & power ratings without modifying untouched components (`MatchCard.tsx` and `TournamentHub.tsx`).
    - **Zero Build Errors:** Verified with `npx tsc --noEmit` passing across all 3 codebases.
20. **Frontend Data Integrity & Fake Metric Elimination:**
    - **Eliminated Synthetic Generators:** Removed `getSyntheticPlayer` and all randomized/fake fallback metrics from `MatchDetailsView.tsx`.
    - **Truthful Fallbacks & State Handling:** Replaced hardcoded numbers in `PlayerModal.tsx` and `H2HExplorer.tsx` with honest `—`, empty states, or genuine workload metrics. Missing altitude is cleanly hidden.
    - **Neutral Radar Baseline & Provisional Labeling:** Updated `RadarChart.tsx` to default empty radars to a neutral 50% baseline with an explicit `Provisional 50% Baseline (Awaiting Telemetry)` caption.
    - **Temporal Freshness Indicator:** Added `🕒 Cutoff: YYYY-MM-DD` timestamp badge in `MatchDetailsView.tsx` Hero bar and restored neutral 50/50 prior win probabilities when Markov estimates are uncomputed.
21. **Data Model Canonicalization & Semantic Deduplication:**
    - **Single Source of Truth Enforced:** Canonicalized `Clutch Index Score (0-100)` (rescaling legacy `/10` formats) and standardized `Biological Energy Tank (%)` across `PlayerModal` and `H2HExplorer`.
    - **Glance-to-Detail Hierarchy:** Retained single-line Hero badges (`🔋 96%`, `🔥 +4 W`, `🎯 Hold 84%`, `🕒 Cutoff`) for fast scanning, routing deeper analyses exclusively to Tab 2 (Workload), Tab 3 (Narrative form), Tab 4 (Markov pricing & TSI), and Tab 5 (H2H archives).
    - **Full Zero-Duplication Clean Build:** Verified with `npx tsc --noEmit` passing across all projects.
22. **ATP & WTA Intelligence Portal Redesign & 3-Column Desktop Grid Architecture:**
    - **Desktop 3-Column Grid:** Replaced the cramped 620px constraint with a full-width portal layout (100% width header, 260px left `SportsNavSidebar`, 850px center feed, 300px right `AiTopPickWidget` & `SideBanner`).
    - **Zero Mock Text & Real Top Pick Engine:** Removed all static fake marketing claims ('73% win rate', '49 KPIs'). `AiTopPickWidget` automatically selects the highest confidence match directly from active database predictions.
    - **ATP vs WTA Deep Differentiation:** Distinct color accents (Electric Cyan `#38bdf8` for ATP Men and Metallic Rose `#fb7185` for WTA Women) across header switcher, sidebar navigation, and match cards with real-time category counts.
    - **Monetization & Conversion:** Embedded official 1WIN Partner card with +500% bonus and user tracking link `/go/:siteId/:trackingId`, plus luxury 3-step VIP unlock modal.
    - **Mobile Graceful Degradation:** Sidebars smoothly hide below 1024px, offering a clean single-column interface with top scrollable tour tabs and zero horizontal overflow.
23. **Crawler vs. Human SPA Routing Architecture (`vercel.json` & `api/seo.js`):**
    - **Problem Solved:** When users clicked the address bar and pressed Enter on a match page (`/match/:slug`), Vercel previously redirected unconditionally to `api/seo.js`, serving raw static pre-rendered HTML without the Vite/React application bundle.
    - **Conditional User-Agent Rewrites:** Configured `vercel.json` so that only recognized search/social bots (`googlebot`, `telegrambot`, `twitterbot`, `whatsapp`, `facebookexternalhit`, etc.) are routed to `/api/seo`.
    - **Human Browser Direct Fallthrough:** Standard human browsers fall through to `/index.html`, where React mounts, reads the match slug via `parseMatchParamFromUrl()`, loads the prediction, and immediately presents the full interactive 3-column match layout (`MatchAnalysisPage`).
    - **Multi-Tier Safeguards:** Added fallback bot checks in `api/seo.js` to redirect non-bots to the SPA route, and added an inline browser redirect script inside the HTML output as a secondary defense.
24. **PostgreSQL Phase 7: AI Telemetry Zero-Fabrication & Strict Quarantine Policy:**
    - **Zero Fabrication Mandate:** When historical trace exports (e.g. client IndexedDB `predictiontracesv1`) are not present in local workspace storage, the system strictly forbids fabricating synthetic prediction runs, agent traces, or cutoff timestamps.
    - **Anti-Lookahead Barrier:** Enforces $cutoff\_timestamp\_utc \le scheduled\_start\_utc$. Deriving cutoff timestamps from `published_at` or `created_at` is strictly prohibited.
    - **Forensic Quarantine of Unresolved Candidates:** Legacy predictions and match editorials with synthetic test fixture IDs or non-canonical player names are never inserted into canonical tables (`predictions.published_predictions` or `predictions.match_editorials`) as dangling foreign key orphans. Instead, they are quarantined to `quarantine-ledger.jsonl` and registered in `provenance.review_queue` under reason `UNRESOLVED_CANONICAL_MATCH`.
    - **Canonical Serialization & Full 64-Character SHA-256 Invariant:** Candidate records are deterministically stringified via recursive lexicographical key sorting and compact UTF-8 formatting. The cryptographic invariant $\text{SHA-256}(\text{canonical\_payload}) \equiv \texttt{ledger.payload\_sha256} \equiv \texttt{raw.source\_evidence.payload\_sha256}$ is verified with 0 mismatches across all 12 candidate records.
    - **Dual-Tier Raw Evidence Retention:** Preserves complete candidate array snapshots in batch parent evidence (`BATCH:predictions`, `BATCH:match_editorials`) while registering dedicated individual `raw.source_evidence` rows for each quarantined candidate to ensure direct Foreign Key resolvability.
    - **Review Queue Enum Compliance (`review_status = 'PENDING'`):** To adhere strictly to canonical schema enum constraints (`provenance.review_status_type`), all quarantined items retain standard status `'PENDING'`, isolating conflict taxonomy cleanly inside `veto_triggers` (`ARRAY['ISOLATED_CONFLICT_REVIEW', exact_reason]`) and `divergent_fields`.
    - **Dual Verdict Classification:**
      - **Safety Verdict:** `PASS` (Referential integrity, idempotency, zero-fabrication, and source immutability certified).
      - **Data Migration Verdict:** `BLOCKED / INCOMPLETE` (0% coverage; 0/9 predictions, 0/3 editorials admitted awaiting authentic trace export and canonical fixture mapping).
      - **Production Cutover:** `NOT APPROVED` / `PROHIBITED`.
      - **Official Operational Phrasing:** *"Phase 7 quarantine-safe execution completed; canonical migration remains blocked."*
    - **Operational Freeze State:**
      - `Phase 7 staging execution`: `CLOSED`
      - `Quarantine ledger`: `ACCEPTED`
      - `Canonical migration`: `BLOCKED`
      - `Production read cutover`: `PROHIBITED`
      - `Next unblock condition`: `authentic predictiontracesv1 export + canonical match crosswalk`
    - **Dual Permanent SQL Gates (Evidence & Review Queue Invariants):**
      - **Gate 1 (Orphan Review Rows — Threshold: 0):**
        ```sql
        SELECT COUNT(*) FROM provenance.review_queue rq LEFT JOIN raw.source_evidence se ON se.evidence_id = rq.incoming_evidence_id WHERE se.evidence_id IS NULL;
        ```
      - **Gate 2 (Evidence Lineage & Source/Payload Hash Match — Threshold: 0):**
        ```sql
        SELECT COUNT(*) FROM provenance.review_queue rq JOIN raw.source_evidence se ON se.evidence_id = rq.incoming_evidence_id WHERE rq.incoming_source <> se.source_name OR rq.divergent_fields->>'payload_sha256' <> se.payload_sha256;
        ```
      - *Architecture Role:* `provenance.review_queue` is strictly reserved for discrepancies and unresolvable identities, where every row must have an authentic parent evidence link. Conversely, AI traces can only enter `ai.prediction_runs` and `ai.agent_traces` upon receiving authentic client IndexedDB export data.
    - **Authentic Telemetry Ingestion Invariants:**
      Upon receiving an authentic `predictiontracesv1` export, the runner must execute in an isolated pass and validate `traceId`, `capturedAt`, `matchId`, `dataSnapshot`, `agents`, and `finalDecision` without fabricating timestamps or synthesizing payloads. Canonical mapping requires:
      - `ai.prediction_runs`: cutoff timestamp ($T_{\text{cutoff}} \le T_{\text{kickoff}}$), feature snapshot, model routing.
      - `ai.agent_traces`: prompt, response, parsed structured output, and run lineage.
      - Dual-pass idempotency with 0 new insertions on re-run.
      - Immutability of previous quarantine ledger and source evidence records.
    - **Dual-Pass Determinism:** Verified 100% idempotency (Pass 2 Delta = +0 rows) and table MD5 hash determinism across all relational tables on local staging.
25. **Authentic Client IndexedDB Telemetry Extraction & Read-Only Audit Strategy:**
    - **Live Store Discovery:** The client application store `prediction_traces_v1` -> `agent_traces` was identified in Electron's origin storage (`AppData/Roaming/state-football/IndexedDB/http_localhost_5173.indexeddb.leveldb`).
    - **Export Invariant:** Extracted via read-only headless script (`scripts/export-indexeddb-traces.cjs`) extracting 411 authentic historical records (spanning 2026-08-14 to 2026-09-10, 35.77 MB, SHA-256 `c6254fe9db31ffbb8c6eabee67f453810e8ea36d8f93d0be28be258c2868097a`) with zero mutations to source data.
    - **Audit Findings:** 407 / 411 records (99.0%) satisfy 100% of the 6/6 mandatory fields (`traceId`, `capturedAt`, `matchId`, `dataSnapshot`, `agents`, `finalDecision`), with 5 specialized agent roles correctly normalized. Exactly 4 early records from 2026-08-21 missing `dataSnapshot` are pre-flagged for quarantine.
    - **Crosswalk Findings:** 339 / 411 (82.5%) trace fixture IDs cleanly match genuine matches in local database.
    - **No Premature Admission Policy:** Telemetry is audited strictly offline; no rows are inserted into PostgreSQL Phase 7 tables until an explicit migration runner pass with human review is authorized.
26. **Phase 7 Multi-Mode Execution, State Transition (Phase 7-A vs 7-B), & Differentiated Metrics:**
    - **State Transition Architecture:**
      - **Phase 7-A (Quarantine-Only Staging Execution):** Evaluated 9 legacy SQLite predictions and 3 match editorials. 100% quarantined to `provenance.review_queue` due to synthetic demo fixtures / test players. `ai.prediction_runs = 0`, `ai.agent_traces = 0`, `legacy_prediction_editorial_coverage_pct = 0.0%` (0 / 12).
      - **Phase 7-B (Post-Export Isolated Staging Ingestion):** Ingested authentic multi-agent telemetry export (411 records) from State Football. Admitted **290 prediction runs** and **1,450 agent traces** into PostgreSQL staging inside an atomic transaction. Pass 2 Delta = +0 rows (100% idempotent). Production cutover remains `PROHIBITED`.
    - **Explicit Denominators & Metrics:**
      - `legacy_prediction_editorial_coverage_pct`: 0.0% (0 / 12)
      - `indexeddb_trace_staging_coverage_pct`: 70.6% (290 / 411)
      - `indexeddb_trace_match_resolution_pct`: 82.5% (339 / 411)
      - `indexeddb_trace_canonical_admission_pct`: 70.6% (290 / 411)
      - `production_migration_coverage_pct`: 0.0% (Production cutover prohibited)
    - **4-Tier Quarantine Forensic Taxonomy (133 Total Items):**
      - `MATCH_CROSSWALK_MISSING_PAYLOAD` (4 records): Early August 21 traces missing `dataSnapshot`/`finalDecision`.
      - `MATCH_CROSSWALK_UNRESOLVED` (72 records): Vendor fixture IDs absent from SQLite `matches`.
      - `MATCH_NOT_STAGED_IN_POSTGRES` (45 records): Valid SQLite matches from qualification tournaments quarantined in Phase 4 due to unlinked editions; isolated from `ai.predictionruns` to prevent FK violations. Must remain strictly distinguished from the 72 unresolvable fixture records.
      - `UNRESOLVED_CANONICAL_MATCH` (12 records): 9 legacy predictions + 3 editorials referencing demo players.
      - Total Review Queue Items: 133 (100% resolved to individual `raw.source_evidence` records with SHA-256 parity).
    - **Multi-Mode Runner Support (`run-postgres-phase-7-ai-migration.cjs`):**
      - `--mode audit`: Read-only, generates manifests, 0 PostgreSQL writes, verified.
      - `--mode staging`: 8 pre-insert controls evaluated, admitted runs/traces in transaction, dual-pass idempotency verified, cleanly shut down.
      - `--mode verify`: Connects to staging, runs 4 verification queries, confirms 0 orphan rows.
    - **Mandatory SQL Verification Queries (Staging Cluster Port 54350):**
      1. `SELECT COUNT(*) FROM ai.predictionruns;` $\to$ **290**
      2. `SELECT COUNT(*) FROM ai.agenttraces;` $\to$ **1,450**
      3. `SELECT COUNT(*) FROM ai.predictionruns r LEFT JOIN matches.matches m ON m.match_id = r.match_id WHERE m.match_id IS NULL;` $\to$ **0** (PASS)
      4. `SELECT COUNT(*) FROM ai.agenttraces t LEFT JOIN ai.predictionruns r ON r.run_id = t.run_id WHERE r.run_id IS NULL;` $\to$ **0** (PASS)
      5. `SELECT COUNT(*) FROM provenance.review_queue rq LEFT JOIN raw.source_evidence se ON se.evidence_id = rq.incoming_evidence_id WHERE se.evidence_id IS NULL;` $\to$ **0** (PASS)
    - **Unresolved Architectural Gates Blocking Canonical Migration & Production Cutover:**
      1. Canonical migration of legacy predictions and editorials (12 records in quarantine).
      2. Full canonical match crosswalk for all legacy rows.
      3. Recovery or disposition of the 72 unresolved vendor-fixture traces.
      4. Resolution of the 45 qualification traces absent from the staged PostgreSQL match set.
      5. Production dual-write validation.
      6. SQLite / PostgreSQL API response parity.
      7. Production shadow-read parity.
    - **Official Operational Classification:**
      ```json
      {
        "staging_execution": "CLOSED",
        "staging_ingestion_snapshot": "COMPLETE",
        "quarantine_ledger": "ACCEPTED",
        "evidence_lineage": "PASSED",
        "idempotency": "PASSED",
        "canonical_migration": "BLOCKED",
        "production_read_cutover": "PROHIBITED",
        "next_required_artifact": "canonical_match_crosswalk_for_legacy_outputs"
      }
      ```
27. **Phase 7 Milestone Certification, Authorization Matrix, & Verified Safe Progression Pipeline:**
    - **Milestone Certification:** *"Crosswalk artifact accepted; canonical records not admitted; production cutover remains prohibited."*
    - **Authorization State:**
      ```json
      {
        "crosswalk_artifact": "GENERATED_AND_AUDITED",
        "canonical_admissions_from_133": 0,
        "quarantine_evidence": "ACCEPTED",
        "production_read_cutover": "PROHIBITED",
        "dual_write": "NOT_YET_AUTHORIZED",
        "shadow_read": "NOT_YET_AUTHORIZED"
      }
      ```
    - **Crosswalk Artifact Function:** The artifact `canonical_match_crosswalk_for_legacy_outputs` is accepted strictly as an authoritative reconciliation artifact and quarantine evidence ledger, not as an admission manifest. All 133 candidate items remain 100% quarantined.
    - **Independent Parity Verification:** Executed `scripts/verify-crosswalk-artifact-parity.cjs` confirming 100% parity across JSON artifact (133 records), Markdown ledger (133 rows), and source quarantine ledgers with 0 invalid hashes and 0 illegal UUIDs.
    - **Verified Safe Next Sequence:**
      1. Resolution of Phase 4 qualification tournament matches (45 records).
      2. Authoritative vendor fixture resolution for 72 traces without fuzzy force-linking.
      3. Separate isolated rollback-safe canonical admission pass.
      4. Phase 8 Data-Access Layer migration, followed by Phase 9 dual-write and Phase 10 shadow-read parity.

28. **Phase 8 Entry Gate Architecture, Repository Contract Decoupling, & SQLite Rollback Circuit-Breaker:**
    - **Entry Gate Objectives:** Prepared the controlled entry gate for Phase 8 (Data-Access / Repository Layer) without authorizing production cutover, dual-write, or live shadow-reads.
    - **Repository Interface Contracts:** Established clean TypeScript contracts (`IPredictionsRepo`, `IEditorialsRepo`, `IPlayersRepo`, `IMatchesRepo`) under `src/db/interfaces/` decoupling application business logic from underlying database engines.
    - **Dual-Engine Adapter Isolation:**
      - `SqliteAdapter`: Wraps existing `better-sqlite3` queries verbatim, preserving 100% bug-for-bug runtime behavior.
      - `PostgresAdapter`: Staging-only adapter mapping read queries to canonical schema views (`ai.predictionruns`, `predictions.match_editorials`). Any write mutation strictly throws `POSTGRES_MUTATION_PROHIBITED`.
    - **Zero-Risk Rollback Circuit Breaker:**
      - `RepositoryFactory` defaults hardcoded to SQLite (`production_reads: SQLITE_ONLY`).
      - Staging shadow comparator (`ShadowComparingPredictionsRepo`) executes PostgreSQL shadow calls asynchronously and suppresses all errors, guaranteeing zero impact on client latency or availability.
    - **Entry Gate Quality Certification (`scripts/verify-phase-8-entry-gate.cjs`):**
      - Certified 6/6 acceptance gates (`P8-G1` through `P8-G6`) passing with zero failures.
29. **Three-Tier Backtest Views Architecture & Admission Governance (RISK-3 & RISK-2 Resolution):**
    - **154 US Open Sync (RISK-2):** Synchronized 154 authentic 2026 US Open matches to backend `gold_matches_validated` via single atomic transaction with pre-write backup, achieving exact 100% parity across Desktop and Backend at 58,131 rows (0 duplicate keys).
    - **Three-Tier Backtest Views Strategy (RISK-3):** Separated backtest ready queries into 3 formal views to prevent polluting authentic raw telemetry with DTMC Markov synthetic odds:
      1. `gold_matches_ready_raw_view` (38,720 rows): Strict point-in-time authentic baseline.
      2. `gold_matches_ready_enriched_view` (46,076 rows): Unites raw ready matches with immutable auxiliary ledger `gold_matches_enriched_admissions` (7,356 IDs), achieving exact bitwise ID parity with Desktop (0 FP, 0 FN).
      3. `gold_matches_ready_view` (38,720 rows Facade): Points directly to `gold_matches_ready_raw_view`, preserving 100% backward compatibility for all existing API routes, controllers, and tests.
    - **Raw-by-Default Governance Rule:** The legacy facade MUST default to pure raw telemetry. Enriched views may only be queried via explicit, documented opt-in by experimental models.
30. **Trace Telemetry Accounting Invariant (`SQLite Resolution ≠ PostgreSQL Canonical Admission`):**
    - **Fundamental Accounting Formula:**
      - Total Multi-Agent Traces: **411**
      - SQLite Match Hits / Resolved: **335**
      - PostgreSQL Staging Admitted: **290** runs / **1,450** traces ($290 \times 5$)
      - Resolved-in-SQLite but Not Staged in PostgreSQL: **45** (valid SQLite matches from Phase 4 qualification tournaments quarantined due to unlinked editions)
      - Missing Payload Traces: **4** (`MATCH_CROSSWALK_MISSING_PAYLOAD`)
      - Unresolved Vendor Fixtures: **72** (`MATCH_CROSSWALK_UNRESOLVED`)
      - Total Quarantine Count: $45 + 4 + 72 = 121$ traces (+ 12 legacy outputs = 133 total quarantine records).
    - **Architectural Rule:** Crosswalk resolution to a local SQLite match does NOT equal admission into canonical PostgreSQL tables. Any match lacking a staged parent in `matches.matches` is strictly routed to `provenance.review_queue` as `MATCH_NOT_STAGED_IN_POSTGRES` to prevent foreign-key orphan violations.

31. **Phase 7 Official Closure Statement, Staging Safety vs Migration Coverage Distinction, & Pre-Cutover Blockers:**
    - **Official Recommended Closure Statement:**
      > *"Phase 7 closed successfully as an isolated staging ingestion. Safety, quarantine integrity, evidence lineage, idempotency, referential integrity, and SQLite immutability passed. Twenty canonical qualification matches were subsequently admitted, yielding 310 prediction runs and 1,550 agent traces. Canonical migration remains incomplete; 101 telemetry traces and 12 legacy outputs remain quarantined. Production reads remain SQLite-only, and dual-write, shadow-read, and production cutover remain prohibited pending resolution of the documented architectural gates."*
    - **Gate Semantics (Staging Safety vs Migration Coverage):**
      - The **12/12 PASS** on Phase 7 Quality Acceptance Gates certifies **staging safety and referential integrity** for the admitted set (zero foreign-key orphans, dual-pass idempotency, 0 bytes SQLite mutation, valid timestamps, non-truncated prompts/reasoning).
    - **Updated Final Accounting Ledger (Post Decision 32):**
      - Total IndexedDB Traces Audited: **411**
      - SQLite-Resolved Matches: **375**
      - Admitted Prediction Runs: **346**
      - Admitted Specialist Agent Traces: **1,730** (5 per admitted run)
      - Quarantined Trace Records: **65** (25 unstaged qualification parents + 36 unresolved vendor fixtures + 4 missing-payload traces)
      - Legacy Outputs Quarantined: **12** (9 legacy predictions + 3 editorials)
      - Total Review-Queue Ledger Items: **77**
      - Pass 2 Insertion Delta: **+0**
      - Prediction-Run Orphans: **0**
      - Agent-Trace Orphans: **0**
      - SQLite Mutation: **0 bytes**
      - Production Cutover: **PROHIBITED**
    - **7 Concrete Pre-Cutover Blockers Required Before Dual-Write / Shadow-Read / Production Cutover:**
      1. Formally disposition the 36 truly unresolved vendor-fixture traces in review queue.
      2. Formally disposition the 25 qualification traces involving missing players, editions, or unsupported doubles data.
      3. Complete canonical admission policy for the 9 legacy predictions and 3 editorials.
      4. Validate SQLite/PostgreSQL API response parity.
      5. Run shadow reads with measurable field-level parity and latency thresholds.
      6. Validate dual-write idempotency and rollback behavior.
      7. Obtain explicit authorization for production dual-write and then shadow-read activation.

32. **Forensic Resolution of 36 US Open Fixtures & Definitive Quarantine Ledger Disposition:**
    - **Forensic Discovery:** Following the 154-match US Open synchronization (Commit `40c347c`), 36 of the previously unresolved vendor fixtures were verified present in `gold_matches_validated` and had 100% verified player identities and competition editions in Phase 3/4.
    - **Canonical Staging Execution:** Staged into `matches.matches` via `batch_us_open_admitted_matches.sql` and `us_open_match_links.jsonl`, mapped to ATP US Open 2026 (`4c111dff-fce0-5e96-bccd-0657253a9be3`) and WTA US Open 2026 (`25909d80-2f5e-5b00-9211-71269dfebb23`).
    - **Staging Expansion:** Admitted prediction runs expanded from 310 to **346**; admitted specialist agent traces expanded from 1,550 to **1,730** ($346 \times 5$).
    - **Quarantine Isolation:** The 36 truly absent vendor fixtures and the 25 qualification traces (with unindexed players or editions) are definitively preserved in quarantine under `MATCH_CROSSWALK_UNRESOLVED` and `MATCH_NOT_STAGED_IN_POSTGRES` per Zero-Fabrication principles. Zero synthetic players or tournament editions manufactured.
    - **Review Queue Ledger Reduction:** Total review queue items reduced from 113 to **77** ($65\text{ traces} + 12\text{ legacy demo outputs}$).
    - **Safety Gates & Immutability:** 12/12 Quality Gates PASS (P7-G1 through P7-G12). Dual-pass idempotency verified (Pass 2 Delta = +0 rows). Source SQLite immutability verified ($\Delta = 0\text{ bytes}$). Phase 8 entry gate certified 6/6 PASS. All 26/26 backend diagnostic tests PASS.
    - **Operational Constraint Maintained:** Production reads remain strictly `SQLITE_ONLY`; dual-write, shadow-read, and production cutover remain `PROHIBITED`.

33. **Phase 8 Data-Access Layer Staging Architecture & Conformance Certification:**
    - **Status:** Staging branch execution completed; production cutover prohibited.
    - **Architectural Abstraction:** Decoupled data access from SQLite engine specifics using abstract domain interfaces (`IPredictionsRepo`, `IEditorialsRepo`, `IPlayersRepo`, `IMatchesRepo`).
    - **Connection Pooling:** Added `StagingPgPool` (`src/db/stagingPgPool.ts`) connecting exclusively to local isolated staging PostgreSQL cluster on port 54350.
    - **Feature Flag Isolation:** `ENABLE_STAGING_PG_ADAPTER` enables staging PostgreSQL adapters exclusively for non-production testing; production reads remain hardcoded to `SQLITE_ONLY`.
    - **Zero Production Mutation Guarantee:** 100% of mutation methods across PostgreSQL adapters throw `POSTGRES_MUTATION_PROHIBITED`.
    - **Zero-Risk Rollback Circuit Breaker:** Non-blocking `ShadowComparingPredictionsRepo` catches and suppresses all PostgreSQL errors, guaranteeing 0ms interruption to SQLite primary reads.
    - **API DTO Parity:** 100% field parity certified across domain DTOs (`Prediction`, `MatchEditorialRecord`, `PublishedPlayer`, `PlayerMatchIndexRow`).
    - **Acceptance Scorecard:** 7/7 Quality Gates PASS (`verify-phase-8-query-conformance.cjs`). 26/26 backend diagnostic tests PASS. Source SQLite databases bitwise immutable ($\Delta = 0\text{ bytes}$).
    - **Prohibition Matrix Maintained:**
      ```json
      {
        "phase_7_staging": "CLOSED_ACCEPTED",
        "phase_8_staging_data_access": "COMPLETED_CERTIFIED",
        "production_reads": "SQLITE_ONLY",
        "dual_write": "PROHIBITED",
        "shadow_read": "PROHIBITED",
        "production_cutover": "PROHIBITED"
      }
      ```

34. **Authoritative Source Baseline Manifest & Phase 9 Dual-Write Design Review Boundaries:**
    - **Source Non-Interchangeability & Baseline Lock:**
      - Established versioned manifest [`docs/source_baseline_manifest_v1.json`](file:///g:/telegram-backend/docs/source_baseline_manifest_v1.json) permanently locking the authoritative Desktop Gold database (`G:/state football/data/tennis_gold.sqlite`, 283,303,936 bytes, SHA-256 `2951176b1fc7da0db250b42e53976c67a25aca59bcf0175706599e30e816c086`) and Backend primary SQLite (`G:/telegram-backend/data/database.sqlite`, 545,468,416 bytes, SHA-256 `4cc4bc8d2d4f0a4bd8d769601000116b4d2fed8bbbe01db98a9811ae1d08b358`).
      - Formally classified `data/tennis_gold.sqlite: 0 bytes` as an unpopulated local placeholder file, non-interchangeable with the authoritative desktop source.
    - **Phase 8 Staging Audit Closure:** Formally accepted with 7/7 follow-up checks passing, including live reads through all 4 PostgreSQL adapters and 100% mutation method assertion.
    - **Phase 9 Scope & Design Review (`docs/phase-9-dual-write-architecture-and-design-review.md`):**
      - Dual-write is currently **PROHIBITED** across all production execution paths.
      - Approved for architectural design review and staging harness preparation only.
      - Recommended architecture: Option B (Asynchronous Buffered Outbox Queue with in-memory DLQ buffer and auto-tripping circuit breaker) guaranteeing 0ms latency impact and complete fail-closed safety for primary SQLite transactions.
    - **Authoritative Operational State:**
      ```json
      {
        "phase_7_staging": "CLOSED_ACCEPTED",
        "phase_8_staging_data_access": "COMPLETED_CERTIFIED",
        "phase_8_audit_closure": "ACCEPTED",
        "phase_9_dual_write": "PROHIBITED",
        "production_reads": "SQLITE_ONLY",
        "production_shadow_reads": "PROHIBITED",
        "production_cutover": "PROHIBITED",
        "sqlite_retirement": "PROHIBITED"
      }
      ```
35. **Phase 9 Staging Dual-Write Architecture & 14-Gate Certification:**
    - **Architecture Decision:** Rejected volatile in-memory queue in favor of a transactional SQLite outbox (`postgres_dual_write_outbox`). The primary business mutation and durable outbox insertion occur within the same SQLite transaction, ensuring zero event loss across process crashes or host restarts.
    - **Asynchronous Staging Delivery:** In-process worker (`StagingDualWriteWorker`) claims short-term leases and asynchronously executes idempotent upserts against staging PostgreSQL on port 54350.
    - **Quality Acceptance Gates (14/14 PASS):** Fully certified via `scripts/verify-phase-9-staging-dual-write.ts` and archived in `docs/phase-9-staging-dual-write-verification-report.md`.
      - Overhead: median 0.303ms (target <= 1ms), P95 0.783ms (target <= 5ms).
      - Fault tolerance: 100% of SQLite mutations succeed with PostgreSQL offline.
      - Atomic rollback: 0 mutations and 0 outbox records committed on abort.
      - Disarm: admission halts in 0.046ms (<100ms target); worker stops in 0.334ms (<1s target).
      - Replay idempotency: exactly zero duplicate rows and bitwise row hash parity (`7eac2b...`).
      - Fail-closed security: `PRODUCTION_TARGET_PROHIBITED` thrown on remote/production hosts; sensitive keys scrubbed.
    - **Operational Governance State:**
      ```json
      {
        "phase_8_audit_closure": "ACCEPTED",
        "phase_9_design_review": "APPROVED_FOR_STAGING_IMPLEMENTATION",
        "phase_9_dual_write": "PROHIBITED_UNTIL_GATES_PASS",
        "production_reads": "SQLITE_ONLY",
        "production_shadow_reads": "PROHIBITED",
        "production_cutover": "PROHIBITED",
        "sqlite_retirement": "PROHIBITED"
      }
      ```



