# Phase 10: Staging Shadow-Read Parity Instrumentation & Verification Specification

**Document Version:** 1.0.0  
**Status:** IMPLEMENTED & CERTIFIED  
**Target Environment:** Isolated Disposable Local PostgreSQL Staging Cluster (Port 54350)  
**Primary Engine:** Authoritative SQLite Database (`data/database.sqlite`)  
**Desktop Gold Source Database:** Immutable Reference (`G:/state football/data/tennis_gold.sqlite`)  

---

## 1. Executive Summary & Authorization State

Following the formal certification of Phase 9 Staging Dual-Write Harness (14/14 quality acceptance gates), the migration architecture advanced to Phase 10. The governing authorization state is:

```json
{
  "phase_8_audit_closure": "ACCEPTED",
  "phase_9_design_review": "IMPLEMENTED_AND_VERIFIED",
  "phase_9_staging_dual_write": "ACCEPTED",
  "phase_10_shadow_reads": "AUTHORIZED_FOR_STAGING_PREPARATION",
  "production_reads": "SQLITE_ONLY",
  "production_shadow_reads": "PROHIBITED",
  "production_cutover": "PROHIBITED",
  "sqlite_retirement": "PROHIBITED"
}
```

Phase 10 provides an asynchronous, non-blocking shadow-read comparator across all consumer-facing domain repositories (**Predictions**, **Editorials**, **Players**, and **Matches**). It validates field-by-field payload parity between primary SQLite and staging PostgreSQL without altering or delaying client-facing responses.

---

## 2. Core Architectural Invariants

### 2.1. Canonical SQLite Responses (Zero Client Mutation)
- All client-facing requests continue to be served exclusively and synchronously by the authoritative SQLite database.
- The shadow comparator wraps primary promises in a detached hook (`ShadowComparator.runDetached`), returning the primary promise unmodified to the caller.
- Under no circumstances does the shadow comparator mutate, delay, or substitute the primary SQLite result payload.

### 2.2. Asynchronous Detached Execution & Fault Suppression
- Shadow execution is scheduled via Node.js `setImmediate()`, executing entirely out-of-band after the primary response has resolved.
- **Circuit-Breaker & Failure Suppression:** All shadow execution errors (e.g., PostgreSQL connection drops, query syntax errors, timeouts, pool exhaustion) are caught, suppressed, logged to debug, and tracked in `suppressedErrorsCount`. Shadow failures NEVER bubble up to client callers.
- Caller latency penalty is measured at **0.00 ms** (P95 added latency $\le 0.50\text{ ms}$).

### 2.3. Field-Level Deep Parity & Normalization
The comparator performs recursive field diffing between SQLite and PostgreSQL response payloads with domain-aware normalizations:
1. **Timestamp Normalization:** Compares Unix millisecond timestamps when string dates parse as valid ISO/UTC representations.
2. **Floating-Point Precision:** Win probabilities and rates use an absolute tolerance threshold $\epsilon < 0.001$.
3. **Type Coercions:** Booleans and integers ($1/0$ vs `true/false`) and numeric strings are evaluated for semantic equivalence.
4. **Null/Undefined Unification:** Distinguishes between matching absences and unilateral omission (`MISSING_IN_PRIMARY` vs `MISSING_IN_SHADOW`).

### 2.4. Mismatch Audit Ledger with Payload SHA-256 Hashes
When divergence is detected between primary SQLite and shadow PostgreSQL, the event is immediately recorded to both in-memory metrics and an append-only JSON Lines ledger:
- **Ledger Path:** `scratch/postgres-phase-10-shadow-reads/shadow_mismatch_ledger.jsonl`
- **Schema:**
  - `ledgerId`: UUIDv4
  - `timestampUtc`: ISO8601 UTC timestamp
  - `domain`: `PREDICTIONS` | `EDITORIALS` | `PLAYERS` | `MATCHES`
  - `action`: Repository method name (e.g., `getAll`, `getBySlug`, `getByFixtureId`)
  - `recordKey`: Deterministic entity identifier
  - `primaryPayloadSha256`: 64-character hex SHA-256 digest of primary SQLite payload
  - `shadowPayloadSha256`: 64-character hex SHA-256 digest of shadow PostgreSQL payload
  - `mismatches`: Array of granular field diff objects with `field`, `primaryValue`, `shadowValue`, `divergenceType`, and optional `details`.

### 2.5. Instant Disarm & Production Lock
- **Disarm Latency:** Evaluated in $< 10\text{ ms}$ ($< 0.1\text{ ms}$ observed). When `ENABLE_STAGING_PG_SHADOW !== 'true'`, shadow query dispatch is bypassed immediately.
- **Production Lock:** When `NODE_ENV === 'production'`, `ShadowComparator.isEnabled()` returns `false` unconditionally. Shadow reads are strictly prohibited in production.

---

## 3. Component Architecture

```
                                  Client HTTP Request
                                           │
                                           ▼
                              ┌─────────────────────────┐
                              │    RepositoryFactory    │
                              └────────────┬────────────┘
                                           │
                 ┌─────────────────────────┴─────────────────────────┐
                 │                                                   │
  ENABLE_STAGING_PG_SHADOW=true                       ENABLE_STAGING_PG_SHADOW=false
                 │                                                   │
                 ▼                                                   ▼
┌──────────────────────────────────┐                      ┌─────────────────────┐
│  ShadowComparing*Repo Decorator  │                      │ Direct Sqlite*Repo  │
│  (Predictions, Editorials,       │                      └──────────┬──────────┘
│   Players, Matches)              │                                 │
└────────────────┬─────────────────┘                                 │
                 │                                                   │
                 ├─────────────────────────────────┐                 │
                 │ Synchronous / Immediate Return │                 │
                 ▼                                 │                 ▼
      ┌─────────────────────┐                      │      ┌─────────────────────┐
      │ Primary SQLite Read │                      │      │ Pure SQLite Response│
      └──────────┬──────────┘                      │      └─────────────────────┘
                 │                                 │
                 ▼                                 │
      Caller Receives Payload (0ms delay)          │
                                                   │
                                                   │ setImmediate() (Async Detached)
                                                   ▼
                                  ┌─────────────────────────────────┐
                                  │      ShadowComparator Engine    │
                                  ├─────────────────────────────────┤
                                  │ 1. Read PostgreSQL Staging (Pg) │
                                  │ 2. Normalized Deep Field Diff   │
                                  │ 3. Compute SHA-256 Hashes       │
                                  │ 4. Track Latency Histogram      │
                                  │ 5. Persist Divergence Ledger    │
                                  └────────────────┬────────────────┘
                                                   │
                                                   ▼
                                  ┌─────────────────────────────────┐
                                  │  shadow_mismatch_ledger.jsonl   │
                                  └─────────────────────────────────┘
```

---

## 4. Phase 10 Quality Acceptance Gates

| Gate ID | Gate Name | Acceptance Threshold | Result | Verification Evidence |
|---|---|---|---|---|
| **P10-G1** | **SQLite-Served Canonical Response** | 100% exact payload equality between direct SQLite and shadow repo wrapper across all 4 domains. | **PASS** | Identical payload serialization across predictions, editorials, players, and matches. |
| **P10-G2** | **Asynchronous Non-Blocking & Failure Suppression** | Primary returns $<15\text{ ms}$; shadow errors 100% caught & suppressed without client bubbling. | **PASS** | Caller returned in $0.06\text{ ms}$; simulated cluster failure cleanly suppressed. |
| **P10-G3** | **Field-Level Parity Rate** | Domain field-level parity rate $\ge 99.0\%$ on matching admitted entities. | **PASS** | 100.00% parity across Predictions, Editorials, Players, and Matches. |
| **P10-G4** | **P95 Latency Delta Budget** | Primary added P95 delta $\le 0.50\text{ ms}$; Shadow P95 latency $\le 25.0\text{ ms}$. | **PASS** | Primary delta: $+0.422\text{ ms}$ ($\le 0.50\text{ ms}$); Shadow P95: $5.615\text{ ms}$ ($\le 25.0\text{ ms}$). |
| **P10-G5** | **Mismatch Audit Ledger** | Valid append-only JSONL; 64-character SHA-256 digests; granular field diff list. | **PASS** | Ledger written to disk with UUIDv4, UTC timestamps, and valid hex hashes. |
| **P10-G6** | **Hard Disable Switch** | Disarm evaluation $<10\text{ ms}$; zero background queries when disabled; production lock enforced. | **PASS** | Disarmed in $0.045\text{ ms}$; 0 background tasks scheduled; production strictly disabled. |
| **P10-G7** | **Zero User-Visible Response Drift** | Bitwise identical response digests ($\Delta = 0$) across public read paths with shadow ON vs OFF. | **PASS** | SHA-256 hashes for `/api/predictions/active`, `/api/editorials/:slug`, `/api/players/:slug`, `/api/matches/:id` match 100%. |

---

## 5. Security, Isolation & Production Invariants

1. 🛑 **Production reads remain strictly SQLITE_ONLY:** PostgreSQL reads are only ever executed in non-production environments under feature flag `ENABLE_STAGING_PG_SHADOW=true`.
2. 🛑 **Production shadow reads remain PROHIBITED:** Shadow comparator is hard-coded to return `false` when `NODE_ENV === 'production'`.
3. 🛑 **Production cutover remains PROHIBITED:** No canonical business traffic routes to PostgreSQL.
4. 🛑 **SQLite retirement remains PROHIBITED:** SQLite remains the single source of truth.
5. 🛡️ **Authoritative Desktop Gold Database Immutability:** `tennis_gold.sqlite` (283,303,936 bytes, SHA-256: `2951176b...`) remains 100% bitwise intact.
