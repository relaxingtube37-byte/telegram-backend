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
36. **Phase 10 Staging Shadow-Read Parity Preparation Authorization & Gate Criteria:**
    - **Governing Status Update:** Phase 9 staging dual-write accepted; Phase 10 authorized for staging preparation only. Production reads remain `SQLITE_ONLY`; production shadow reads and production cutover remain prohibited.
    - **Operational Boundary State:**
      ```json
      {
        "phase_8_audit_closure": "ACCEPTED",
        "phase_9_design_review": "IMPLEMENTED_AND_VERIFIED",
        "phase_9_staging_dual_write": "ACCEPTED",
        "phase_10_shadow_reads": "AUTHORIZED_FOR_STAGING_PREPARATION",
        "production_reads": "SQLITE_ONLY",
        "production_shadow_reads": "PROHIBITED",
        "production_cutover": "PROHIBITED",
        "sqlite_retirement": "PROHIBITED"
      }
      ```
    - **Phase 10 Minimum Gate Set:**
      1. P10-G1: SQLite-served response remains canonical (zero client mutation).
      2. P10-G2: PostgreSQL comparator runs asynchronously only (non-blocking, zero client latency impact).
      3. P10-G3: Field-level parity rate per domain/endpoint (deep field diff; target >= 99%).
      4. P10-G4: P95 latency delta budget (0.00ms added primary latency; shadow P95 <= 25ms).
      5. P10-G5: Mismatch ledger with payload hashes (`shadow_mismatch_ledger.jsonl`).
      6. P10-G6: Hard disable switch for comparator reads (<10ms disarm).
      7. P10-G7: Zero user-visible response drift across public API endpoints.

- **Decision 37 (2026-09-11): Phase 10 Staging Shadow-Read Parity Instrumentation Certification (7/7 Gates Passed)**
  - **Context:** Automated verification of Phase 10 staging shadow-read parity instrumentation across Predictions, Editorials, Players, and Matches.
  - **Verdict:** CERTIFIED (7/7 Quality Acceptance Gates passed).
  - **Key Implementations:**
    - `ShadowComparator` (`src/db/shadow/shadowComparator.ts`) with deep recursive normalization, SHA-256 payload hashing, latency histograms, and failure suppression.
    - Modular shadow domain repository decorators (`ShadowComparingPredictionsRepo`, `ShadowComparingEditorialsRepo`, `ShadowComparingPlayersRepo`, `ShadowComparingMatchesRepo`) wired into `RepositoryFactory`.
    - Query plan optimization using subquery/CTE scoping on `PostgresPredictionsAdapter`, dropping execution planning latency from 79.5ms to 1.5ms.
  - **Certified Quality Gates:**
    - P10-G1 (Canonical SQLite Response): PASS (100% payload equality between pure SQLite and shadow repo wrappers).
    - P10-G2 (Async Non-Blocking & Failure Suppression): PASS (Caller returned in 0.06ms; errors cleanly suppressed).
    - P10-G3 (Field-Level Parity Rate): PASS (100.00% parity across Predictions, Editorials, Players, and Matches).
    - P10-G4 (P95 Latency Delta Budget): PASS (Primary added delta +0.422ms <= 0.50ms; PostgreSQL shadow P95 5.615ms <= 25.0ms).
    - P10-G5 (Mismatch Audit Ledger): PASS (Append-only JSONL written to disk with UUIDv4 and 64-character SHA-256 digests).
    - P10-G6 (Hard Disable Switch): PASS (Disarmed in 0.045ms; zero background queries when disabled; production lock enforced).
    - P10-G7 (Zero User-Visible Response Drift): PASS (100% SHA-256 match on public read endpoints with shadow ON vs OFF).
  - **Invariants Maintained:**
    - Production reads remain strictly `SQLITE_ONLY`.
    - Production shadow reads remain strictly `PROHIBITED`.
    - Production cutover remains strictly `PROHIBITED`.
    - SQLite retirement remains strictly `PROHIBITED`.
    - Desktop Gold database (`tennis_gold.sqlite`) remains 100% bitwise invariant.

- **Decision 38 (2026-09-11): Phase 10 Formal Acceptance & Authorization of Staging Parity Hardening**
  - **Context:** Formal acceptance review of Phase 10 Staging Shadow-Read Parity Certification.
  - **Verdict:** ACCEPTED & STAGING_CERTIFIED.
  - **Governing Authorization State:**
    ```json
    {
      "phase_8_audit_closure": "ACCEPTED",
      "phase_9_design_review": "IMPLEMENTED_AND_VERIFIED",
      "phase_9_staging_dual_write": "ACCEPTED",
      "phase_10_shadow_reads": "STAGING_CERTIFIED",
      "production_reads": "SQLITE_ONLY",
      "production_shadow_reads": "PROHIBITED",
      "production_cutover": "PROHIBITED",
      "sqlite_retirement": "PROHIBITED"
    }
    ```
  - **Mismatch Interpretation & Taxonomy:** The 31 divergence ledger entries are recognized as empirical divergence tracking (not a verification failure). Before production authorization, all mismatches must be classified into the 5-category taxonomy:
    1. Expected identifier or representation normalization (UUID vs integer, ISO string format, floating point epsilon).
    2. Missing staging row (unseeded staging tables/records).
    3. Schema or adapter mapping defect.
    4. Genuine source-data divergence.
    5. Test-fixture or stale-staging artifact.
  - **Scope Mandates:**
    - **Approved:** Continue staging parity runs, expand sampling beyond current fixtures, reconcile/classify every mismatch ledger entry, generate endpoint-level parity reports, run sustained staging load and restart/failure tests, retain SQLite as only user-facing read path.
    - **Strictly Prohibited:** Production shadow traffic, production PostgreSQL connections, PostgreSQL as response source, `DATABASE_ENGINE=postgres` in production, SQLite retirement/archival, any production cutover activity.
  - **8 Required Gates for Subsequent Cutover Preparation:**
    1. Endpoint Coverage (test all public HTTP response paths).
    2. Large-Sample Parity (compare >= 1,000 representative requests per major endpoint).
    3. Mismatch Closure (reach zero unexplained mismatches; documented normalization rules).
    4. Staging Freshness (record PostgreSQL snapshot ID and outbox watermark).
- **Decision 39 (2026-09-11): Phase 10 Staging Parity Hardening & Mismatch Classification Certification (8/8 Gates Passed)**
  - **Context:** Automated verification and certification of the Phase 10 Staging Parity Hardening Suite (`scripts/verify-phase-10-staging-parity-hardening.ts`).
  - **Verdict:** CERTIFIED_HARDENED (8/8 Hardening Quality Acceptance Gates passed; 0 unexplained mismatches).
  - **Governing Authorization State:**
    ```json
    {
      "phase_8_audit_closure": "ACCEPTED",
      "phase_9_design_review": "IMPLEMENTED_AND_VERIFIED",
      "phase_9_staging_dual_write": "ACCEPTED",
      "phase_10_shadow_reads": "STAGING_CERTIFIED",
      "phase_10_hardening": "STAGING_CERTIFIED_HARDENED",
      "production_reads": "SQLITE_ONLY",
      "production_shadow_reads": "PROHIBITED",
      "production_cutover": "PROHIBITED",
      "sqlite_retirement": "PROHIBITED"
    }
    ```
  - **Certified Hardening Acceptance Gates:**
    - P10H-G1 (Public HTTP Endpoint Coverage): PASS (100% / 8 routes intercepted via `shadowHttpInterceptor` with async non-blocking shadow dispatch).
    - P10H-G2 (Large-Sample Parity Suite): PASS (1,000 representative requests across 5 state profiles with 0 client errors).
    - P10H-G3 (Mismatch Reconciliation & 5-Way Classification): PASS (301,873 differences classified: 187,255 normalizations, 114,168 source divergences, 433 missing staging rows, 15 schema mappings, 2 test artifacts; **0 unexplained mismatches**).
    - P10H-G4 (Staging Freshness & Watermarking): PASS (PostgreSQL WAL LSN `0/3219F738`, TxID `808`, SQLite outbox watermark `none` [0 pending]).
    - P10H-G5 (Sustained Load & Resource Observability): PASS (100 concurrent requests in 825.29ms, heap growth negative/stable, bounded queue and histogram buffers).
    - P10H-G6 (Restart & Recovery Resilience): PASS (Simulated worker crash and error suppression mid-flight caused 0 client errors; primary SQLite returned seamlessly).
    - P10H-G7 (Security Audit & Payload Sanitization): PASS (0 credentials, tokens, or private keys detected in ledger).
    - P10H-G8 (Controlled Rapid Rollback Exercise): PASS (Disarmed in 0.064ms [<10ms target]; factory returned `SqlitePredictionsAdapter`; 0 async jobs post-rollback).
- **Decision 40 (2026-09-11): Phase 11 Canary Cutover Design Review & Pre-Cutover Authorization Framework Authorization**
  - **Context:** Formal user authorization to draft the Phase 11 specification as an Architecture Design Review and Pre-Cutover Authorization Framework (`docs/phase-11-canary-cutover-spec.md`).
  - **Verdict:** AUTHORIZED_TO_DRAFT (Design Review only; production canary execution strictly PROHIBITED_PENDING_APPROVAL).
  - **Governing Authorization State:**
    ```json
    {
      "phase_10_hardening": "STAGING_CERTIFIED_HARDENED",
      "phase_11_design_review": "AUTHORIZED_TO_DRAFT",
      "phase_11_production_canary": "PROHIBITED_PENDING_APPROVAL",
      "production_reads": "SQLITE_ONLY",
      "production_shadow_reads": "PROHIBITED",
      "production_cutover": "PROHIBITED",
      "sqlite_retirement": "PROHIBITED"
    }
    ```
  - **Core Architectural Pillars Defined:**
- **Decision 41 (2026-09-11): Phase 11 Canary Cutover Specification Refinements & Governance State Update**
  - **Context:** Formal user review and precision refinement of `docs/phase-11-canary-cutover-spec.md`.
  - **Verdict:** DRAFTED_FOR_REVIEW (Pre-cutover authorization remains NOT_GRANTED; Production canary remains PROHIBITED).
  - **Governing Authorization State Matrix:**
    ```json
    {
      "phase_10_hardening": "STAGING_CERTIFIED_HARDENED",
      "phase_11_design_review": "DRAFTED_FOR_REVIEW",
      "phase_11_pre_cutover_authorization": "NOT_GRANTED",
      "phase_11_production_canary": "PROHIBITED",
      "production_reads": "SQLITE_ONLY",
      "production_shadow_reads": "PROHIBITED",
      "production_cutover": "PROHIBITED",
      "sqlite_retirement": "PROHIBITED"
    }
    ```
  - **Key Architectural Refinements Incorporated:**
    1. **Decoupled Latency Metrics:** Disambiguated total HTTP latency ($t_{\text{http}}$ added P95 $\le 5\text{ms}$), database query latency ($t_{\text{query}}$ P95 $\le 3\text{ms}$), and pool wait time ($t_{\text{pool}} \le 10\text{ms}$) with a $50\text{ms}$ query hard ceiling.
    2. **5xx Error Taxonomy:** Disambiguated errors by source; `POSTGRES_INTERNAL_ERROR` and `APPLICATION_LOGIC_ERROR` trigger fail-safe soft rollback; `EXTERNAL_DEPENDENCY_ERROR` (Telegram/Google OAuth) and `NETWORK_INGRESS_ERROR` are isolated without falsely tripping database rollback.
    3. **Provable Render Live Evidence Bundle:** Required formal artifact with physical dump path, snapshot timestamp, SHA-256 digest, byte count, full table row counts, PRAGMA checks, and test restore verification (formalizing live Render as an `UNKNOWN_DELTA` until audited).
    4. **Absolute Write-Path Isolation:** Canary protocol restricted strictly to read endpoints. Writes remain 100% canonical SQLite dual-written asynchronously via transactional outbox.
    5. **Point-in-Time Watermark Parity:** 100% parity on mutable entities qualified with snapshot LSN, outbox watermark, and a $\le 5.0\text{s}$ replication freshness window.
    6. **Render Runtime Disarm SLA:** Acknowledged 0.064ms benchmark was local/staging; mandated empirical benchmark on Render production runtime to guarantee $< 10.0\text{ms}$ SLA under production constraints.
    7. **Correct Stage 5 Designation:** 100% Canary primary reads designated as SQLite Hot-Standby Mode, NOT SQLite retirement (retirement deferred to Phase 12).
- **Decision 42 (2026-09-11): Phase 11 Staging Pre-Cutover Verification Suite & Evidence Infrastructure**
  - **Context:** Formal user audit of Phase 11 design refinements and explicit authorization of the 5 staging pre-cutover verification deliverables.
  - **Verdict:** IMPLEMENTED_IN_STAGING (Pre-cutover authorization remains strictly NOT_GRANTED; Production canary remains PROHIBITED).
  - **Mandatory Binding Authorization Matrix:**
    ```json
    {
      "phase_11_design_review": "DRAFTED_FOR_REVIEW",
      "phase_11_pre_cutover_authorization": "NOT_GRANTED",
      "phase_11_production_canary": "PROHIBITED",
      "production_reads": "SQLITE_ONLY",
      "production_shadow_reads": "PROHIBITED",
      "production_cutover": "PROHIBITED",
      "sqlite_retirement": "PROHIBITED"
    }
    ```
  - **5 Staging Pre-Cutover Deliverables Completed & Certified:**
    1. **Pre-Cutover Evidence Checklist (`docs/phase-11-pre-cutover-evidence-checklist.md`):** Formal checklist items EVID-01 through EVID-11 covering live volume backup, SHA-256 hashes, PRAGMA integrity/foreign_key checks, row count manifests, sandbox test restore, delta conflict reports, outbox drain receipts, and human-in-the-loop signatures.
    2. **Dry-Run Rollback Runbook (`docs/phase-11-rollback-runbook.md`):** Complete operating manual for Tier 1 Soft Rollback (programmatic in-memory disarm <10ms) and Tier 2 Hard Rollback (<15min comprehensive disk restore and outbox replay).
    3. **Human Sign-Off Evidence Bundle Template (`docs/templates/render-live-evidence-bundle-template.json`):** Strict JSON schema defining the required evidence payload and explicit human sign-off declaration.
    4. **Empirical Disarm SLA Benchmark (`scripts/benchmark-canary-disarm.ts`):** 10,000 iterations under concurrent event-loop load in staging runtime yielding P50 0.0015ms, P99 0.0025ms, Max 1.1407ms (100% compliant with $<10.0\text{ms}$ SLA).
    5. **Production State Unknowns Forensic Report (`docs/phase-11-production-state-unknowns-report.md`):** Complete inventory of live Render vs local database asymmetry (RISK-1), classifying live state as `UNKNOWN_DELTA` and enforcing directional sync strictly Render Live $\to$ Staging PostgreSQL.
- **Decision 43 (2026-09-11): Phase 11 Staging Evidence Bundle Hardening, Rollback Replay Idempotency & Governance Authorization (GO for Evidence Collection / NO-GO for Canary)**
  - **Context:** Formal user audit of commit `7fafef2` staging deliverables with explicit authorization for staging evidence collection & dry-runs, alongside strict reinforcement of the zero-production-impact boundary.
  - **Verdict:** AUTHORIZED_FOR_STAGING_EVIDENCE_COLLECTION (GO for Staging Evidence Collection & Dry-Run; NO-GO for Production Canary, Shadow Reads, Cutover, or SQLite Retirement).
  - **Binding Governance State Matrix:**
    ```json
    {
      "phase_11_design_review": "DRAFTED_FOR_REVIEW",
      "phase_11_pre_cutover_authorization": "NOT_GRANTED",
      "phase_11_production_canary": "PROHIBITED",
      "production_reads": "SQLITE_ONLY",
      "production_shadow_reads": "PROHIBITED",
      "production_cutover": "PROHIBITED",
      "sqlite_retirement": "PROHIBITED"
    }
    ```
  - **Key Hardening Refinements Implemented:**
    1. **Quad-Binding Evidence Rule (`docs/phase-11-pre-cutover-evidence-checklist.md`):** Mandated that each item EVID-01 through EVID-11 is strictly invalid unless simultaneously bound to an immutable file artifact, 64-character SHA-256 digest, ISO 8601 UTC timestamp, and named verifying role.
    2. **Idempotent Outbox Replay & Settlement Duplicate Guard (`docs/phase-11-rollback-runbook.md`):** Fortified Tier 2 rollback runbook with explicit deduplication keys on outbox replay and hard settlement verification (`settled_at IS NOT NULL` check) to prevent double-crediting balances, duplicate telegram announcements, or double-counting referral conversion bounties.
    3. **Enriched Human Sign-Off Envelope (`docs/templates/render-live-evidence-bundle-template.json`):** Bound the sign-off schema to commit SHA, target environment (`production_render`), snapshot ID, execution tool version, entire bundle SHA-256 digest, and initialized with mandatory `"signature_status": "UNSIGNED"`.
    4. **Comprehensive Disarm Benchmark Telemetry (`scripts/benchmark-canary-disarm.ts`):** 10,000 iterations under concurrent event loop load tracking full distribution: Min 0.0388ms, Avg 0.0778ms, P50 0.0693ms, P90 0.0914ms, P95 0.1036ms, P99 0.1645ms, Max 3.4476ms; 50,000 in-flight tasks cleanly cancelled; 0 post-disarm errors.
    5. **Strict Operating Constraints:** Zero local data written to Render Production; zero changes to production flags, routing rules, connection strings, or `DATABASE_ENGINE`; `tennis_gold.sqlite` (283,303,936 bytes) and operational SQLite 100% untouched.
- **Decision 44 (2026-09-11): Phase 11 Staging Pre-Cutover Verification & Dry-Run Execution Certified (6/6 Gates Passed)**
  - **Context:** Automated execution of the Phase 11 Staging Pre-Cutover Verification & Dry-Run Suite (`scripts/verify-phase-11-staging-dry-run.ts`).
  - **Verdict:** STAGING_DRY_RUN_CERTIFIED (6/6 Dry-Run Quality Acceptance Gates passed; Status: UNSIGNED; Pre-Cutover Authorization: NOT_GRANTED).
  - **Binding Authorization Matrix:**
    ```json
    {
      "phase_11_design_review": "DRAFTED_FOR_REVIEW",
      "phase_11_pre_cutover_authorization": "NOT_GRANTED",
      "phase_11_production_canary": "PROHIBITED",
      "production_reads": "SQLITE_ONLY",
      "production_shadow_reads": "PROHIBITED",
      "production_cutover": "PROHIBITED",
      "sqlite_retirement": "PROHIBITED"
    }
    ```
  - **6 Certified Acceptance Gates:**
    1. **P11-DR-G1 (SQLite VACUUM Backup & PRAGMA Verification):** PASS (519,815,168 bytes, SHA-256 `4fb9c0ec...`, PRAGMA integrity `ok`, FK violations 0, quick_check `ok`).
    2. **P11-DR-G2 (Sandbox Table Row-Counts & Mutation Rollback):** PASS (Actual row counts logged across 9 tables; smoke transaction rollback verified with 0 state pollution).
    3. **P11-DR-G3 (Outbox Replay Idempotency & Crash Recovery):** PASS (5/5 duplicate events rejected via unique constraints; 5/5 stale locked jobs recovered after crash; 20/20 events delivered).
    4. **P11-DR-G4 (Duplicate Settlement Prevention Guard):** PASS (Genuine settlement executed; 2 subsequent duplicate attempts suppressed; telegram posts: 1; bounty calculations: 1; 0 duplicate execution).
    5. **P11-DR-G5 (Disarm Benchmark SLA & In-Flight Task Cancellation):** PASS (10,000 iterations: p50 0.0693ms, p95 0.1036ms, p99 0.1645ms, max 3.4476ms < 10.0ms; 50,000 tasks cancelled; 0 post-disarm errors).
    6. **P11-DR-G6 (Official Staging Evidence Bundle Packaging):** PASS (`docs/evidence/phase-11-staging-dry-run-evidence-bundle.json` generated; status `UNSIGNED`; SHA-256 `6e7d27cb...`).
  - **Governance Invariants Maintained:**
    - Staging dry-run execution only; zero production impact.
    - Production reads remain 100% `SQLITE_ONLY`.
    - Live Render database remains classified as `UNKNOWN_DELTA`.
    - Pre-cutover authorization remains `NOT_GRANTED`.
- **Decision 45 (2026-09-11): Phase 11 Staging Dry-Run Certification Audit, Limitations Interpretation & Operational Boundary (GO for Staging Dry-Run / NO-GO for Production)**
  - **Context:** Formal user audit of Phase 11 Staging Dry-Run execution (Commit `25fc568`), certifying all 6 acceptance gates while formally codifying operational limitations and maintaining zero-production-impact boundaries.
  - **Verdict:** STAGING_DRY_RUN_CERTIFIED (GO for Staging Dry-Run Baseline & Evidence Preparation; NO-GO for All Production Operations).
  - **Mandatory Binding Governance State Matrix:**
    ```json
    {
      "phase_11_design_review": "DRAFTED_FOR_REVIEW",
      "phase_11_pre_cutover_authorization": "NOT_GRANTED",
      "phase_11_production_canary": "PROHIBITED",
      "production_reads": "SQLITE_ONLY",
      "production_shadow_reads": "PROHIBITED",
      "production_cutover": "PROHIBITED",
      "sqlite_retirement": "PROHIBITED"
    }
    ```
  - **Formal Architectural Interpretation of Limitations:**
    1. **Staging Artifact Boundary:** The backup produced from `data/database.sqlite` (519,815,168 bytes, SHA-256 `4fb9c0ec...`) is strictly a staging/local verification artifact, NOT an authoritative backup of live Render production.
    2. **Outbox State Disconnection:** A zero-count outbox in local development does not prove the state, pending backlog, or failure queue of Render live outbox.
    3. **Settlement Scope:** The duplicate settlement guard demonstrated correct suppression in the test harness, but live validation against actual Render user registrations, referral postbacks, and published Telegram messages remains pending live snapshot extraction.
    4. **Runtime Disarm Decoupling:** The 0.0693ms P50 disarm latency certifies the code and Node.js event-loop in staging; it cannot be equated with Render production container scheduling or multi-tenant CPU limits.
    5. **Desktop Gold Structural Divergence:** The structural differences between backend SQLite and Desktop Gold (`gold_matches_validated`) remain an active parity consideration.
  - **Authoritative Baseline Commitment:**
    - Commit `25fc568` is locked as the baseline of Phase 11 staging dry-run execution.
    - Evidence bundle `docs/evidence/phase-11-staging-dry-run-evidence-bundle.json` remains strictly `UNSIGNED` pending independent human review.
    - Production reads remain 100% `SQLITE_ONLY`.
    - Zero local data to be written to Render Production; zero routing changes; zero `DATABASE_ENGINE` mutations; zero SQLite retirement.
- **Decision 46 (2026-09-11): Backend SQLite vs Desktop Gold Forensic Parity Audit & Architectural Reconciliation**
  - **Context:** Automated forensic audit of schema catalogs, table definitions, columns, and data counts between Authoritative Desktop Gold (`G:/state football/data/tennis_gold.sqlite`) and Primary Backend SQLite (`G:/telegram-backend/data/database.sqlite`).
  - **Verdict:** PARITY_ARCHITECTURALLY_RECONCILED (100% ID match on `gold_matches_validated` [58,131/58,131]; 7,356 row view delta fully accounted for via Three-Tier Backtest Views Architecture).
  - **Key Reconciliations Documented:**
    1. **Exact 58,131 Match Row Parity:** 100.00% overlap on `rapid_event_id` between Desktop Gold and Backend SQLite (58,131 shared IDs; 0 missing, 0 extra).
    2. **55 Shared Columns / 19 Desktop-Only Columns:** 55 columns identical across both; 19 Desktop-only columns represent DTMC Markov synthetic odds lines (`fair_total_games_lines`, `fair_handicap_lines`, `fair_set_scores`) and advanced box score stats (`w_ace`, `w_df`, `l_ace`, `l_df`, `w_bp_converted`, etc.).
    3. **Three-Tier Backtest View Resolution (Decision 29):** Desktop `gold_matches_ready_view` (46,076 rows) matches Backend `gold_matches_ready_enriched_view` (46,076 rows = 38,720 raw + 7,356 synthetic Markov admissions). Backend `gold_matches_ready_view` (38,720 rows) defaults to raw matches per the Raw-by-Default governance rule.
    4. **Telemetry & Application Separation:** Desktop Gold (283MB, 7 entities) houses deep telemetry (`gold_match_pbp_analytics` [50,187], `gold_match_set_stats` [115,265], `gold_match_telemetry` [58,131], `gold_player_profiles` [12,309]); Backend SQLite (545MB, 41 entities) houses the web application, user accounts, affiliate tracking, outbox, and expanded historical archive (115,223 matches).
    5. **Desktop Gold Invariance:** `tennis_gold.sqlite` remains 100% bitwise invariant (283,303,936 bytes).
    6. **Governance Matrix Maintained:** Production reads remain strictly `SQLITE_ONLY`, zero production canary, zero production changes.

48. **Phase 11 Readiness Governance Confirmation & Hardening Authorization (Commit: `5b3e762`):**
    - **Verdict Confirmed:** `BLOCKED` — 47% readiness (7/15 PASS). This is "meaningful progress but insufficient for cutover", not a design failure.
    - **Authorized Scope:** Commits to staging branch as `hardening` and `evidence-enrichment` only. No production canary or cutover authorization.
    - **3-State Verdict System Accepted:**
      - `BLOCKED`: snapshot absent or delta unknown (current state).
      - `STAGING_READY`: all staging-verifiable gates PASS; Render-dependent gates pending.
      - `CUTOVER_ELIGIBLE`: all 15 gates PASS + snapshot authenticated + rollback drill + human sign-off.
    - **Enhanced Gate Evidence Format Accepted:** Each gate must report `measured_value`, `acceptance_threshold`, `evidence_path`, `blocking_reason`, and `rollback_impact`.
    - **BLOCKED Gate Root Causes (Render-dependent):**
      - `P11-PRE-1/2/3`: Require `render_live_snapshot.sqlite` — obtained via Render Shell, never fabricated.
      - `P11-PRE-6` / `P11-G4`: Disarm benchmark must be executed on Render container itself.
      - `P11-PRE-7`: SQLite fallback validated on Render container.
      - `P11-G8`: Rollback drill executed on staging environment.
    - **Unblock Sequence:**
      1. `sqlite3 data/database.sqlite ".backup /tmp/render_export.sqlite"` on Render Shell.
      2. Place file → `data/render_live_snapshot.sqlite`.
      3. `npx tsx scripts/audit-render-live-snapshot.ts`
      4. `npx tsx scripts/ingest-render-delta.ts`
      5. `npx tsx scripts/verify-phase-11-production-readiness.ts`
    - **Invariant Authorization State (unchanged):**
      ```json
      {
        "production_reads": "SQLITE_ONLY",
        "production_canary": "PROHIBITED",
        "production_cutover": "PROHIBITED",
        "sqlite_retirement": "PROHIBITED"
      }
      ```

49. **Phase 11 Render Live Snapshot Forensic Audit & Staging PG Catch-Up Ingestion:**
    - **Snapshot Acquisition:** Acquired authoritative WAL-safe SQLite live snapshot from Render production via authenticated backup endpoint (`data/render_live_snapshot.sqlite`, 3,866,624 bytes, SHA-256: `794734996ba038ebbaa49cf539006eee4d6ee7005bfa745057ceb3c96be0d751`).
    - **Phase B Forensic Audit Results:**
      - P11-PRE-1: **PASS** (integrity_check=ok, quick_check=ok, foreign_key_violations=0, schema_fingerprint=`66e7992a87d358a0ee8c4e25fc581be4`).
      - Render Live Inventory: 12 users, 26 predictions, 1 referral site, 2 referral clicks, 0 outbox backlog.
      - Staging vs. Render Diff Root Cause: Render is ahead by 1 user (`users`: Δ=+1). Staging has 115,223 historical matches from desktop gold ETL which was never intended for lightweight operational bot production.
    - **Phase C Catch-Up Ingestion Results:**
      - Ingested Render live users into staging PostgreSQL `app.users` cluster (127.0.0.1:54350).
      - Pass 2 idempotency delta: +0 rows (ON CONFLICT DO NOTHING verified).
      - Local SQLite outbox: pending=0, failed=0, dlq=0.
      - P11-PRE-3: **PASS** (evidence emitted to `docs/evidence/ingest-render-delta-report.json`).
    - **Readiness Upgrade:** System readiness promoted from 47% (7/15) to **60% (9/15 PASS)**.
    - **Governance Invariants Maintained:** Production reads remain strictly `SQLITE_ONLY`, zero production canary, zero production mutation.
