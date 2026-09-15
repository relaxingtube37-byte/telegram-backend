# Phase 2 Ingestion Pipeline: Tournament Editions Tooling

**Branch:** `staging/phase-1-ingestion-spec`
**Execution Environment:** OFFLINE / READ-ONLY SQLITE
**Target PostgreSQL Entity:** `competition.tournament_editions` (in `postgresSchemaV1.sql`)
**Parent Dependency:** Frozen Phase 1 `identity.tournaments` registry (`commit 19660b1`)

---

## 1. Overview & Purpose

The `scripts/dry-run-phase-2-editions.cjs` script provides an offline, read-only extraction and validation pipeline for populating annual tournament editions (`competition.tournament_editions`) across the 2021 through 2026 professional tennis seasons.

### Core Objectives:
1. **Deterministic Parent Resolution:** Maps match fixtures across 2021–2026 back to the frozen Phase 1 `identity.tournaments` UUID registry.
2. **Boundary Date Aggregation:** Derives authentic `start_date` (`min(match_date)`) and `end_date` (`max(match_date)`) per edition.
3. **Surface Override Detection:** Identifies tournaments that switched surfaces in specific seasons (e.g. Charleston 125 played on Clay vs Hard default).
4. **Draw Size & Zero-Fabrication:** Extracts verified draw sizes in the range `[4, 128]` while preserving authentic `NULL` when unproven (sanitizing legacy `0` values).
5. **Conflict & Quarantine Isolation:** Routes preliminary qualifying events, exhibitions, and unmapped sponsor strings into `phase-2-editions-conflicts.jsonl`.
6. **Deterministic UUIDv5 Primary Keys:** Generates reproducible `edition_id` identifiers via RFC 4122 UUIDv5.

---

## 2. Safety Invariants & Guardrails

| Invariant | Implementation Mechanism |
| :--- | :--- |
| **Fail-Closed Execution** | Halts immediately with exit code `1` if `--dry-run` is omitted. |
| **Read-Only SQLite Connections** | All database connections are opened with `{ readonly: true, fileMustExist: true }`. |
| **Zero Database Writes** | The script never executes `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `VACUUM`, or PRAGMA writes. |
| **Zero Remote Connections** | No network socket or connection to any PostgreSQL instance. |
| **Integrity Audit** | Verifies SQLite database file byte sizes before and after execution (Gate G10). |

---

## 3. Usage & CLI Commands

### Standard Dry-Run Execution:
```bash
node scripts/dry-run-phase-2-editions.cjs --dry-run
```

### Fail-Closed Demonstration:
```bash
# Omitting --dry-run will halt immediately:
node scripts/dry-run-phase-2-editions.cjs
# Exit Code: 1
# [SECURITY VIOLATION] FAIL-CLOSED EXECUTION HALTED
```

### Custom Output Directory (Optional):
```bash
node scripts/dry-run-phase-2-editions.cjs --dry-run --out-dir scratch/custom-output
```

---

## 4. Invariant Quality Gates (G1 - G10)

* **G1: Parent Tournament Resolution:** 100% of non-quarantined editions must resolve to a valid Phase 1 tournament UUID.
* **G2: Edition Identity Uniqueness:** Ensures 100% unique `(tournament_id, year)` pairs.
* **G3: Deterministic UUIDv5 Keys:** Verified reproducible `edition_id` UUIDs.
* **G4: Calendar Year Scope:** All editions must fall strictly within `2021..2026`.
* **G5: Temporal Chronology Order:** All editions must satisfy `start_date <= end_date`.
* **G6: Surface Enum Validity:** All surfaces must match `'Hard'`, `'Clay'`, `'Grass'`, `'Carpet'`, or `'Unknown'`.
* **G7: Draw Size Sanity:** Draw size must be `NULL` or an integer within `[4, 128]` (never `<= 0`).
* **G8: Non-Collapsing Disambiguation:** Guarantees no two distinct tournaments are silently collapsed into one edition.
* **G9: Comprehensive Conflict Emitting:** 100% of unresolved/quarantined candidates are recorded with diagnostic reasons.
* **G10: Zero SQLite Mutation Guarantee:** Confirms source SQLite database byte sizes remain bit-for-bit identical before and after the run.

---

## 5. Output Artifacts Specification

The dry-run pipeline generates four artifacts in `scratch/phase-2-dry-run-output/`:

1. `phase-2-editions.jsonl`: Clean target records ready for PostgreSQL `competition.tournament_editions`.
2. `phase-2-editions-conflicts.jsonl`: Quarantined candidate records with diagnostic tags (`QUALIFICATION_DRAWS`, `EXHIBITION_EVENTS`, `UNMAPPED_SPONSOR_STRING`).
3. `phase-2-editions-validation-report.json`: Machine-readable audit summary of gate checks, edition counts, and year distributions.
4. `phase-2-editions-validation-report.md`: Human-readable markdown audit summary.

---

## 6. Schema Review & Uniqueness Notes

* **Uniqueness Invariant:** The pipeline enforces strictly one canonical edition per `(tournament_id, year)` pair. Preliminary qualifications, exhibitions, and unmapped tokens are segregated into conflicts and never collapsed into main-draw editions.
* **Schema Review Observation on `postgresSchemaV1.sql`:** The DDL currently sets `start_date DATE NOT NULL, end_date DATE NOT NULL`. While 100% of historical played editions (2021–2026) have verified dates from match fixtures, future provisional calendar editions before tournament scheduling will require relaxing these columns to `NULLABLE` to avoid dummy date fabrication.

