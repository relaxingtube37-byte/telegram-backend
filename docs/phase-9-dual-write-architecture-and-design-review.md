# Phase 9: Dual-Write Architecture & Staging Harness Design Review

**Document Version:** 1.0.0-DRAFT  
**Date:** 2026-09-11  
**Target Environment:** Isolated Local Staging (Port 54350)  
**Status:** 🛡️ **DESIGN REVIEW ONLY — DUAL-WRITE REMAINS STRICTLY PROHIBITED**  
**Authoritative Operational State:**
```json
{
  "phase_7_staging": "CLOSED_ACCEPTED",
  "phase_8_staging_data_access": "COMPLETED_CERTIFIED",
  "phase_8_audit_closure": "ACCEPTED",
  "phase_9_dual_write": "PROHIBITED",
  "production_reads": "SQLITE_ONLY",
  "production_shadow_reads": "PROHIBITED",
  "production_cutover": "PROHIBITED",
  "sqlite_retirement": "PROHIBITED"
}
```

---

## 1. Context, Scope & Governance Boundaries

The Data-Access Layer (Phase 8) successfully decoupled application domain models from physical storage engines via abstract interfaces (`IPredictionsRepo`, `IEditorialsRepo`, `IPlayersRepo`, `IMatchesRepo`). 

Phase 9 introduces the **Dual-Write Architecture** to keep PostgreSQL staging synchronized with new SQLite mutations as they occur. 

> [!CAUTION]
> **STRICT PROHIBITION NOTICE:**
> Dual-write is currently **PROHIBITED** in all production execution paths. This document provides the architectural design review and staging verification harness specifications only. No dual-write operations may be enabled until formal authorization is granted following this design review.

---

## 2. Architectural Approaches for Dual-Write

We evaluate two architectural strategies for dual-write implementation:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           OPTION A: SYNCHRONOUS                         │
│                                                                         │
│  Client Write ──► [Domain Service] ──► SQLite (Primary, Blocking)       │
│                                    └─► PostgreSQL (Secondary, Blocking) │
│  Risk: PostgreSQL latency or failure blocks user requests.              │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                     OPTION B: ASYNCHRONOUS BUFFERED                     │
│                             (RECOMMENDED)                               │
│                                                                         │
│  Client Write ──► [Domain Service] ──► SQLite (Primary, 0ms latency)    │
│                                    │                                    │
│                                    ▼                                    │
│                         In-Memory Outbox Queue                          │
│                                    │                                    │
│                         [Background Staging Worker]                     │
│                                    │                                    │
│                                    ▼                                    │
│                         PostgreSQL Staging (Port 54350)                 │
│                                    │                                    │
│                                    ▼ (on error)                         │
│                         Dead-Letter Queue (DLQ)                         │
│                                                                         │
│  Benefit: Complete isolation; PostgreSQL downtime has zero user impact. │
└─────────────────────────────────────────────────────────────────────────┘
```

### Recommendation: Option B (Asynchronous Buffered Outbox)
- **Zero Latency Impact:** SQLite primary transaction completes immediately.
- **Fail-Closed Safety:** If the staging PostgreSQL daemon is offline, errors do not bubble up to the caller; mutations are queued in an in-memory DLQ buffer with structured forensic logging.
- **Circuit Breaker:** If 5 consecutive dual-write errors occur, the worker enters `CIRCUIT_OPEN` state, suspending writes to PostgreSQL while keeping primary SQLite operational.

---

## 3. Detailed Component Design

### 3.1. Dual-Write Repository Wrapper (`DualWritingPredictionsRepo`)
A decorator implementing `IPredictionsRepo`:
```typescript
export class DualWritingPredictionsRepo implements IPredictionsRepo {
  constructor(
    private primary: IPredictionsRepo,        // SqlitePredictionsAdapter
    private secondary: PostgresPredictionsAdapter,
    private outboxQueue: StagingOutboxQueue
  ) {}

  async create(prediction: CreatePredictionInput): Promise<Prediction> {
    // 1. Authoritative SQLite write (Primary)
    const result = await this.primary.create(prediction);

    // 2. Enqueue asynchronous secondary write if feature flag is active
    if (process.env.ENABLE_STAGING_DUAL_WRITE === 'true' && process.env.NODE_ENV !== 'production') {
      this.outboxQueue.enqueue({
        domain: 'PREDICTIONS',
        action: 'CREATE',
        payload: result,
        enqueuedAt: new Date()
      });
    }

    return result;
  }
}
```

### 3.2. Dead-Letter Queue (DLQ) & Forensic Ledger
When a secondary PostgreSQL write fails:
1. The error message and full serialized payload are written to `scratch/postgres-phase-9-dual-write/dlq_records.jsonl`.
2. A structured audit event is logged with SHA-256 payload checksum.
3. The circuit breaker increments its failure counter.

### 3.3. Disarm & Instant Rollback Mechanism (<5 Seconds)
Dual-write can be instantly disarmed via:
- Setting `ENABLE_STAGING_DUAL_WRITE=false`.
- Calling `RepositoryFactory.disarmDualWrite()`.
- Primary SQLite operations remain 100% unaffected.

---

## 4. Pre-Requisite Baseline Immutability Manifest

In accordance with Phase 0 migration standards, baseline source databases are locked and verifiable against [`docs/source_baseline_manifest_v1.json`](file:///g:/telegram-backend/docs/source_baseline_manifest_v1.json):

```json
{
  "authoritative_desktop_gold": {
    "path": "G:/state football/data/tennis_gold.sqlite",
    "bytes": 283303936,
    "sha256": "2951176b1fc7da0db250b42e53976c67a25aca59bcf0175706599e30e816c086"
  },
  "backend_primary_sqlite": {
    "path": "G:/telegram-backend/data/database.sqlite",
    "bytes": 545468416,
    "sha256": "4cc4bc8d2d4f0a4bd8d769601000116b4d2fed8bbbe01db98a9811ae1d08b358"
  }
}
```

---

## 5. Phase 9 Proposed Quality Acceptance Gates

| Gate | Title | Acceptance Criteria |
| :---: | :--- | :--- |
| **P9-G1** | **Outbox Queue Non-Blocking Delivery** | Secondary write processing adds $\le 1\text{ms}$ to primary SQLite response time. |
| **P9-G2** | **Circuit Breaker Auto-Trip** | PostgreSQL downtime automatically trips circuit breaker without unhandled rejections. |
| **P9-G3** | **DLQ Reconciliation & Auditability** | 100% of failed dual-writes captured in DLQ ledger with cryptographic SHA-256 hashes. |
| **P9-G4** | **Instant Rollback Disarm** | Toggling `ENABLE_STAGING_DUAL_WRITE=false` halts all PostgreSQL mutations in $\le 100\text{ms}$. |
| **P9-G5** | **Production Read Immutability** | Production reads remain strictly locked to `SQLITE_ONLY`. |
| **P9-G6** | **Dual-Pass Idempotency** | Replaying outbox items produces exactly zero duplicate rows in staging PostgreSQL. |

---

## 6. Authorization & Execution Request

Phase 9 implementation will remain strictly confined to the staging branch and harness scripts. Authorization to proceed to staging implementation will be requested following review of this architectural document.
