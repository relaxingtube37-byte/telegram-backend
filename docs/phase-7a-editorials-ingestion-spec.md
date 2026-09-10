# Phase 7A: Match Editorials Ingestion & DTO Parity Specification
**Target Schema:** `predictions.matcheditorials` (aliased as `predictions.match_editorials`)  
**Pipeline Mode:** Offline / Dry-Run Draft Only  
**Execution Context:** Standalone Node.js (`scripts/dry-run-phase-7a-editorials.cjs`)  
**Status:** SPECIFICATION & DRY-RUN APPROVED  

---

## 1. Executive Summary & Architectural Scope

Mode A long-form tennis editorials provide pre-match tactical previews, surface breakdown analytics, head-to-head dynamics, and search engine optimization (SEO) packages for public web visitors, registered members, and external syndicated feeds.

Prior to Phase 7A, editorial records were maintained in the backend SQLite `match_editorials` table. While functional for early testing and Phase D workflow demonstrations, migrating these editorial packages to PostgreSQL `predictions.matcheditorials` requires strict architectural governance:
1. **Deterministic Match Fixture Linkage:** Every editorial record must resolve to a valid Phase 3 singles match fixture (`matches.matches(match_id)`). Synthetic, developmental, or unresolvable test fixtures must be quarantined to prevent database pollution.
2. **Lossless JSONB Normalization:** Legacy stringified JSON columns (`key_facts_json`, `data_bullets_json`, `tags_json`, `seo_metadata_json`, `key_stats_json`, `status_history_json`) must be transformed into first-class PostgreSQL `JSONB` structures without data truncation or corruption.
3. **Exact Copy & Status Semantics Preservation:** Editorial headlines, analytical copy, author bylines, and publish status state machines (`draft`, `review`, `approved`, `published`, `archived`) must be preserved without rewriting copy.
4. **Consumer-Facing DTO Parity:** The migration must guarantee 100% backward-compatibility for public consumer endpoints (`GET /api/web/editorials/:idOrSlug`), admin endpoints, and SEO renderers.

---

## 2. Target PostgreSQL Schema DDL

The authoritative PostgreSQL table is **`predictions.matcheditorials`** (aliased in compatibility views to `predictions.match_editorials`):

```sql
-- DDL Excerpt: predictions.matcheditorials
CREATE TABLE IF NOT EXISTS predictions.matcheditorials (
  editorial_id BIGSERIAL PRIMARY KEY,
  fixture_id INTEGER NOT NULL UNIQUE,
  match_id UUID NULL REFERENCES matches.matches(match_id) ON DELETE SET NULL,
  slug TEXT NOT NULL UNIQUE,
  headline TEXT NOT NULL,
  subtitle TEXT NULL,
  summary TEXT NOT NULL,
  short_summary TEXT NULL,
  guest_safe_summary TEXT NULL,
  tactical_analysis TEXT NOT NULL,
  surface_breakdown TEXT NULL,
  h2h_breakdown TEXT NULL,
  author_name TEXT NOT NULL DEFAULT 'PTIN Tennis Editorial Team',
  editor_name TEXT NULL,
  seo_title TEXT NULL,
  seo_description TEXT NULL,
  share_text TEXT NULL,
  key_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
  data_bullets JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  seo_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  publish_status predictions.editorial_publish_status NOT NULL DEFAULT 'draft',
  version SMALLINT NOT NULL DEFAULT 1,
  published_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_predictions_editorials_fixture 
  ON predictions.matcheditorials (fixture_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_predictions_editorials_slug 
  ON predictions.matcheditorials (slug);

CREATE INDEX IF NOT EXISTS idx_predictions_editorials_status 
  ON predictions.matcheditorials (publish_status, published_at DESC);
```

---

## 3. Strict Safety Invariants

1. **Zero PostgreSQL Access:** Operates strictly offline without live remote PostgreSQL database connections.
2. **Zero SQLite Mutation:** SQLite database files (`data/database.sqlite`, `tennis_gold.sqlite`) are opened exclusively with `{ readonly: true, fileMustExist: true }`. File size invariance is strictly verified (0 byte delta).
3. **Zero Network Calls:** No external HTTP, HTTPS, or remote network socket calls.
4. **Codebase Immutability:** Zero modifications to `src/`, `server/`, or runtime application code.
5. **Fail-Closed Execution:** Mandates explicit `--dry-run` CLI flag; immediately halts with exit code 1 if invoked without it.

---

## 4. Model Rules & Governance Invariants

1. **Identifier Preservation:** Every emitted editorial must preserve `fixture_id` and `slug` exactly.
2. **Parent Match Linkage First:** Each editorial must resolve to a valid Phase 3 `match_id`. Unresolved or ambiguous records are quarantined with diagnostic reason codes (`UNRESOLVED_PHASE3_MATCH`).
3. **Lossless JSON Normalization:** All legacy stringified JSON columns must be parsed and stored as structured JSONB arrays/objects without silent dropping.
4. **Publish Status Semantics:** The 5-stage lifecycle state machine (`draft`, `review`, `approved`, `published`, `archived`) and revision version counter must be preserved exactly.
5. **Lossless Editorial Copy:** Editorial body text (`headline`, `summary`, `tactical_analysis`, `surface_breakdown`, `h2h_breakdown`) must not be rewritten, summarized, or altered during ingestion.
6. **Public DTO Parity:** Output payload structures for public consumer endpoints must replicate existing API response contracts identically.
7. **Collision Quarantine:** Any duplicate `slug` or duplicate `fixture_id` must be isolated in quarantine.

---

## 5. Invariant Quality Gates (G1 – G12)

| Gate | Name | Rule / Specification | Threshold |
| :--- | :--- | :--- | :--- |
| **G1** | **Fixture ID & Slug Preservation** | 100% of emitted editorials preserve `fixture_id` and `slug` exactly. | 100% Preserved |
| **G2** | **Target Schema Conformance** | All emitted rows map completely to `predictions.matcheditorials` DDL. | 100% PASS |
| **G3** | **JSON Structural Parseability** | All JSON fields parse cleanly into valid JSONB arrays and objects. | 100% Valid JSON |
| **G4** | **Unresolved Match Linkage Quarantine** | All records lacking deterministic Phase 3 match linkage quarantined. | 100% Quarantined |
| **G5** | **Slug Uniqueness Invariant** | Exactly zero slug collisions across all emitted records. | 0 Collisions |
| **G6** | **Fixture ID Uniqueness Invariant** | Exactly zero fixture ID collisions across all emitted records. | 0 Collisions |
| **G7** | **Publish Status Semantics** | Status values conform strictly to canonical enum (`draft`, `published`, etc.). | 100% Valid |
| **G8** | **Editorial Copy Preservation** | 100% of analytical text and headlines preserved without rewriting. | 100% Exact Copy |
| **G9** | **Public Response DTO Parity** | DTO contract parity verified against public endpoint specification. | 100% Verified |
| **G10** | **Zero SQLite Mutation** | Source SQLite file sizes must show exactly 0 byte delta before and after run. | 0 Bytes Changed |
| **G11** | **Zero PostgreSQL & Zero Network** | Standalone offline execution with zero remote database or API connections. | 100% Offline |
| **G12** | **Fail-Closed Execution** | Halts immediately with exit code 1 if invoked without `--dry-run`. | Enforced |
