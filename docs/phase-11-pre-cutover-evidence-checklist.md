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

| Item ID | Verification Domain | Required Artifact / Proof | Validation Method | Responsible Role | Status |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **EVID-01** | **Live Render SQLite Volume Snapshot** | Physical backup artifact: `render_prod_backup_<timestamp>.sqlite` | Online backup via `VACUUM INTO` or disk volume clone during low-traffic window | Operations Lead | `PENDING_MAINTENANCE_WINDOW` |
| **EVID-02** | **Cryptographic Hash Proof** | SHA-256 digest (64-char hex) & exact file size in bytes | `sha256sum render_prod_backup_*.sqlite` logged and immutable | Security Auditor | `PENDING_BACKUP` |
| **EVID-03** | **SQLite Structural Integrity Proof** | Integrity output artifact: `integrity_check.log` | `PRAGMA integrity_check;` returning exactly `ok` with 0 corruption lines | Database Admin | `PENDING_BACKUP` |
| **EVID-04** | **Foreign Key Constraint Proof** | Foreign key audit log: `foreign_key_check.log` | `PRAGMA foreign_key_check;` returning exactly 0 violation rows | Database Admin | `PENDING_BACKUP` |
| **EVID-05** | **Production Table Row-Count Manifest** | Comprehensive table row-count report | Automated count query across all production tables | Data Engineer | `PENDING_BACKUP` |
| **EVID-06** | **Sandbox Test Restore Verification** | Test restore audit report: `sandbox_restore_report.json` | Restore snapshot to isolated SQLite container; execute smoke queries and dummy mutation | QA / Lead Engineer | `PENDING_BACKUP` |
| **EVID-07** | **Live State vs Baseline Conflict Audit** | Reconciliation report: `render_live_conflict_report.json` | Forensic diff comparing live Render state against developer baseline manifest | Migration Architect| `PENDING_DIFF` |
| **EVID-08** | **Catch-Up Ingestion Verification** | Staging PostgreSQL delta ingestion receipt | Ingest live delta into staging PostgreSQL cluster; verify foreign key constraints | Data Engineer | `PENDING_STAGING` |
| **EVID-09** | **Dual-Write Outbox Drain Proof** | Outbox watermark log: `outbox_drain_receipt.json` | Verify `postgres_dual_write_outbox` has 0 `PENDING`, 0 `PROCESSING`, 0 `FAILED`, and 0 `DLQ` items | Systems Engineer | `PENDING_DRAIN` |
| **EVID-10** | **Render Runtime Disarm SLA Benchmark** | Empirical latency histogram: `disarm_benchmark_render.json` | 10,000 iterations of in-memory switch executed on Render container runtime | Performance Lead | `PENDING_BENCHMARK` |
| **EVID-11** | **Human-in-the-Loop Approval Record** | Signed Evidence Bundle: `render_live_evidence_bundle.json` | Cryptographic signature / explicit sign-off on reconciliation delta by project lead | Authorizing Lead | `NOT_GRANTED` |

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
