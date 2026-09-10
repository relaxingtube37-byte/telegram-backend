# Phase 7A: Match Editorials & DTO Parity Dry-Run Runner

This directory contains the deterministic, read-only offline dry-run runner for Phase 7A of the tennis data migration pipeline.

---

## 1. Overview & Objectives

`dry-run-phase-7a-editorials.cjs` extracts, normalizes, and validates match editorial preview packages from the backend SQLite `match_editorials` table for ingestion into PostgreSQL **`predictions.matcheditorials`**, with explicit DTO parity verification for public consumer-facing endpoints.

Key tasks:
- Validate match fixture linkage against frozen Phase 3 matches (`matches.matches(match_id)`).
- Normalize legacy stringified JSON fields into structured PostgreSQL `JSONB` targets.
- Guarantee 100% backward-compatibility for public editorial response payloads (`GET /api/web/editorials/:idOrSlug`).
- Enforce strict fail-closed execution and byte-level database immutability.

---

## 2. Safety Invariants

- **Read-Only SQLite:** SQLite database files are opened with `{ readonly: true, fileMustExist: true }`. File byte sizes are verified before and after execution (0 bytes delta required).
- **No PostgreSQL Connection:** Operates 100% offline without live database connections.
- **No Network Calls:** Zero network or external API requests.
- **Fail-Closed Execution:** Requires explicit `--dry-run` CLI argument. Without this flag, execution halts immediately with exit code 1.
- **Codebase Immutability:** Zero modifications to `src/`, `server/`, or runtime code.

---

## 3. Invocation Commands

### Standard Dry-Run Execution
```bash
node scripts/dry-run-phase-7a-editorials.cjs --dry-run
```

### Verification of Fail-Closed Behavior
```bash
node scripts/dry-run-phase-7a-editorials.cjs
# Expected output:
# [FATAL] Phase 7A dry-run requires explicit --dry-run flag.
# Usage: node scripts/dry-run-phase-7a-editorials.cjs --dry-run
# Process exit code: 1
```

---

## 4. Generated Artifacts

Outputs are saved in `scratch/phase-7a-dry-run-output/`:

| Artifact | Format | Description |
| :--- | :--- | :--- |
| `phase-7a-editorials.jsonl` | JSONL | Validated editorial records mapping to `predictions.matcheditorials`. |
| `phase-7a-editorial-conflicts.jsonl` | JSONL | Quarantined records with diagnostic error codes. |
| `phase-7a-validation-report.json` | JSON | Machine-readable validation gate assessment results. |
| `phase-7a-validation-report.md` | Markdown | Comprehensive audit report summarizing all 12 quality gates and DTO parity notes. |

---

## 5. 12 Invariant Quality Gates Verified

1. **G1 (Fixture ID & Slug Preservation):** Emitted editorials preserve `fixture_id` and `slug` exactly.
2. **G2 (Target Schema Conformance):** Emitted records conform completely to `predictions.matcheditorials` DDL.
3. **G3 (JSON Structural Parseability):** All legacy JSON strings parse cleanly into structured JSONB arrays/objects.
4. **G4 (Unresolved Match Linkage Quarantine):** Unresolved or synthetic fixtures isolated in quarantine.
5. **G5 (Slug Uniqueness Invariant):** 0 slug collisions detected.
6. **G6 (Fixture ID Uniqueness Invariant):** 0 fixture ID collisions detected.
7. **G7 (Publish Status Semantics):** Canonical status values (`draft`, `published`, etc.) preserved.
8. **G8 (Editorial Copy Preservation):** 100% of analytical text and headlines preserved without rewriting.
9. **G9 (Public Response DTO Parity):** Parity verified against `GET /api/web/editorials/:idOrSlug` contracts.
10. **G10 (Zero SQLite Mutation):** 0 byte delta on source SQLite databases.
11. **G11 (Zero PostgreSQL & Network):** 100% offline standalone dry-run execution.
12. **G12 (Fail-Closed Execution):** Mandatory `--dry-run` flag enforced.
