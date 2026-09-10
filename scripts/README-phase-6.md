# Phase 6: AI Prediction Runs & Agent Traces Dry-Run Runner

This directory contains the deterministic, read-only offline dry-run runner for Phase 6 of the tennis data migration pipeline.

---

## 1. Overview & Objectives

`dry-run-phase-6-ai-traces.cjs` extracts, normalizes, and validates multi-agent AI prediction runs and granular specialist traces for ingestion into PostgreSQL target schemas:
- **`ai.predictionruns`** (Top-level prediction runs with frozen feature snapshot and `predictedwinnerid`)
- **`ai.agenttraces`** (Constituent 5-specialist agent execution traces with full prompts, tokens, and lossless `raw_thinking_content`)
- **`predictions.publishedpredictions`** (Serving layer maintaining explicit lineage to `run_id` or flagged as `LEGACY_UNLINKED`)

---

## 2. Safety Invariants

- **Read-Only SQLite:** Source databases (`database.sqlite`, `tennis_gold.sqlite`) are opened with `{ readonly: true, fileMustExist: true }`. File byte sizes are verified before and after execution (0 bytes changed).
- **No PostgreSQL Connection:** Operates 100% offline without live database connections.
- **No Network Calls:** Zero network or external API requests.
- **Fail-Closed Execution:** Requires explicit `--dry-run` CLI argument. Without this flag, execution halts immediately with exit code 1.
- **Codebase Immutability:** No changes to application or server code.

---

## 3. Invocation Commands

### Standard Dry-Run Execution
```bash
node scripts/dry-run-phase-6-ai-traces.cjs --dry-run
```

### Verification of Fail-Closed Behavior
```bash
node scripts/dry-run-phase-6-ai-traces.cjs
# Expected output:
# [FATAL] Phase 6 dry-run requires explicit --dry-run flag.
# Usage: node scripts/dry-run-phase-6-ai-traces.cjs --dry-run
# Process exit code: 1
```

---

## 4. Generated Artifacts

Outputs are saved in `scratch/phase-6-dry-run-output/`:

| Artifact | Format | Description |
| :--- | :--- | :--- |
| `phase-6-prediction-runs.jsonl` | JSONL | Validated prediction runs mapping to `ai.predictionruns`. |
| `phase-6-agent-traces.jsonl` | JSONL | Specialist execution traces mapping to `ai.agenttraces`. |
| `phase-6-published-predictions.jsonl` | JSONL | Serving table rows mapping to `predictions.publishedpredictions`. |
| `phase-6-ai-conflicts.jsonl` | JSONL | Quarantined records with diagnostic error codes. |
| `phase-6-validation-report.json` | JSON | Machine-readable validation gate assessment results. |
| `phase-6-validation-report.md` | Markdown | Comprehensive audit report summarizing all 14 quality gates. |

---

## 5. 14 Invariant Quality Gates Verified

1. **G1 (Parent Match Resolution):** Every emitted run resolves to a valid Phase 3 `match_id`.
2. **G2 (Trace-to-Run Linkage):** Every emitted trace resolves to an emitted `run_id`.
3. **G3 (Run-to-Trace Cardinality):** Exactly 5 canonical traces per run (cardinality 5, 0 orphan traces).
4. **G4 (Strict Agent Role Normalization):** Roles strictly normalized to `PHYSICAL`, `STATISTICAL`, `HISTORICAL`, `MARKET`, `CHIEF`.
5. **G5 (Predicted Winner Resolution):** Canonical `predictedwinnerid` verified in Phase 1 player registry.
6. **G6 (Symmetric Participant Side Validation):** `_predicted_winner_side` strictly resolves to side 1 or side 2.
7. **G7 (Prompts & Raw Responses Non-Empty):** System prompt, user prompt, and raw completion text are non-empty.
8. **G8 (No Thought Loss):** Full reasoning preserved in `raw_thinking_content`; 40.00% historical recoverability reported.
9. **G9 (Cutoff Barrier & Lookahead Validation):** True capture timestamp utilized; no fabrication from match start.
10. **G10 (JSON Structural Parseability):** Feature snapshot, routing config, parsed output, and key factors are valid JSON.
11. **G11 (Published Prediction Lineage):** Explicitly categorized as `LINKED_TO_RUN` or `LEGACY_UNLINKED`.
12. **G12 (Comprehensive Quarantine):** All unlinked or invalid records logged with deterministic reason codes.
13. **G13 (Zero SQLite Mutation):** 0 byte delta on source SQLite databases.
14. **G14 (Fail-Closed Execution):** Mandatory `--dry-run` flag enforced.
