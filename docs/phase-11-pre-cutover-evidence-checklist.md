# Phase 11 Pre-Cutover Evidence Checklist & Verification Protocol

> **Specification Reference:** [phase-11-canary-cutover-spec.md](file:///g:/telegram-backend/docs/phase-11-canary-cutover-spec.md)  
> **Governance Status:** `DRAFTED_FOR_REVIEW`  
> **Pre-Cutover Authorization Status:** `NOT_GRANTED`  
> **Target Environment:** Staging Preparation & Staging Validation Only  
> **Production Status:** `SQLITE_ONLY` (Strictly Enforced)  
> **Authoritative Date:** `2026-09-11`

---

## 1. Overview & Purpose

This checklist specifies the mandatory evidence artifacts, cryptographic proofs, and integrity validations that must be compiled and formally approved **before** any pre-cutover authorization or canary traffic routing can be considered for Phase 11.

Under architectural requirement **RISK-1**, the live production Render SQLite database (`data/database.sqlite`) represents an active state delta (user signups, referral conversions, session tokens, live match settlement records) that does not exist in developer environments or the frozen desktop Gold database (`tennis_gold.sqlite`).

---

## 2. Evidence Collection Checklist (Pre-Cutover Battery)

> [!IMPORTANT]
> **QUAD-BINDING CERTIFICATION RULE:**  
> An evidence item is deemed strictly **UNVERIFIED / REJECTED** unless it satisfies all four binding parameters simultaneously:  
> 1. **Immutable File Artifact:** Persisted on disk under a deterministic, versioned filepath.  
> 2. **Cryptographic SHA-256 Digest:** 64-character hexadecimal checksum computed immediately upon creation.  
> 3. **UTC Timestamp:** ISO 8601 millisecond-precision timestamp (`YYYY-MM-DDTHH:mm:ss.sssZ`).  
> 4. **Named Verifying Role:** Named responsible engineer, DBA, or auditor who certified the artifact.

| Item ID | Verification Domain | Required Immutable Artifact | SHA-256 Hash Requirement | UTC Timestamp Spec | Responsible Sign-Off Role | Pre-Cutover Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **EVID-01** | **Live Render SQLite Volume Snapshot** | `/mnt/persistent-disk/backups/render_prod_backup_<timestamp>.sqlite` | 64-char hex of raw `.sqlite` file | Creation timestamp (UTC) | Operations Lead | `PENDING_MAINTENANCE_WINDOW` |
| **EVID-02** | **Cryptographic Hash Proof** | `render_prod_backup_<timestamp>.sha256` | Self-contained SHA-256 manifest | Hash calculation timestamp (UTC) | Security Auditor | `PENDING_BACKUP` |
| **EVID-03** | **SQLite Structural Integrity Proof** | `integrity_check_<timestamp>.log` | Hash of output containing `ok` | Query execution timestamp (UTC) | Database Administrator | `PENDING_BACKUP` |
| **EVID-04** | **Foreign Key Constraint Proof** | `foreign_key_check_<timestamp>.log` | Hash of 0-byte (empty) log | Query execution timestamp (UTC) | Database Administrator | `PENDING_BACKUP` |
| **EVID-05** | **Production Table Row-Count Manifest** | `row_counts_manifest_<timestamp>.json` | Hash of JSON with counts for 9 tables | Extraction timestamp (UTC) | Data Engineer | `PENDING_BACKUP` |
| **EVID-06** | **Sandbox Test Restore Verification** | `sandbox_restore_report_<timestamp>.json` | Hash of test restore execution log | Restore completion timestamp (UTC) | QA / Lead Engineer | `PENDING_BACKUP` |
| **EVID-07** | **Live State vs Baseline Conflict Audit** | `render_live_conflict_report_<timestamp>.json` | Hash of diff comparing live vs baseline | Audit completion timestamp (UTC) | Migration Architect | `PENDING_DIFF` |
| **EVID-08** | **Catch-Up Ingestion Verification** | `staging_pg_catchup_receipt_<timestamp>.json` | Hash of PostgreSQL staging insertion log | Staging commit timestamp (UTC) | Data Engineer | `PENDING_STAGING` |
| **EVID-09** | **Dual-Write Outbox Drain Proof** | `outbox_drain_receipt_<timestamp>.json` | Hash of receipt showing 0 pending/DLQ | Drain audit timestamp (UTC) | Systems Engineer | `PENDING_DRAIN` |
| **EVID-10** | **Render Runtime Disarm SLA Benchmark** | `disarm_benchmark_render_<timestamp>.json` | Hash of 10k iteration histogram | Benchmark completion timestamp (UTC) | Performance Lead | `PENDING_BENCHMARK` |
| **EVID-11** | **Human-in-the-Loop Signed Bundle** | `phase-11-render-evidence-bundle-<timestamp>.json` | Hash of complete JSON bundle | Human sign-off timestamp (UTC) | Authorizing Lead | `UNSIGNED` |

---

## 3. Detailed Verification Standards

### 3.1 EVID-01 to EVID-04: Backup & Cryptographic Proof Standard
The backup procedure must be completely non-destructive:
```sql
-- Executed inside Render production maintenance shell
VACUUM INTO '/mnt/persistent-disk/backups/render_prod_backup_YYYYMMDD_HHMMSS.sqlite';
```
Immediately upon completion:
```bash
sha256sum render_prod_backup_YYYYMMDD_HHMMSS.sqlite > render_prod_backup_YYYYMMDD_HHMMSS.sha256
sqlite3 render_prod_backup_YYYYMMDD_HHMMSS.sqlite "PRAGMA integrity_check;" > integrity_check.log
sqlite3 render_prod_backup_YYYYMMDD_HHMMSS.sqlite "PRAGMA foreign_key_check;" > foreign_key_check.log
```
*Acceptance Criteria:*
- `integrity_check.log` must contain single line: `ok`.
- `foreign_key_check.log` must be exactly 0 bytes (no dangling foreign keys).

### 3.2 EVID-05: Table Row-Count Baseline Audit
The row counts of the following tables must be recorded and matched against the local baseline manifest:
- **Identity & Auth:** `users`
- **Referral & Revenue:** `referral_sites`, `referral_clicks`, `partner_conversions`
- **AI Predictions & Content:** `predictions`, `settings`, `historical_matches`, `top_players_cache`
- **Replication Architecture:** `postgres_dual_write_outbox`

### 3.3 EVID-06 & EVID-07: Conflict Audit & Human Sign-Off
Under no circumstances may data be synced from developer environments to production. All new production entities (users who registered, referral clicks logged, real-time match predictions settled) must be treated as **authoritative live state** and migrated forward into PostgreSQL staging.

Any ID collision or schema variation between the live Render database and the local schema must produce a conflict report entry categorized as:
1. `NEW_LIVE_ENTITY` (admitted into staging PostgreSQL).
2. `STATUS_DIVERGENCE` (latest live status overrides local historical status).
3. `UNKNOWN_SCHEMA_DELTA` (halts cutover until schema migration script is approved).

---

## 4. Evidence Package Signing Standard

The complete bundle must be packaged into a single JSON envelope matching [`templates/render-live-evidence-bundle-template.json`](file:///g:/telegram-backend/docs/templates/render-live-evidence-bundle-template.json) and stored under:
```
docs/evidence/phase-11-render-evidence-bundle-<YYYYMMDD-HHMMSS>.json
```
No canary traffic or pre-cutover activity may be scheduled until this evidence bundle is fully compiled, verified, and signed off.
