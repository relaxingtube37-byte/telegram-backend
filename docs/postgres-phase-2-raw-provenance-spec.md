# PostgreSQL Phase 2: Raw Evidence & Provenance Migration Specification

**Document Role:** Authoritative Architectural Design, Ingestion Strategy & Data Dictionary  
**Target Engine:** Disposable Local PostgreSQL Staging Cluster (Port 54345)  
**Execution Script:** [`scripts/run-postgres-phase-2-raw-provenance.cjs`](file:///G:/telegram-backend/scripts/run-postgres-phase-2-raw-provenance.cjs)  
**Phase Status:** PHASE 2 COMPLETE (9/9 GATES PASS)

---

## 1. Executive Summary & Migration Scope

The objective of **PostgreSQL Phase 2: Raw Evidence and Provenance Migration** is to populate the root evidence and provenance layers of the canonical PostgreSQL relational architecture from validated staging datasets without mutating live SQLite databases, contacting production clusters, or importing premature canonical entities (players, tournaments, editions, matches, or boxscore statistics).

### Target PostgreSQL Tables & Quantities:
1. **`raw.source_evidence`:** Exactly **13,263** immutable source payloads with cryptographically verified SHA-256 digests.
2. **`provenance.source_match_links`:** Exactly **3,807** external-to-canonical match resolution records:
   - **2,129 Confirmed Links:** Main tour matches linked directly to established canonical `match_id`s.
   - **1,678 Provisional Links:** New match candidates assigned `match_id = NULL` so that nonexistent canonical fixtures are never required.
3. **`provenance.field_provenance`:** Exactly **186** field-level service telemetry provenance records supporting fill-null enrichment.
4. **`provenance.review_queue`:** Exactly **1,223** operator review and quarantine items:
   - **917 Isolated Stat Conflicts:** High-divergence telemetry conflicts ($\text{diff} \ge 10$) isolated under `review_status = 'ISOLATED_CONFLICT_REVIEW'`.
   - **211 Tier 2 Challenger Approvals:** Main draw Challenger matches under `review_status = 'PENDING_OPERATOR_APPROVAL'`.
   - **95 Tier 3 Ongoing Approvals:** Live tournament fixtures under `review_status = 'PENDING_OPERATOR_APPROVAL'`.

---

## 2. Input Artifacts & Field Mappings

```
scratch/tennismylife-staging-admission/
 ├── source-evidence-staging.jsonl (13,263 rows) ──────► raw.source_evidence
 ├── match-link-staging.jsonl      (3,807 rows)  ──────► provenance.source_match_links
 ├── field-provenance-staging.jsonl (186 rows)   ──────► provenance.field_provenance
 └── approval-queue.jsonl          (1,223 rows)  ──────► provenance.review_queue
```

### 2.1. `raw.source_evidence` Mapping
| Source Field | Target Column | Type | Transformation & Handling |
| :--- | :--- | :--- | :--- |
| `evidence_id` | `evidence_id` | `UUID` | Primary Key. Preserved exactly from staging. |
| `source_name` | `source_name` | `VARCHAR(50)` | `'tennismylife'` |
| `source_match_id` | `source_match_id` | `VARCHAR(100)` | Unique source record token (e.g. `TENNISMYLIFE:atp_2024:...`) |
| `payload_sha256` | `payload_sha256` | `CHAR(64)` | 100% cryptographic SHA-256 payload digest preserved. |
| `storage_mode` | `storage_mode` | `VARCHAR(20)` | `'inline_jsonb'` |
| `payload_json` | `payload_json` | `JSONB` | Native PostgreSQL JSONB payload containing metadata and disposition. |
| `payload_size_bytes` | `payload_size_bytes`| `INTEGER` | Byte size of raw payload string. |
| `fetched_at` | `fetched_at` | `TIMESTAMPTZ` | Timestamp of original source ingestion. |

**Natural Key & Idempotency:** `CONSTRAINT uq_raw_source_evidence_unique_record UNIQUE (source_name, source_match_id, payload_sha256)` ensures `ON CONFLICT DO NOTHING` on subsequent passes.

### 2.2. `provenance.source_match_links` Mapping
| Source Field | Target Column | Type | Transformation & Handling |
| :--- | :--- | :--- | :--- |
| `match_id` | `match_id` | `UUID NULL` | If `link_status = 'CONFIRMED'`, retains canonical `match_id`. If `link_status = 'PROVISIONAL'`, set to `NULL` (adheres to invariant: provisional links must not require nonexistent canonical match). |
| `source_name` | `source_name` | `VARCHAR(50)` | `'tennismylife'` |
| `source_match_id` | `source_match_id` | `VARCHAR(100)` | Unique source record identifier. |
| `evidence_id` | `evidence_id` | `UUID` | Foreign Key targeting `raw.source_evidence(evidence_id)`. |
| `confidence_score` | `confidence_score`| `NUMERIC(5,2)` | 0.0 to 100.0 score from linker engine. |
| `scorer_version` | `scorer_version` | `VARCHAR(20)` | Linker algorithm version (`'v2.1.0'`). |
| `rule_version` | `rule_version` | `VARCHAR(20)` | Domain rule version (`'v2.1.0'`). |
| `link_status` | `link_status` | `VARCHAR(20)` | `'CONFIRMED'` or `'PROVISIONAL'`. |
| `linked_at` | `linked_at` | `TIMESTAMPTZ` | Staging admission timestamp. |

**Natural Key & Idempotency:** `CONSTRAINT uq_provenance_source_match_links UNIQUE (source_name, source_match_id)`.

### 2.3. `provenance.field_provenance` Mapping
| Source Field | Target Column | Type | Transformation & Handling |
| :--- | :--- | :--- | :--- |
| `provenance_id` | `staging_id` | `UUID UNIQUE` | Deterministic staging UUID guaranteeing idempotency. |
| `match_id` | `match_id` | `UUID` | Canonical match UUID being enriched. |
| `field_name` | `field_name` | `VARCHAR(50)` | Telemetry field (`'svpt'`, `'sv_gms'`, `'first_in'`, `'aces'`, etc.). |
| `source_name` | `source_name` | `VARCHAR(50)` | `'tennismylife'` |
| `source_match_id` | `source_match_id` | `VARCHAR(100)` | Upstream source record identifier. |
| `evidence_id` | `evidence_id` | `UUID` | Foreign Key targeting `raw.source_evidence(evidence_id)`. |
| `raw_value` | `raw_value` | `TEXT` | Raw telemetry attribute value as string. |
| `confidence` | `confidence` | `NUMERIC(5,2)` | Enrichment confidence score (90.00%). |
| `recorded_at` | `recorded_at` | `TIMESTAMPTZ` | Admission timestamp. |

### 2.4. `provenance.review_queue` Mapping
| Source Field | Target Column | Type | Transformation & Handling |
| :--- | :--- | :--- | :--- |
| `queue_id` | `staging_id` | `UUID UNIQUE` | Deterministic staging UUID guaranteeing idempotency. |
| `candidate_match_id` | `candidate_match_id`| `UUID NULL` | Candidate match UUID for operator inspection, or NULL for pure telemetry conflicts. |
| `incoming_source` | `incoming_source` | `VARCHAR(50)` | `'tennismylife'` |
| `incoming_source_id` | `incoming_source_id`| `VARCHAR(100)` | Source record identifier. |
| `incoming_evidence_id`| `incoming_evidence_id`| `UUID` | Foreign Key targeting `raw.source_evidence(evidence_id)`. |
| `confidence_score` | `confidence_score`| `NUMERIC(5,2)` | 0.0 to 100.0 score. |
| `veto_triggers` | `veto_triggers` | `TEXT[]` | PostgreSQL array of veto codes triggered. |
| `divergent_fields` | `divergent_fields` | `JSONB` | Structured JSON of conflicting fields and candidate values. |
| `review_status` | `review_status` | `review_status_type`| `'PENDING_OPERATOR_APPROVAL'` or `'ISOLATED_CONFLICT_REVIEW'`. |
| `created_at` | `created_at` | `TIMESTAMPTZ` | Admission timestamp. |

---

## 3. Strict Isolation & Non-Destructive Invariants

1. **No Canonical Domain Ingestion:** Zero rows are inserted into `identity.players`, `identity.tournaments`, `competition.tournament_editions`, `matches.matches`, `matches.match_participants`, `matches.match_results`, or `statistics.match_player_statistics`.
2. **Referential Integrity Strategy for Staging:** Because canonical matches are not imported in Phase 2, foreign key validation triggers on `matches.matches` are temporarily disabled during evidence staging. Full foreign key enforcement will be triggered upon Phase 5 canonical match admission.
3. **SQLite Immutability:** Legacy SQLite databases (`data/database.sqlite` and `tennis_gold.sqlite`) remain strictly read-only with $0\text{ bytes}$ delta.
4. **Production Isolation:** Operations take place exclusively inside a local disposable staging PostgreSQL cluster (`scratch/postgres-phase-2-raw-provenance/pg_staging`).
5. **Two-Pass Execution Rule:**
   - **Pass 1:** Inserts all $18,479$ records.
   - **Pass 2:** Must evaluate to a pure **No-Op** ($0$ rows inserted), with $100\%$ identical counts and content hashes.
