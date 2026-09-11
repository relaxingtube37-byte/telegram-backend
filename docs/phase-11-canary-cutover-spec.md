# Phase 11: Controlled Production Cutover & Dual-Run Canary Architecture Specification
## Design Review & Pre-Cutover Authorization Framework

> **Document Type:** Architecture Design Review & Pre-Cutover Authorization Framework  
> **Status:** `DRAFT_DESIGN_REVIEW` — **NO PRODUCTION AUTHORIZATION**  
> **Preceding Certifications:** 
> - [Phase 9 Staging Dual-Write (14/14 PASS)](file:///g:/telegram-backend/docs/phase-9-staging-dual-write-verification-report.md)
> - [Phase 10 Staging Shadow-Read Parity (7/7 PASS)](file:///g:/telegram-backend/docs/phase-10-staging-shadow-read-verification-report.md)
> - [Phase 10 Staging Parity Hardening & Mismatch Classification (8/8 PASS)](file:///g:/telegram-backend/docs/phase-10-staging-parity-hardening-report.md)  
> **Target Branch:** `staging/phase-1-ingestion-spec`  
> **Authoritative Date:** `2026-09-11`

---

## 1. Executive Summary & Governance Scope

This specification establishes the comprehensive design, safety criteria, kill-switch mechanisms, and pre-cutover verification procedures for **Phase 11: Controlled Production Cutover**.

> [!CAUTION]
> **STRICT GOVERNANCE BOUNDARY:**  
> Approval of this document authorizes **ONLY** the architectural design review and the creation of the pre-cutover testing harness on staging.  
> **It explicitly DOES NOT authorize:**
> 1. Routing live production traffic to PostgreSQL.
> 2. Connecting to production PostgreSQL from client-facing services.
> 3. Setting `DATABASE_ENGINE=postgres` in the live environment.
> 4. Overwriting or synchronizing live Render SQLite storage without human-certified dry-run conflict reports.
> 5. Deprecating, archiving, deleting, or switching SQLite to read-only mode in production.

### Governing Authorization State Matrix
```json
{
  "phase_8_audit_closure": "ACCEPTED",
  "phase_9_design_review": "IMPLEMENTED_AND_VERIFIED",
  "phase_9_staging_dual_write": "ACCEPTED",
  "phase_10_shadow_reads": "STAGING_CERTIFIED",
  "phase_10_hardening": "STAGING_CERTIFIED_HARDENED",
  "phase_11_design_review": "AUTHORIZED_TO_DRAFT",
  "phase_11_production_canary": "PROHIBITED_PENDING_APPROVAL",
  "production_reads": "SQLITE_ONLY",
  "production_shadow_reads": "PROHIBITED",
  "production_cutover": "PROHIBITED",
  "sqlite_retirement": "PROHIBITED"
}
```

---

## 2. Goals and Explicit Non-Goals

### 2.1 Goals
1. **Zero-Downtime Transition Framework:** Define an immutable, observable, and reversible methodology for transitioning customer read queries from SQLite to PostgreSQL.
2. **Deterministic Dual-Tier Rollback:** Guarantee instantaneous programmatic rollback (<10ms soft rollback via memory flag) and runbook-governed hard rollback with 0% data loss.
3. **Live Render State Protection (RISK-1 Resolution):** Establish cryptographic backup, forensic schema diffing, and conflict reconciliation for live Render SQLite storage before any production cutover activity.
4. **Graduated Canary Routing Protocol:** Detail route-by-route and tenant-isolated canary percentages with automated circuit breakers and strict budget enforcement.
5. **Full Observability & Metric Gates:** Specify P95/P99 latency thresholds, connection pool limits, and error budgets required for every stage of canary progression.

### 2.2 Non-Goals
1. **No Production Execution in this Phase:** No code or environment variables in the live production cluster (Render) will be modified during the review of this specification.
2. **No Immediate SQLite Retirement:** SQLite retirement belongs strictly to Phase 12, following a sustained, defect-free soak period of 100% production dual-run operation.
3. **No Blind Data Overwrite:** Under no circumstances will local SQLite or staging PostgreSQL states be blindly synced or restored onto live Render production storage.

---

## 3. Entry Prerequisites Checklist (Pre-Cutover Gates)

Before requesting authorization to initiate even a 1% canary rollout in production, the following mandatory entry gates must be satisfied and documented:

| Gate Code | Prerequisite Description | Verification Method | Acceptance Threshold |
| :--- | :--- | :--- | :--- |
| **P11-PRE-1** | **Authoritative Render Live Backup** | Physical vacuum/dump of live Render SQLite volume | Valid SQLite file, SHA-256 registered, test restore successful |
| **P11-PRE-2** | **Render State Forensic Audit** | Diffing live Render tables against local baseline manifest | Full audit of `users`, `referrals`, `predictions`, `settings` |
| **P11-PRE-3** | **Catch-Up Ingestion Verification** | Delta ingestion of live Render records into PostgreSQL | Zero unmigrated rows; Foreign key integrity verified |
| **P11-PRE-4** | **PostgreSQL Production Provisioning** | Dedicated production PostgreSQL cluster sizing & pool config | Min 20 max 100 connections, SSL enforced, WAL enabled |
| **P11-PRE-5** | **Outbox Synchronization Catch-Up** | `postgres_dual_write_outbox` watermark verification | 0 pending, 0 failed, 0 DLQ events in outbox |
| **P11-PRE-6** | **In-Memory Kill Switch Readiness** | Standalone benchmark of in-memory disarm mechanism | Evaluated in $< 1.0\text{ ms}$; 0 DB round-trip dependency |
| **P11-PRE-7** | **SQLite Standby Read-Path Readiness** | Fallback validation under artificial PostgreSQL termination | 100% of read requests succeed seamlessly via SQLite |

---

## 4. Live Render Production State Safety (RISK-1 Remediation)

The production backend runs on Render persistent disk storage (`data/database.sqlite`). Over time, real users, bot interactions, affiliate clicks, and live match settlements generate state not present in local developer machines or the Desktop Gold database.

```
┌────────────────────────────────────────────────────────────────────────┐
│               RISK-1 REMEDIATION WORKFLOW (MANDATORY)                  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
       ┌───────────────────────────────────────────────────────────┐
       │ 1. Render Read-Only Maintenance Window / Snapshot Trigger │
       └────────────────────────────┬──────────────────────────────┘
                                    │
                                    ▼
       ┌───────────────────────────────────────────────────────────┐
       │ 2. Cryptographic Volume Backup:                           │
       │    render_prod_backup_YYYYMMDD_HHMMSS.sqlite              │
       │    Calculate SHA-256 digest & byte length                 │
       └────────────────────────────┬──────────────────────────────┘
                                    │
                                    ▼
       ┌───────────────────────────────────────────────────────────┐
       │ 3. Automated Test Restore to Staging Environment          │
       │    Run integrity_check, foreign_key_check                 │
       └────────────────────────────┬──────────────────────────────┘
                                    │
                                    ▼
       ┌───────────────────────────────────────────────────────────┐
       │ 4. State Reconciliation & Conflict Report:                │
       │    - New Telegram Users (users table)                     │
       │    - Referral Clicks & Postbacks (referral_* tables)      │
       │    - User Settings & Access Modes (settings table)        │
       │    - Live Prediction Settlement States (predictions table)│
       └────────────────────────────┬──────────────────────────────┘
                                    │
                                    ▼
       ┌───────────────────────────────────────────────────────────┐
       │ 5. Formal Human-in-the-Loop Sign-Off on Conflict Report   │
       └───────────────────────────────────────────────────────────┘
```

### Safety Rules for Render Data:
1. **Read-Only Dump Requirement:** Prior to cutover, a point-in-time backup of `data/database.sqlite` must be extracted using SQLite online backup API or `VACUUM INTO`.
2. **Integrity Validation:** The backup file must pass `PRAGMA integrity_check;` and `PRAGMA foreign_key_check;`.
3. **No Reverse Overwrite:** Local development files must never overwrite live Render user tables. Any state synchronization must flow strictly **from Live Render to PostgreSQL**.

---

## 5. Phased Canary Routing Strategy

Canary routing delegates a controlled percentage of public read requests to PostgreSQL while SQLite remains the real-time synchronization master and synchronous fallback.

### 5.1 Canary Progression Schedule

```
 Stage 0          Stage 1          Stage 2          Stage 3          Stage 4          Stage 5
┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐
│ 0% PG   │ ───► │ 1% PG   │ ───► │ 5% PG   │ ───► │ 25% PG  │ ───► │ 50% PG  │ ───► │ 100% PG │
│ 100% SQL│      │ 99% SQL │      │ 95% SQL │      │ 75% SQL │      │ 50% SQL │      │ SQLite  │
│ (Soak)  │      │ (24h)   │      │ (24h)   │      │ (48h)   │      │ (48h)   │      │ Standby │
└─────────┘      └─────────┘      └─────────┘      └─────────┘      └─────────┘      └─────────┘
```

1. **Stage 0: 0% Canary (Dry-Run / Production Shadow Soak):**
   - Routing: 100% SQLite primary; shadow reads active only on staging.
   - Purpose: Baseline latency profiling under actual production traffic load.
2. **Stage 1: 1% Canary (Low-Risk Read-Only Endpoints):**
   - Endpoints: Public feed and tournament catalog (`/api/predictions/feed`, `/api/web/tournaments/today`).
   - Duration: Minimum 24 hours.
   - Audience: Anonymous/unauthenticated read requests only.
3. **Stage 2: 5% Canary (Expanded Public Catalog):**
   - Endpoints: Player profiles and match listings (`/api/web/players`, `/api/web/matches`).
   - Duration: Minimum 24 hours.
4. **Stage 3: 25% Canary (Authenticated WebApp Endpoints):**
   - Endpoints: Redacted predictions and stats (`/api/webapp/predictions`, `/api/webapp/stats`).
   - Duration: Minimum 48 hours.
5. **Stage 4: 50% Canary (High-Concurrency Peak Events):**
   - Endpoints: All public and WebApp read routes.
   - Duration: Minimum 48 hours covering at least two active live tournament match windows.
6. **Stage 5: 100% Canary (SQLite Standby Mode):**
   - Routing: 100% PostgreSQL primary reads; SQLite retained in hot-standby with continuous dual-write outbox synchronization.
   - Duration: Minimum 14 days before Phase 12 (Retirement) can be considered.

### 5.2 Deterministic Routing Strategy (Non-Random Hash Ring)
Canary routing must **not** use naive `Math.random() < 0.05` to prevent session flickering (a user seeing differing data between page reloads). Routing must be deterministic based on:
```ts
const hashVal = crypto.createHash('md5').update(`${userRef || clientIp}:${endpoint}`).digest().readUInt16BE(0);
const routeToPg = (hashVal % 100) < canaryPercentage;
```
This guarantees consistent per-session and per-entity user experience while evenly distributing load.

---

## 6. Conservative Stop & Abort Criteria (Automatic Circuit Breakers)

The canary pipeline must immediately halt progression and execute an **Automated Soft Rollback** if any of the following breach conditions occur during a 5-minute rolling observation window:

| Operational Domain | Stop Condition / Breach Threshold | Metric Source | Action Triggered |
| :--- | :--- | :--- | :--- |
| **HTTP Errors** | Any unexpected 5xx status code or unhandled exception on PG path | HTTP middleware logs | Instant Soft Rollback |
| **Primary Latency Delta** | P95 latency exceeds baseline by $> 5.0\text{ ms}$ or P99 exceeds baseline by $> 25.0\text{ ms}$ | Performance histogram | Instant Soft Rollback |
| **Hard Latency Ceiling** | Any query execution time $> 50.0\text{ ms}$ | Adapter query timer | Instant Soft Rollback |
| **Response Parity Mismatch**| Any unexplained JSON response divergence on admitted records | Shadow comparator ledger | Abort progression & investigate |
| **Data Asymmetry** | Stale read detection or missing outbox event ($> 30\text{s}$ lag) | Watermark comparison | Halt progression |
| **Pool Saturation** | PostgreSQL connection pool utilization $> 75\%$ for $> 30\text{ seconds}$ | `pg_stat_activity` / Pool metric | Halt & throttle |
| **Memory Stability** | Node.js process heap growth $> 25\text{ MB}$ within 15 minutes | Process memory monitor | Halt & investigate |
| **Business Impact** | Telegram bot delivery drop, user auth failure, or settlement error | Application domain monitor | Instant Soft Rollback |

---

## 7. Two-Tier Rollback Architecture

```
                                  TRIGGER CONDITION
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  ▼                                               ▼
         [TRANSIENT ANOMALY]                             [CATASTROPHIC FAILURE]
         Latency spike / 5xx error                       Corrupted state / Data drift
                  │                                               │
                  ▼                                               ▼
       ┌─────────────────────┐                         ┌─────────────────────┐
       │   TIER 1 ROLLBACK   │                         │   TIER 2 ROLLBACK   │
       │   (SOFT ROLLBACK)   │                         │   (HARD ROLLBACK)   │
       └──────────┬──────────┘                         └──────────┬──────────┘
                  │                                               │
       • Memory flag toggled (<10ms)                   • Halt deployment
       • 100% traffic reverts to SQLite                • Restore validated backup
       • In-flight PG queries drained                  • Replay dual-write outbox
       • Zero data change required                     • Full forensic RCA
```

### 7.1 Tier 1: Soft Rollback (Programmatic In-Memory Disarm)
- **Target Execution Latency:** $< 10\text{ ms}$ (measured benchmark in Phase 10: **0.064 ms**).
- **Mechanism:** In-process atomic feature switch:
  ```ts
  CanaryRouter.disarm('LATENCY_SPIKE_EXCEEDED');
  ```
- **Operational Effect:**
  1. Immediately directs 100% of incoming read requests to `RepositoryFactory.getSqliteRepository()`.
  2. Bails out of all queued and in-flight PostgreSQL queries without blocking response delivery.
  3. No service restart or container deployment required.
  4. Outbox replication continues to safely buffer mutations in SQLite.

### 7.2 Tier 2: Hard Rollback (Comprehensive System Restoration)
- **Target Recovery Time:** $< 15\text{ minutes}$.
- **Runbook Procedures:**
  1. Set environment variable `CANARY_CUTOVER_DISABLED=true` and `DATABASE_ENGINE=sqlite` in Render dashboard.
  2. Restart web service to load known-good immutable baseline.
  3. Verify `tennis_gold.sqlite` and `database.sqlite` checksums.
  4. Perform forensic reconciliation of any outbox events delivered during the canary window.
  5. Convene root cause analysis (RCA) prior to any subsequent rescheduling.

---

## 8. Rollback Runbook (Step-by-Step Operator Procedures)

### Procedure 1: Triggering Emergency Soft Rollback via Admin API
```bash
# Emergency disarm authenticated with admin bearer token
curl -X POST "https://<render-service-url>/api/admin/canary/disarm" \
  -H "Authorization: Bearer <ADMIN_SECRET_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"reason": "EMERGENCY_OPERATOR_ABORT", "operator": "lead_engineer"}'
```
*Expected Response:*
```json
{
  "status": "SUCCESS",
  "disarmed": true,
  "disarmDurationMs": 0.082,
  "activeEngine": "SQLITE",
  "canaryPercentage": 0,
  "timestamp": "2026-09-11T18:30:00.000Z"
}
```

### Procedure 2: Verification of Standby Fallback Path
```bash
# Verify health check confirms SQLite canonical operation
curl -s "https://<render-service-url>/health" | jq .
# Expected output:
# { "status": "UP", "database": "sqlite", "canary_active": false }
```

---

## 9. Quality Acceptance Gates for Phase 11 (Final Authorization Battery)

When formal authorization to implement Phase 11 is requested, the implementation must pass the following 8 Quality Acceptance Gates:

| Gate ID | Quality Acceptance Gate Title | Evaluation Criteria | Target Metric |
| :--- | :--- | :--- | :--- |
| **P11-G1** | **Deterministic Canary Router** | Non-random session hash routing across 0/1/5/25/50/100% tiers | 100% deterministic session allocation |
| **P11-G2** | **Zero-Disruption Fallback** | Instant SQLite fallback during simulated PostgreSQL crash | 0 HTTP 500 errors; 0 dropped requests |
| **P11-G3** | **Production Baseline Profiling** | P95 and P99 latency measured across all public endpoints | P95 added latency $\le 1.0\text{ ms}$ |
| **P11-G4** | **Sub-Millisecond Disarm** | In-memory kill switch disarms canary routing instantly | Disarm latency $< 5.0\text{ ms}$ |
| **P11-G5** | **Live Render Backup Validation** | Render physical SQLite dump verified via SHA-256 and test restore | PRAGMA integrity_check = `ok` |
| **P11-G6** | **Outbox Catch-Up Zero-Lag** | Outbox delivery worker achieves zero undelivered events | Backlog = 0 events; Lag $< 5.0\text{s}$ |
| **P11-G7** | **Security & Audit Logging** | Canary routing decisions, disarms, and failovers audited | Audit records persisted with timestamp & reason |
| **P11-G8** | **Dry-Run Rollback Drill** | End-to-end execution of Tier 1 & Tier 2 rollback runbooks | Recovery completed without data corruption |

---

## 10. Status & Sign-Off Record

- **Current Specification Status:** `DRAFT_DESIGN_REVIEW`
- **Pre-Cutover Authorization Status:** `PENDING_HUMAN_REVIEW`
- **Production Status:** `SQLITE_ONLY` (Strictly Enforced)
- **Approved by User Directive:** `2026-09-11` (Decision 40)
