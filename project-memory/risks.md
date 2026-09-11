# Known Risks & Mitigations

## Risks
1. **Viewport Overflow on Very Narrow Devices (≤ 360px):**
   - *Mitigation:* Ensure all pills, horizontal scoreboards, and filter bars have flex-wrap or horizontal touch scrolling (`-webkit-overflow-scrolling: touch`).
2. **Data Polling Overhead:**
   - *Mitigation:* Background live polling is restricted to the current date with 15s intervals.
3. **Premature AI Telemetry Production Cutover:**
   - *Risk:* Inadvertently cutting over frontend or backend read paths to PostgreSQL Phase 7 canonical tables (`predictions.published_predictions`, `predictions.match_editorials`) or enabling dual-write / shadow-read before readiness gates pass.
   - *Mitigation:* Operational freeze is strictly enforced (`staging_execution = CLOSED`, `staging_snapshot = FROZEN`, `quarantine_ledger = ACCEPTED`, `canonical_migration = BLOCKED`, `production_read_cutover = PROHIBITED`, `dual_write = NOT_YET_AUTHORIZED`, `shadow_read = NOT_YET_AUTHORIZED`). Milestone 27 certified (*"Crosswalk artifact accepted; canonical records not admitted; production cutover remains prohibited."*). All 133 candidate records remain quarantined.

