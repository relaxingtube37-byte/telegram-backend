# TennisMyLife Staging Admission Plan: Engineering Specification

## 1. Executive Summary & Objective

This document defines the formal engineering specification, data models, invariant constraints, and quality gates for the **TennisMyLife Staging Admission Plan**.

The objective of this pipeline is to transition reviewed, verified TennisMyLife data from the candidate review phase into structured, schema-compliant **staging artifacts** ready for downstream ingestion into target PostgreSQL 16+ schemas (`raw`, `provenance`, `statistics`, `matches`), while enforcing absolute isolation on conflicts, preventing premature canonical mutations, and ensuring 100% offline immutability of legacy systems.

---

## 2. Hard Invariants & Guardrails

1. **Strict Offline Execution:** Zero PostgreSQL connections or queries. Zero network requests.
2. **SQLite Immutability:** `data/database.sqlite` (544,415,744 bytes) and `tennis_gold.sqlite` (283,303,936 bytes) must maintain an exact $\Delta = 0$ byte delta and identical SHA-256 digests.
3. **Upstream Artifact Invariance:** Phase 3 (`identity_players.jsonl`), Phase 5 (`matches.jsonl`), and Phase 6 (`match_player_statistics.jsonl`) outputs remain bit-for-bit unchanged.
4. **Staging Isolation:** All outputs are written exclusively to `scratch/tennismylife-staging-admission/`. No writes are permitted to operational database views or production tables.
5. **Non-Destructive Telemetry:** Existing Phase 6 canonical statistics must **never** be overwritten. All 917 prioritized field-level conflicts are routed strictly to `approval-queue.jsonl`.
6. **Zero Auto-Creation:** No players, tournaments, or competition editions may be automatically generated in canonical registries. Unresolved competitors (669 unique players) remain strictly quarantined.
7. **NULL Preservation:** Missing fields remain authentic `NULL`s. Coercion of missing metrics to zero is strictly prohibited.
8. **Deterministic Two-Pass Verification:** Successive executions against identical inputs must produce 100% bit-for-bit identical SHA-256 digests across all staging artifacts.

---

## 3. Staging Schemas & Artifact Taxonomies

The staging pipeline generates six specialized JSONL datasets matching target PostgreSQL schemas:

### 3.1 Raw Source Evidence Staging (`source-evidence-staging.jsonl`)
- **Target Schema:** `raw.source_evidence`
- **Volume:** Exactly 13,263 records (100% of evaluated source records).
- **Attributes:**
  - `evidence_id`: Deterministic UUIDv5 (`evidence:<source_record_id>`).
  - `source_name`: `'tennismylife'`.
  - `source_match_id`: `<source_record_id>`.
  - `payload_sha256`: Cryptographic SHA-256 hash of the normalized source record.
  - `storage_mode`: `'inline_jsonb'`.
  - `payload_json`: JSON object containing dataset metadata, candidate fingerprint, and exclusive ledger disposition.
  - `payload_size_bytes`: Byte length of the JSON string.
  - `fetched_at`: Timestamp (`2026-09-11T00:00:00.000Z`).
  - `staging_disposition`: Mutually exclusive disposition from Candidate Review Pass.

### 3.2 Source Match Links Staging (`match-link-staging.jsonl`)
- **Target Schema:** `provenance.source_match_links`
- **Volume:** Exactly 3,807 active match links.
  - **2,129 Confirmed Links:** Connecting TennisMyLife records to existing Phase 5 canonical matches (`link_status = 'CONFIRMED'`, `confidence_score = 95.0`).
  - **1,678 Provisional Links:** Connecting TennisMyLife records to staged candidate fixtures (`link_status = 'PROVISIONAL'`, `confidence_score = 85.0`).
- **Attributes:** `link_id`, `match_id`, `source_name`, `source_match_id`, `evidence_id`, `confidence_score`, `scorer_version`, `rule_version`, `link_status`, `linked_at`.

### 3.3 Field Provenance Staging (`field-provenance-staging.jsonl`)
- **Target Schema:** `provenance.field_provenance`
- **Volume:** Exactly 186 telemetry records.
- **Scope:** Captures field-level provenance for all admitted fill-null service telemetry attributes (aces, double faults, first serves, break points, service games).
- **Attributes:** `provenance_id`, `match_id`, `field_name`, `source_name`, `source_match_id`, `evidence_id`, `raw_value`, `confidence`, `rule_version`, `recorded_at`.

### 3.4 Fill-Null Telemetry Staging (`fill-null-staging.jsonl`)
- **Target Schema:** `statistics.match_player_statistics` (enrichment queue)
- **Volume:** Exactly 186 telemetry enrichment records.
- **Attributes:** `staging_id`, `canonical_match_id`, `source_record_id`, `player_id`, `player_role`, `field_name`, `tennismylife_value`, `enrichment_action = 'UPDATE_NULL_FIELD'`, `rule_version`, `status = 'STAGED_FOR_ENRICHMENT'`, `staged_at`.

### 3.5 Match Admission Staging (`match-admission-staging.jsonl`)
- **Target Schema:** `matches.matches`, `matches.match_participants`, `matches.match_results`
- **Volume:** Exactly 1,678 new match candidates.
- **Stratification:**
  - `TIER_1_TOUR_MAIN_DRAW`: 1,372 matches (825 ATP + 547 WTA).
  - `TIER_2_CHALLENGER_CANONICAL`: 211 matches.
  - `TIER_3_ONGOING_CANDIDATE`: 95 matches.
- **Attributes:** `staged_match_id`, `candidate_fingerprint`, `source_record_id`, `edition_id`, `scheduled_start_utc`, `round_name`, `side1_player_id` (lower UUID), `side2_player_id` (higher UUID), `winner_player_id`, `loser_player_id`, `score_raw`, `quality_tier`, `status = 'STAGED_FOR_ADMISSION'`, `rule_version`, `staged_at`.

### 3.6 Approval & Conflict Isolation Queue (`approval-queue.jsonl`)
- **Target Schema:** `provenance.review_queue`
- **Volume:** Exactly 1,223 queue items.
  - **917 Isolated Stat Conflicts:** All field-level conflicts with $\text{diff} \ge 10$ points/games quarantined under `review_status = 'ISOLATED_CONFLICT_REVIEW'`.
  - **211 Tier 2 Challenger Match Approvals:** Canonical players in Challenger tier quarantined under `review_status = 'PENDING_OPERATOR_APPROVAL'`.
  - **95 Tier 3 Ongoing Match Approvals:** Live 2024 season matches quarantined under `review_status = 'PENDING_OPERATOR_APPROVAL'`.
- **Attributes:** `queue_id`, `queue_type`, `candidate_match_id`, `incoming_source`, `incoming_source_id`, `incoming_evidence_id`, `confidence_score`, `veto_triggers`, `divergent_fields`, `review_status`, `rationale`, `created_at`.

---

## 4. Quality Acceptance Gates

| Gate ID | Condition & Verification Rule | Target Threshold |
| :--- | :--- | :---: |
| **G1** | **Ledger Rows Accounted For** | Exactly 13,263 source rows staged in raw evidence |
| **G2** | **Fill-Null Rows Accounted For** | Exactly 186 telemetry enrichment candidates staged |
| **G3** | **Conflicts Accounted For** | Exactly 917 prioritized conflicts isolated in approval queue |
| **G4** | **Match Candidates Accounted For** | Exactly 1,678 new match candidates staged |
| **G5** | **Zero Silent Row Loss** | Total staged raw evidence equals total candidate ledger rows ($13,263$) |
| **G6** | **Zero PostgreSQL Connections** | 0 connection attempts; 100% offline |
| **G7** | **SQLite Hashes Unchanged** | `database.sqlite` and `tennis_gold.sqlite` size & hash invariant ($\Delta = 0$) |
| **G8** | **Phase Artifacts Unchanged** | Phase 3, 5, and 6 JSONL files bit-for-bit unchanged |
| **G9** | **Dual-Run SHA-256 Determinism** | 100% cryptographic digest match between Pass 1 and Pass 2 |

All gates must evaluate to **PASS**.
