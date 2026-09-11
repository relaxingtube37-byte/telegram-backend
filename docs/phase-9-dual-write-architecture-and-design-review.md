# Phase 9: Dual-Write Architecture & Staging Harness Design Specification

**Document Version:** 2.0.0-APPROVED  
**Date:** 2026-09-11  
**Target Environment:** Isolated Local Staging (Port 54350)  
**Status:** 🛡️ **APPROVED FOR STAGING IMPLEMENTATION — DUAL-WRITE PROHIBITED IN PRODUCTION**  
**Authoritative Operational State:**
```json
{
  "phase_8_audit_closure": "ACCEPTED",
  "phase_9_design_review": "APPROVED_FOR_STAGING_IMPLEMENTATION",
  "phase_9_dual_write": "PROHIBITED_UNTIL_GATES_PASS",
  "production_reads": "SQLITE_ONLY",
  "production_shadow_reads": "PROHIBITED",
  "production_cutover": "PROHIBITED",
  "sqlite_retirement": "PROHIBITED"
}
```

---

## 1. Architectural Model: Transactional SQLite Outbox

### 1.1. Core Durability & Non-Blocking Lifecycle
An in-memory queue is non-durable and vulnerable to crash loss. Therefore, Phase 9 utilizes a **Transactional SQLite Outbox Table** as the authoritative record of write intent.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      REQUEST PATH (TRANSACTIONAL ATOMICITY)                 │
│                                                                             │
│  Client Write ──► [Service] ──► SQLite Transaction (Single Atomic Commit)   │
│                                  ├── 1. Primary Business Mutation           │
│                                  └── 2. Insert into postgres_dual_write_outbox│
│                                              (PENDING, available_at=now)    │
│  Median overhead ≤ 1ms | P95 overhead ≤ 5ms | Zero external network calls   │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (Polling / Signal)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 ASYNCHRONOUS STAGING DUAL-WRITE WORKER                      │
│                                                                             │
│  [Worker Loop] ──► Claim batch of PENDING rows (status -> PROCESSING)      │
│                ──► Execute Idempotent Upsert against PostgreSQL Port 54350  │
│                ──► Success: Mark status -> DELIVERED                        │
│                ──► Error: Retry with exponential backoff                    │
│                ──► Max Attempts (5) Exceeded: Mark status -> DLQ            │
│                     └── Append forensic envelope to dlq_records.jsonl       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Durable Outbox Schema & DLQ Specification

### 2.1. Outbox Table Schema DDL (SQLite)
```sql
CREATE TABLE IF NOT EXISTS postgres_dual_write_outbox (
  event_id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK ( status IN ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'DLQ') ),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  locked_at TEXT,
  delivered_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outbox_claim 
  ON postgres_dual_write_outbox (status, available_at);

CREATE INDEX IF NOT EXISTS idx_outbox_aggregate 
  ON postgres_dual_write_outbox (aggregate_type, aggregate_id);
```

### 2.2. Dead-Letter Queue (DLQ) Forensic Envelope
When an event exceeds maximum retry attempts (default: 5), it is marked `DLQ` in SQLite, and an audit envelope is appended to `scratch/postgres-phase-9-dual-write/dlq_records.jsonl`:
```json
{
  "event_id": "uuid-v4",
  "idempotency_key": "deterministic-key",
  "aggregate_type": "PREDICTION",
  "aggregate_id": "fixture_101",
  "operation": "CREATE",
  "payload_json": "{...}",
  "payload_sha256": "4cc4bc8d2d4f0a4bd8d769601000116b4d2fed8bbbe01db98a9811ae1d08b358",
  "attempt_count": 5,
  "first_failed_at": "2026-09-11T16:00:00.000Z",
  "last_failed_at": "2026-09-11T16:05:00.000Z",
  "last_error_code": "ECONNREFUSED",
  "last_error_message": "connect ECONNREFUSED 127.0.0.1:54350",
  "source_commit": "8bb3e3e"
}
```

### 2.3. Delivery & Recovery Semantics
1. **At-Least-Once Delivery with Deduplication:** Deterministic idempotency keys prevent duplicate rows. Handlers execute `INSERT ... ON CONFLICT (key) DO UPDATE/NOTHING`.
2. **Lease Expiration & Crash Recovery:** Rows locked in `PROCESSING` whose `locked_at` exceeds lease timeout (default: 30 seconds) are automatically reclaimed to `PENDING` on worker restart.
3. **Exponential Retry Backoff:** Delays calculate as $\text{delay} = \min(60000, 1000 \times 2^{\text{attempt\_count}})$.
4. **Graceful Shutdown:** Worker stops claiming new work immediately upon signal and waits up to 5 seconds for active writes to complete.

---

## 3. Phase 9 Quality Acceptance Gates (14/14 GATES)

| Gate | Requirement & Acceptance Criteria | Verification Method |
| :---: | :--- | :--- |
| **P9-G1** | **Outbox Latency Overhead:** Primary SQLite transaction overhead: median $\le 1\text{ms}$, P95 $\le 5\text{ms}$. Zero synchronous network calls on request path. | Benchmark 100 benchmark writes with/without outbox insertion. |
| **P9-G2** | **Circuit Breaker Auto-Trip:** PostgreSQL staging downtime trips circuit breaker to `OPEN` without bubbling exceptions. | Simulate cluster shutdown; verify zero caller errors. |
| **P9-G3** | **DLQ Envelope & Integrity:** 100% of exhausted events captured in outbox table with status `DLQ` and exported to `dlq_records.jsonl`. | Inject 5 consecutive failures; verify SHA-256 and JSON fields. |
| **P9-G4** | **Instant Rollback Disarm:** Admission stop $\le 100\text{ms}$ after disarm flag; active workers acknowledge disarm in $\le 1\text{s}$. | Toggle `ENABLE_STAGING_DUAL_WRITE=false`; measure halt latency. |
| **P9-G5** | **Production Read Immutability:** Production reads remain strictly locked to `SQLITE_ONLY`. | Inspect `RepositoryFactory` in production environment. |
| **P9-G6** | **Idempotent Replay (Row Hash Parity):** Replaying identical events creates 0 duplicate rows and leaves PostgreSQL row content hashes bitwise unchanged. | Replay delivered batch; compare MD5/SHA-256 of target rows. |
| **P9-G7** | **PostgreSQL Downtime Fault Tolerance:** Primary SQLite mutations succeed without interruption when PostgreSQL is offline. | Write 10 records with port 54350 offline; verify all commit. |
| **P9-G8** | **Atomic Commit Invariant:** Primary mutation and outbox record commit atomically; a forced rollback commits neither. | Test transaction abort; verify 0 primary rows and 0 outbox rows. |
| **P9-G9** | **Worker Lease Reclamation:** Expired `PROCESSING` leases are automatically reset to `PENDING` upon worker restart. | Artificially age `locked_at` by 60s; verify restart reclaims row. |
| **P9-G10** | **Authenticated & Auditable DLQ Replay:** Replaying DLQ items is idempotent and emits structured audit trail entries. | Trigger DLQ replay handler; verify status changes to `DELIVERED`. |
| **P9-G11** | **Backlog Observability & Threshold Alerts:** System reports accurate counts of `PENDING`, `PROCESSING`, `DELIVERED`, `DLQ`. | Query outbox metrics; assert count accuracy. |
| **P9-G12** | **Production Credential Rejection:** Worker asserts fail-closed check if connection config contains non-local host or production credentials. | Pass production host; assert worker throws `PRODUCTION_TARGET_PROHIBITED`. |
| **P9-G13** | **Payload Sanitization:** Payloads scrubbed of secrets, authorization tokens, and credentials before serialization. | Inspect outbox `payload_json` for credential leak prevention. |
| **P9-G14** | **Crash Recovery State Preservation:** Crash simulation leaves all committed outbox items preserved without state corruption. | Verify SQLite outbox table integrity across simulated process exits. |

---

## 4. Operational Invariants

- 🛑 **DATABASE_ENGINE remains SQLite:** No production configuration changes.
- 🛑 **Dual-write remains strictly PROHIBITED in production:** Staging-only worker on Port 54350.
- 🛑 **Production reads remain SQLite-only:** 0% production traffic routed to PostgreSQL.
- 🛑 **Production shadow-read remains PROHIBITED:** Staging non-blocking comparison only.
- 🛑 **Production cutover remains PROHIBITED:** Hard-blocked by migration policy.
- 🛑 **Source SQLite Databases bitwise immutable:** Evaluated against `docs/source_baseline_manifest_v1.json`.
