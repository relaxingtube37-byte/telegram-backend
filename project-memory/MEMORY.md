# Project Memory

## Goals
Secure backend admin endpoints; protect operational web admin routes.

## Decisions
- `/api/web/admin/*` uses shared `requireAdminAuth` middleware (same as `/api/admin/*`).
- `ADMIN_SECRET` has no code default; weak/known fallback values are always rejected.
- Missing or weak `ADMIN_SECRET` causes all admin auth to fail closed (401).
- Canonical DB env var reads `DATABASE_FILE` with fallback to `DATABASE_PATH` and local `./data/database.sqlite`.
- Backup directory reads `BACKUP_DIR` with fallback to `<dbDir>/backups`.
- SQLite backup snapshot retention policy (`pruneOldBackups`) retains maximum 3 snapshots to prevent persistent disk overflow.
- Server binds explicitly to `0.0.0.0` for containerized reverse-proxy compatibility on Render.
- Production build is isolated via `tsconfig.build.json` (`npm run build:prod`).
- Local dev stack: backend `:8080`, website `VITE_API_BASE=/api/web`, webapp `/api/webapp`, desktop `VITE_API_SERVER` + `VITE_ADMIN_SECRET` or Settings UI.

## Progress
- 2026-09-06: Hardened deployment compatibility for Render with Persistent Disk: created `tsconfig.build.json`, fixed TS build blockers in `admin.controller.ts`, `channel-poster.service.ts`, `incrementalApiEnrichment.service.ts`, and `historicalMatchInsert.ts`; bound server to `0.0.0.0`; added `BACKUP_DIR` and `DATABASE_PATH` support in `env.ts`; implemented snapshot retention policy (pruneOldBackups=3) in `backup.service.ts`. Verified `npm run build:prod` (0 errors), `npm test` (47/47 passed), and dry-run backup & settler suite (5/5 passed).
- 2026-08-27: Hardened admin auth; protected web admin routes; added security test suite.
- 2026-08-27: Aligned four-project local dev config (port 8080, env names, admin headers, route alias `sync-fixture-results`).
- 2026-08-30: Incremental tennis ingestion — TennisMyLife WTA CSV base, WTA API gap-fill, RapidAPI sparse enrichment, upsert (no wipe by default).
- 2026-08-30: Unified historical pool into live analysis — `/api/web/players/:name/surface-stats`, hub + match details merge SQLite stats with API.
- 2026-08-30: UI settings shows ATP/WTA split, WTA serve %, last sync; backtest + player profiles use pool; full db_frozen rebuild.
- 2026-08-30: Persistent SQLite pool (`pool_cache`) + `ensure-match` API; hub/match-details/backtest call ensure before fetch.
- 2026-08-31: Remote tennis download removed; ingestion reads local season CSVs from `LOCAL_TENNIS_DATA_DIR` (`G:/state football/2021-2026-data`). Player sync is CSV-only (`csvOnly: true`) — no API/PBP. Pool: ~239k matches (2021–2026 ATP+WTA).
- 2026-08-31: CSV name matching fixed (`Last I.`, hyphenated surnames, `Soon Woo Kwon`↔`Soonwoo Kwon`, `Lee C. Y.`); reindex 400/400 players linked.
- 2026-09-02: Data-quality repair completed — eliminated legacy synthetic serve formulas (`serveWinRate * 0.72`, `effectiveTotalServes / (matches * 60)`, `1 - bpScored / bpTotal`). Extended backend `AggregatedSurfaceStats` and `historicalPlayerStats.service.ts` to extract authentic point-level telemetry (`firstServeIn`, `firstServeWon`, `secondServeWon`, `secondServeTotal`, `servePointsTotal`, `breakPointsSaved`, `breakPointsFaced`). Frontend domain model (`surfaceModel.ts`), `holdBreakSynergy.ts`, and client services rewired to real ATP/WTA percentages with honest `undefined` / `isEstimated` handling when telemetry is absent. Metamorphic verification confirmed on top ATP/WTA players.
- 2026-09-02: Pre-2024 archive-only separation implemented. 50,348 pre-2024 historical fixtures marked `is_archive_only = 1`, `is_canonical_modeling_usable = 0`, `is_backtest_safe = 0`, status reason `EXCLUDED_PRE_2024_ARCHIVE`. Preserved 100% of historical data for career profile, H2H, and tournament bracket display while hard-blocking pre-2024 rows from model training, backtest candidate selection, ROI evaluation, and serve modeling.
- 2026-09-02: Operational rewiring completed — `canonical_matches` is now the primary operational fixture source of truth for all 2024+ modeling, backtest candidates, and feature pipelines. `player_matches_validated` view derives participants directly from `canonical_matches`. `queryBacktestCandidateMatches` queries `canonical_matches` directly (8,182 backtest-safe fixtures). All safety rules, point-in-time constraints, and zero-leakage invariants verified via metamorphic sentinel testing.
- 2026-09-02: Created fixture-level canonical match layer `canonical_matches` (140,432 matches: 33,266 both sources unified, 81,957 Source A only, 25,209 Source B only). 100% odds preserved (99,446), full provenance flags, and strict confidence gating.
- 2026-09-02: Established canonical 2024+ modeling subset view `canonical_modeling_matches_2024_plus`. Yields 36,966 clean modeling matches with 0 placeholder serve stats, 0 retirements/walkovers, and strict status reasons. Top-100 backtest usable: 16,128; ROI usable: 15,944.
- 2026-09-02: Canonical dataset unification completed. 37,289 PMI rows enriched from Source B RapidAPI bundles (real serve statistics, PBP flags, provenance fields); 13,643 rows preserved as historical_only_no_source_b. Real serve stats updated in historical_matches (37,091 placeholder stats replaced). Odds and biometrics 100% preserved. Zero rows deleted.
- 2026-09-02: Bulk Match Bundles Phase 2 completed: 57,977 matches processed with 8 req/sec concurrency & exponential backoff retry. 54,731 matches with full serve/break statistics (94.4%) and 50,033 with Point-by-Point (86.3%). Sweep pass completed recovering transient network failures. All 400 player indexes and `events-index.json` rebuilt.
- 2026-09-01: Historical feature pipeline — Top-100, frozen canonical path, placeholder serve flags; endpoints `GET /api/web/historical-match-features`, `GET /api/web/validated-layer-audit`.
- 2026-09-01: Sentinel leakage test (`runSentinelLeakageTest.ts`) — metamorphic future-row mutation/removal against validated historical features; read-only in-memory store.
- 2026-09-01: Backtest canonical path switched from db_frozen JSONL to `tracked_db` API (`GET /api/web/backtest-matches` → `player_matches_validated`). Old `scratch/tennis_archive/db_frozen/*.jsonl` removed.

## Decisions (data)
- `historical_matches` ingestion is incremental by default (`clearBeforeSync: false`).
- Tennis data: local season CSV files only (`2021-2026-data` folder). Remote GitHub/TennisMyLife/API download disabled in `importTennisData.ts`.
- Player linking: `csvOnly` mode links matches from `historical_matches` pool; no RapidAPI events/stats/PBP fetch.
- Backtest policy: Top-100 both players at event time (ranks 1-100; 101 excluded); frozen dataset is canonical backtest path; placeholder serve rows excluded from raw-count features; API blocked in historical mode.
- Validated layer `player_matches_validated` and `canonical_modeling_matches_2024_plus` provide the canonical read paths for historical stats/H2H/features; quarantine flags gate feature families; no synthetic serve/break imputation.
- Authentic Serve & Return Telemetry: Synthetic multipliers (e.g. 0.72) and heuristics (`matches * 60`) are strictly forbidden. Serve & return stats are derived from canonical match telemetry (`firstIn / svpt`, `firstWon / firstIn`, `secondWon / (svpt - firstIn)`, `bpSaved / bpFaced`, `bpWon / bpOpportunities`). If telemetry is missing or placeholder, metrics return `undefined`/null and are displayed as `—` or `N/A` in UI and LLM prompts.
- Canonical 2024+ modeling subset: `canonical_modeling_matches_2024_plus` filters to verified API enriched rows (`is_canonical_modeling_usable = 1`), strictly excluding walkovers, placeholder stats, and unplayed speculative draws.
- Live hub analysis merges API year-stats with SQLite pool via `mergeApiStatsWithHistoricalPool`.
- Persistent pool (`pool_cache`): read-through SQLite cache; finished events permanent; `POST /api/web/pool/ensure-match` fills gaps on demand.
- `tracked_players`: one registry row per player (not per-player tables); `playerSync` paginates RapidAPI `events/previous`, upserts `historical_matches`, enriches serve stats; admin `POST /api/web/admin/tracked-players/track` accepts name or `rapidPlayerId`.
- Bulk API export (2026-09-01): `npm run bulk:list-cohort` lists deduped `rapid_event_id` rows for active tracked players with `current_rank <= 200` (2024–2026); `npm run bulk:fetch-match-bundles` saves full `statistics.json` + `point_by_point.json` per event under `data/bulk-match-bundles/` with per-player index files for later DB import.
- Bulk player history (2026-09-01): `npm run bulk:fetch-player-history` fetches live ATP/WTA top-200 rankings then paginates `events/previous` (30/page) per player into `data/bulk-player-history/` (`events.jsonl` + `indexes/all-events.json`); rate `--req-per-sec 8`, resume with `--resume`. UI: `npm run bulk:ui` → http://localhost:3099 (start/pause/resume, state in `job-control.json`). Two phases: (1) player match lists, (2) per-event stats+PBP bundles. Resume after phase 1 must start bundles — job infers phase from disk counts (`readDistinctEventCount`); UI shows «شروع مرحله ۲» when bundles pending.

## Risks
- Production must set a strong `ADMIN_SECRET` (12+ chars, not a known weak value).
- Weak secrets were previously committed in git (`admin123`, `state_tennis_secret_2026`, etc.) — rotate in deployment env.
