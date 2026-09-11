# Known Risks & Mitigations

## Risks
1. **Viewport Overflow on Very Narrow Devices (≤ 360px):**
   - *Mitigation:* Ensure all pills, horizontal scoreboards, and filter bars have flex-wrap or horizontal touch scrolling (`-webkit-overflow-scrolling: touch`).
2. **Data Polling Overhead:**
   - *Mitigation:* Background live polling is restricted to the current date with 15s intervals.
3. **Premature AI Telemetry Production Cutover:**
   - *Risk:* Inadvertently cutting over frontend or backend read paths to PostgreSQL Phase 7 canonical tables (`predictions.published_predictions`, `predictions.match_editorials`) or enabling dual-write / shadow-read before readiness gates pass.
   - *Mitigation:* Operational freeze is strictly enforced (`staging_execution = CLOSED`, `staging_snapshot = FROZEN`, `quarantine_ledger = ACCEPTED`, `canonical_migration = BLOCKED`, `production_read_cutover = PROHIBITED`, `dual_write = NOT_YET_AUTHORIZED`, `shadow_read = NOT_YET_AUTHORIZED`). Milestone 27 certified (*"Crosswalk artifact accepted; canonical records not admitted; production cutover remains prohibited."*). All 133 candidate records remain quarantined.
4. **Unexported Render Production State (RISK-1):**
   - *Risk:* Live Render database has not been independently dumped as a read-only export. Live user accounts, recent predictions, and referrals may diverge from local SQLite.
   - *Mitigation:* Mandatory read-only production dump prior to Phase 11 cutover.
5. **Gold Matches Validated Disparity (RISK-2) — [RESOLVED]:**
   - *Root Cause:* Traced to 154 authentic 2026 US Open matches (Sep 2–10, 2026) captured on desktop post-dating backend's Sep 1 cutoff.
   - *Resolution:* Synchronized all 154 rows into backend `database.sqlite` via atomic single-transaction with physical pre-write backup (`scripts/sync-154-us-open-matches.cjs`), mapping strictly to 55 canonical columns. Desktop and backend now achieve exact 100% parity at 58,131 rows with 0 duplicate keys and 26/26 regression tests passing.
6. **Backtest View Disparity (RISK-3):**
   - *Risk:* Desktop backtest view contains 46,076 rows vs Backend contains 38,566 rows (7,510-row discrepancy).
   - *Mitigation:* Resolve filtering/aggregation criteria between desktop and backend backtest pipelines prior to historical shadow comparisons.
7. **Quarantined Qualification Parent Matches (RISK-4):**
   - *Risk:* 45 authentic traces remain quarantined in `provenance.review_queue` awaiting Phase 4 tournament edition links.
   - *Mitigation:* Ingest parent tournament editions in Phase 4 before admitting candidate runs to prevent FK violations.
8. **Unresolved Vendor Fixtures (RISK-5):**
   - *Risk:* 72 authentic traces lack vendor fixture IDs in local database.
   - *Mitigation:* Strictly prohibit fuzzy force-linking or synthetic identifiers; require authoritative provider crosswalk.

