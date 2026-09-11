# Phase 11 — Render Production PostgreSQL Provisioning Checklist (Gate P11-PRE-4)

## Overview
Gate **P11-PRE-4** validates that a dedicated, production-grade PostgreSQL cluster has been provisioned on Render with the requisite SSL enforcement, WAL level, and connection pooling capabilities before any production canary or cutover can be considered.

> [!IMPORTANT]
> This gate validates **infrastructure readiness only**. Passing this gate does **NOT** activate production PostgreSQL reads, does not enable canary routing, and does not retire SQLite. Production remains strictly `SQLITE_ONLY`.

---

## Step 1: Render Dashboard Provisioning Guide

1. Log into your Render account at [dashboard.render.com](https://dashboard.render.com).
2. In the top-right corner, click **New +** ➔ **PostgreSQL**.
3. Fill in the cluster parameters:

| Parameter | Recommended Value | Requirement |
|:----------|:------------------|:------------|
| **Name** | `telegram-backend-postgres` | Informative identifier |
| **Database** | `telegram_backend` | Production database name |
| **User** | `telegram_admin` | Dedicated cluster owner |
| **Region** | **Same region as Web Service** | Critical: Same region (e.g. Frankfurt or Oregon) minimizes RTT latency |
| **PostgreSQL Version** | **16** (or latest LTS) | Spec requires >= 15 |
| **Instance Type** | **Starter** ($7/mo) or higher | Must support dedicated continuous WAL and connection pooling |

4. Click **Create Database**.
5. Wait ~60 seconds for the database state to reach **Available**.

---

## Step 2: Retrieve Connection String

In the Render PostgreSQL dashboard page:
1. Locate the **Connections** section.
2. If testing locally: copy the **External Database URL**.
   - Format: `postgresql://telegram_admin:[PASSWORD]@dpg-xxxxxx-a.[region]-postgres.render.com/telegram_backend`
3. If running inside Render container: copy the **Internal Database URL**.

> [!CAUTION]
> **Secret Hygiene:** Never commit connection strings, passwords, or credentials to git repositories, markdown files, or task logs.

---

## Step 3: Run the Provisioning Validator

Open your PowerShell terminal and execute:

```powershell
# Set connection string in current session memory only (never saved to disk)
$env:RENDER_PG_CONNECTION_STRING = "postgresql://telegram_admin:[PASSWORD]@dpg-xxxxxx-a.render.com/telegram_backend"

# Run the non-mutating validation probe
npx tsx scripts/verify-render-pg-provisioning.ts
```

### What the Script Checks:
- **SSL Handshake:** Confirms `SHOW ssl;` is active and enforced.
- **Engine Version:** Confirms `version()` is PostgreSQL 15+.
- **WAL Configuration:** Confirms `SHOW wal_level;` is active (`replica` or `logical`).
- **Connection Capacity:** Confirms `SHOW max_connections;` meets concurrency budget.
- **RTT Latency:** Measures round-trip ping time (`SELECT 1;`).
- **DDL/DML Scratch Isolation:** Executes a temporary scratch table probe (`BEGIN; CREATE TEMP TABLE ...; DROP TABLE ...; COMMIT;`) to verify transactional capability without modifying any production tables.

---

## Step 4: Verify Evidence & Readiness Dashboard

After running the probe, the official evidence file will be created at:
[`docs/evidence/render-pg-provisioning-report.json`](file:///G:/telegram-backend/docs/evidence/render-pg-provisioning-report.json)

Then re-evaluate the Phase 11 readiness scorecard:
```powershell
npx tsx scripts/verify-phase-11-production-readiness.ts
```

Upon successful validation, **P11-PRE-4** transitions from `PENDING_HUMAN_ACTION` to **`PASS`**, elevating overall system readiness to **80% (12/15 PASS)**.

---

## Governance Rules Maintained
- Production reads remain strictly `SQLITE_ONLY`.
- Zero mutations to existing production SQLite data.
- Zero production canary traffic.
- Zero credentials stored in repository or project memory.
