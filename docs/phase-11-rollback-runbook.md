# Phase 11: Production Canary Rollback Runbook & Operating Procedures
## Dry-Run Rollback Protocols & Incident Remediation

> **Specification Reference:** [phase-11-canary-cutover-spec.md](file:///g:/telegram-backend/docs/phase-11-canary-cutover-spec.md)  
> **Governance Status:** `DRAFTED_FOR_REVIEW`  
> **Pre-Cutover Authorization Status:** `NOT_GRANTED`  
> **Target Environment:** Staging Dry-Run Execution Only  
> **Authoritative Date:** `2026-09-11`

---

## 1. Rollback Architecture & Strategy Overview

The Phase 11 canary cutover design incorporates a **Two-Tier Rollback Strategy** to handle incidents with zero data corruption and minimal user disruption:

```
                                  INCIDENT DETECTED
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  ▼                                               ▼
         [TRANSIENT INCIDENT]                            [CATASTROPHIC FAILURE]
         Latency spike / Single 5xx                      Data corruption / Schema drift
                  │                                               │
                  ▼                                               ▼
       ┌─────────────────────┐                         ┌─────────────────────┐
       │   TIER 1 ROLLBACK   │                         │   TIER 2 ROLLBACK   │
       │   (SOFT ROLLBACK)   │                         │   (HARD ROLLBACK)   │
       └──────────┬──────────┘                         └──────────┬──────────┘
                  │                                               │
       • Instant in-memory disarm                      • Service deployment halted
       • 100% traffic reverts to SQLite                • Restored verified backup
       • In-flight PG queries aborted                  • Replay dual-write outbox
       • ZERO restart required                         • Full incident RCA
```

---

## 2. Tier 1: Emergency Soft Rollback (In-Memory Disarm)

### 2.1 Technical Mechanism & SLA
- **Target SLA:** $< 10.0\text{ ms}$ (Staging benchmark: **0.064 ms**).
- **Execution Level:** In-process atomic state flag (`CanaryRouter.disarm()`).
- **Prerequisites:** Express application online; Node.js process running.
- **Side Effects:** Zero downtime; zero dropped requests; zero database modifications.

### 2.2 Trigger Triggers (When to Execute Tier 1)
Execute Tier 1 immediately if any of the following occur:
1. An unexpected 5xx error originating from PostgreSQL (`POSTGRES_INTERNAL_ERROR`).
2. P95 latency exceeds baseline by $> 5.0\text{ ms}$ on any public endpoint.
3. Any single query execution time $> 50.0\text{ ms}$.
4. PostgreSQL connection pool utilization $> 75\%$ for more than 30 seconds.
5. In-flight memory growth $> 25\text{ MB}$ within 15 minutes.

### 2.3 Operator Execution Steps (Tier 1)

#### Option A: Programmatic Execution via Admin API (Fastest)
```bash
curl -X POST "https://<render-service-url>/api/admin/canary/disarm" \
  -H "Authorization: Bearer <ADMIN_SECRET_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "LATENCY_SPIKE_EXCEEDED_50MS",
    "operator": "lead_engineer",
    "notes": "P95 exceeded 5ms budget on /api/predictions/feed"
  }'
```

*Expected JSON Response:*
```json
{
  "status": "SUCCESS",
  "disarmed": true,
  "disarmDurationMs": 0.082,
  "activeEngine": "SQLITE",
  "canaryPercentage": 0,
  "disarmedAt": "2026-09-11T18:30:00.000Z",
  "reason": "LATENCY_SPIKE_EXCEEDED_50MS"
}
```

#### Option B: Environment Variable Disarm (Fallback)
If Admin API is unreachable:
1. Open Render Dashboard $\to$ Environment Variables.
2. Set `ENABLE_CANARY_CUTOVER=false`.
3. Set `CANARY_PERCENTAGE=0`.
4. Click **Save Changes** (triggers graceful zero-downtime hot-reload).

### 2.4 Post-Disarm Verification (Tier 1)
Run the following verification probe immediately after triggering soft rollback:
```bash
# 1. Probe health check
curl -s "https://<render-service-url>/health" | jq .
# Expected output:
# { "status": "UP", "database": "sqlite", "canary_active": false, "canary_pct": 0 }

# 2. Verify 10 consecutive requests return via SQLite
for i in {1..10}; do
  curl -s -i "https://<render-service-url>/api/predictions/feed" | grep "X-Data-Source: sqlite"
done
```

---

## 3. Tier 2: Hard Rollback (Comprehensive System Restoration)

### 3.1 Technical Mechanism & SLA
- **Target SLA:** $< 15\text{ minutes}$.
- **Execution Level:** Infrastructure service reconfiguration, persistent disk rollback, and outbox reconciliation.
- **Applicability:** Catastrophic data divergence, unrecoverable schema mismatch, or complete PostgreSQL cluster failure.

### 3.2 Operator Execution Steps (Tier 2)

#### Step 1: Halt Incoming Production Traffic
1. In Render Dashboard, enable the maintenance page or route incoming ingress to a static 503 Maintenance landing page.
2. Suspend Telegram bot webhook / polling worker:
   ```bash
   curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/deleteWebhook?drop_pending_updates=false"
   ```

#### Step 2: Restore Known-Good SQLite Physical Volume
1. SSH into the Render maintenance shell.
2. Verify checksum of authoritative backup created during pre-cutover:
   ```bash
   sha256sum /mnt/persistent-disk/backups/render_prod_backup_YYYYMMDD_HHMMSS.sqlite
   # Verify against EVID-02 cryptographic proof
   ```
3. Copy verified snapshot over live database:
   ```bash
   cp /mnt/persistent-disk/backups/render_prod_backup_YYYYMMDD_HHMMSS.sqlite /mnt/persistent-disk/data/database.sqlite
   ```
4. Execute SQLite structural validation:
   ```bash
   sqlite3 /mnt/persistent-disk/data/database.sqlite "PRAGMA integrity_check;"
   sqlite3 /mnt/persistent-disk/data/database.sqlite "PRAGMA foreign_key_check;"
   ```

#### Step 3: Reconcile Dual-Write Outbox Mutations
1. Extract any mutations that were recorded in the outbox during the canary window:
   ```bash
   sqlite3 /mnt/persistent-disk/data/database.sqlite \
     "SELECT event_id, aggregate_type, aggregate_id, operation, created_at FROM postgres_dual_write_outbox WHERE created_at >= '<canary_start_time>' ORDER BY created_at ASC;"
   ```
2. Replay or reconcile user signups and affiliate clicks to ensure zero customer transaction loss.

#### Step 4: Lock Configuration & Restart Service
1. In Render Dashboard, ensure the following environment variables are locked:
   - `DATABASE_ENGINE=sqlite`
   - `ENABLE_CANARY_CUTOVER=false`
   - `CANARY_PERCENTAGE=0`
   - `ENABLE_STAGING_PG_SHADOW=false`
2. Trigger manual deploy / restart of the Render web service.
3. Reactivate Telegram bot polling / webhook.

---

## 4. Root Cause Analysis (RCA) & Post-Mortem Protocol

Following any Tier 1 or Tier 2 rollback:
1. Export logs from `scratch/postgres-phase-10-shadow-reads/shadow_mismatch_ledger.jsonl`.
2. Extract connection pool metrics from PostgreSQL staging cluster.
3. Record exact timeline in `project-memory/risks.md`.
4. All further canary cutover activities remain **STRICTLY BLOCKED** until an RCA report is drafted, reviewed, and signed off by the engineering lead.
