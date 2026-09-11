# Durable Notes & Observations

## Notes
- Font stack loaded via Google Fonts in `index.html`: `Plus Jakarta Sans`, `Outfit`, `Inter`, `JetBrains Mono`.
- Dev server runs on port 3000 by default.
- **PostgreSQL Phase 7 Operational Classification & Two-Phase State Transition:**
  - Official Verdict:
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
  - State Snapshots:
    - Phase 7-A: Quarantine-only staging for 9 predictions & 3 editorials (`legacy_prediction_editorial_coverage_pct = 0.0%`).
    - Phase 7-B: Post-export isolated staging ingestion for 411 authentic traces (`admitted_runs = 290`, `admitted_traces = 1,450`, `quarantined_traces = 121`, `indexeddb_trace_staging_coverage_pct = 70.6%`).
  - Prohibited Operations: (1) Changing production read paths to PostgreSQL Phase 7 tables; (2) Deleting or mutating SQLite source files; (3) Populating canonical AI tables with synthetic or legacy demo records; (4) Converting quarantine items to admitted migration without authentic evidence; (5) Declaring canonical `migration_complete: true` prior to dual-write and shadow-read parity.
- **Milestone 27 Closed vs. Open Gate Matrix:**
  - Milestone Certification: *"Crosswalk artifact accepted; canonical records not admitted; production cutover remains prohibited."*
  - Closed Gates (PASS): Crosswalk artifact existence, JSON/Markdown parity (133/133), Quarantine reconciliation (133/133), SHA-256 evidence parity (133/133), Evidence UUID validation (133/133), Canonical admission (0/133).
  - Open Architectural Gates: Qualifying parent match resolution (45 items), 72 unresolved fixture resolution, Data-access migration (Phase 8), Dual-write validation (Phase 9, NOT AUTHORIZED), Shadow-read parity (Phase 10, NOT AUTHORIZED), Production cutover (PROHIBITED).
- **Phase 8 Entry Gate Checkpoint & Verified Safe Resumption Sequence:**
  - **Commit Anchor:** `9343dcb` (`feat(phase-8): certify phase 8 entry gate, decouple repository interfaces, and establish sqlite circuit-breaker`).
  - **Operational State:** `Phase 7 CLOSED & FROZEN`, `Phase 8 Entry Gate CERTIFIED (6/6 PASS)`, `Phase 8 Execution NOT STARTED`, `Production reads: SQLITE_ONLY`, `Dual-write: NOT AUTHORIZED`, `Shadow-read: NOT AUTHORIZED`, `Production cutover: PROHIBITED`.
  - **Durable Safe Resumption Sequence Status:**
    1. **Resolve `gold_matches_validated` Disparity (RISK-2):** ✅ **RESOLVED** (Commit `40c347c`). Exact 100% parity at 58,131 rows.
    2. **Resolve Backtest View Disparity (RISK-3):** ✅ **RESOLVED**. Three-tier views deployed: raw (38,720), enriched (46,076), legacy facade (38,720). Quality gates 6/6 PASS.
    3. **Render Production Export (RISK-1):** In-queue. Obtain authenticated, read-only export directly from the live Render PostgreSQL/SQLite database.
    4. **Cryptographic Manifest:** Compute SHA-256 checksums and establish an immutable manifest for the Render export.
    5. **Three-Way Data Reconciliation:** Perform differential audit across Render, backend SQLite, and desktop SQLite.
    6. **Quarantine Resolution (RISK-4 & RISK-5):** Ingest parent tournament editions in Phase 4 for 45 qualification traces; obtain official vendor mappings for 72 unlinked traces without force-linking.
    7. **Staging Parity Baseline:** Only after all disparities are documented and resolved, formulate the staging parity baseline for controlled Phase 8 execution.
- **Trace Accounting Invariant (SQLite Resolution ≠ PostgreSQL Canonical Admission):**
  - **411 Total Multi-Agent Traces:**
    - **335 SQLite-Resolved:** Fixture cleanly matched in local SQLite `database.sqlite`.
      - **290 PostgreSQL-Admitted:** Staged into `ai.predictionruns` & `ai.agenttraces` ($290 \times 5 = 1,450$).
      - **45 Resolved-but-Not-Staged:** Valid SQLite matches from Phase 4 qualification tournaments quarantined under `MATCH_NOT_STAGED_IN_POSTGRES`.
    - **72 Unresolved Vendor Fixtures:** Vendor fixture ID absent from SQLite (`MATCH_CROSSWALK_UNRESOLVED`).
    - **4 Missing Payload Traces:** Early August 21 records lacking snapshot/decision (`MATCH_CROSSWALK_MISSING_PAYLOAD`).
  - **Quarantine Total:** $45 + 72 + 4 = 121$ traces (+ 12 legacy outputs = 133 total quarantine records).
  - Crosswalk resolution against SQLite does NOT grant canonical admission into PostgreSQL without verified parent records in `matches.matches`.
- **Backtest Views Dual-Baseline Governance Rule:**
  - `gold_matches_ready_raw_view` (38,720 rows) represents authentic un-synthesized telemetry; strictly required for baseline models and parity proofs.
  - `gold_matches_ready_enriched_view` (46,076 rows) represents DTMC Markov synthesized fair-odds expansion; permitted exclusively for research models tolerant of synthetic odds.
  - Conflating enriched records with raw baseline telemetry is strictly prohibited across all future reporting.
  - `gold_matches_ready_view` legacy facade remains hard-wired to raw view by default.

- **Note 12: Forensic Resolution of 45 Unstaged Qualification Matches & Expanded Telemetry Accounting:**
  - Forensic audit categorized the 45 qualification traces into 20 `CANONICAL_RESOLVABLE` and 25 `REMAIN_QUARANTINED`.
  - The 20 matches possess 100% verified tournament editions and player UUIDs; safely staged into PostgreSQL staging (`matches.matches`) with symmetric participant entries and settled results.
  - The 25 matches lack authentic player/edition entities in Phase 3/4 registries (e.g. absent Challenger/ITF editions or unindexed players like Kumstat, Penickova); strictly retained in quarantine under `MATCH_NOT_STAGED_IN_POSTGRES` per Zero-Fabrication principles. Zero synthetic players or editions manufactured.

- **Note 13: Forensic Resolution of 72 Vendor Fixtures & Updated Telemetry Accounting:**
  - Forensic audit partitioned the 72 previously unresolved vendor fixtures:
    - **36 Authentic US Open 2026 Matches:** Resolved in SQLite `gold_matches_validated` post-sync; 100% verified winner and loser player UUIDs in Phase 3 registry; mapped to ATP (`4c111dff-fce0-5e96-bccd-0657253a9be3`) and WTA (`25909d80-2f5e-5b00-9211-71269dfebb23`) editions. Staged via `batch_us_open_admitted_matches.sql` and `us_open_match_links.jsonl`.
    - **36 Truly Absent Vendor Fixtures:** Unindexed qualifying matches (Cincinnati, Winston Salem, US Open qualifying) and WTA events (Hong Kong, Seoul, 's-Hertogenbosch). Safely preserved in quarantine under `MATCH_CROSSWALK_UNRESOLVED` per Zero-Fabrication policy.
  - **25 Qualification Traces Final Disposition:** Strictly preserved in quarantine under `MATCH_NOT_STAGED_IN_POSTGRES` per Zero-Fabrication rules (unindexed ITF players/editions, doubles).
  - **Certified Telemetry Invariant:**
    - Total Exported Traces: **411**
    - Admitted Prediction Runs: **346** (expanded from 310; exactly +36 runs)
    - Admitted Specialist Agent Traces: **1,730** ($346 \times 5$, expanded from 1,550; exactly +180 traces)
    - Quarantined Trace Bundles: **65** ($25\text{ qualification} + 36\text{ unresolved vendor} + 4\text{ missing payload}$)
    - Legacy SQLite Quarantined Outputs: **12** (9 predictions + 3 editorials)
    - Total Review Queue Ledger: **77 items** ($65\text{ trace bundles} + 12\text{ legacy demo outputs}$)
    - Pass 2 Insertion Delta: **+0** rows (100% idempotent)
    - Source SQLite Immutability: $\Delta = 0\text{ bytes}$
    - Referential Integrity: 0 orphan runs, 0 orphan traces, 0 orphan evidence links.

- **Note 14: Phase 8 Data-Access Layer Staging Execution & Governance Conformance:**
  - **Operational State Transition:**
    - `phase_7_staging`: `CLOSED_ACCEPTED`
    - `phase_8_staging_data_access`: `COMPLETED_CERTIFIED`
    - `production_reads`: `SQLITE_ONLY`
    - `dual_write`: `PROHIBITED`
    - `shadow_read`: `PROHIBITED`
    - `production_cutover`: `PROHIBITED`
  - **Decoupled Architecture Implemented:**
    - Domain interfaces: `IPredictionsRepo`, `IEditorialsRepo`, `IPlayersRepo`, `IMatchesRepo` in `src/db/interfaces/`.
    - SQLite adapters: `src/db/adapters/sqlite/` wrapping `better-sqlite3` repositories verbatim.
    - PostgreSQL adapters: `src/db/adapters/postgres/` querying canonical schemas (`ai.predictionruns`, `predictions.match_editorials`, `identity.players`, `matches.matches`).
    - Staging Connection Pool: `StagingPgPool` in `src/db/stagingPgPool.ts` (isolated port 54350, max 5, timeout 5000ms).
    - Repository Factory: `RepositoryFactory` with `ENABLE_STAGING_PG_ADAPTER` feature flag (staging only, non-production) and non-blocking `ShadowComparingPredictionsRepo` circuit-breaker.
  - **Zero Production Mutation:** 100% of write/mutation methods in PostgreSQL adapters throw `POSTGRES_MUTATION_PROHIBITED`.
  - **Quality Gates Certified (7/7 PASS):** Verified via `scripts/verify-phase-8-query-conformance.cjs` and documented in `docs/phase-8-query-conformance-and-parity-report.md`.
  - **Zero Regression:** 26/26 backend diagnostic tests PASS in `src/test_backend_full.ts`. Source SQLite databases bitwise immutable ($\Delta = 0\text{ bytes}$).

- **Note 15: Source Immutability Recheck, Desktop Gold Path Resolution & Phase 8 Audit Closure Certification:**
  - **Discrepancy Resolution:** Identified that previous `data/tennis_gold.sqlite: 0 bytes` was an unpopulated placeholder in `telegram-backend/data/`. The authoritative Desktop Gold Database containing full PBP, set statistics, and telemetry is located at `G:/state football/data/tennis_gold.sqlite` (283,303,936 bytes).
  - **Cryptographic Immutability Ledger:**
    - Primary Backend DB (`G:/telegram-backend/data/database.sqlite`): 545,468,416 bytes, SHA-256 `4cc4bc8d2d4f0a4bd8d769601000116b4d2fed8bbbe01db98a9811ae1d08b358`, status: `VERIFIED`.
    - Desktop Gold DB (`G:/state football/data/tennis_gold.sqlite`): 283,303,936 bytes, SHA-256 `2951176b1fc7da0db250b42e53976c67a25aca59bcf0175706599e30e816c086`, delta = 0, status: `VERIFIED`.
    - Non-existent path (`../state-football/data/tennisgold.sqlite`): exists: `false`, bytes: `null`, sha256: `null`, status: `NOT_VERIFIED`.
  - **Audit Closure Verification Suite Certified (7/7 PASS, `scripts/verify-phase-8-audit-closure.ts`):**
    - `check_1_pg_integrity`: `pg` 8.23.0 & `@types/pg` 8.23.1 verified in package and lockfile.
    - `check_2_source_immutability`: Bitwise invariance verified across authoritative paths.
    - `check_3_feature_flag_default`: Production environment strictly defaults to `SQLITE_ONLY`.
    - `check_4_rollback_circuit_breaker`: PostgreSQL downtime suppressed with 0ms interruption; SQLite primary read returned in 2ms.
    - `check_5_live_adapter_reads`: Live queries executed against `ai.predictionruns`, `predictions.match_editorials`, `identity.players`, `matches.matches` on port 54350.
    - `check_6_mutation_prohibition`: 9/9 mutation methods throw exact `POSTGRES_MUTATION_PROHIBITED` error.
- **Note 16: Versioned Baseline Manifest (v1.0.0) & Phase 9 Design Review Scope:**
  - **Versioned Baseline Manifest (`docs/source_baseline_manifest_v1.json`):**
    - Authoritative Desktop Gold DB (`G:/state football/data/tennis_gold.sqlite`): 283,303,936 bytes, SHA-256 `2951176b1fc7da0db250b42e53976c67a25aca59bcf0175706599e30e816c086`.
    - Primary Backend DB (`G:/telegram-backend/data/database.sqlite`): 545,468,416 bytes, SHA-256 `4cc4bc8d2d4f0a4bd8d769601000116b4d2fed8bbbe01db98a9811ae1d08b358`.
    - Explicitly designated non-interchangeable with the 0-byte local placeholder `data/tennis_gold.sqlite`.
  - **Phase 9 Dual-Write Design Review (`docs/phase-9-dual-write-architecture-and-design-review.md`):**
    - Dual-write remains strictly **PROHIBITED** across all production paths.
- **Note 17: Phase 9 Staging Dual-Write Harness & 14-Gate Certification (14/14 PASS):**
  - **Durability Invariant:** Replaced in-memory queue with transactional SQLite outbox (`postgres_dual_write_outbox`). Primary business mutation and outbox event insert occur within the same SQLite transaction.
  - **14 Quality Acceptance Gates (100% Certified):**
    - P9-G1: Latency Overhead (Baseline median 0.059ms, Dual-write median 0.362ms, overhead 0.303ms <= 1.0ms, P95 0.783ms <= 5.0ms).
    - P9-G2: Circuit Breaker Auto-Trip (tripped to OPEN on persistent failure threshold).
    - P9-G3: DLQ Envelope Integrity & `dlq_records.jsonl` export.
    - P9-G4: Instant Rollback Disarm (<100ms admission check: 0.046ms, worker stop: 0.334ms <= 1s).
    - P9-G5: Production Read Immutability (`SQLITE_ONLY`).
    - P9-G6: Idempotent Replay & Bitwise Row Hash Parity (`7eac2b625c87818e84eb590df4413a1e631341a77d6924e32f7bb9ab4815d40a`).
    - P9-G7: PostgreSQL Downtime Fault Tolerance (100% primary mutations succeed with PG offline).
    - P9-G8: Atomic Commit Invariant (forced rollback leaves 0 primary and 0 outbox records).
    - P9-G9: Worker Lease Reclamation on restart.
    - P9-G10: Authenticated DLQ Replay back to PENDING state.
    - P9-G11: Real-time backlog observability & metrics.
    - P9-G12: Production Credential Rejection (`PRODUCTION_TARGET_PROHIBITED`).
    - P9-G13: Payload Sanitization (credentials/tokens scrubbed).
    - P9-G14: Crash Recovery State Preservation (committed outbox events survive restarts).
- **Note 18: Phase 10 Staging Shadow-Read Parity Preparation Scope:**
  - **Status:** Authorized for staging preparation only. Production shadow reads and cutover remain strictly prohibited.
  - **Scope:** Instrumenting field-by-field asynchronous comparison across predictions, editorials, player profiles, and match listings without modifying client-facing SQLite responses.
  - **7 Required Gates:** Canonical SQLite response, asynchronous comparator execution, field-level parity rate (>=99%), P95 latency delta budget (<=25ms), mismatch audit ledger (`shadow_mismatch_ledger.jsonl`), hard disable switch (<10ms disarm), zero user-visible response drift.
- **Note 19: Phase 10 Staging Shadow-Read Parity Certification (7/7 PASS):**
  - **Status:** Fully Certified & Verified on 2026-09-11 (`scripts/verify-phase-10-staging-shadow-reads.ts`).
  - **P10-G1 (Canonical SQLite Response):** 100% exact payload equality between direct SQLite and shadow repo wrapper across all 4 domains.
  - **P10-G2 (Async Non-Blocking & Failure Suppression):** Detached via `setImmediate()`; caller returned in 0.06ms; errors cleanly suppressed.
  - **P10-G3 (Field-Level Parity Rate):** 100.00% parity across Predictions, Editorials, Players, and Matches on matching admitted entities.
  - **P10-G4 (P95 Latency Delta Budget):** Primary added latency delta +0.422ms (budget <= 0.50ms); PostgreSQL shadow P95 5.615ms (budget <= 25.0ms).
  - **P10-G5 (Mismatch Audit Ledger):** Append-only JSONL written to disk (`scratch/postgres-phase-10-shadow-reads/shadow_mismatch_ledger.jsonl`) with UUIDv4 and 64-character SHA-256 digests.
  - **P10-G6 (Hard Disable Switch):** Evaluated in 0.045ms (<10ms target); zero background comparisons when disabled; production lock enforced.
  - **P10-G7 (Zero User-Visible Response Drift):** 100% SHA-256 match on public read endpoints with shadow ON vs OFF.
  - **Optimizations:** Scoped `PostgresPredictionsAdapter` queries with CTE (`WITH r AS (SELECT * FROM ai.predictionruns ...)`), dropping execution planning time from 79.5ms to 1.5ms.
- **Note 20: Phase 10 Formal Acceptance & Authorization of Staging Parity Hardening:**
  - **Verdict:** Phase 10 accepted and certified for STAGING (`phase_10_shadow_reads: STAGING_CERTIFIED`).
  - **Divergence Classification Taxonomy (5 Categories):**
    1. Expected identifier or representation normalization (UUID vs numeric fixture ID, ISO date formats, floating-point precision).
    2. Missing staging row (unmigrated or unseeded staging records like match editorials or player profiles).
    3. Schema or adapter mapping defect.
    4. Genuine source-data divergence.
    5. Test-fixture or stale-staging artifact.
- **Note 21: Phase 10 Staging Parity Hardening & Mismatch Classification Certification (8/8 PASS):**
  - **Status:** Formally certified as `STAGING_CERTIFIED_HARDENED` on 2026-09-11 via `scripts/verify-phase-10-staging-parity-hardening.ts`.
  - **P10H-G1 (Public HTTP Endpoint Coverage):** 100% of public endpoints (8 routes) intercepted with 0 client delay via `shadowHttpInterceptor`.
  - **P10H-G2 (Large-Sample Parity):** 1,000 requests executed across 5 state profiles with 0 client errors.
  - **P10H-G3 (Mismatch Reconciliation & 5-Way Classification):** 301,873 differences classified with **0 unexplained mismatches** (187,255 normalizations, 114,168 source divergences, 433 missing staging rows, 15 schema mappings, 2 test artifacts).
  - **P10H-G4 (Staging Freshness & Watermarking):** PostgreSQL WAL LSN `0/3219F738`, TxID `808`, Outbox watermark `none` (0 pending events).
  - **P10H-G5 (Sustained Load & Resource Observability):** 100 concurrent requests in 825.29ms, $\Delta\text{Heap} = -238.65\text{ MB}$, memory stable with bounded buffers.
  - **P10H-G6 (Restart & Recovery Resilience):** Worker crash simulation cleanly suppressed; primary SQLite response returned without interruption.
  - **P10H-G7 (Security Audit & Payload Sanitization):** 0 sensitive keys, Bearer tokens, or credentials in audit ledger.
  - **P10H-G8 (Controlled Rapid Rollback Exercise):** Disarmed in 0.064ms (<10ms target); factory returned `SqlitePredictionsAdapter`; 0 async jobs executed post-rollback.
- **Note 22: Phase 11 Canary Cutover Architecture Design Review & Pre-Cutover Authorization Framework:**
  - **Status:** `DRAFTED_FOR_REVIEW` (Specification refined in `docs/phase-11-canary-cutover-spec.md`; pre-cutover authorization `NOT_GRANTED`; production canary strictly `PROHIBITED`).
  - **Pre-Cutover Prerequisite Requirements:** Live Render volume backup evidence bundle with physical path, exact timestamp, SHA-256 digest, byte count, full table row counts, PRAGMA checks, and test restore verification (formalizing live Render as an `UNKNOWN_DELTA` until audited - RISK-1 remediation); zero unmigrated rows.
  - **Canary Routing Matrix:** Phased 0% (soak) $\to$ 1% (read-only feed) $\to$ 5% (catalog) $\to$ 25% (webapp) $\to$ 50% (peak events) $\to$ 100% (SQLite hot-standby, NOT retirement) using deterministic MD5 hash ring per session/user.
  - **Decoupled Latency & Error Taxonomy:** Disambiguated total HTTP latency ($t_{\text{http}}$), database query latency ($t_{\text{query}}$), and pool wait time ($t_{\text{pool}}$); disambiguated 5xx errors (database/application errors trigger fail-safe rollback; external dependency errors like Telegram/OAuth are isolated).
  - **Two-Tier Rollback Runbook:** Tier 1 programmatic in-memory disarm (<10ms target, benchmarked at 0.064ms in staging, requiring empirical benchmark on Render production runtime); Tier 2 hard rollback with deployment halt, immutable baseline restore, and outbox catch-up replay.
- **Note 23: Phase 11 Staging Evidence Checklist, Rollback Runbook & Disarm SLA Benchmark:**
  - **Status:** Staging artifacts and runbooks created under `DRAFTED_FOR_REVIEW` (production canary remains strictly `PROHIBITED`).
  - **Evidence Checklist:** `docs/phase-11-pre-cutover-evidence-checklist.md` establishes EVID-01 to EVID-11 (physical dump, cryptographic SHA-256, PRAGMA checks, table counts, test restore, conflict report, human sign-off).
  - **Dry-Run Rollback Runbook:** `docs/phase-11-rollback-runbook.md` establishes step-by-step procedures for Tier 1 Soft Rollback (programmatic in-memory switch) and Tier 2 Hard Rollback (volume restore, config lock, outbox replay).
  - **Human Sign-Off Template:** `docs/templates/render-live-evidence-bundle-template.json` specifies the formal JSON schema for the pre-cutover evidence package.
  - **Empirical Disarm Benchmark (`scripts/benchmark-canary-disarm.ts`):** 10,000 in-memory disarm iterations under simulated event loop load yielded Min 0.0013ms, Avg 0.0019ms, P50 0.0017ms, P95 0.0022ms, P99 0.0030ms, Max 0.9752ms (100% compliant with $<10.0\text{ms}$ SLA).
  - **Production State Unknowns Report:** `docs/phase-11-production-state-unknowns-report.md` formalizes live Render database as an `UNKNOWN_DELTA` and outlines the non-destructive extraction runbook (RISK-1 remediation).
  - **Invariants Maintained:** Production reads remain strictly `SQLITE_ONLY`. Desktop Gold database (`tennis_gold.sqlite`) remains 100% bitwise invariant (283,303,936 bytes).
- **Note 24: Phase 11 Staging Evidence Bundle Hardening & GO/NO-GO Boundary:**
  - **Verdict:** GO for Staging Evidence Collection & Dry-Run; NO-GO for Production Canary, Shadow Reads, Cutover, or SQLite Retirement.
  - **Quad-Binding Hardening:** Each checklist item EVID-01 through EVID-11 is strictly bound to an immutable file artifact, 64-char SHA-256 digest, UTC timestamp, and responsible sign-off role.
  - **Rollback Tier 2 Idempotency:** Implemented outbox deduplication keys and explicit checks for `settled_at IS NOT NULL` on prediction outcomes to prevent duplicate user payouts, affiliate CPA bounties, or duplicate Telegram messages.
  - **Evidence Envelope:** Initialized with `"signature_status": "UNSIGNED"`, commit SHA, environment, snapshot ID, execution tool version, and bundle content SHA-256 digest.
  - **Benchmark Telemetry:** 10,000 iterations tracking p50 (0.0693ms), p95 (0.1036ms), p99 (0.1645ms), max (3.4476ms), 50,000 cancelled in-flight tasks, and 0 post-disarm errors.
  - **Operating Prohibitions:** Production reads remain strictly `SQLITE_ONLY`. Zero changes to production flags, routing rules, connection strings, or `DATABASE_ENGINE`. Desktop Gold database (`tennis_gold.sqlite`) remains 100% bitwise invariant (283,303,936 bytes).
- **Note 25: Phase 11 Staging Pre-Cutover Verification & Dry-Run Suite Certified (6/6 Gates PASS):**
  - **Status:** Formally verified on 2026-09-11 via `scripts/verify-phase-11-staging-dry-run.ts`.
  - **P11-DR-G1 (SQLite VACUUM Backup):** 519,815,168 bytes backed up in 2,754.73ms; SHA-256 `4fb9c0ec...`; PRAGMA integrity `ok`, FK check 0 violations, quick_check `ok`.
  - **P11-DR-G2 (Sandbox Table Row Counts & Mutation Rollback):** All 9 production tables audited; sandbox smoke transaction rolled back cleanly with zero database leakage.
  - **P11-DR-G3 (Outbox Replay Idempotency & Crash Resumption):** 5/5 duplicate events rejected via unique constraints; 5/5 stale locked jobs recovered after worker crash simulation; 20/20 events delivered cleanly.
  - **P11-DR-G4 (Duplicate Settlement Prevention Guard):** Initial settlement succeeded; 2 subsequent duplicate attempts suppressed (`DUPLICATE_SETTLEMENT_SUPPRESSED`); exactly 1 Telegram post and 1 bounty calculation executed.
  - **P11-DR-G5 (Disarm Benchmark SLA & In-Flight Cancellation):** 10,000 iterations, p50 0.0693ms, p99 0.1645ms, max 3.4476ms; 50,000 in-flight tasks cancelled; 0 errors.
  - **P11-DR-G6 (Official Staging Evidence Bundle Packaging):** Staging evidence package generated at `docs/evidence/phase-11-staging-dry-run-evidence-bundle.json` with status `UNSIGNED` and bundle SHA-256 `6e7d27cb...`.
  - **Governance Invariants:** Pre-cutover authorization remains `NOT_GRANTED`. Production reads remain strictly `SQLITE_ONLY`. Live Render database remains classified as `UNKNOWN_DELTA`.
- **Note 26: Formal Interpretation of Phase 11 Staging Limitations & Baseline Retention:**
  - **Verdict:** GO for Staging Dry-Run Baseline & Evidence Preparation; NO-GO for All Production Operations.
  - **5 Limitations Formally Codified:**
    1. Local backup is a staging evidence artifact, not an authoritative Render live volume backup.
    2. Local empty outbox does not prove zero lag or queue state on live Render.
    3. Isolated settlement guard test proves mechanism integrity, not live user/referral reconciliation.
    4. Local 0.0693ms disarm SLA applies to staging runtime, not Render production container scheduling.
    5. Structural difference between backend SQLite and Desktop Gold remains an active parity consideration.
  - **Baseline:** Commit `25fc568` locked as the staging baseline. Evidence bundle remains `UNSIGNED`. Production reads remain 100% `SQLITE_ONLY`.
- **Note 27: Backend SQLite vs Desktop Gold Forensic Parity Audit & Reconciliation:**
  - **Status:** Completed on 2026-09-11 via `scripts/audit-backend-vs-desktop-gold-parity.ts`.
  - **`gold_matches_validated` Row Parity:** 58,131 / 58,131 (100.00% exact match on `rapid_event_id`; 0 missing, 0 extra).
  - **Column Distribution:** 55 shared columns; 19 Desktop-only columns (Markov synthetic odds + box score return stats).
  - **Three-Tier Backtest Views Parity:** Desktop `gold_matches_ready_view` (46,076 rows) exactly matches Backend `gold_matches_ready_enriched_view` (46,076 rows = 38,720 raw + 7,356 Markov admissions). Backend default `gold_matches_ready_view` has 38,720 rows enforcing the Raw-by-Default governance rule (Decision 29). The 7,356 delta is an architectural safety design, not a parity defect.
  - **Telemetry Tables:** Desktop Gold (283MB) holds deep telemetry (`gold_match_pbp_analytics` [50,187], `gold_match_set_stats` [115,265], `gold_match_telemetry` [58,131], `gold_player_profiles` [12,309]). Backend SQLite (545MB) holds the web application, user accounts, and expanded historical archive (`historical_matches` [115,223]).
  - **Documentation:** Full report published at `docs/backend-vs-desktop-gold-parity-matrix.md`.
  - **Desktop Gold Immutability:** `tennis_gold.sqlite` confirmed 100% bitwise invariant (283,303,936 bytes).







