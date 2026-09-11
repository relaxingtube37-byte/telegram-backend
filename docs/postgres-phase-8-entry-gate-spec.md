# PostgreSQL Phase 8: Data-Access & Repository Layer Entry Gate Specification

**Document Role:** Authoritative Architectural Design, Repository Contract Definition, and Controlled Entry Gate Specification  
**Status:** `DRAFT / SPECIFICATION_PREPARATION` (Phase 8 has NOT started)  
**Preceding Milestone:** Milestone 27 Certified (`14de6c34e1ba5b8bf3e07916c053950ebfaafb45`)  
**Target Environment:** Isolated Disposable Local PostgreSQL Staging (Port 54350) / SQLite Local  
**Production Cutover:** 🛑 **PROHIBITED (Production Reads: SQLITE_ONLY)**  

---

## 1. Phase 8 Entry Gate State & Governance Pre-requisites

Phase 8 may only proceed under strict validation of the following immutable operational gate:

```json
{
  "phase_7_status": "CLOSED",
  "staging_snapshot": "FROZEN",
  "crosswalk_parity": "PASS",
  "quarantine_reconciliation": "PASS",
  "canonical_admission": 0,
  "unresolved_parent_policy": "DOCUMENTED",
  "rollback_target": "SQLITE",
  "production_reads": "SQLITE_ONLY",
  "dual_write": "NOT_YET_AUTHORIZED",
  "shadow_read": "NOT_YET_AUTHORIZED",
  "production_cutover": "PROHIBITED"
}
```

> [!IMPORTANT]
> **Strict Operational Boundary:** Phase 8 is limited exclusively to **Repository Layer design, adapter abstraction, and staging read comparison**. It does NOT authorize dual-write, does NOT authorize shadow-read in production, and does NOT cut over production read paths. The live production system remains 100% backed by SQLite.

---

## 2. Architectural Objectives

1. **Decouple Data Access from Database Engines:** Introduce abstract interfaces (`IPredictionsRepo`, `IEditorialsRepo`, `IPlayersRepo`, `IMatchesRepo`) that hide SQLite and PostgreSQL implementation specifics behind clean domain contracts.
2. **Implement Dual-Engine Adapters:**
   - `SqliteAdapter`: Wraps current `better-sqlite3` queries verbatim, preserving 100% existing runtime behavior.
   - `PostgresAdapter`: Implements identical domain methods querying PostgreSQL canonical tables and compatibility views (`ai.predictionruns`, `ai.agenttraces`, `predictions.published_predictions`, `predictions.match_editorials`, `matches.matches`, `identity.players`).
3. **Establish Zero-Risk Rollback Architecture:**
   - Hardcode default engine to `SQLITE`.
   - Any failure, timeout, or divergence in PostgreSQL immediately and silently falls back to SQLite.
4. **Prepare Non-Blocking Shadow Comparator (Staging Only):**
   - Provide an offline test comparator to benchmark PostgreSQL query execution, response shape parity, and latency against SQLite without affecting live API clients.

---

## 3. Repository Layer Contracts & Interfaces

### 3.1. `IPredictionsRepo`
```typescript
export interface PredictionFilter {
  limit?: number;
  status?: 'UPCOMING' | 'LIVE' | 'WON' | 'LOST' | 'VOID';
  surface?: string;
}

export interface IPredictionsRepo {
  getActive(): Promise<PredictionRecord[]>;
  getHistory(limit: number): Promise<PredictionRecord[]>;
  getById(id: number | string): Promise<PredictionRecord | null>;
  getByFixtureId(fixtureId: number): Promise<PredictionRecord | null>;
}
```

### 3.2. `IEditorialsRepo`
```typescript
export interface IEditorialsRepo {
  getPublished(limit?: number): Promise<EditorialRecord[]>;
  getBySlug(slug: string): Promise<EditorialRecord | null>;
  getByFixtureId(fixtureId: number): Promise<EditorialRecord | null>;
  getById(id: number): Promise<EditorialRecord | null>;
}
```

### 3.3. `IMatchesRepo`
```typescript
export interface IMatchesRepo {
  getById(matchId: string | number): Promise<MatchRecord | null>;
  getHeadToHead(player1Id: string | number, player2Id: string | number): Promise<H2HSummary>;
  getRecentMatchesByPlayer(playerId: string | number, limit: number): Promise<MatchRecord[]>;
  getLiveMatches(): Promise<MatchRecord[]>;
}
```

### 3.4. `IPlayersRepo`
```typescript
export interface IPlayersRepo {
  getById(playerId: string | number): Promise<PlayerProfile | null>;
  searchByName(query: string): Promise<PlayerProfile[]>;
  getRankingHistory(playerId: string | number): Promise<RankingHistoryPoint[]>;
}
```

---

## 4. Factory & Adapter Architecture

```
                       ┌───────────────────────────────┐
                       │    Application Service Layer  │
                       │ (PredictionsService / Web API)│
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │       Repository Factory      │
                       │  (Config: READ_ENGINE=SQLITE) │
                       └───────┬───────────────┬───────┘
                               │               │
            ┌──────────────────┘               └──────────────────┐
            ▼                                                     ▼
┌──────────────────────────────┐              ┌──────────────────────────────┐
│        SqliteAdapter         │              │       PostgresAdapter        │
│   (Primary Production)       │              │     (Staging Shadow Read)    │
│  database.sqlite / Gold DB   │              │  Local PostgreSQL (Port 54350│
└──────────────────────────────┘              └──────────────────────────────┘
```

### 4.1. Factory Invariant & Circuit Breaker
```typescript
export class RepositoryFactory {
  static getPredictionsRepo(): IPredictionsRepo {
    const primary = new SqlitePredictionsRepo();
    if (process.env.ENABLE_STAGING_PG_SHADOW === 'true') {
      const shadow = new PostgresPredictionsRepo();
      return new ShadowComparingPredictionsRepo(primary, shadow);
    }
    return primary;
  }
}
```

---

## 5. Controlled Shadow-Comparison Specification (Staging Only)

In Staging, the `ShadowComparingRepo` pattern executes:
1. **Primary Call:** Synchronously call `primary.getActive()` against SQLite.
2. **Immediate Return:** Return the SQLite result directly to the HTTP response pipeline.
3. **Async Shadow Call:** Asynchronously execute `shadow.getActive()` against PostgreSQL staging.
4. **Parity Diff Logging:** Compare JSON shapes, row counts, and field values. Log any divergence with reason codes to `scratch/phase-8-shadow-divergence.log`.
5. **Zero Error Propagation:** PostgreSQL errors or connection drops must NEVER affect the response delivered to the caller.

---

## 6. Open Architectural Risks (Carried Forward into Phase 8)

| Risk Code | Risk Description | Remediation Prerequisite |
| :--- | :--- | :--- |
| **RISK-1** | **Unverified Render Production Source:** Live Render environment may contain user accounts, referrals, or live predictions not present in local SQLite. | Mandatory read-only production dump prior to Phase 11 cutover. |
| **RISK-2** | **Gold Matches Validated Disparity:** Desktop shows 58,131 rows vs Backend shows 57,977 rows. | Root cause investigation required before shadow parity baseline can be certified. |
| **RISK-3** | **Backtest-Ready View Disparity:** Desktop backtest view shows 46,076 rows vs Backend shows 38,566 rows. | Resolution required before historical telemetry can be compared across engines. |
| **RISK-4** | **Unresolved Parent Matches (45 items):** 45 qualification traces remain quarantined in `provenance.review_queue` awaiting Phase 4 tournament edition links. | Parent tournament editions must be linked before runs can be admitted. |
| **RISK-5** | **Unresolved Vendor Fixtures (72 items):** 72 traces lack vendor fixture crosswalk in SQLite. | Authoritative fixture mapping required; force-linking prohibited. |

---

## 7. Quality Acceptance Gates for Phase 8

| Gate | Title | Acceptance Criteria |
| :---: | :--- | :--- |
| **P8-G1** | **Interface Completeness** | 100% of methods in `src/db/repositories/` mapped to typed TypeScript interfaces. |
| **P8-G2** | **Production Read Immutability** | SQLite execution path is 100% identical; zero client traffic routed to PostgreSQL. |
| **P8-G3** | **PostgreSQL Query Conformance** | Postgres adapters execute against frozen schema views without SQL syntax errors. |
| **P8-G4** | **Rollback Circuit Breaker** | Verified 0ms fallback to SQLite under simulated PostgreSQL failure. |
| **P8-G5** | **Zero Production Mutation** | PostgreSQL writes remain strictly disabled; production read cutover remains PROHIBITED. |
| **P8-G6** | **Dual-Write & Shadow-Read Prohibition** | Phase 9 (Dual-Write) and Phase 10 (Shadow-Read) remain formally unauthorized until Phase 8 is closed. |
