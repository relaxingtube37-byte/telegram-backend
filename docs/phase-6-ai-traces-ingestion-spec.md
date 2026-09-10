# Phase 6: AI Traces & Published Predictions Ingestion Specification
**Target Schemas:** `ai.predictionruns`, `ai.agenttraces`, `predictions.publishedpredictions`  
**Pipeline Mode:** Offline / Dry-Run Draft Only  
**Execution Context:** Standalone Node.js (`scripts/dry-run-phase-6-ai-traces.cjs`)  
**Status:** SPECIFICATION & DRY-RUN APPROVED  

---

## 1. Executive Summary & Architectural Purpose

Modern multi-agent AI betting systems produce complex, multi-stage reasoning outputs spanning specialized analytical agents (physical biomechanics, statistical distribution, historical tactical context, market intelligence, and chief synthesis). 

Prior to Phase 6, these critical telemetry artifacts—specifically full LLM prompts, latency, token consumption, and extended deep-reasoning tokens (`reasoning_content`)—were confined to ephemeral browser storage (IndexedDB `prediction_traces_v1`) and local JSON debug files (`backtest_traces_audit.json`). Concurrently, the backend SQLite `predictions` table only preserved a 9-row summary view designed for Telegram bot broadcasts, lacking the granular auditability, replayability, and model governance required for institutional-grade sports analytics.

Phase 6 establishes the deterministic ingestion specification and offline dry-run extraction pipeline that maps multi-agent execution runs and their constituent specialist traces into high-fidelity PostgreSQL schemas:
1. **`ai.predictionruns`** (top-level run execution, feature hashes, frozen snapshots, model routing, and canonical winner resolution).
2. **`ai.agenttraces`** (the 5 specialized agent execution chains per run, holding prompts, token counts, latency, and lossless extended reasoning).
3. **`predictions.publishedpredictions`** (the serving view for the WebApp, Telegram Mini App, and guest portals, strictly preserving lineage back to the originating execution `run_id`).

---

## 2. Five Non-Negotiable Architectural Principles

Phase 6 strictly locks five core architectural invariants:

### 1. Match Linkage First
Under no circumstances may an AI prediction run or individual agent trace enter the canonical PostgreSQL tables without deterministic linkage to an authoritative, frozen Phase 3 `match_id`. Source fixtures that cannot be mapped to the canonical singles fixture corpus are immediately isolated in quarantine (`phase-6-ai-conflicts.jsonl` under `UNRESOLVED_PHASE3_MATCH`).

### 2. Strict Cutoff Barrier (Zero Lookahead Fabrication)
`cutoff_timestamp_utc` represents the point-in-time barrier when the feature vector was frozen and models were invoked. It must originate from authentic source observation telemetry (`capturedAt`).
- Scheduled match start or publish time must **NEVER** be substituted into `cutoff_timestamp_utc`.
- If a trace was captured after scheduled match start ($T_{\text{cutoff}} > T_{\text{start}}$), it is strictly flagged as `_is_backtest_safe: false` to prevent retrospective data contamination in historical backtesting.

### 3. Lossless Reasoning Retention (No Thought Loss)
Extended reasoning tokens from deep thinking models (such as DeepSeek-R1, OpenAI o3-mini, and Gemini Thinking) represent the single most valuable asset for forensic audit and model improvement. The field `raw_thinking_content` must preserve 100% of the raw thought stream without truncation or summarization. Historical recoverability must be transparently tracked.

### 4. Rigid Agent Role Normalization
The multi-agent architecture permits exactly five canonical agent roles:
- `PHYSICAL`: Sports physiologist, biomechanics, recovery, acute-to-chronic workload (ACWR).
- `STATISTICAL`: Tennis probability analyst, Markov chain simulations, Elo distributions.
- `HISTORICAL`: Historian, tactical matchups, head-to-head dynamics, court pace affinity.
- `MARKET`: Betting market intelligence, closing line value (CLV), odds movement, market efficiency.
- `CHIEF`: Lead tennis strategist, final synthesis, consensus arbitration, quality gating.

Any role string failing to normalize into these five canonical keys is rejected into quarantine (`INVALID_AGENT_ROLE`).

### 5. Serving Layer Separation & Lineage
`predictions.publishedpredictions` is purely a serving table for consumer endpoints, not the authoritative source-of-truth for model reasoning. Every published prediction must maintain an explicit lineage foreign key (`run_id`) to `ai.predictionruns`. Legacy broadcast records lacking execution traces are explicitly segregated and tagged as `_lineage_status: 'LEGACY_UNLINKED'`.

---

## 3. Schema & DDL Canonical Alignment

### Authoritative Table & Column Naming
In alignment with PostgreSQL schema guidelines and user requirements:
- **Table Names:** Standardized without internal underscores: `ai.predictionruns`, `ai.agenttraces`, and `predictions.publishedpredictions` (aliased in compatibility views to `prediction_runs`, `agent_traces`, and `published_predictions`).
- **Predicted Winner Identifier:** The top-level prediction run identifies the selected victor via **`predictedwinnerid`** (UUID FK referencing `identity.players(player_id)`).
- **Participant Side Helper:** The target DDL does **not** contain `predicted_winner_side`. For downstream validation and symmetrical participant checks, the side relative to Phase 3 ordering (`player1_id` vs `player2_id`) is derived as `_predicted_winner_side` in the dry-run JSONL output, explicitly flagged as a validation helper rather than an authoritative DDL column.

```sql
-- DDL Excerpt: ai.predictionruns
CREATE TABLE IF NOT EXISTS ai.predictionruns (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  cutoff_timestamp_utc TIMESTAMPTZ NOT NULL,
  feature_schema_hash CHAR(64) NOT NULL,
  feature_snapshot JSONB NOT NULL,
  model_routing_config JSONB NOT NULL,
  predictedwinnerid UUID NOT NULL REFERENCES identity.players(player_id),
  win_probability_pct NUMERIC(5, 2) NOT NULL CHECK (win_probability_pct BETWEEN 0.00 AND 100.00),
  confidence_tier VARCHAR(20) NOT NULL,
  best_bet_market TEXT NULL,
  best_bet_selection TEXT NULL,
  best_bet_ev_pct NUMERIC(5, 2) NULL,
  quality_gate_passed BOOLEAN NOT NULL,
  quality_gate_verdict TEXT NULL,
  total_latency_ms INTEGER NOT NULL,
  total_prompt_tokens INTEGER NULL,
  total_completion_tokens INTEGER NULL,
  estimated_cost_usd NUMERIC(8, 5) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- DDL Excerpt: ai.agenttraces
CREATE TABLE IF NOT EXISTS ai.agenttraces (
  trace_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES ai.predictionruns(run_id) ON DELETE CASCADE,
  agent_role ai.agent_role_type NOT NULL,
  agent_index SMALLINT NOT NULL CHECK (agent_index BETWEEN 1 AND 5),
  provider VARCHAR(30) NOT NULL,
  model_identifier VARCHAR(100) NOT NULL,
  temperature NUMERIC(3, 2) NOT NULL,
  prompt_tokens INTEGER NULL,
  completion_tokens INTEGER NULL,
  latency_ms INTEGER NOT NULL,
  system_prompt TEXT NOT NULL,
  user_prompt TEXT NOT NULL,
  raw_thinking_content TEXT NULL,
  raw_response_content TEXT NOT NULL,
  parsed_output JSONB NOT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_ai_agenttraces_run_role UNIQUE (run_id, agent_role)
);

-- DDL Excerpt: predictions.publishedpredictions
CREATE TABLE IF NOT EXISTS predictions.publishedpredictions (
  prediction_id BIGSERIAL PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES matches.matches(match_id) ON DELETE CASCADE,
  run_id UUID NULL REFERENCES ai.predictionruns(run_id) ON DELETE SET NULL,
  fixture_id INTEGER NOT NULL UNIQUE,
  home_player_id UUID NOT NULL REFERENCES identity.players(player_id),
  away_player_id UUID NOT NULL REFERENCES identity.players(player_id),
  predicted_winner_id UUID NOT NULL REFERENCES identity.players(player_id),
  win_probability SMALLINT NOT NULL CHECK (win_probability BETWEEN 1 AND 99),
  confidence VARCHAR(20) NOT NULL,
  predicted_score TEXT NULL,
  best_bet_market TEXT NULL,
  best_bet_selection TEXT NULL,
  best_bet_ev NUMERIC(5, 2) NULL,
  best_bet_rationale TEXT NULL,
  alt_bet_market TEXT NULL,
  alt_bet_selection TEXT NULL,
  key_factors JSONB NOT NULL DEFAULT '[]'::jsonb,
  devils_advocate_risk TEXT NULL,
  ai_summary TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'UPCOMING',
  result_score TEXT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
```

---

## 4. Strict Safety Invariants

1. **Zero PostgreSQL Connections:** 100% offline dry-run; no network database connections.
2. **Zero SQLite Mutations:** Source files (`database.sqlite`, `tennis_gold.sqlite`) are opened strictly with `{ readonly: true, fileMustExist: true }`. Exact file byte sizes are validated before and after execution (0 bytes delta required).
3. **Zero Network Calls:** No external HTTP, HTTPS, or remote API calls.
4. **Codebase Immutability:** No changes to `src/`, `server/`, or runtime application code.
5. **Fail-Closed Execution:** Mandates `--dry-run` command line flag; immediately halts with exit code 1 if invoked without it.

---

## 5. Invariant Quality Gates (G1 – G14)

| Gate | Name | Rule / Specification | Threshold |
| :--- | :--- | :--- | :--- |
| **G1** | **Parent Match Resolution** | Every emitted prediction run must resolve to a frozen Phase 3 `match_id`. | 100% PASS (0 unlinked) |
| **G2** | **Trace-to-Run Linkage** | Every emitted agent trace must resolve to an emitted `run_id`. | 100% PASS (0 orphan traces) |
| **G3** | **Run-to-Trace Cardinality** | Each run must possess between 1 and 5 canonical traces. | 100% PASS |
| **G4** | **Strict Agent Role Normalization** | Role must belong strictly to `[PHYSICAL, STATISTICAL, HISTORICAL, MARKET, CHIEF]`. | 100% PASS (0 invalid roles) |
| **G5** | **Predicted Winner Resolution** | `predictedwinnerid` must resolve to an active canonical player UUID in Phase 1. | 100% PASS |
| **G6** | **Symmetric Side Validation** | Validation helper `_predicted_winner_side` must match participant side 1 or 2. | 100% PASS |
| **G7** | **Prompts & Raw Responses Non-Empty**| System prompt, user prompt, and raw response strings must be populated. | 100% PASS |
| **G8** | **No Thought Loss (Recoverability)** | 100% of available reasoning is captured in `raw_thinking_content`; rate tracked. | 100% Preserved |
| **G9** | **Cutoff Barrier & Lookahead Check** | `cutoff_timestamp_utc` must come from authentic capture time; no lookahead fabrication. | 100% Validated |
| **G10** | **JSON Structural Parseability** | Feature snapshot, routing config, parsed output, and key factors must parse cleanly. | 100% Valid JSON |
| **G11** | **Published Prediction Lineage** | Every published prediction tagged as `LINKED_TO_RUN` or `LEGACY_UNLINKED`. | 100% Classified |
| **G12** | **Comprehensive Quarantine** | All ambiguous, unlinked, or corrupt records emitted to `phase-6-ai-conflicts.jsonl`. | 100% Logged |
| **G13** | **Zero SQLite Mutation** | File size delta on all SQLite source files must be exactly 0 bytes. | 0 Bytes Changed |
| **G14** | **Fail-Closed Execution** | Halts immediately with exit code 1 if invoked without `--dry-run`. | Enforced |
