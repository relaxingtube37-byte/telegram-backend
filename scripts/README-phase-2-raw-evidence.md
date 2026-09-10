# Phase 2: Raw Evidence Ingestion & Cryptographic Audit Runner

This directory contains the deterministic offline dry-run runner and cryptographic audit suite for Phase 2 of the tennis data migration pipeline.

---

## 1. Overview & Objectives

`dry-run-phase-2-raw-evidence.cjs` executes an automated, read-only extraction and integrity audit of upstream raw evidence layers, preparing for ingestion into the canonical PostgreSQL `raw.source_evidence` table.

Key Tasks:
- Audit all **13,000** baseline evidence records from SQLite `raw_source_evidence` (8,100 `sackmann` and 4,900 `pbp`).
- Verify **100% SHA-256 cryptographic match** between recorded hashes and real-time calculated digests (0 discrepancies permitted).
- Validate JSON syntax across 100% of payloads.
- Audit **RapidAPI bulk match bundles** (`data/bulk-match-bundles/events`) for presence, non-emptiness, and valid JSON structure.
- Route incomplete or corrupt bundle directories to a structured quarantine dataset.
- Generate deterministic, collision-free UUIDv5 identifiers for every evidence record.
- Guarantee byte-level immutability of source SQLite databases (0 bytes delta).

---

## 2. Safety Invariants & Guardrails

- **Read-Only SQLite:** SQLite database files (`data/database.sqlite` and `tennis_gold.sqlite`) are opened strictly with `{ readonly: true, fileMustExist: true }`. File sizes are verified before and after execution (0 bytes delta required).
- **No PostgreSQL Connection:** Operates 100% offline without live database connections or network sockets.
- **No Network Calls:** Zero network or external API requests.
- **Fail-Closed Execution:** Requires explicit `--dry-run` CLI flag. Invocation without this flag halts immediately with exit code 1.
- **Codebase Immutability:** Zero modifications to `src/`, `server/`, or runtime application code.
- **Cutover Prohibited:** Live production cutover is strictly **NO-GO** until Phase 10 live parity.

---

## 3. Invocation Commands

### Standard Dry-Run Execution (Sample Mode: 2,000 Bundles)
```bash
node scripts/dry-run-phase-2-raw-evidence.cjs --dry-run
```

### Full Bundle Audit (Complete Traversal: 58,131 Bundles)
```bash
node scripts/dry-run-phase-2-raw-evidence.cjs --dry-run --audit-all-bundles
```

### Verification of Fail-Closed Behavior
```bash
node scripts/dry-run-phase-2-raw-evidence.cjs
# Expected output:
# [FATAL] Phase 2 raw evidence dry-run requires explicit --dry-run flag.
# Usage: node scripts/dry-run-phase-2-raw-evidence.cjs --dry-run
# Process exit code: 1
```

---

## 4. Generated Artifacts

Outputs are saved in `scratch/phase-2-raw-evidence-output/`:

| Artifact | Format | Description |
| :--- | :--- | :--- |
| `phase-2-raw-evidence-validation-report.json` | JSON | Machine-readable validation gate assessment results (10/10 PASS). |
| `phase-2-raw-evidence-validation-report.md` | Markdown | Comprehensive audit report summarizing all 10 quality gates and evidence metrics. |
| `phase-2-raw-evidence-records.jsonl` | JSONL | Sample mapped canonical evidence records conforming to `raw.source_evidence`. |
| `phase-2-raw-evidence-quarantine.jsonl` | JSONL | Quarantined bundle directories with categorized failure reasons. |

---

## 5. 10 Quality Gates Verified

1. **G1 (100% Hash Integrity):** Exactly 13,000 / 13,000 SHA-256 matches (0 discrepancies).
2. **G2 (100% JSON Validity):** Exactly 13,000 / 13,000 valid JSON payloads (0 syntax errors).
3. **G3 (Record Count Parity):** Exactly 13,000 rows (8,100 sackmann + 4,900 pbp).
4. **G4 (Target Schema Compatibility):** Conforms to `raw.source_evidence` DDL in `db/postgres-schema-v1.sql`.
5. **G5 (Deterministic UUIDv5 Generation):** 13,000 unique UUIDs synthesized without collisions.
6. **G6 (RapidAPI Bulk Bundles Full Audit):** 58,131 directories audited; 50,018 complete (86.04%), 8,113 quarantined.
7. **G7 (Quarantine Routing Isolation):** Incomplete/empty/corrupt bundles cleanly isolated with audit metadata.
8. **G8 (Zero SQLite Mutation):** 0 bytes delta on `database.sqlite` and `tennis_gold.sqlite`.
9. **G9 (Zero PostgreSQL Writes):** 100% offline standalone dry-run.
10. **G10 (Fail-Closed CLI Invariant):** Mandatory `--dry-run` flag enforced.

---

## 6. Ingestion Readiness Assessment

- **SQLite raw evidence audit:** PASS (13,000 / 13,000 matches, 0 discrepancies, 0 errors)
- **SHA-256 parity:** PASS (13,000 / 13,000 matches)
- **JSON validity for 13,000 rows:** PASS (0 syntax errors)
- **Bulk bundle discovery:** PASS (58,131 directories discovered)
- **Full bulk bundle audit:** PASS (with categorized quarantine: 50,018 complete, 8,113 quarantined)
- **Audit Manifest SHA-256:** `a83588ce7d20b743720e9910e53edab4415671691d9e8bd148c8699176371112`
- **Total payload volume:** 3,285,097,830 bytes (3.059 GB)
- **Quarantine pipeline:** PASS (8,113 isolated in `phase-2-raw-evidence-quarantine.jsonl`)
- **PostgreSQL ingestion:** NO-GO (Strictly prohibited until Phase 10 parity)
- **Production cutover:** NO-GO (Strictly prohibited until Phase 10 parity)

