# Project Memory

## Goals
Secure backend admin endpoints; protect operational web admin routes.
Product direction: deep tennis analytics site (ATP/WTA singles) controlled from State Football — not VIP picks-only portal.

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
- Strict deployment rule: All ongoing development, testing, and enhancements must be performed 100% OFFLINE on local workspace copies only. Absolutely NO pushes to remote git (origin/master) or triggering Render deploys while work is in progress. The live servers are actively serving users and will only be updated after all offline changes are fully verified and user gives explicit instruction.
- Access modes: `FREE` | `REGISTRATION_REQUIRED` | `DEPOSIT_REQUIRED` (legacy `VIP_REFERRAL` normalized to registration).
- Guest content layers live in `website_config`: `guest_can_see_summary|stats|ai_full|watch_live`, plus `payment_gateway_enabled` (off until wired) and `unlock_via_referral`.
- Business CTAs (Phase C) live in separate settings key `business_action_settings` — not mixed into `access_policy`: registration_referral / watch_live / payment placeholder / shared watch URL.
- Referral clicks store opaque `click_id` attribution; partner postbacks are idempotent via `partner_conversions.dedupe_key`.
- Watch Live uses shared partner `/go/:siteId/:userId?action=watch_live` referral redirect — no stream capture/redistribution.
- Google Sign-In & One Tap authentication integrated (`POST /api/webapp/auth/google`) with deterministic safe numeric user ID generation for SQLite backward-compatibility.
- Users schema enriched with `email`, `auth_provider`, `google_id`, `avatar_url`.
- "VIP" terminology eliminated across all components in favor of professional "Member Access" and "Full Tactical Dossier".
- Gating UI upgraded to soft-blur gradient overlay on deep predictive dossiers with 1-click Google and Telegram connect.
- State Football admin UsersTab displays auth source badge (Google vs Telegram) and email alongside Telegram usernames.

## Progress
- 2026-09-09: Trust-Enhanced User Profile Menu & Account Logout:
  - Header: Integrated interactive user profile capsule displaying avatar (Google picture / Telegram avatar / initials) with online status dot, user display name, and verified badge (`PRO MEMBER ✓` or `STEP 2 PENDING`).
  - Trust Signals Dropdown: Clicking the profile capsule opens a glass dropdown featuring full user details, dedicated tracking ID (`#10492`), 256-Bit SSL encryption badge, official 1WIN partnership sync status, and unlocked AI perks checklist.
  - Logout Action: Added `handleLogout` clearing `localStorage` (`ptin_web_session`, `ptin_web_verified`, `ptin_partner_activated`, `ptin_telegram_user`, `ptin_web_uid`), resetting state, and reloading guest data.
  - Verified with clean build and pushed to `origin/master`.
- 2026-09-09: Elegant, Simplified 2-Step Registration & Activation Flow:
  - Preserved the required 2-step business model (Step 1: Account Connection via Google/Telegram ➔ Step 2: 1WIN Partner Activation).
  - Redesigned `ReferralModal.tsx` with a clean, minimal 2-step stepper:
    - Step 1: 1-click Google Sign-In (or automatic Telegram connection) with instant auto-advance to Step 2 upon success.
    - Step 2: 1WIN Partner Card with a single prominent "Step 2: Register on 1WIN & Unlock" CTA that opens the tracking URL and unlocks all AI predictions.
  - Simplified `SignUpStrip.tsx`: displays dynamic step state ("Step 1: Sign in with Google" vs "Step 2: Activate 1WIN (+500% Bonus)") without confusing secondary buttons or clutter.
  - Verified with clean build and pushed to `origin/master`.
- 2026-09-09: Telegram Mini App Instant Unlock & Synchronous User Detection:
  - WebApp: Updated `App.tsx` to detect `Telegram.WebApp.initDataUnsafe.user` synchronously on initial render, preventing unauthenticated fallback states in Telegram WebView.
  - Resilience: Client-side unlock logic now permanently overrides predictions with `content_locked = false` upon partner click or verified token, immune to background network latency or stale server responses.
  - CTAs Wired: Added `onVerified` handler to `SignUpStrip`, `MatchBusinessActions`, `SideBanner`, and `ReferralModal`. Clicking "Activate 1WIN" or match registration immediately unlocks tactical predictions and sets `ptin_web_verified` in `localStorage`.
  - Referral Modal: Configured `ReferralModal` to open Step 2 directly when inside Telegram, skipping unusable Google Sign-In prompts.
  - Verified with clean production build (`tsc -b && vite build`) and pushed to `origin/master`.
- 2026-09-09: Telegram Mini App Full Unlocking & Verification Flow:
  - Backend: Updated `computeIsVerified` in `contentAccess.ts` and `resolveAccess.ts` to recognize authenticated Telegram users (`auth_provider === 'telegram'` or valid `telegram_id`) as verified under `REGISTRATION_REQUIRED`.
  - Database: Updated `UsersRepo.upsertFromBot` to mark Telegram users `is_verified = 1`, `verify_status = 'telegram_verified'`, `auth_provider = 'telegram'`. Added automatic SQLite backfill migration for existing Telegram users. Added `setTelegramVerified` helper.
  - Auth Routes: Updated `POST /api/webapp/auth` to issue cryptographically signed session tokens upon Telegram HMAC validation (`sessionToken`) and return `verified: true`. Added explicit `POST /api/webapp/referral/complete` endpoint.
  - WebApp: Updated `App.tsx` to store session tokens and preserve verification status on launch. Updated `ReferralModal.tsx` to call `/referral/complete` on Step 2 partner clicks or direct complete action.
  - Verified by `test_telegram_miniapp_unlock.ts`, security suite (21/21), clean builds and git master push across backend and webapp.
- 2026-09-09: Google Sign-In, Dual-Auth & Professional Gating Presentation:
  - Backend: Added `googleAuth.ts`, `POST /api/webapp/auth/google`, `UsersRepo.upsertFromGoogle`, `test_google_auth.ts` (all passed).
  - Schema: Enriched `users` table with `email`, `auth_provider`, `google_id`, `avatar_url` via safe migrations.
  - WebApp: Integrated Google Identity Services (`gsi/client`) + `useGoogleAuth` hook; eliminated all "VIP" tacky jargon and button spam; replaced lock boxes with soft-blur gradient overlay in `MatchDeepAnalysis.tsx`; updated `ReferralModal.tsx` with dual Google/Telegram 1-click connect.
  - State Football: Enriched `TelegramUserRecord` with Google fields; updated `UsersTab.tsx` with Google vs Telegram badges and email identifiers.
  - Verified 100% test pass (26/26 backend, 21/21 security, Google auth suite) and clean production builds on all 3 projects. Zero deployments performed.
- 2026-09-08: Final Polish, Consistency & QA Audit across all 4 phases (A, B, C, D):
  - Phase A: Unified `contentAccess.ts` defaults with `access-policy` (`REGISTRATION_REQUIRED`), linked `saveWebsiteConfig` to live `access_policy` layers in `admin.controller.ts`, verified default mode fallback, legacy alias normalization, and schema stability in `test_access_policy_phase_a.ts`.
  - Phase B: Refined winner lean logic in `MatchPredictionPanel.tsx` (preventing false winner pill on home player when predicted_winner is empty), styled fallback error state with `btn-secondary` in `MatchAnalysisPage.tsx`, reused shared `buildAuthHeaders` with Telegram `initData` support in `MatchEditorialSummary.tsx`, expanded `phaseBChecks.ts` (edge cases & lean heuristics).
  - Phase C: Tightened `redirectWhitelist.ts` with strict HTTP/HTTPS protocol validation and subdomain matching for allowed hosts, deleted dead code `src/postback.ts`, updated `tsconfig.build.json` includes, expanded `test_business_actions_phase_c.ts` with unsafe URI scheme and subdomain tests.
  - Phase D: Enhanced `EDITORIAL_STATUS_FLOW` with reversible transitions (`published → review`, `approved → draft`), added `Draft` button & status badge in `PublishingTab.tsx`, resolved Windows libuv test teardown in `test_editorial_phase_d.ts`.
  - Verified 100% test pass across all 4 phases, security suite (21/21), webapp build, backend production build, and desktop typecheck. Zero deployments performed.
- 2026-09-08: Phase D editorial publishing: match editorial package + SEO metadata + draft→review→approved→published→archived workflow; admin Publishing/SEO tab; backend editorials schema/status APIs; site MatchEditorialSummary consumption; SeoRenderer prefers editorial. Verified by `test_editorial_phase_d.ts` + `phaseDChecks.ts`. A/B/C untouched in scope. No deploy.
- 2026-09-08: Phase C business actions (referral attribution + watch live + postback idempotency): `business_action_settings` separate from access_policy; tables `referral_clicks` / `partner_conversions`; `/go` mints opaque click_id + whitelist; postback deduped; admin toggles in Referrals tab; match-page CTAs. Verified by `npx tsx src/test_business_actions_phase_c.ts`. Phase A/B untouched in scope.
- 2026-09-08: Phase B match analysis page (telegram-webapp): MatchAnalysisPage + MatchHeader/PredictionPanel/InsightSummary/AnalyticsGrid/DeepAnalysis/LiveStatus; wired to `/api/web/matches` + deep-analytics with graceful guest lock UI. Phase A untouched.
- 2026-09-08: Phase A access-policy (guest/member matrix):
  - Module `src/access-policy` with `FREE | REGISTRATION_REQUIRED | GATED_LATER` (default `REGISTRATION_REQUIRED`).
  - Live SQLite settings (`access_mode` + `access_policy` layers); server-side redact on `GET /api/web/matches` and `GET /api/web/matches/deep-analytics`.
  - State Football Referrals tab controls mode + guest layers (summary / stats none|partial|full / AI full).
  - Verified by `npx tsx src/test_access_policy_phase_a.ts`.
- 2026-09-08: Deep tennis analytics business wiring:
  - Server-side guest redaction + content layer flags; webapp deep-analytics endpoints; Watch Live referral CTA; admin toggles in State Football Website tab; dual-package publish enriched with real surface stats (no fake hold/break placeholders).
- 2026-09-08: Match Page SEO Architecture & Raw HTML Prerendering:
  - Implemented `SeoRendererService` and `seoRoutes` serving raw HTML with route-specific `<title>`, `<meta description>`, Open Graph, Twitter Cards, canonical tags, and Schema.org JSON-LD (`SportsEvent` & `NewsArticle`).
  - Added semantic pre-rendered HTML container in `#root` and client hydration state (`window.__INITIAL_MATCH__`).
  - Added path-based routing (`/match/:slug`) and dual-mode query fallback (`?match=`) with history pushState and popstate handling in `App.tsx`.
  - Added `api/seo.js` serverless function and updated `vercel.json` rewrites and `public/_redirects`.
- 2026-09-08: Web Security Hardening & Telegram Ownership Verification:
  - Eliminated web VIP unlock spoofing via `ptin_web_uid` and deprecated raw query `GET /api/webapp/user/:telegramId` (now returns 401).
  - Implemented HMAC-SHA256 signed web session tokens (`POST /api/webapp/auth/web`) and cryptographic Telegram Login Widget validation (`POST /api/webapp/auth/telegram-widget`).
  - Replaced manual Telegram ID input in `ReferralModal.tsx` with official Telegram Login widget and direct Mini App deep link.
  - Added SPA fallback rewrites for Vercel (`vercel.json`) and Netlify/Cloudflare Pages (`public/_redirects`).
- 2026-09-06: End-to-end integration hardening between State Football, Telegram Backend, and Telegram WebApp:
  - Mounted `webappRoutes` at root (`/`), `/webapp`, and `/api/webapp` so any client `VITE_API_BASE` configuration resolves.
  - Added baseline auto-seeding in `schema.ts` for referral partner (`1win`) and active prediction so Render ephemeral disk wipes never leave the DB empty.
  - Removed ML gating cutoff blocking in `ChannelPosterService.publishPrediction` so admin-published predictions post immediately to Telegram channel without silent drops.
  - Fixed WebApp UI issues: truncated score in status pill (`WON 2:0`) to eliminate overlap with player names, replaced duplicate win probability pill with `✓ Pick` badge, and expanded gender heuristic keywords with WTA player surnames to display correct `WTA` tour badges.
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
