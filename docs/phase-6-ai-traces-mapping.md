# Phase 6: AI Traces & Published Predictions Mapping Specification
**Target Tables:** `ai.predictionruns`, `ai.agenttraces`, `predictions.publishedpredictions`  
**Pipeline Mode:** Deterministic Mapping Specification  
**Status:** DRAFT APPROVED & DRY-RUN VERIFIED  

---

## 1. Top-Level Entity: `ai.predictionruns`

The table `ai.predictionruns` captures every unique execution of the multi-agent AI prediction pipeline for a specific match fixture at a specific frozen point in time.

### Schema & Mapping Rules

| Target Column | Target Type | Source Field (`AgentTrace`) | Transformation & Invariant Rule |
| :--- | :--- | :--- | :--- |
| **`run_id`** | `UUID PRIMARY KEY` | `trace.traceId` | Deterministic UUIDv5: `uuidv5("run:" + trace.traceId, NAMESPACE_RUNS)`. |
| **`match_id`** | `UUID NOT NULL` | `dataSnapshot.matchId` | Resolved to frozen Phase 3 `matches.matches(match_id)` via vendor fixture mapping. Fails to quarantine if unresolvable. |
| **`cutoff_timestamp_utc`**| `TIMESTAMPTZ NOT NULL` | `trace.capturedAt` | Point-in-time boundary. Strictly derived from source execution timestamp; never fabricated from match start. |
| **`feature_schema_hash`** | `CHAR(64) NOT NULL` | `dataSnapshot` | Cryptographic SHA-256 hash: `sha256(JSON.stringify(dataSnapshot))` guaranteeing feature snapshot immutability. |
| **`feature_snapshot`** | `JSONB NOT NULL` | `trace.dataSnapshot` | Complete frozen input feature dictionary (rankings, ELO, H2H, surface stats, environmental deltas, data quality flags). |
| **`model_routing_config`**| `JSONB NOT NULL` | `modelUsed`, `provider`, `temperature` | Structured JSON: `{"modelUsed": "...", "provider": "...", "temperature": 0.2}`. |
| **`predictedwinnerid`** | `UUID NOT NULL` | `decision.predictedWinner` | Authoritative target DDL column: canonical player UUID FK referencing `identity.players(player_id)`. Resolved via Phase 1 registry. |
| **`win_probability_pct`** | `NUMERIC(5, 2) NOT NULL` | `decision.winProbability` | Gated win probability percentage (0.00 – 100.00). |
| **`confidence_tier`** | `VARCHAR(20) NOT NULL` | `decision.confidence` | Normalized to uppercase: `'HIGH'`, `'MEDIUM'`, `'LOW'`, `'MODERATE'`. |
| **`best_bet_market`** | `TEXT NULL` | `decision.bestBet.market` | Target wagering market (e.g. `'Total Games'`, `'Moneyline'`). |
| **`best_bet_selection`**| `TEXT NULL` | `decision.bestBet.selection` | Selected wager (e.g. `'Over 22.5 Games'`). |
| **`best_bet_ev_pct`** | `NUMERIC(5, 2) NULL` | `decision.bestBet.ev` | Model calculated expected value percentage. |
| **`quality_gate_passed`**| `BOOLEAN NOT NULL` | `decision.qualityGatePassed` | Output of the prediction quality gate (defaults to `TRUE` if passed). |
| **`quality_gate_verdict`**| `TEXT NULL` | `decision.qualityGateVerdict` | Forensic verdict summary (e.g. `'APPROVED'`, `'REJECTED'`). |
| **`total_latency_ms`** | `INTEGER NOT NULL` | `trace.totalDurationMs` | Total wall-clock duration of the pipeline in milliseconds. |
| **`total_prompt_tokens`**| `INTEGER NULL` | Sum of agent prompt tokens | Aggregated token usage across all 5 specialist agents. |
| **`total_completion_tokens`**| `INTEGER NULL` | Sum of agent completion tokens | Aggregated completion tokens across all 5 agents. |
| **`estimated_cost_usd`** | `NUMERIC(8, 5) NULL` | Model cost calculator | Estimated inference cost based on provider rate cards. |
| **`created_at`** | `TIMESTAMPTZ NOT NULL` | `trace.capturedAt` | Authentic observation creation timestamp. |

### Validation & Lineage Helper Fields (Dry-Run JSONL Only)
- **`_predicted_winner_side` (`1 | 2`):** Symmetrical side derived by comparing `predictedwinnerid` against `match.player1_id` (side 1) and `match.player2_id` (side 2). *Strictly maintained as a helper field for post-match audit, not claimed as an authoritative DDL column.*
- **`_source_trace_id`:** Original string trace identifier (e.g. `"pred_16948855"`).
- **`_is_backtest_safe` (`BOOLEAN`):** `TRUE` if `cutoff_timestamp_utc <= reference_match_start_utc`; `FALSE` if retrospective execution.
- **`_reference_match_start_utc`:** Frozen scheduled start time from Phase 3 match.

---

## 2. Granular Specialist Traces: `ai.agenttraces`

The table `ai.agenttraces` stores the granular execution telemetry of each specialized agent invoked during a prediction run.

### Schema & Mapping Rules

| Target Column | Target Type | Source Field (`AgentTraceEntry`) | Transformation & Invariant Rule |
| :--- | :--- | :--- | :--- |
| **`trace_id`** | `UUID PRIMARY KEY` | Derived | Deterministic UUIDv5: `uuidv5("trace:" + runId + ":" + canonicalRole, NAMESPACE_TRACES)`. |
| **`run_id`** | `UUID NOT NULL` | Parent Run ID | Foreign key referencing `ai.predictionruns(run_id)`. |
| **`agent_role`** | `ai.agent_role_type` | `agent.agentName` / `agent.agentRole` | Strictly normalized into canonical 5-role enum: `PHYSICAL`, `STATISTICAL`, `HISTORICAL`, `MARKET`, `CHIEF`. |
| **`agent_index`** | `SMALLINT NOT NULL` | Pipeline execution order | 1 (`PHYSICAL`), 2 (`STATISTICAL`), 3 (`HISTORICAL`), 4 (`MARKET`), 5 (`CHIEF`). |
| **`provider`** | `VARCHAR(30) NOT NULL` | `agent.provider` / `trace.provider` | Provider name (e.g. `'deepseek'`, `'openai'`, `'cerebras'`, `'groq'`). |
| **`model_identifier`** | `VARCHAR(100) NOT NULL` | `agent.modelUsed` / `trace.modelUsed`| Concrete model identifier (e.g. `'deepseek-reasoner'`, `'gpt-oss-120b'`). |
| **`temperature`** | `NUMERIC(3, 2) NOT NULL` | `trace.temperature` | Sampling temperature parameter (default `0.20` or `0.70`). |
| **`prompt_tokens`** | `INTEGER NULL` | `agent.cacheMissTokens` | Input prompt tokens supplied to the model. |
| **`completion_tokens`** | `INTEGER NULL` | Completion token count | Output tokens generated by the model. |
| **`latency_ms`** | `INTEGER NOT NULL` | `agent.durationMs` | Wall-clock execution time of this specific agent API call. |
| **`system_prompt`** | `TEXT NOT NULL` | `agent.promptSnapshot.systemPrompt` | Complete, unmodified system instructions provided to the agent. |
| **`user_prompt`** | `TEXT NOT NULL` | `agent.promptSnapshot.userPrompt` | Complete, unmodified contextual user prompt provided to the agent. |
| **`raw_thinking_content`**| `TEXT NULL` | `agent.reasoning` | **Lossless reasoning tokens** from thinking models (DeepSeek-R1, o3-mini). Never truncated. |
| **`raw_response_content`**| `TEXT NOT NULL` | `agent.rawOutput` | Unparsed completion text returned by the model. |
| **`parsed_output`** | `JSONB NOT NULL` | `agent.parsedOutput` | Validated structured JSON extracted from completion. |
| **`error_message`** | `TEXT NULL` | `agent.errorMessage` | Exception message if status was `'error'`; `NULL` on success. |
| **`created_at`** | `TIMESTAMPTZ NOT NULL` | `trace.capturedAt` | Execution timestamp. |

### Agent Role Normalization Dictionary

```javascript
const ROLE_MAP = {
  'physical agent': 'PHYSICAL',
  'sports physiologist': 'PHYSICAL',
  'statistical agent': 'STATISTICAL',
  'tennis probability analyst': 'STATISTICAL',
  'historical agent': 'HISTORICAL',
  'tennis historian & tactician': 'HISTORICAL',
  'market agent': 'MARKET',
  'betting market intelligence': 'MARKET',
  'chief analyst': 'CHIEF',
  'chief tennis strategist': 'CHIEF'
};
```

---

## 3. Serving Layer: `predictions.publishedpredictions`

The table `predictions.publishedpredictions` serves the presentation layer for the Telegram bot, WebApp, and external subscribers, while maintaining explicit lineage to `ai.predictionruns`.

### Schema & Mapping Rules

| Target Column | Target Type | Source Field | Invariant & Lineage Rule |
| :--- | :--- | :--- | :--- |
| **`prediction_id`** | `BIGSERIAL PRIMARY KEY` | Autoincrement / Index | Monotonically increasing identifier. |
| **`match_id`** | `UUID NOT NULL` | `match.match_id` | Foreign key referencing Phase 3 canonical match. |
| **`run_id`** | `UUID NULL` | `runRecord.run_id` | Foreign key referencing `ai.predictionruns(run_id)`. Populated for trace-derived predictions; `NULL` for legacy. |
| **`fixture_id`** | `INTEGER NOT NULL UNIQUE` | Vendor fixture ID | Maintained for backward compatibility with frontend routing. |
| **`home_player_id`** | `UUID NOT NULL` | `match.player1_id` | Symmetrical participant 1 UUID from Phase 3 match. |
| **`away_player_id`** | `UUID NOT NULL` | `match.player2_id` | Symmetrical participant 2 UUID from Phase 3 match. |
| **`predicted_winner_id`**| `UUID NOT NULL` | `winnerPlayerId` | Authoritative canonical player UUID of predicted victor. |
| **`win_probability`** | `SMALLINT NOT NULL` | Win probability | Integer percentage between 1 and 99. |
| **`confidence`** | `VARCHAR(20) NOT NULL` | Confidence string | `'HIGH'`, `'MODERATE'`, `'MEDIUM'`, `'LOW'`. |
| **`predicted_score`** | `TEXT NULL` | Predicted set score | e.g. `'2:0'`, `'2:1'`. |
| **`best_bet_market`** | `TEXT NULL` | Market name | e.g. `'Total Games'`, `'Total Sets'`, `'Moneyline'`. |
| **`best_bet_selection`**| `TEXT NULL` | Selection text | e.g. `'Over 22.5 Games'`, `'Under 2.5 Sets'`. |
| **`best_bet_ev`** | `NUMERIC(5, 2) NULL` | EV percentage | Calculated expected value if positive edge detected. |
| **`best_bet_rationale`**| `TEXT NULL` | Synthesis rationale | Explanatory synthesis note. |
| **`key_factors`** | `JSONB NOT NULL` | Array of key drivers | Valid JSON array of analytical bullet points. |
| **`ai_summary`** | `TEXT NULL` | Editorial summary | High-level synthesis summary. |
| **`status`** | `VARCHAR(20) NOT NULL` | Lifecycle state | Defaults to `'UPCOMING'`. |
| **`published_at`** | `TIMESTAMPTZ NOT NULL` | `date` / `published_at` | True observation or publication timestamp. |
| **`_lineage_status`** | `VARCHAR(30)` | Helper Flag | `'LINKED_TO_RUN'` (trace-backed) vs `'LEGACY_UNLINKED'` (SQLite legacy). |

---

## 4. Conflict Quarantine Schema: `phase-6-ai-conflicts.jsonl`

Records that fail any foundational invariant are emitted to `phase-6-ai-conflicts.jsonl` with deterministic metadata:

```json
{
  "source_table": "backtest_traces_audit.json",
  "source_id": "pred_16948853",
  "reason": "UNRESOLVED_PHASE3_MATCH",
  "diagnostic_details": "Vendor fixture ID 16948853 cannot be resolved to any frozen Phase 3 canonical match.",
  "quarantined_at_utc": "2026-09-10T19:46:03.636Z"
}
```
