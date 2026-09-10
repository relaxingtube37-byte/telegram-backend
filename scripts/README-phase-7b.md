# Phase 7B: API Compatibility & Read Model Parity Dry-Run Runner

This directory contains the deterministic, read-only offline dry-run runner for Phase 7B of the tennis data migration pipeline.

---

## 1. Overview & Objectives

`dry-run-phase-7b-api-compatibility.cjs` performs an exhaustive, automated compatibility audit between existing SQLite-backed API responses and target PostgreSQL read models/views. It ensures that downstream applications (Telegram WebApp, Desktop engine, public web portal) experience zero breaking changes during cutover.

Key tasks:
- Perform field-by-field and type-by-type shape comparison across 5 contract-critical endpoints.
- Evaluate both **Verified Member (Unlocked)** and **Unverified Guest (Locked)** access tiers.
- Verify exact nullability, enum domains, derived-field synthesis, and sort ordering.
- Test fail-closed rejection on ambiguous fixtures and missing CLI flags.
- Guarantee byte-level immutability of source SQLite databases.

---

## 2. Safety Invariants

- **Read-Only SQLite:** SQLite database files (`data/database.sqlite` and `tennis_gold.sqlite`) are opened strictly with `{ readonly: true, fileMustExist: true }`. File byte sizes are verified before and after execution (0 bytes delta required).
- **No PostgreSQL Connection:** Operates 100% offline without live database connections or network sockets.
- **No Network Calls:** Zero network or external API requests.
- **Fail-Closed Execution:** Requires explicit `--dry-run` CLI argument. Without this flag, execution halts immediately with exit code 1.
- **Codebase Immutability:** Zero modifications to `src/`, `server/`, or runtime application code.

---

## 3. Invocation Commands

### Standard Dry-Run Execution
```bash
node scripts/dry-run-phase-7b-api-compatibility.cjs --dry-run
```

### Verification of Fail-Closed Behavior
```bash
node scripts/dry-run-phase-7b-api-compatibility.cjs
# Expected output:
# [FATAL] Phase 7B compatibility audit requires explicit --dry-run flag.
# Usage: node scripts/dry-run-phase-7b-api-compatibility.cjs --dry-run
# Process exit code: 1
```

---

## 4. Generated Artifacts

Outputs are saved in `scratch/phase-7b-dry-run-output/`:

| Artifact | Format | Description |
| :--- | :--- | :--- |
| `request-response-snapshots.json` | JSON | Complete request/response payload snapshots across verified and guest access modes. |
| `field-by-field-diff-report.json` | JSON | Comprehensive field, type, and presence comparison matrices across all 5 endpoints. |
| `nullability-audit-report.json` | JSON | Audit of 14 nullable fields verifying exact null vs undefined semantics. |
| `enum-value-domain-audit.json` | JSON | Value domain comparison for `status`, `confidence`, `publish_status`, `access_mode`, etc. |
| `ordering-pagination-audit.json` | JSON | Deterministic ordering and default pagination limit comparison. |
| `phase-7b-validation-report.json` | JSON | Machine-readable validation gate assessment results (10/10 PASS). |
| `phase-7b-validation-report.md` | Markdown | Comprehensive audit report summarizing all 10 quality gates. |

---

## 5. 10 Invariant Quality Gates Verified

1. **G1 (100% Field-Name Parity):** Zero missing and zero extra keys across all 5 audited endpoints and access tiers.
2. **G2 (100% Type Parity):** All scalar, boolean, array, and object types match identically (0 type mismatches).
3. **G3 (100% Nullability Parity):** Exact semantics verified for all 14 nullable fields.
4. **G4 (Enum / Value-Domain Parity):** Discrete value sets map identically to canonical domains.
5. **G5 (Guest / Auth Gating Parity):** Redaction pipeline masks (`content_locked`, summary truncation, tactical stripping) produce identical guest views.
6. **G6 (Ordering & Pagination Parity):** Deterministic descending publication timestamp order verified.
7. **G7 (No Hidden Derived-Field Drift):** Derived fields (`title := headline`, player avatar URLs, parsed `key_stats`) preserved.
8. **G8 (Zero SQLite Mutation):** 0 bytes delta backend DB, 0 bytes delta gold DB.
9. **G9 (Zero PostgreSQL Writes):** 100% offline standalone execution.
10. **G10 (Fail-Closed Ambiguity & Invariant):** Mandatory `--dry-run` flag enforced; ambiguous or unresolved fixtures cleanly evaluate to 404/quarantine.
