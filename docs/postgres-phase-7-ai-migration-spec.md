# PostgreSQL Phase 7: AI Prediction Runs, Multi-Agent Traces, Predictions & Editorials Migration Specification

**Document Role:** Authoritative Architectural Design, Ingestion Strategy & Data Dictionary  
**Target Engine:** Disposable Local PostgreSQL Staging Cluster (Port 54350)  
**Execution Script:** [`scripts/run-postgres-phase-7-ai-migration.cjs`](file:///g:/telegram-backend/scripts/run-postgres-phase-7-ai-migration.cjs)  
**Phase Status:** EXECUTION IN PROGRESS / STAGING VERIFICATION  

---

## 1. Executive Summary & Migration Scope

The objective of **PostgreSQL Phase 7: AI Telemetry, Predictions & Editorials Migration** is to establish the machine learning intelligence and editorial layer in the canonical PostgreSQL relational architecture.

Phase 7 defines the relational contract for:
1. **`ai.prediction_runs`:** Top-level evaluation runs containing pre-match feature snapshots, routing configurations, confidence tiers, and model outputs.
2. **`ai.agent_traces`:** Fine-grained execution traces capturing specialist multi-agent reasoning (Physical, Statistical, Historical, Market, Chief) with full token telemetry.
3. **`predictions.published_predictions`:** Public-facing predictive DTOs published to Telegram and web consumers.
4. **`predictions.match_editorials`:** Rich editorial match previews, long-form tactical analyses, and structured SEO metadata.
5. **`provenance.review_queue` / Quarantine Ledger:** Isolated forensic audit trail capturing unresolvable fixtures, missing participants, and malformed candidates.

### Strict Operational Precondition: Zero Fabrication Invariant
In accordance with project architecture and the reality of historical storage:
- **IndexedDB Trace Storage:** Full multi-agent execution traces were historically captured in browser/client IndexedDB under the object store `predictiontracesv1`.
- **Pending Source Export:** As documented, an authentic export file for `predictiontracesv1` is pending and not yet present on disk.
- **Zero Fabrication Mandate:** The system strictly prohibits synthesizing `run_id`, `trace_id`, or `cutoff_timestamp_utc` from publication dates (`published_at` or `created_at`).
- **Target Admission:** Until an authentic `predictiontracesv1` export is supplied:
  - `ai.prediction_runs` admitted: **0**
  - `ai.agent_traces` admitted: **0**
  - `synthetic_runs_created`: **0**
  - `fabricated_timestamps`: **0**

---

## 2. Pre-Migration AI & Editorial Reconciliation Manifest

Before database ingestion, candidate records from SQLite (`data/database.sqlite`) were audited and classified:

```
Candidate Published Predictions:        9 records
 ├── Unresolved Canonical Fixtures:     8 records (quarantined)
 └── Null Fixture Identifier:           1 record  (quarantined)
Candidate Match Editorials:             3 records
 └── Unresolved Canonical Fixtures:     3 records (quarantined)
IndexedDB Multi-Agent Trace Exports:    Pending Source Export (0 records)
```

### Reconciliation Accounting Identities:
1. `candidate_predictions (9) = admitted_predictions (0) + quarantined_predictions (9)`
2. `candidate_editorials (3) = admitted_editorials (0) + quarantined_editorials (3)`
3. `admitted_prediction_runs = 0` (awaiting authentic `predictiontracesv1` export)
4. `admitted_agent_traces = 0` (awaiting authentic `predictiontracesv1` export)
5. `synthetic_runs_created = 0`
6. `fabricated_timestamps = 0`

---

## 3. Schema Data Dictionary & Relational Invariants

### 3.1. `ai.prediction_runs`
Top-level evaluation run record for an AI model execution against a specific match fixture.

| Column Name | Data Type | Nullable | Constraints & Relational Targets | Architectural Purpose |
| :--- | :--- | :---: | :--- | :--- |
| `run_id` | `UUID` | **NO** | `PRIMARY KEY DEFAULT gen_random_uuid()` | Immutable unique identifier for evaluation run. |
| `match_id` | `UUID` | **NO** | `REFERENCES matches.matches(match_id) ON DELETE RESTRICT` | Target match fixture evaluated. |
| `cutoff_timestamp_utc` | `TIMESTAMPTZ` | **NO** | `CHECK (cutoff_timestamp_utc <= match.scheduled_start_utc)` | Strict temporal barrier prohibiting lookahead bias. |
| `feature_schema_hash` | `CHAR(64)` | **NO** | SHA-256 hash of feature snapshot schema | Schema reproducibility and drift detection. |
| `feature_snapshot` | `JSONB` | **NO** | Valid JSONB object | Exact point-in-time features available at cutoff. |
| `model_routing_config` | `JSONB` | **NO** | Valid JSONB object | LLM provider, models used, temperatures. |
| `predicted_winner_id` | `UUID` | **NO** | `REFERENCES identity.players(player_id) ON DELETE RESTRICT` | Projected winner resolved to canonical identity. |
| `win_probability_pct` | `NUMERIC(5,2)` | **NO** | `CHECK (win_probability_pct BETWEEN 0.0 AND 100.0)` | Probability calibration score. |
| `confidence_tier` | `VARCHAR(20)` | **NO** | e.g. `HIGH`, `MEDIUM`, `LOW` | Calibrated confidence tier. |
| `best_bet_market` | `TEXT` | YES | Optional recommended wager market. | Market selection. |
| `best_bet_selection` | `TEXT` | YES | Optional recommended wager selection. | Selection side. |
| `best_bet_ev_pct` | `NUMERIC(5,2)` | YES | Expected value percentage if calculated. | Value edge. |
| `quality_gate_passed` | `BOOLEAN` | **NO** | `DEFAULT TRUE` | Whether run passed post-generation validation. |
| `quality_gate_reasons` | `TEXT[]` | YES | Array of validation flags or veto triggers. | Diagnostic log. |
| `total_latency_ms` | `INTEGER` | **NO** | `CHECK (total_latency_ms >= 0)` | Wall-clock execution latency. |
| `total_cost_usd` | `NUMERIC(8,5)` | YES | `CHECK (total_cost_usd >= 0)` | Model inference cost. |
| `created_at` | `TIMESTAMPTZ` | **NO** | `DEFAULT clock_timestamp()` | Audit creation timestamp. |

### 3.2. `ai.agent_traces`
Execution log and reasoning traces for individual specialist agents.

| Column Name | Data Type | Nullable | Constraints & Relational Targets | Architectural Purpose |
| :--- | :--- | :---: | :--- | :--- |
| `trace_id` | `UUID` | **NO** | `PRIMARY KEY DEFAULT gen_random_uuid()` | Trace entry identifier. |
| `run_id` | `UUID` | **NO** | `REFERENCES ai.prediction_runs(run_id) ON DELETE CASCADE` | Parent execution run. |
| `agent_role` | `ai.agent_role_type` | **NO** | `ENUM ('PHYSICAL', 'STATISTICAL', 'HISTORICAL', 'MARKET', 'CHIEF')` | Specialist agent role. |
| `provider` | `VARCHAR(30)` | **NO** | e.g. `google`, `anthropic`, `openai` | LLM API provider. |
| `model_identifier` | `VARCHAR(100)` | **NO** | e.g. `gemini-1.5-pro`, `claude-3-5-sonnet` | Exact foundation model identifier. |
| `temperature` | `NUMERIC(3,2)` | **NO** | `CHECK (temperature BETWEEN 0.0 AND 2.0)` | Sampling temperature. |
| `prompt_tokens` | `INTEGER` | YES | `CHECK (prompt_tokens >= 0)` | Input token count. |
| `completion_tokens` | `INTEGER` | YES | `CHECK (completion_tokens >= 0)` | Output token count. |
| `latency_ms` | `INTEGER` | **NO** | `CHECK (latency_ms >= 0)` | Specialist execution latency. |
| `system_prompt` | `TEXT` | **NO** | Verbatim prompt text | Complete system prompt without truncation. |
| `user_prompt` | `TEXT` | **NO** | Verbatim prompt text | Complete user prompt without truncation. |
| `raw_thinking_content` | `TEXT` | YES | Raw thought process if available. | Chain-of-thought tokens. |
| `raw_response_content` | `TEXT` | **NO** | Complete LLM text response | Verbatim generation output. |
| `parsed_output` | `JSONB` | **NO** | Valid JSONB | Structured extraction from raw response. |
| `error_message` | `TEXT` | YES | Error message if generation failed. | Failure diagnostics. |
| `created_at` | `TIMESTAMPTZ` | **NO** | `DEFAULT clock_timestamp()` | Ingestion timestamp. |

### 3.3. `predictions.published_predictions`
Public prediction serving entity displayed on web and Telegram.

| Column Name | Data Type | Nullable | Constraints & Relational Targets |
| :--- | :--- | :---: | :--- |
| `prediction_id` | `BIGSERIAL` | **NO** | `PRIMARY KEY` |
| `match_id` | `UUID` | **NO** | `REFERENCES matches.matches(match_id) ON DELETE RESTRICT` |
| `run_id` | `UUID` | YES | `REFERENCES ai.prediction_runs(run_id) ON DELETE SET NULL` |
| `fixture_id` | `INTEGER` | **NO** | `UNIQUE` (vendor fixture ID) |
| `home_player_id` | `UUID` | **NO** | `REFERENCES identity.players(player_id) ON DELETE RESTRICT` |
| `away_player_id` | `UUID` | **NO** | `REFERENCES identity.players(player_id) ON DELETE RESTRICT` |
| `predicted_winner_id` | `UUID` | **NO** | `REFERENCES identity.players(player_id) ON DELETE RESTRICT` |
| `win_probability` | `SMALLINT` | **NO** | `CHECK (win_probability BETWEEN 0 AND 100)` |
| `confidence` | `VARCHAR(20)` | **NO** | Confidence tier (`HIGH`, `MEDIUM`, `LOW`) |
| `key_factors` | `JSONB` | **NO** | `DEFAULT '[]'::jsonb` |
| `status` | `predictions.prediction_status_type` | **NO** | `DEFAULT 'UPCOMING'` |
| `published_at` | `TIMESTAMPTZ` | **NO** | Publication timestamp |

### 3.4. `predictions.match_editorials`
Long-form tactical previews and match intelligence.

| Column Name | Data Type | Nullable | Constraints & Relational Targets |
| :--- | :--- | :---: | :--- |
| `editorial_id` | `BIGSERIAL` | **NO** | `PRIMARY KEY` |
| `fixture_id` | `INTEGER` | **NO** | `UNIQUE` |
| `match_id` | `UUID` | YES | `REFERENCES matches.matches(match_id) ON DELETE SET NULL` |
| `slug` | `TEXT` | **NO** | `UNIQUE` (SEO slug) |
| `headline` | `TEXT` | **NO** | Editorial title |
| `summary` | `TEXT` | **NO** | Executive overview |
| `tactical_analysis` | `TEXT` | **NO** | Detailed multi-court strategic breakdown |
| `key_facts` | `JSONB` | **NO** | `DEFAULT '[]'::jsonb` |
| `data_bullets` | `JSONB` | **NO** | `DEFAULT '[]'::jsonb` |
| `tags` | `JSONB` | **NO** | `DEFAULT '[]'::jsonb` |
| `seo_metadata` | `JSONB` | **NO** | `DEFAULT '{}'::jsonb` |
| `publish_status` | `predictions.editorial_publish_status` | **NO** | `DEFAULT 'draft'` |

---

## 4. Non-Negotiable Boundary Rules & Quarantine Policy

1. **Anti-Lookahead Cutoff Barrier:**
   $$cutoff\_timestamp\_utc \le scheduled\_start\_utc$$
   Any AI prediction run whose feature snapshot or observation cutoff occurs after official match scheduled start is strictly rejected or quarantined under `CUTOFF_LOOKAHEAD_VIOLATION`.
2. **Zero Fabrication of Cutoffs or Identifiers:**
   Under no circumstances may `cutoff_timestamp_utc` be inferred or synthesized from `published_at` or `created_at`. If an authentic cutoff is absent, the record cannot be admitted as an authoritative pre-match evaluation run.
3. **No Winner Feature Leakage:**
   Feature snapshots must not contain `winner_player_id`, final score, retirement flags, or match outcome variables.
4. **Relational Quarantine (Zero Foreign Key Orphans):**
   Any legacy prediction or editorial whose `fixture_id` cannot be resolved to a canonical `matches.matches` UUID is routed to `quarantine-ledger.jsonl` and recorded in `provenance.review_queue` under `UNRESOLVED_CANONICAL_MATCH`.
5. **Canonical JSON Serialization & Cryptographic Invariant:**
   To guarantee bitwise forensic reproducibility across languages and platforms, all candidate records undergo deterministic canonical stringification prior to cryptographic hashing:
   - **Recursive Lexicographical Sorting:** All JSON object keys are sorted alphabetically at every level of depth.
   - **Order-Preserving Arrays:** Array items retain their exact authentic sequence.
   - **Compact Whitespace:** Zero extraneous formatting whitespace outside string literals (no spaces after `:` or `,`).
   - **UTF-8 Encoding:** Canonical strings are converted to UTF-8 byte sequences.
   - **The Cryptographic Invariant:**
     $$\text{SHA-256}(\text{canonical\_serialized\_payload}) \equiv \texttt{ledger.payload\_sha256} \equiv \texttt{raw.source\_evidence.payload\_sha256}$$
     All hashes are strictly stored as full 64-character lowercase hexadecimal strings.
6. **Dual-Tier Source Evidence Retention:**
   - **Batch Parent Snapshots:** `raw.source_evidence` retains immutable batch evidence records (`BATCH:predictions` and `BATCH:match_editorials`) whose `payload_json` contains the complete array of candidate rows extracted from SQLite.
   - **Dedicated Per-Record Evidence:** Each quarantined candidate has its own individual `raw.source_evidence` row holding its complete payload as JSONB, enabling direct Foreign Key resolvability from `provenance.review_queue.incoming_evidence_id`.
7. **Review Queue Enum Compliance (`review_status = 'PENDING'`):**
   To strictly preserve canonical DDL constraints without altering the frozen enum `provenance.review_status_type` (`'PENDING'`, `'APPROVED'`, `'REJECTED'`, `'MERGED'`), all quarantined records are inserted with:
   - `review_status = 'PENDING'`
   - `veto_triggers = ARRAY['ISOLATED_CONFLICT_REVIEW', <exact_reason>]::text[]`
   - `divergent_fields = { "review_classification": "ISOLATED_CONFLICT_REVIEW", "exact_reason": ..., "diagnostic_details": ..., "payload_sha256": ..., "record_evidence_id": ..., "parent_evidence_id": ..., "canonical_payload": ... }::jsonb`

---

## 5. Authentic Trace Export Specification (`predictiontracesv1`)

The migration runner provides an integrated ingestion pathway for authentic IndexedDB dumps via `--trace-export=<filepath>`. When invoked, the pipeline validates:

```json
{
  "traceId": "authentic-unique-string-or-uuid",
  "matchId": 12345678,
  "capturedAt": "2026-08-25T14:30:00.000Z",
  "modelUsed": "gemini-1.5-pro",
  "provider": "google",
  "temperature": 0.2,
  "dataSnapshot": { "features": {} },
  "finalDecision": { "winnerId": 123, "winProbability": 62 },
  "agentTraces": [
    {
      "agentRole": "PHYSICAL",
      "systemPrompt": "...",
      "userPrompt": "...",
      "rawResponse": "...",
      "parsedOutput": {}
    }
  ]
}
```

If any field fails validation (e.g. role not in `agent_role_type`, corrupted JSON, or cutoff > match start), the trace bundle is quarantined with a deterministic error code.

---

## 6. The 12 Invariant Quality Acceptance Gates (P7-G1 to P7-G12)

| Gate | Title | Acceptance Criterion |
| :---: | :--- | :--- |
| **P7-G1** | Parent Match Linkage Fidelity | 100% of admitted predictions link to a valid match in `matches.matches` (0 orphan matches). |
| **P7-G2** | Participant Integrity | 100% of admitted predictions have valid participants in `identity.players`. |
| **P7-G3** | Anti-Lookahead Temporal Barrier | $cutoff\_timestamp\_utc \le scheduled\_start\_utc$ strictly enforced. |
| **P7-G4** | Zero Fabricated Timestamps | Zero synthetic cutoff timestamps inferred or guessed. |
| **P7-G5** | JSONB Structural Parseability | 100% of admitted JSONB columns parse cleanly in PostgreSQL. |
| **P7-G6** | Prediction-to-Run Lineage Fidelity | Every admitted prediction links to a valid run or documents lineage. |
| **P7-G7** | Canonical Agent Role Enum | Agent roles strictly confined to `PHYSICAL`, `STATISTICAL`, `HISTORICAL`, `MARKET`, `CHIEF`. |
| **P7-G8** | Prompt & Response Fidelity | Prompts and raw responses preserved without truncation. |
| **P7-G9** | Zero Orphan Foreign Keys | Strict zero dangling foreign key references across all schemas. |
| **P7-G10** | Dual-Pass Idempotency | Pass 2 insertion delta equals exactly 0 rows (100% idempotent no-op). |
| **P7-G11** | Zero Fabrication Policy | Zero synthetic runs or traces manufactured awaiting authentic export. |
| **P7-G12** | Bitwise SQLite Immutability | Source SQLite databases bitwise untouched ($\Delta = 0\text{ bytes}$). |
