# Phase 6: AI Traces & Published Predictions Source Inventory
**Target Schemas:** `ai.predictionruns`, `ai.agenttraces`, `predictions.publishedpredictions`  
**Execution Mode:** Offline Read-Only Ingestion Inventory  
**Status:** COMPLETE & VERIFIED  

---

## 1. Primary Source Registries & Telemetry Artifacts

Phase 6 examines, categorizes, and audits three primary sources containing multi-agent prediction runs, raw model execution traces, and historical published predictions:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                PRIMARY AI & TRACE SOURCES                              │
├──────────────────────────────┬───────────────────────────────┬─────────────────────────┤
│ 1. Desktop Trace Bundles     │ 2. Desktop IndexedDB Export   │ 3. Backend SQLite DB    │
│    (backtest_traces_audit)   │    (predictionDiagnostics)    │    (predictions table)  │
│    • 10 multi-agent runs     │    • Full schema interface    │    • 9 legacy rows      │
│    • 50 agent trace entries  │    • Thinking & Prompt keys   │    • Telegram broadcast │
│    • Lossless prompt/tokens  │    • Diagnostics analytics    │    • Dev/mock fixtures  │
└──────────────────────────────┴───────────────────────────────┴─────────────────────────┘
```

---

## 2. Detailed Source Catalog

### Source 1: Desktop Audit Trace Bundle (`backtest_traces_audit.json`)
- **File System Location:** `G:/state football/data/backtest_traces_audit.json` (and twin export `new_backtest_audit.json`)
- **File Size:** ~1,037 KB (13,442 lines of formatted JSON)
- **Role in Pipeline:** Authoritative primary source for multi-agent prediction runs and agent execution traces.
- **Top-Level Structure:**
  - `formatVersion`: `"1.0"`
  - `exportedAt`: ISO 8601 export timestamp (`2026-09-03T15:37:38.623Z`)
  - `totalPredictions`: 10
  - `totalTraces`: 10
  - `predictions`: Array of 10 `TrackedPrediction` objects (published view)
  - `traces`: Array of 10 `AgentTrace` objects (deep execution telemetry)
- **Trace Level Structure (`AgentTrace`):**
  - `traceId`: String UUID matching prediction identifier (e.g. `"pred_16948855"`)
  - `capturedAt`: Exact ISO 8601 timestamp of analysis execution (`2026-09-03T15:36:37.042Z`)
  - `totalDurationMs`: Aggregate execution wall-clock time (e.g. 3,129 ms)
  - `modelUsed`, `provider`, `temperature`: Top-level routing metadata
  - `dataSnapshot`: Complete 67-indicator input feature snapshot (ranking, H2H, surface stats, environmental deltas, CPI, weather, and quality flags)
  - `finalGatedDecision`: Normalized synthesis output containing `predictedWinner`, `winProbability`, `confidence`, `bestBet`, `qualityGatePassed`, `qualityGateVerdict`
  - `agents`: Array of 5 `AgentTraceEntry` objects per run
- **Agent Entry Structure (`AgentTraceEntry`):**
  - `agentName`: e.g. `"Physical Agent"`, `"Statistical Agent"`, `"Historical Agent"`, `"Market Agent"`, `"Chief Analyst"`
  - `agentRole`: Specialist designation (e.g. `"Sports Physiologist"`, `"Tennis Probability Analyst"`, `"Chief Tennis Strategist"`)
  - `promptSnapshot`: Strict object containing full `{ systemPrompt, userPrompt }` strings
  - `modelUsed`, `provider`: Specific model mapped to agent (e.g. `gpt-oss-120b`, `deepseek-reasoner`, `cerebras`)
  - `latency_ms` / `durationMs`: API call latency (typically 500 – 2,500 ms)
  - `prompt_tokens` / `cacheMissTokens`: Cache miss / prompt token count
  - `raw_thinking_content` / `reasoning`: Raw extended reasoning tokens from reasoning models (up to ~2,000 characters per agent)
  - `raw_response_content` / `rawOutput`: Raw unparsed completion response text
  - `parsed_output` / `parsedOutput`: Structured JSON output conforming to specialist schema

### Source 2: Desktop IndexedDB Schema Specification (`predictionDiagnostics.ts`)
- **File System Location:** `G:/state football/src/predictionDiagnostics.ts` & `G:/state football/src/types.ts`
- **Database Name:** `prediction_traces_v1`
- **Object Store:** `agent_traces` (keyPath: `traceId`)
- **Indices:**
  - `capturedAt` (for chronological pagination)
  - `matchId` (pointing to `dataSnapshot.matchId`)
- **Purpose & Role:** Governs the live browser-side persistence of agent traces generated during interactive UI analysis. The JSON schema exported by `backtest_traces_audit.json` strictly conforms to the TypeScript interfaces defined in this file.

### Source 3: Backend SQLite Legacy Predictions Table (`database.sqlite`)
- **File System Location:** `g:/telegram-backend/data/database.sqlite` (table `predictions`)
- **Record Count:** 9 rows
- **Schema Columns:**
  - `id`: Integer primary key (1, 2, 3, 4, 5, 7, 8, 9, 10)
  - `fixture_id`: Integer external fixture identifier (e.g. 999001, 999002, 98765432, null)
  - `match_date`, `home_name`, `away_name`: Match headline info
  - `predicted_winner`: Raw player name string
  - `win_probability`: Integer percentage (e.g. 65, 70)
  - `confidence`: Confidence tier (`HIGH`, `MEDIUM`, `LOW`)
  - `predicted_score`, `best_bet_market`, `best_bet_selection`, `best_bet_ev`, `best_bet_rationale`
  - `key_factors`: JSON string array of analytical bullet points
  - `ai_summary`: Editorial summary text
  - `status`: Lifecycle status (`UPCOMING`, `SETTLED`)
  - `result_score`, `published_at`, `created_at`, `updated_at`
- **Audit Finding:** All 9 records represent developmental mock and placeholder fixtures created during initial Telegram bot prototyping (e.g. fixture IDs `999001`, `999002`, `98765432`, `88776655`, and test player names). Because none correspond to genuine singles matches in the Phase 3 canonical match corpus, all 9 records are quarantined under `LEGACY_UNLINKED_ORPHAN`.

---

## 3. Source Quality & Ingestion Tiers

| Source Name | Storage Engine | Record Count | Fidelity Level | Ingestion Fate |
| :--- | :--- | :---: | :---: | :--- |
| **Audit Trace Runs** | JSON Bundle (`backtest_traces_audit.json`) | 10 runs | Maximum (Complete prompt snapshots, reasoning tokens, full feature vectors) | 6 runs accepted into `ai.predictionruns`; 4 runs quarantined (3 unlinked fixture, 1 doubles). |
| **Audit Agent Traces** | JSON Bundle (`backtest_traces_audit.json`) | 50 entries | Maximum (Full `systemPrompt`, `userPrompt`, `raw_thinking_content`, parsed output) | 30 traces accepted into `ai.agenttraces` (5 per accepted run); 20 traces quarantined with parent runs. |
| **Audit Published Predictions** | JSON Bundle (`backtest_traces_audit.json`) | 10 records | High (Derived directly from gated decision with verified `run_id` lineage) | 6 published predictions accepted into `predictions.publishedpredictions` (`LINKED_TO_RUN`). |
| **Backend SQLite Predictions** | SQLite Table (`predictions`) | 9 records | Low (Summary-only, no prompts, no reasoning, developmental fixture IDs) | 0 accepted into serving table; 9 isolated in quarantine as `LEGACY_UNLINKED_ORPHAN`. |

---

## 4. Quarantine Classification Catalog

| Diagnostic Reason Code | Observed Count | Description & Architectural Action |
| :--- | :---: | :--- |
| `UNRESOLVED_PHASE3_MATCH` | **3** | The vendor fixture ID in the trace (`16948853`, `16939124`, `16960465`) could not be mapped to any canonical match in Phase 3. Quarantined to preserve parent match integrity. |
| `UNRESOLVED_PREDICTED_WINNER` | **1** | The predicted winner string (`"Tararudee L. | Kalieva E."`) denotes a doubles pairing rather than a singles player. Quarantined to prevent singles entity pollution. |
| `LEGACY_UNLINKED_ORPHAN` | **9** | Backend SQLite prediction rows with synthetic or mock fixture IDs (`999001`, `998811`, `88001122`, etc.) lacking parent fixtures in Phase 3. Quarantined. |
