# Phase 2: Raw Evidence Field-by-Field Mapping Specification

**Document Role:** Transformation & Field Mapping Reference for Raw Evidence Ingestion
**Target Table:** `raw.source_evidence` (`db/postgres-schema-v1.sql`)
**Target Engine:** PostgreSQL 16+
**Status:** SPECIFICATION / DRY-RUN MAPPING

---

## 1. Schema Mapping Overview

The target table `raw.source_evidence` stores the unmodified raw payloads received from external data sources. This document defines the exact field extraction, synthesis, and type transformation from:
1. SQLite `raw_source_evidence` (13,000 baseline records)
2. Filesystem `bulk-match-bundles/events` (RapidAPI match bundles)

---

## 2. Target Schema Definition (`raw.source_evidence`)

```sql
CREATE TABLE IF NOT EXISTS raw.source_evidence (
  evidence_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name VARCHAR(50) NOT NULL,
  source_match_id VARCHAR(100) NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  storage_mode VARCHAR(20) NOT NULL DEFAULT 'inline_jsonb'
    CHECK (storage_mode IN ('inline_jsonb', 's3_pointer', 'raw_text')),
  payload_json JSONB NULL,
  blob_uri TEXT NULL,
  payload_size_bytes INTEGER NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_raw_source_evidence_unique_record UNIQUE (source_name, source_match_id, payload_sha256)
);
```

---

## 3. Transformation Rules for SQLite `raw_source_evidence`

| Target Column | SQLite Source Column | Transformation & Synthesis Logic | Nullable | Example Value |
| :--- | :--- | :--- | :---: | :--- |
| `evidence_id` | `evidence_id` (INTEGER) | Deterministic UUIDv5 synthesis using namespace `e4d89647-73d8-4fbb-9f93-10d9e8772379` and key `${source_name}:${source_match_id}:${payload_sha256}`. | NO | `550e8400-e29b-41d4-a716-446655440000` |
| `source_name` | `source_name` (TEXT) | Exact copy (`sackmann` or `pbp`). Trimmed and lowercase. | NO | `'sackmann'` |
| `source_match_id` | `source_match_id` (TEXT) | Exact copy. Must be non-empty string. | NO | `'p1_base_961688'` |
| `payload_sha256` | `payload_sha256` (TEXT) | Hex SHA-256. Verified against `sha256(raw_payload_json)`. Must match identically. | NO | `'d96f8bbcc144cc535604514af28b32f110d7515c1889ec059a8e840528d43996'` |
| `storage_mode` | Synthesized | Set to `'inline_jsonb'` if payload size $\le$ 64 KB; else `'s3_pointer'`. (All 13,000 SQLite payloads are $\le$ 100 bytes). | NO | `'inline_jsonb'` |
| `payload_json` | `raw_payload_json` (TEXT) | Validated via `JSON.parse()`. Cast to native PostgreSQL `JSONB`. | YES | `{"original_id":961688,"source":"sackmann","phase":"phase_1_pilot"}` |
| `blob_uri` | Synthesized | `NULL` for inline payloads. (Populated for S3 pointers). | YES | `NULL` |
| `payload_size_bytes` | `raw_payload_json` (TEXT) | Calculated as byte length: `Buffer.byteLength(raw_payload_json, 'utf8')`. | NO | `66` |
| `fetched_at` | `fetched_at` (TEXT) | Parsed from SQLite datetime string (`YYYY-MM-DD HH:MM:SS`) to ISO-8601 UTC timestamp (`YYYY-MM-DDTHH:MM:SS.000Z`). | NO | `'2026-09-10T14:03:22.000Z'` |
| `created_at` | Synthesized | Ingestion run timestamp in ISO-8601 UTC. Defaults to `clock_timestamp()` on insert. | NO | `'2026-09-11T00:30:00.000Z'` |

---

## 4. Transformation Rules for Bulk Match Bundles (`bulk-match-bundles/events`)

Each event bundle directory (e.g. `data/bulk-match-bundles/events/11866515/`) contains up to 4 files:
1. `event_details.json` $\rightarrow$ `source_name = 'rapidapi_details'`
2. `statistics.json` $\rightarrow$ `source_name = 'rapidapi_statistics'`
3. `point_by_point.json` $\rightarrow$ `source_name = 'rapidapi_pbp'`
4. `manifest.json` $\rightarrow$ `source_name = 'rapidapi_manifest'`

| Target Column | Bundle File Source | Transformation & Synthesis Logic | Nullable |
| :--- | :--- | :--- | :---: |
| `evidence_id` | Synthesized | UUIDv5 `${source_name}:${rapid_event_id}:${payload_sha256}`. | NO |
| `source_name` | File classification | One of `rapidapi_details`, `rapidapi_statistics`, `rapidapi_pbp`, `rapidapi_manifest`. | NO |
| `source_match_id` | Directory name | RapidAPI Event ID string (e.g., `'11866515'`). | NO |
| `payload_sha256` | File content | Cryptographic SHA-256 digest of file byte content. | NO |
| `storage_mode` | File size | `'inline_jsonb'` if size $\le$ 64 KB; else `'s3_pointer'`. | NO |
| `payload_json` | File content | JSON parsed object if `'inline_jsonb'`; `NULL` if `'s3_pointer'`. | YES |
| `blob_uri` | File path | `s3://tennis-raw-evidence/bundles/{eventId}/{fileName}` if `'s3_pointer'`; `NULL` if inline. | YES |
| `payload_size_bytes` | File stats | `fs.statSync(filePath).size`. | NO |
| `fetched_at` | `manifest.json` | Extracted from `manifest.fetched_at` (e.g. `'2026-09-01T19:43:34.594Z'`). | NO |
| `created_at` | Synthesized | Current execution UTC timestamp. | NO |

---

## 5. Quarantine Mapping Schema

Records failing validation are routed to `scratch/phase-2-raw-evidence-output/phase-2-raw-evidence-quarantine.jsonl` with the following structure:

```json
{
  "quarantine_id": "uuid",
  "source_stream": "sqlite_evidence | bulk_bundle",
  "source_name": "string",
  "source_match_id": "string",
  "quarantine_reason": "CORRUPT_JSON | EMPTY_PAYLOAD | HASH_MISMATCH | MISSING_BUNDLE_FILES",
  "error_message": "string",
  "raw_payload_snippet": "string",
  "quarantined_at": "ISO-8601 timestamp"
}
```
