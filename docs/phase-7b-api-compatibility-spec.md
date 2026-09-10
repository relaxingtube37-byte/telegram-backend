# Phase 7B: API Compatibility & Read Model Parity Specification
**Target Read Models:** `predictions.publishedpredictions`, `predictions.matcheditorials`, `public.canonicalmatchesoperational`, `ai.predictionruns`  
**Pipeline Mode:** Offline / Dry-Run Specification & Compatibility Audit Only  
**Execution Context:** Standalone Node.js (`scripts/dry-run-phase-7b-api-compatibility.cjs`)  
**Status:** SPECIFICATION & DRY-RUN VERIFIED (10/10 GATES PASS)  

---

## 1. Executive Summary & Architectural Mandate

As the tennis intelligence platform migrates from its single-node SQLite prototype architecture to an enterprise-grade PostgreSQL relational database, preserving 100% backward compatibility for existing client applications is a non-negotiable architectural invariant. Any silent field renaming, unexpected type coercion, altered nullability semantics, or drifting access-gating behavior will immediately break downstream consumers, including:
- The Telegram WebApp frontend (`g:\telegram-webapp`)
- Desktop analytical engines and automation pipelines (`g:\state football`)
- Syndicated public web readers and SEO crawlers
- External webhook consumers and betting recommendation subscribers

Phase 7B establishes the formal specification and offline verification framework for **API Compatibility and Read Model Parity**. It guarantees that target PostgreSQL read models and compatibility views can serve existing HTTP endpoint contracts identically, byte-for-byte in structure, without modifying runtime server code (`src/` or `server/`) during the migration phases.

> [!IMPORTANT]
> **Scope & Cutover Gate Mandates:**
> - **Contract Parity vs. Production Read Parity:** این فاز contract parity را ثابت می‌کند، نه production read parity را. production parity طبق برنامه در Phase 10 و با canary comparator سنجیده می‌شود. *(This phase validates contract parity, not live production read parity. Production parity is measured in Phase 10 via live canary comparator.)*
> - **No-Cutover Gate Boundary:** قبولی 10/10 به معنی آمادگی برای ادامه‌ی فاز 8 و 9 است، نه مجوز cutover. خود برنامه صریحاً NO-GO می‌دهد تا وقتی Phase 10 parity روی ترافیک واقعی تأیید نشده باشد. *(Passing 10/10 gates signifies readiness to advance to Phase 8 and Phase 9, never authorization for cutover. The program enforces an absolute NO-GO until Phase 10 shadow/canary parity is confirmed.)*

---

## 2. Audited Contract-Critical Endpoints

The audit evaluates five contract-critical endpoints across both **Verified Member (Unlocked)** and **Unverified Guest (Locked)** access tiers:

| Endpoint | Method | Criticality | Primary Consumer | Core Risk Mitigated |
| :--- | :---: | :---: | :--- | :--- |
| `/api/webapp/predictions` | GET | Contract-Critical | Telegram WebApp Feed | Field naming drift, EV string formatting, guest redaction masking |
| `/api/webapp/matches/:idOrSlug/editorial` | GET | Contract-Critical | WebApp Match Analysis | Title synthesis, JSON array parsing, guest teaser redaction |
| `/api/web/editorials/:idOrSlug` | GET | Contract-Critical | Public Web Portal | Dual-slug/id routing, backwards-compatible legacy JSON columns |
| `/api/webapp/matches/:fixtureId/analytics` | GET | Contract-Critical | WebApp Deep Dive | Rolling form structure, H2H teaser masking for guests |
| `/api/web/matches` | GET | Contract-Critical | Legacy Operational View | Compatibility view (`canonicalmatchesoperational`) parity |
| `/api/webapp/stats` | GET | Complementary Trust | WebApp Dashboard | Aggregate win-rate trust metrics, settled/active counts |

---

## 3. Strict Safety Invariants

Phase 7B executes strictly within the sandbox boundaries established across Phases 1 through 7A:
1. **Zero SQLite Mutation:** Both source SQLite databases (`data/database.sqlite` and `G:/state football/data/tennis_gold.sqlite`) are opened exclusively with `{ readonly: true, fileMustExist: true }`. Byte sizes are measured before and after dry-run execution; a 0-byte delta is enforced.
2. **Zero PostgreSQL Connections:** Operates 100% offline without opening network sockets or issuing queries to remote PostgreSQL instances.
3. **Zero Network Calls:** No external HTTP, HTTPS, or remote network socket calls.
4. **Codebase Immutability:** Absolute zero modifications to `src/`, `server/`, or runtime application code.
5. **Fail-Closed Execution:** Mandates explicit `--dry-run` CLI flag; immediately halts with exit code 1 if invoked without it.
6. **Ambiguity Rejection:** Rejects ambiguous slug or fixture lookups with fail-closed 404/quarantine handling rather than serving corrupted or synthetic records.

---

## 4. Quality Acceptance Gates (G1 – G10)

Ten rigorous quality gates govern Phase 7B acceptance:

| Gate | Name | Rule / Specification | Verification Criteria | Status |
| :--- | :--- | :--- | :--- | :---: |
| **G1** | **100% Field-Name Parity** | 0 missing keys and 0 extra keys between SQLite responses and PostgreSQL read model projections across all tiers. | `missingInPg === 0 && extraInPg === 0` across all 10 matrices | ✅ PASS |
| **G2** | **100% Type Parity** | Type signatures (string, number, boolean, array, object, null, undefined) match identically across all keys. | 0 `TYPE_MISMATCH` discrepancies detected | ✅ PASS |
| **G3** | **100% Nullability Parity** | Nullable fields maintain identical `null` vs `undefined` semantics between SQLite and target projections. | 14 nullable fields audited and verified | ✅ PASS |
| **G4** | **Enum / Value-Domain Parity** | Discrete value sets (`status`, `confidence`, `publish_status`, `access_mode`, `guest_stats_level`) match exactly. | 100% domain membership verified | ✅ PASS |
| **G5** | **Guest / Auth Gating Parity** | Client access tiers produce identical payload masking (locked content flags, summary truncation, tactical stripping). | Verified Unlocked vs Guest Locked matrices match | ✅ PASS |
| **G6** | **Ordering & Pagination Parity** | Sorting clauses (`published_at DESC`, `COALESCE(published_at, ...) DESC`) and limits match identically. | Exact sort order and limits confirmed | ✅ PASS |
| **G7** | **No Hidden Derived-Field Drift** | Derived fields (`title := headline`, player image URLs, parsed JSON structures) conform to legacy expectations. | 100% derivation fidelity preserved | ✅ PASS |
| **G8** | **Zero SQLite Mutation** | Source SQLite databases remain bitwise unchanged. | 0 bytes delta backend, 0 bytes delta gold | ✅ PASS |
| **G9** | **Zero PostgreSQL Writes** | 100% offline standalone dry-run execution without database writes. | Verified offline execution | ✅ PASS |
| **G10** | **Fail-Closed Ambiguity & CLI Invariant** | CLI halts without `--dry-run`; ambiguous or non-existent fixture/slug lookups evaluate to null/quarantine. | Code 1 halt without flag + verified null resolution | ✅ PASS |

---

## 5. PostgreSQL Target Read Model Projections

To achieve 100% field and type parity without modifying client contract expectations, the target PostgreSQL database implements dedicated read views and projections:

### 5.1. Operational Matches View: `public.canonicalmatchesoperational`
Provides seamless backward-compatibility for `/api/web/matches` and legacy operational feeds:
```sql
CREATE OR REPLACE VIEW public.canonicalmatchesoperational AS
SELECT
  p.id,
  p.fixture_id,
  p.tournament_name,
  p.round_name,
  p.surface,
  p.match_date,
  p.home_name,
  p.away_name,
  p.home_odds,
  p.away_odds,
  p.predicted_winner,
  p.win_probability,
  p.confidence,
  p.predicted_score,
  p.best_bet_selection,
  p.best_bet_market,
  p.best_bet_ev,
  p.best_bet_rationale,
  p.alt_bet_selection,
  p.alt_bet_market,
  p.key_factors,
  p.devils_advocate_risk,
  p.ai_summary,
  '/api/webapp/players/' || url_encode(COALESCE(p.home_id, p.home_name)) || '/image?size=80' AS home_image,
  '/api/webapp/players/' || url_encode(COALESCE(p.away_id, p.away_name)) || '/image?size=80' AS away_image,
  p.home_id,
  p.away_id,
  p.status,
  p.result_score,
  p.published_at,
  p.created_at
FROM predictions.publishedpredictions p
ORDER BY p.published_at DESC;
```

### 5.2. Match Editorials View: `predictions.match_editorials_view`
Emits both first-class JSONB arrays and backward-compatible stringified legacy columns:
```sql
CREATE OR REPLACE VIEW predictions.match_editorials_view AS
SELECT
  e.editorial_id AS id,
  e.fixture_id,
  e.slug,
  e.headline,
  e.headline AS title,
  e.subtitle,
  e.summary,
  COALESCE(e.short_summary, e.summary) AS short_summary,
  e.guest_safe_summary,
  e.tactical_analysis,
  e.surface_breakdown,
  e.h2h_breakdown,
  e.key_facts,
  e.key_facts::text AS key_facts_json,
  e.data_bullets,
  e.data_bullets::text AS data_bullets_json,
  e.tags,
  e.tags::text AS tags_json,
  e.seo_metadata,
  CASE WHEN e.seo_metadata IS NOT NULL THEN e.seo_metadata::text ELSE NULL END AS seo_metadata_json,
  e.key_stats,
  CASE WHEN e.key_stats IS NOT NULL THEN e.key_stats::text ELSE NULL END AS key_stats_json,
  e.status_history,
  e.status_history::text AS status_history_json,
  e.share_text,
  e.author_name,
  e.editor_name,
  e.seo_title,
  e.seo_description,
  e.publish_status,
  e.version,
  1 AS ai_assisted,
  CASE WHEN e.publish_status = 'published' THEN 1 ELSE 0 END AS is_published,
  e.published_at,
  e.created_at,
  e.updated_at
FROM predictions.matcheditorials e;
```

---

## 6. Access Gating & Redaction Semantics

The parity audit validates that the dual-tier access engine (`src/utils/contentAccess.ts` and `src/access-policy/redact.ts`) functions identically across data layers:

### Unverified Guest Redaction Rules:
1. **Predictions (`GET /api/webapp/predictions`):**
   - `content_locked`: set to `true`.
   - `key_factors`, `devils_advocate_risk`: redacted to `undefined`.
   - `best_bet_*` and `alt_bet_*`: redacted to `undefined`.
   - `ai_summary`: cleanly truncated to 220 characters with ellipsis (`…`).
   - `predicted_score`: preserved for basic teaser trust unless stats level is entirely stripped.
2. **Editorials (`GET /api/web/editorials/:idOrSlug` & `/api/webapp/matches/:idOrSlug/editorial`):**
   - `content_locked`: set to `true`.
   - `tactical_analysis`, `surface_breakdown`, `h2h_breakdown`, `ai_analysis`: redacted to `undefined`.
   - `summary` & `short_summary`: truncated to 280 characters.
   - `key_facts`: preserved if `guest_can_see_summary = true`.
   - `key_stats`: redacted to `undefined` unless `guest_can_see_stats = true`.
3. **Analytics (`GET /api/webapp/matches/:fixtureId/analytics`):**
   - `locked`: set to `true`.
   - Deep tactical edge, fatigue metrics, and recent scores: stripped.
   - Teaser rolling form win rates and H2H encounter counts: preserved.

---

## 7. Canary Read Comparator Strategy

Prior to final production DNS or traffic cutover, the architecture mandates a **Canary Read Comparator**:
1. **Parallel Shadow Reads:** For 5% of incoming GET requests, the API gateway or proxy concurrently fetches responses from both the legacy SQLite read path and the PostgreSQL read path.
2. **Diff Evaluation:** The comparator evaluates responses against the G1–G7 rules:
   - Zero missing keys
   - Zero unexpected type differences
   - Timestamp parity within tolerable network delta (< 100ms)
3. **Telemetry & Alerting:** Any deviation triggers an immediate alert and pauses automated traffic migration.
