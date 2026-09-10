# Phase 4: Tournament Editions & Competitions Dry-Run Runner

This directory contains the deterministic offline dry-run runner and validation suite for Phase 4 of the tennis data migration pipeline.

---

## 1. Overview & Objectives

`dry-run-phase-4-competition-editions.cjs` executes an automated, read-only aggregation, temporal bounding, surface override resolution, and integrity audit of upstream match evidence (seasons 2021–2026), preparing for ingestion into the canonical PostgreSQL schema (`competition.tournament_editions`).

Key Tasks:
- Resolve parent tournament identities against frozen Phase 3 registries (`identity.tournaments` and `identity.tournament_aliases`).
- Explicitly resolve the schema architecture:
  - `identity.tournaments` is the canonical master tournament directory.
  - `competition.tournament_editions` (unquoted `competition.tournamenteditions`) is the annual edition layer referencing `identity.tournaments(tournament_id)`.
- Aggregate match evidence from Tier 1 (`canonical_matches_v2`), Tier 2 (`historical_matches`), and Tier 3 (`canonical_matches` v1).
- Bounding tournament edition date ranges (`start_date` and `end_date`).
- Detect and resolve surface overrides (19 identified).
- Enrich venue speed ratings (CPI) from `prePopulatedVenues.ts`.
- Synthesize deterministic UUIDv5 primary keys (`edition_id`).
- Isolate preliminary qualification brackets, exhibition events, and unmapped sponsor strings to quarantine (`phase-4-competition-editions-conflicts.jsonl`).
- Verify **zero orphan editions** (`orphan_count == 0`).
- Guarantee byte-level and hash-level immutability of source SQLite databases (0 bytes delta).

---

## 2. Safety Invariants & Guardrails

- **Read-Only SQLite:** Source databases (`data/database.sqlite` and `tennis_gold.sqlite`) are opened strictly with `{ readonly: true, fileMustExist: true }`. File sizes and SHA-256 digests are verified before and after execution (0 bytes delta, 0 hash delta required).
- **No PostgreSQL Connection:** Operates 100% offline without live database connections or network sockets.
- **No Network Calls:** Zero network or external API requests.
- **Fail-Closed Execution:** Requires explicit `--dry-run` CLI flag. Invocation without this flag halts immediately with exit code 1.
- **Codebase Immutability:** Zero modifications to `src/`, `server/`, or runtime application code.
- **Cutover Prohibited:** Live production cutover is strictly **NO-GO** until Phase 10 live parity.

---

## 3. Invocation Commands

### Fail-Closed Behavior Verification
```bash
node scripts/dry-run-phase-4-competition-editions.cjs
# Expected output:
# [SECURITY VIOLATION] FAIL-CLOSED EXECUTION HALTED
# Missing mandatory flag: --dry-run
# Process exit code: 1
```

### Full Offline Dry-Run Execution
```bash
node scripts/dry-run-phase-4-competition-editions.cjs --dry-run
```

---

## 4. Generated Artifacts

Outputs are saved in `scratch/phase-4-competition-editions-output/`:

| Artifact | Format | Description |
| :--- | :--- | :--- |
| `competition_tournament_editions.jsonl` | JSONL | 3,466 canonical tournament edition records matching `competition.tournament_editions`. |
| `phase-4-competition-editions-conflicts.jsonl` | JSONL | 1,065 quarantined candidate groups (qualifications, exhibitions, unmapped sponsors). |
| `phase-4-competition-editions-orphans.jsonl` | JSONL | 0 orphan records (verifies 100% parent tournament resolution). |
| `phase-4-competition-editions-validation-report.json` | JSON | Machine-readable validation gate assessment results (10/10 PASS). |
| `phase-4-competition-editions-validation-report.md` | Markdown | Comprehensive audit report summarizing all 10 quality gates and edition metrics. |

---

## 5. 10 Quality Gates Verified

1. **G1 (Parent Tournament Resolution):** 100% of editions resolve to canonical `tournament_id` (0 orphans).
2. **G2 (Natural Key Uniqueness):** Exactly 3,466 unique `(tournament_id, year)` pairs (0 duplicates).
3. **G3 (Deterministic UUIDv5 Primary Keys):** 100% reproducible, collision-free UUIDv5.
4. **G4 (Calendar Year Scope):** All edition years within $[2021, 2026]$ (0 out-of-scope).
5. **G5 (Temporal Chronology Order):** 100% of editions have `start_date <= end_date`.
6. **G6 (Surface Enum Conformance):** 100% conformance to `competition.surface_type`.
7. **G7 (Draw Size Sanity & Zero-Fabrication):** Draw sizes within $[4, 128]$ or `NULL` (0 out-of-bounds, 0 zeros).
8. **G8 (Non-Collapsing Disambiguation):** 0 cross-tournament collapses.
9. **G9 (Comprehensive Conflict Emitting):** Exactly 1,065 unmapped candidates tracked in quarantine JSONL.
10. **G10 (Zero SQLite Mutation Guarantee):** Backend delta: 0 bytes, Gold delta: 0 bytes.

---

## 6. Strict Safety Declarations

> **Schema validated on local/staging PostgreSQL only; production runtime unchanged; SQLite untouched; cutover prohibited until Phase 10 parity.**
>
> این فاز contract parity را ثابت می‌کند، نه production read parity را. production parity طبق برنامه در Phase 10 و با canary comparator سنجیده می‌شود.
>
> قبولی 10/10 به معنی آمادگی برای ادامه‌ی فاز بعدی است، نه مجوز cutover. خود برنامه صریحاً NO-GO می‌دهد تا وقتی Phase 10 parity روی ترافیک واقعی تأیید نشده باشد.
