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
- **Backtest Views Dual-Baseline Governance Rule:**
  - `gold_matches_ready_raw_view` (38,720 rows) represents authentic un-synthesized telemetry; strictly required for baseline models and parity proofs.
  - `gold_matches_ready_enriched_view` (46,076 rows) represents DTMC Markov synthesized fair-odds expansion; permitted exclusively for research models tolerant of synthetic odds.
  - Conflating enriched records with raw baseline telemetry is strictly prohibited across all future reporting.

