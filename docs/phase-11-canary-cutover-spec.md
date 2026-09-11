# Phase 11: Controlled Production Cutover & Dual-Run Canary Architecture Specification
## Design Review & Pre-Cutover Authorization Framework

> **Document Type:** Architecture Design Review & Pre-Cutover Authorization Framework  
> **Status:** `DRAFTED_FOR_REVIEW` — **NO PRODUCTION CANARY AUTHORIZATION**  
> **Preceding Certifications:** 
> - [Phase 9 Staging Dual-Write (14/14 PASS)](file:///g:/telegram-backend/docs/phase-9-staging-dual-write-verification-report.md)
> - [Phase 10 Staging Shadow-Read Parity (7/7 PASS)](file:///g:/telegram-backend/docs/phase-10-staging-shadow-read-verification-report.md)
> - [Phase 10 Staging Parity Hardening & Mismatch Classification (8/8 PASS)](file:///g:/telegram-backend/docs/phase-10-staging-parity-hardening-report.md)  
> **Target Branch:** `staging/phase-1-ingestion-spec`  
> **Authoritative Date:** `2026-09-11`

---

## 1. Executive Summary & Governance Scope

This specification establishes the architectural design, safety boundaries, fault taxonomy, observability metrics, and pre-cutover verification procedures for **Phase 11: Controlled Production Cutover**.

> [!CAUTION]
> **STRICT GOVERNANCE BOUNDARY:**  
> This document represents a **Design Review and Pre-Cutover Authorization Framework ONLY**.  
> It **EXPLICITLY DOES NOT AUTHORIZE**:
> 1. Routing live production traffic to PostgreSQL.
> 2. Connecting to production PostgreSQL from client-facing services.
> 3. Setting `DATABASE_ENGINE=postgres` in the live environment.
> 4. Overwriting or synchronizing live Render SQLite storage without human-certified dry-run conflict reports.
> 5. Routing any write or mutation operations through PostgreSQL.
> 6. Deprecating, archiving, deleting, or retiring SQLite.

### Governing Authorization State Matrix
```json
{
  "phase_10_hardening": "STAGING_CERTIFIED_HARDENED",
  "phase_11_design_review": "DRAFTED_FOR_REVIEW",
  "phase_11_pre_cutover_authorization": "NOT_GRANTED",
  "phase_11_production_canary": "PROHIBITED",
  "production_reads": "SQLITE_ONLY",
  "production_shadow_reads": "PROHIBITED",
  "production_cutover": "PROHIBITED",
  "sqlite_retirement": "PROHIBITED"
}
```

---

## 2. Goals, Non-Goals & Core Architectural Principles

### 2.1 Goals
1. **Zero-Downtime Transition Framework:** Define an immutable, observable, and reversible methodology for transitioning customer read queries from SQLite to PostgreSQL.
2. **Deterministic Dual-Tier Rollback:** Guarantee programmatic soft rollback (<10ms target via in-memory atomic switch) and runbook-governed hard rollback with 0% data loss.
3. **Live Render State Protection (RISK-1 Resolution):** Establish an authoritative cryptographic backup, table-level audit, and conflict reconciliation evidence bundle for live Render SQLite storage before any production cutover activity.
4. **Graduated Canary Routing Protocol:** Detail route-by-route and tenant-isolated canary percentages with automated circuit breakers and strict budget enforcement.
5. **Decoupled Observability Metric Gates:** Disambiguate total HTTP response latency from database query execution time and connection pool acquisition delay.

### 2.2 Non-Goals
1. **No Production Execution in this Phase:** No code or environment variables in the live production cluster (Render) will be modified during this review.
2. **No PostgreSQL Write Path:** Write operations are strictly excluded from canary routing; writes remain 100% canonical SQLite.
3. **No Immediate SQLite Retirement:** Stage 5 (100% Canary Reads) keeps SQLite in synchronized hot-standby mode. Retirement belongs strictly to Phase 12 after a sustained soak period.
4. **No Blind Data Overwrite:** Local development files or staging states must never overwrite live Render storage.

### 2.3 Core Principle: Absolute Write-Path Isolation
Canary routing applies **exclusively to read operations**.
All mutations (`create`, `updateResult`, `publishPrediction`, settlement triggers, user registrations, referral tracking, and Telegram bot message logging) continue through the transactional SQLite engine and are replicated asynchronously via the durable `postgres_dual_write_outbox` table. Under no circumstances will write requests be routed directly to PostgreSQL during Phase 11.

---

## 3. Entry Prerequisites & Live Render Evidence Bundle (RISK-1 Remediation)

The live Render production environment operates on persistent disk storage (`data/database.sqlite`). Because real users, bot interactions, affiliate clicks, and live match settlements generate active state on Render, the live production state represents an **`UNKNOWN_DELTA`** relative to developer baselines until formally audited.

### 3.1 Mandatory Pre-Cutover Gates Checklist

| Gate Code | Prerequisite Description | Verification Method | Acceptance Threshold |
| :--- | :--- | :--- | :--- |
| **P11-PRE-1** | **Authoritative Render Live Backup** | Physical vacuum/dump of live Render SQLite volume | Complete evidence bundle registered; PRAGMA checks pass |
| **P11-PRE-2** | **Render State Forensic Audit** | Diffing live Render tables against local baseline manifest | Full audit of `users`, `referrals`, `predictions`, `settings` |
| **P11-PRE-3** | **Catch-Up Ingestion Verification** | Delta ingestion of live Render records into PostgreSQL | Zero unmigrated rows; Foreign key integrity verified |
| **P11-PRE-4** | **PostgreSQL Production Provisioning** | Dedicated production PostgreSQL cluster sizing & pool config | Min 20 max 100 connections, SSL enforced, WAL enabled |
| **P11-PRE-5** | **Outbox Synchronization Zero-Lag** | `postgres_dual_write_outbox` watermark verification | 0 pending, 0 failed, 0 DLQ events in outbox |
| **P11-PRE-6** | **Render Runtime Disarm Benchmark** | Empirical benchmark of in-memory disarm on Render container | Disarm execution time confirmed $< 10.0\text{ ms}$ on Render |
| **P11-PRE-7** | **SQLite Standby Read-Path Readiness** | Fallback validation under artificial PostgreSQL termination | 100% of read requests succeed seamlessly via SQLite |

### 3.2 Formal Render Live Evidence Bundle Specification
Prior to any pre-cutover authorization, an authoritative **Evidence Bundle** (`render_live_evidence_bundle_<timestamp>.json`) must be produced containing:
1. `artifact_path`: Exact file path of the physical SQLite volume dump.
2. `snapshot_timestamp_utc`: Exact ISO-8601 UTC timestamp of the snapshot.
3. `file_sha256`: 64-character SHA-256 cryptographic digest of the backup file.
4. `file_byte_size`: Exact byte length of the backup file.
5. `table_row_counts`: Exact row count for every production table:
   - `users`, `referral_sites`, `referral_clicks`, `partner_conversions`
   - `predictions`, `settings`, `historical_matches`, `top_players_cache`
   - `postgres_dual_write_outbox`
6. `pragmas_verified`:
   - `PRAGMA integrity_check;` returning exactly `ok`.
   - `PRAGMA foreign_key_check;` returning exactly zero violation rows.
7. `test_restore_status`: Clean execution of automated test restore in an isolated sandbox verifying both read querying and test transactional mutation.
8. `reconciliation_delta_manifest`: Explicit categorization of all live user/prediction delta rows, requiring human-in-the-loop sign-off before staging ingestion.

---

## 4. Phased Canary Routing Strategy

Canary routing delegates a controlled percentage of public read requests to PostgreSQL while SQLite remains the canonical master and synchronous fallback.

### 4.1 Canary Progression Schedule

```
 Stage 0          Stage 1          Stage 2          Stage 3          Stage 4          Stage 5
┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────────────┐
│ 0% PG   │ ───► │ 1% PG   │ ───► │ 5% PG   │ ───► │ 25% PG  │ ───► │ 50% PG  │ ───► │ 100% PG Primary │
│ 100% SQL│      │ 99% SQL │      │ 95% SQL │      │ 75% SQL │      │ 50% SQL │      │ SQLite Standby  │
│ (Soak)  │      │ (24h)   │      │ (24h)   │      │ (48h)   │      │ (48h)   │      │ (Min 14 Days)   │
└─────────┘      └─────────┘      └─────────┘      └─────────┘      └─────────┘      └─────────────────┘
```

1. **Stage 0: 0% Canary (Dry-Run & Production Shadow Soak):**
   - Routing: 100% SQLite primary; shadow comparisons active only in staging.
   - Purpose: Baseline HTTP and query latency profiling under actual production traffic load.
2. **Stage 1: 1% Canary (Low-Risk Read-Only Endpoints):**
   - Endpoints: Public prediction feed and tournament catalog (`/api/predictions/feed`, `/api/web/tournaments/today`).
   - Audience: Anonymous/unauthenticated read requests only.
   - Minimum Duration: 24 hours.
3. **Stage 2: 5% Canary (Expanded Public Catalog):**
   - Endpoints: Player profiles and match listings (`/api/web/players`, `/api/web/matches`).
   - Minimum Duration: 24 hours.
4. **Stage 3: 25% Canary (Authenticated WebApp Endpoints):**
   - Endpoints: Redacted predictions and platform stats (`/api/webapp/predictions`, `/api/webapp/stats`).
   - Minimum Duration: 48 hours.
5. **Stage 4: 50% Canary (High-Concurrency Peak Events):**
   - Endpoints: All public and WebApp read routes.
   - Minimum Duration: 48 hours covering at least two active live tournament match windows.
6. **Stage 5: 100% Canary Primary Reads (SQLite Hot-Standby Mode):**
   - Routing: 100% PostgreSQL primary reads.
   - **Crucial Clarification:** This is **NOT** SQLite retirement. SQLite is retained in synchronized hot-standby with active transactional dual-write replication.
   - Minimum Duration: 14 consecutive days of zero-incident operation before Phase 12 (Retirement) can be designed.

### 4.2 Deterministic Session Hash Ring (Non-Random Allocation)
To prevent **session flickering** (where a user sees different data on consecutive requests), routing uses an MD5 hash ring based on user identifier or client IP:
```ts
function shouldRouteToPg(identifier: string, endpoint: string, canaryPct: number): boolean {
  if (canaryPct <= 0) return false;
  if (canaryPct >= 100) return true;
  const hash = crypto.createHash('md5').update(`${identifier}:${endpoint}`).digest();
  const bucket = hash.readUInt16BE(0) % 100;
  return bucket < canaryPct;
}
```

---

## 5. Latency Decoupling & Stop / Abort Criteria

### 5.1 Decoupled Latency Metrics Specification
To prevent fast database queries from masking slow HTTP responses (e.g. serialization overhead, middleware bottlenecks) or connection pool wait starvation, three distinct latency metrics are evaluated independently:

```
Total HTTP Request Duration (t_http)
├─► Connection Acquisition Time (t_pool)   [Target: <= 10.0 ms]
├─► PostgreSQL Query Execution (t_query)   [Target: P95 <= 3.0 ms, P99 <= 15.0 ms]
└─► Payload Serialization & Dispatch (t_io) [Target: <= 5.0 ms]
```

1. **Total HTTP Latency ($t_{\text{http}}$):**
   - Baseline Primary P95: $\sim 1.02\text{ ms}$.
   - Allowed Canary Added P95 Delta: $\le 5.0\text{ ms}$.
   - Allowed Canary Added P99 Delta: $\le 25.0\text{ ms}$.
   - Hard Ceiling: Any single HTTP response $> 100.0\text{ ms}$ triggers inspection.
2. **PostgreSQL Query Latency ($t_{\text{query}}$):**
   - P95 Budget: $\le 3.0\text{ ms}$.
   - P99 Budget: $\le 15.0\text{ ms}$.
   - Hard Query Ceiling: Any query execution $> 50.0\text{ ms}$ triggers circuit breaker.
3. **Connection Pool Acquisition Time ($t_{\text{pool}}$):**
   - Budget: $\le 10.0\text{ ms}$ timeout. If client waits $> 10.0\text{ ms}$ for a connection, request immediately aborts to SQLite.

### 5.2 5xx Error Taxonomy & Disambiguation Protocol
Not all 5xx errors warrant a database rollback. Errors must be disambiguated by source:

| Error Category | Diagnostic Signature | System Action | Rollback Triggered? |
| :--- | :--- | :--- | :---: |
| **`POSTGRES_INTERNAL_ERROR`** | Connection drop, pool exhaustion (`timeout exceeded`), query syntax error, transaction abort | Fail-open to SQLite; increment failure counter | **YES** (Immediate Soft Rollback if $\ge 1$ occurrence) |
| **`APPLICATION_LOGIC_ERROR`** | Unhandled promise rejection, undefined property access in handler | Log error; fail-safe fallback to SQLite | **YES** (If occurring on PG path) |
| **`EXTERNAL_DEPENDENCY_ERROR`**| Telegram Bot API 502/504, Google OAuth network failure, vendor live score API timeout | Route through normal error handler; log external incident | **NO** (Isolated; does not affect database routing) |
| **`NETWORK_INGRESS_ERROR`** | Cloudflare 520/524, Render edge proxy timeout | Monitor infrastructure health; log edge event | **NO** (Unless correlated with local server unresponsiveness) |
| **`UNKNOWN_ERROR`** | Unclassified 5xx status code | Fail-safe fallback to SQLite; trigger circuit breaker | **YES** (Safety-first default) |

### 5.3 Point-in-Time Parity with Watermarking
For time-sensitive mutable records (live match scores, settlement statuses), parity evaluation must be qualified with:
1. **`snapshot_pg_lsn`**: PostgreSQL Write-Ahead Log sequence number.
2. **`outbox_watermark`**: Maximum delivered `event_id` and pending count.
3. **Freshness Window ($\Delta t_{\text{rep}} \le 5.0\text{s}$)**: Differences within the documented asynchronous replication window are classified as `REPLICATION_LAG_IN_FLIGHT` rather than true divergence. Differences persisting beyond $\Delta t_{\text{rep}}$ trigger a halt.

---

## 6. Two-Tier Rollback Architecture & Render Runtime Benchmark

```
                                  TRIGGER CONDITION
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  ▼                                               ▼
         [TRANSIENT ANOMALY]                             [CATASTROPHIC FAILURE]
         Latency spike / PG error                        Corrupted state / Data drift
                  │                                               │
                  ▼                                               ▼
       ┌─────────────────────┐                         ┌─────────────────────┐
       │   TIER 1 ROLLBACK   │                         │   TIER 2 ROLLBACK   │
       │   (SOFT ROLLBACK)   │                         │   (HARD ROLLBACK)   │
       └──────────┬──────────┘                         └──────────┬──────────┘
                  │                                               │
       • Memory flag toggled (<10ms)                   • Halt deployment in Render
       • 100% traffic reverts to SQLite                • Restore verified backup
       • In-flight PG queries drained                  • Replay dual-write outbox
       • Zero data change required                     • Full forensic RCA
```

### 6.1 Tier 1: Soft Rollback (Programmatic In-Memory Disarm)
- **Target Execution Latency:** $< 10.0\text{ ms}$.
- **Staging Benchmark Result:** Measured at **0.064 ms** in Phase 10 verification.
- **Mandatory Render Production Benchmark Requirement:**  
  *The 0.064 ms result was achieved on local staging hardware. Before production cutover authorization, an empirical disarm benchmark must be executed directly on the Render production container runtime to verify that memory flag evaluation executes in $< 10.0\text{ ms}$ under production CPU/memory limits.*
- **Mechanism:** In-process atomic feature flag:
  ```ts
  CanaryRouter.disarm('LATENCY_SPIKE_EXCEEDED');
  ```
- **Operational Effect:**
  1. Immediately directs 100% of incoming read requests to `RepositoryFactory.getSqliteRepository()`.
  2. Aborts all queued and in-flight PostgreSQL queries without blocking client response delivery.
  3. No service restart or container deployment required.

### 6.2 Tier 2: Hard Rollback (Comprehensive System Restoration)
- **Target Recovery Time:** $< 15\text{ minutes}$.
- **Runbook Procedures:**
  1. Set environment variables `CANARY_CUTOVER_DISABLED=true` and `DATABASE_ENGINE=sqlite` in Render dashboard.
  2. Restart web service to load known-good immutable baseline.
  3. Verify `tennis_gold.sqlite` and `database.sqlite` checksums against the baseline manifest.
  4. Perform forensic reconciliation of any outbox events delivered during the canary window.
  5. Convene root cause analysis (RCA) prior to any subsequent rescheduling.

---

## 7. Quality Acceptance Gates for Phase 11 (Final Authorization Battery)

When formal authorization to implement Phase 11 is requested, the implementation must pass the following 8 Quality Acceptance Gates:

| Gate ID | Quality Acceptance Gate Title | Evaluation Criteria | Target Metric |
| :--- | :--- | :--- | :--- |
| **P11-G1** | **Deterministic Canary Router** | Non-random session hash routing across 0/1/5/25/50/100% tiers | 100% deterministic session allocation |
| **P11-G2** | **Zero-Disruption Fallback** | Instant SQLite fallback during simulated PostgreSQL crash | 0 HTTP 500 errors; 0 dropped requests |
| **P11-G3** | **Decoupled Latency Profiling** | $t_{\text{http}}$, $t_{\text{query}}$, and $t_{\text{pool}}$ measured separately across public routes | Added HTTP P95 $\le 5.0\text{ms}$; Query P95 $\le 3.0\text{ms}$ |
| **P11-G4** | **Render Runtime Disarm SLA** | Empirical in-memory kill-switch benchmark executed on Render | Disarm latency $< 10.0\text{ ms}$ on Render runtime |
| **P11-G5** | **Live Render Evidence Bundle** | Physical volume dump, SHA-256, row counts, and test restore verified | Evidence bundle signed off; integrity = `ok` |
| **P11-G6** | **Outbox Catch-Up Zero-Lag** | Outbox delivery worker achieves zero undelivered events | Backlog = 0 events; Lag $< 5.0\text{s}$ |
| **P11-G7** | **Security & Audit Logging** | Canary routing decisions, disarms, and failovers audited | Audit records persisted with timestamp & reason |
| **P11-G8** | **Dry-Run Rollback Drill** | End-to-end execution of Tier 1 & Tier 2 rollback runbooks | Recovery completed without data corruption |

---

## 8. Status & Sign-Off Record

- **Current Specification Status:** `DRAFTED_FOR_REVIEW`
- **Pre-Cutover Authorization Status:** `NOT_GRANTED`
- **Production Canary Status:** `PROHIBITED`
- **Production Response Path:** `SQLITE_ONLY` (Strictly Enforced)
- **Approved by User Directive:** `2026-09-11` (Decision 41)
