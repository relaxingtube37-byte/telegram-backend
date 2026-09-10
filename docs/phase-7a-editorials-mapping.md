# Phase 7A: Match Editorials Mapping & DTO Parity Specification
**Target Table:** `predictions.matcheditorials` (or `predictions.match_editorials`)  
**Source Table:** SQLite `match_editorials`  
**Status:** DRAFT APPROVED & DRY-RUN VERIFIED  

---

## 1. Field-Level Deterministic Mapping

| Target Column (`predictions.matcheditorials`) | Target Type | Source Field (`match_editorials`) | Transformation & Invariant Rule |
| :--- | :--- | :--- | :--- |
| **`editorial_id`** | `BIGSERIAL PRIMARY KEY` | `id` | Monotonically increasing primary key; preserved from SQLite ID. |
| **`fixture_id`** | `INTEGER NOT NULL UNIQUE` | `fixture_id` | Vendor fixture identifier; preserved exactly for client routing. |
| **`match_id`** | `UUID NULL` | Resolved | Foreign key to `matches.matches(match_id)`. Resolved via Phase 3 match index. Quarantined if unresolvable. |
| **`slug`** | `TEXT NOT NULL UNIQUE` | `slug` | Unique URL-friendly slug; preserved exactly. |
| **`headline`** | `TEXT NOT NULL` | `headline` | Primary editorial title; preserved exactly without rewriting. |
| **`subtitle`** | `TEXT NULL` | `subtitle` | Contextual subtitle (e.g. `'Demo Open · R16 · Hard'`). |
| **`summary`** | `TEXT NOT NULL` | `summary` | Comprehensive analytical summary. |
| **`short_summary`** | `TEXT NULL` | `short_summary` | Brief summary; falls back to `summary` if null. |
| **`guest_safe_summary`** | `TEXT NULL` | `guest_safe_summary` | Public teaser summary; falls back to `short_summary` or `summary`. |
| **`tactical_analysis`** | `TEXT NOT NULL` | `tactical_analysis` | Deep tactical analysis copy; preserved verbatim. |
| **`surface_breakdown`** | `TEXT NULL` | `surface_breakdown` | Court speed & CPI analysis; preserved verbatim. |
| **`h2h_breakdown`** | `TEXT NULL` | `h2h_breakdown` | Historical head-to-head tactical context; preserved verbatim. |
| **`author_name`** | `TEXT NOT NULL` | `author_name` | Defaults to `'PTIN Tennis Editorial Team'` if null. |
| **`editor_name`** | `TEXT NULL` | `editor_name` | Name of approving editor. |
| **`seo_title`** | `TEXT NULL` | `seo_title` | `<title>` tag content for search engines. |
| **`seo_description`** | `TEXT NULL` | `seo_description` | `<meta name="description">` content. |
| **`share_text`** | `TEXT NULL` | `share_text` | Social media sharing snippet. |
| **`key_facts`** | `JSONB NOT NULL` | `key_facts_json` | Parsed JSON array of analytical bullet points. Defaults to `'[]'::jsonb`. |
| **`data_bullets`** | `JSONB NOT NULL` | `data_bullets_json` | Parsed JSON array of statistical data points. Defaults to `'[]'::jsonb`. |
| **`tags`** | `JSONB NOT NULL` | `tags_json` | Parsed JSON array of taxonomy tags. Defaults to `'[]'::jsonb`. |
| **`seo_metadata`** | `JSONB NOT NULL` | `seo_metadata_json` | Parsed JSON object containing `titleTag`, `canonicalSlug`, etc. Defaults to `'{}'::jsonb`. |
| **`publish_status`** | `VARCHAR(20) NOT NULL` | `publish_status` | Canonical enum: `'draft'`, `'review'`, `'approved'`, `'published'`, `'archived'`. |
| **`version`** | `SMALLINT NOT NULL` | `version` | Monotonically increasing revision counter (default 1). |
| **`published_at`** | `TIMESTAMPTZ NULL` | `published_at` | True publication timestamp. Null if unpublished. |
| **`created_at`** | `TIMESTAMPTZ NOT NULL` | `created_at` | Record creation timestamp. |
| **`updated_at`** | `TIMESTAMPTZ NOT NULL` | `updated_at` | Last modification timestamp. |

---

## 2. Public Response DTO Parity Specification

The consumer-facing endpoint **`GET /api/web/editorials/:idOrSlug`** serves the public website and Telegram Mini App. When backed by PostgreSQL `predictions.matcheditorials`, the returned JSON must match the legacy SQLite response shape with 100% fidelity.

### Response DTO Field Mapping

```typescript
export interface PublicEditorialDto {
  fixture_id: number;
  slug: string;
  headline: string;
  title: string;                    // Synthesized: title === headline
  subtitle?: string | null;
  summary?: string;                 // Truncated to 280 chars if content_locked
  short_summary?: string;           // Truncated to 280 chars if content_locked
  guest_safe_summary?: string;      // Public fallback summary
  key_facts?: string[];             // Redacted if !guest_can_see_summary
  data_bullets?: string[];          // Redacted if !guest_can_see_stats
  tags?: string[];
  share_text?: string | null;
  author_name?: string;
  editor_name?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  seo_metadata?: Record<string, any>;
  publish_status: string;
  version: number;
  published_at?: string | null;
  
  // Tactical Deep Analytics (Redacted if content_locked)
  tactical_analysis?: string;
  surface_breakdown?: string;
  h2h_breakdown?: string;
  key_stats?: Record<string, any>;  // Derived from _key_stats

  // Access & Gating Decorators
  content_locked: boolean;
  verified: boolean;
  access_mode: 'FREE' | 'REGISTRATION_REQUIRED' | 'DEPOSIT_REQUIRED';
  content_layers: {
    guest_can_see_summary: boolean;
    guest_can_see_stats: boolean;
    guest_can_see_ai_full: boolean;
  };
}
```

### Synthesis & Redaction Rules:
1. **Title Synthesis:** `title` is populated directly from `headline`.
2. **Key Stats Deserialization:** `key_stats` is extracted directly from JSONB.
3. **Guest Redaction Pipeline (`redactEditorial`):**
   - If user is verified (`isVerified === true`) or `guest_can_see_ai_full === true`:
     `content_locked = false`, all tactical analysis, surface breakdown, and H2H breakdown strings are included in full.
   - If guest (`isVerified === false` and `!guest_can_see_ai_full`):
     `content_locked = true`, `tactical_analysis`, `surface_breakdown`, and `h2h_breakdown` are set to `undefined`. `summary` is truncated to 280 characters using `truncateSummary()`. `key_facts` and `data_bullets` are conditionally redacted according to active content layer toggles.

---

## 3. Conflict Quarantine Schema

Records failing validation gates are emitted to `phase-7a-editorial-conflicts.jsonl`:

```json
{
  "source_table": "match_editorials",
  "source_id": "3",
  "fixture_id": 99008877,
  "slug": "phase-d-player-a-vs-player-b-demo-99008877",
  "headline": "Player A vs Player B: Form, Surface & Match Analysis — Demo Open",
  "reason": "UNRESOLVED_PHASE3_MATCH",
  "diagnostic_details": "Editorial fixture ID 99008877 (\"Player A vs Player B: Form, Surface & Match Analysis — Demo Open\") has no corresponding canonical match in frozen Phase 3 fixtures.",
  "quarantined_at_utc": "2026-09-10T19:55:52.912Z"
}
```
