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
6. **Backtest View Disparity (RISK-3) — [RESOLVED]:**
   - *Root Cause:* Traced to Desktop having executed an offline model enrichment pass (`scripts/enrichGoldOddsAndExpandPool.ts`) synthesizing DTMC Markov fair odds for 7,356 matches missing PBP/history/surface/stats and forcing `final_status = 'READY'`. Backend strictly quarantined these under raw rules (`MISSING_PBP`: 3,359, `MISSING_HISTORY`: 1,891, `MISSING_STATS_AND_PBP`: 1,656, `INVALID_SURFACE`: 441, `MISSING_STATS`: 9).
   - *Resolution:* Implemented three-tier backtest view architecture with zero base table mutation: (1) `gold_matches_ready_raw_view` (38,720 rows - authentic baseline), (2) `gold_matches_ready_enriched_view` (46,076 rows - exact parity with Desktop via immutable auxiliary ledger `gold_matches_enriched_admissions`), and (3) `gold_matches_ready_view` (38,720 rows - legacy facade protecting 100% existing consumers). Certified 6/6 quality gates (`scripts/verify-backtest-views-parity.cjs`) and 26/26 backend regression tests.
7. **Quarantined Qualification Parent Matches (RISK-4) — [PARTIALLY RESOLVED / GOVERNED]:**
   - *Status:* Out of 45 qualification traces, exactly 20 matches had 100% verified tournament editions and player UUIDs in Phase 3/4 registries and were staged into PostgreSQL staging (`batch_qualification_admitted_matches.sql`), expanding admitted runs to 310.
   - *Residual Risk:* 25 traces involve missing players (6 winners, 15 losers), unlinked Challenger/ITF editions (4), or doubles data (1).
   - *Mitigation:* Strictly preserved in quarantine under `MATCH_NOT_STAGED_IN_POSTGRES` per Zero-Fabrication policy. Zero synthetic players or tournament editions manufactured.
8. **Unresolved Vendor Fixtures (RISK-5):**
   - *Risk:* 72 authentic traces lack vendor fixture IDs in local database.
   - *Mitigation:* Strictly prohibit fuzzy force-linking or synthetic identifiers; require authoritative provider crosswalk.

