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



