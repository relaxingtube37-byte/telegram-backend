# Phase 1 Ingestion Pipeline: Identity Registries Tooling

**Branch:** `staging/phase-1-ingestion-spec`
**Execution Environment:** OFFLINE / READ-ONLY SQLITE
**Target PostgreSQL DDL:** `G:/telegram-backend/postgresSchemaV1.sql`

---

## 1. Overview & Purpose

The `scripts/dry-run-phase-1-identities.cjs` script provides an offline, zero-risk, read-only extraction and validation pipeline for migrating legacy SQLite player and tournament registries into the target PostgreSQL 16 schema.

### Core Objectives:
1. **Authoritative Identity Extraction:** Reads `canonical_players` (1,765 rows) and `canonical_tournaments` (1,183 rows) from `data/database.sqlite`.
2. **Biometric & Profile Enrichment:** Enriches canonical players with `height_cm`, `weight_kg`, `birth_date`, `hand`, and `turned_pro_year` from `tennis_gold.sqlite: gold_player_profiles` (12,309 rows).
3. **Deterministic UUIDv5 Primary Keys:** Assigns reproducible, namespace-isolated UUIDv5 identifiers.
4. **Collision & Duplicate Deduplication:** Resolves 28 player alias duplicate groups and 2 tournament alias duplicate groups according to strict deterministic rules.
5. **Zero Mutation & Zero Fabrication:** Guarantees no writes to SQLite databases, no connections to PostgreSQL, and preserves authentic `NULL` values.

---

## 2. Safety Invariants & Guardrails

| Invariant | Implementation Mechanism |
| :--- | :--- |
| **Fail-Closed Execution** | Script halts immediately with exit code `1` if `--dry-run` is not explicitly passed. |
| **Read-Only SQLite Connections** | All database connections are opened exclusively with `{ readonly: true, fileMustExist: true }`. |
| **Zero Database Writes** | The script never calls `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `VACUUM`, or PRAGMA write commands. |
| **Zero Remote Connections** | No network socket or connection to any hosted or production PostgreSQL instance. |
| **Integrity Audit** | Captures database byte sizes before and after execution to guarantee zero on-disk file alterations (Gate G10). |

---

## 3. Usage & CLI Commands

### Standard Dry-Run Execution:
```bash
node scripts/dry-run-phase-1-identities.cjs --dry-run
```

### Fail-Closed Behavior Demonstration:
```bash
# Omitting --dry-run will immediately fail closed:
node scripts/dry-run-phase-1-identities.cjs
# Exit Code: 1
# [SECURITY VIOLATION] FAIL-CLOSED EXECUTION HALTED
```

### Custom Output Directory (Optional):
```bash
node scripts/dry-run-phase-1-identities.cjs --dry-run --out-dir scratch/custom-output
```

---

## 4. Invariant Quality Gates (G1 - G10)

Every dry-run execution validates 10 automated quality gates before reporting success:

* **G1: Player Primary Key Uniqueness:** All generated `player_id` UUIDs must be 100% unique.
* **G2: Player Slug Uniqueness:** URL slugs derived from player names must be 100% unique (satisfies `uq_identity_players_slug`).
* **G3: Player Gender Enum Validity:** All player genders must strictly match `'M'`, `'F'`, or `'MIXED'`.
* **G4: Player Biometric Sanity:** Height must be within [140, 230] cm and weight within [40, 140] kg, or stored as `NULL`.
* **G5: Tournament Surface Enum Validity:** All surfaces must strictly match `'Hard'`, `'Clay'`, `'Grass'`, `'Carpet'`, or `'Unknown'`.
* **G6: Tournament Natural Key Uniqueness:** Every tournament must be unique across `(name_standard, tour)`.
* **G7: Player Alias Foreign Key Integrity:** 100% of player aliases must resolve to an existing `player_id` (0 orphans).
* **G8: Tournament Alias Foreign Key Integrity:** 100% of tournament aliases must resolve to an existing `tournament_id` (0 orphans).
* **G9: Alias Token Uniqueness:** Guarantees 0 duplicate tokens per `(source_name, normalized_token)` in target tables.
* **G10: Zero SQLite Mutation Guarantee:** Confirms source SQLite database byte sizes remain bit-for-bit identical before and after the run.

---

## 5. Output Artifacts Specification

The script generates six artifacts in `scratch/phase-1-dry-run-output/`:

1. `identity_players.jsonl`: 1,765 records matching `identity.players` target schema.
2. `identity_player_aliases.jsonl`: 2,833 deduplicated records matching `identity.player_aliases` schema (28 duplicate groups collapsed from 2,861 raw SQLite rows).
3. `identity_tournaments.jsonl`: 1,183 records matching `identity.tournaments` target schema.
4. `identity_tournament_aliases.jsonl`: 1,376 deduplicated records matching `identity.tournament_aliases` schema (2 duplicate groups collapsed from 1,378 raw SQLite rows).
5. `phase-1-dry-run-validation-report.json`: Comprehensive machine-readable execution audit, country normalization audit, and gate verification payload.
6. `phase-1-dry-run-validation-report.md`: Human-readable markdown audit report for review.

> **Reconciliation Note:** Target `identity.player_aliases` expects strictly 2,833 records, not 2,861. The 28 duplicate groups (56 rows) are collapsed to enforce `uq_identity_player_aliases_source_token`. All downstream verification must validate against 2,833 records.
