# Phase 1: PostgreSQL Canonical Schema v1 & Compatibility Views Specification

This directory contains the documentation, validation runner, and operational guidelines for the PostgreSQL Canonical Schema v1 and backward-compatibility views layer.

---

## 1. Overview & Objectives

The Phase 1 database definition establishes the foundational, enterprise-grade relational structure for the tennis analytics and predictions pipeline. It transitions the data architecture from fragmented SQLite files and loose JSON schemas into an authoritative, normalized, 11-schema PostgreSQL 16 data warehouse.

Key Deliverables:
- **Canonical DDL (`db/postgres-schema-v1.sql`):** 11 schemas, 28 canonical tables, 11 custom domain enums, 37 foreign keys, 69 check constraints, and 46 specialized indexes.
- **Compatibility Views (`db/postgres-compatibility-views-v1.sql`):** 5 canonical operational read projections (`public.canonicalmatchesoperational`, `public.playermatchesvalidated`, `public.goldmatchesreadyview`, `predictions.published_predictions_view`, `predictions.match_editorials_view`) plus 4 legacy camelCase aliases ensuring zero breaking changes for existing consumers.
- **Specification Documentation:** Complete architectural reference in `docs/postgres-schema-v1-spec.md` and `docs/postgres-compatibility-views-spec.md`.
- **Validation Suite (`scripts/validate-postgres-schema-v1.cjs`):** Automated AST and structural validator verifying all 9 invariant acceptance gates.

---

## 2. Safety Invariants & Guardrails

- **Local/Staging PostgreSQL Only:** DDL execution and inspection are strictly restricted to local or staging PostgreSQL 16 instances (e.g., Docker container `docker run -d --name tennis-pg16 -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16`).
- **Zero Runtime Application Impact:** No changes to `DATABASE_ENGINE` or application connection strings. Zero modifications to `src/`, `server/`, or runtime application logic.
- **Zero SQLite Mutation:** Production SQLite databases (`data/database.sqlite` and `tennis_gold.sqlite`) are strictly untouched (verified 0 bytes delta before and after script runs).
- **No Dual-Write & No Early Cutover:** Cutover is strictly **NO-GO** until Phase 10 live traffic parity validation with canary comparator.

---

## 3. Invocation Commands

### Running the Offline Schema Validator
```bash
node scripts/validate-postgres-schema-v1.cjs
```

### Applying DDL to Local/Staging PostgreSQL 16
To provision a local clean container and apply the schemas:

```bash
# 1. Start clean PostgreSQL 16 instance in Docker
docker run --name postgres-v1-staging -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16

# 2. Execute Phase 1 Canonical DDL
psql -h localhost -p 5432 -U postgres -d postgres -f db/postgres-schema-v1.sql

# 3. Execute Compatibility Views Layer
psql -h localhost -p 5432 -U postgres -d postgres -f db/postgres-compatibility-views-v1.sql

# 4. Idempotency Check (re-running must succeed with 0 errors)
psql -h localhost -p 5432 -U postgres -d postgres -f db/postgres-schema-v1.sql
psql -h localhost -p 5432 -U postgres -d postgres -f db/postgres-compatibility-views-v1.sql
```

---

## 4. Generated Artifacts

Validation results and schema metrics are written to `scratch/postgres-schema-v1-output/`:

| Artifact | Format | Description |
| :--- | :--- | :--- |
| `postgres-schema-v1-validation-report.json` | JSON | Machine-readable validation gate assessment results (9/9 PASS). |
| `postgres-schema-v1-validation-report.md` | Markdown | Comprehensive audit report summarizing all 9 quality gates and table inventories. |

---

## 5. Acceptance Quality Gates Verified (9/9 PASS)

1. **G1 (11 Schemas Verified):** `raw`, `identity`, `competition`, `matches`, `statistics`, `markets`, `ai`, `predictions`, `provenance`, `backtest`, `app`.
2. **G2 (28 Canonical Tables Verified):** All 28 target entities declared with primary keys and normalized columns.
3. **G3 (Foreign Key Target Validity):** 37 foreign keys verified targeting existing canonical tables and valid composite keys.
4. **G4 (Domain Check Constraints):** 69 check constraints enforcing valid enum subsets, non-negative scores, probabilities between 0 and 1, and UTC timestamp sanity.
5. **G5 (Indexes & Lookups Verified):** 46 specialized indexes declared covering multi-column lookups, tournament edition dates, participant queries, and temporal ordering.
6. **G6 (Idempotent Execution Safe):** DDL uses `CREATE SCHEMA IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DO $$ BEGIN ... EXCEPTION ... END $$` for enums, and `CREATE OR REPLACE VIEW`.
7. **G7 (Zero SQLite Mutation):** 0 bytes delta verified on both `data/database.sqlite` and `G:/state football/data/tennis_gold.sqlite`.
8. **G8 (Zero Runtime Codebase Modification):** `src/` and `server/` code remain 100% untouched.
9. **G9 (Compatibility Views Derived from Canonical Model):** All 5 core operational views derive directly from canonical tables with projection alias support.
