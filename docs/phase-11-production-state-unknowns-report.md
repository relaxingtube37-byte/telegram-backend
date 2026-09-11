# Phase 11: Production State Unknowns & Live Render Delta Report
## Forensic Analysis of Live Production Asymmetry (RISK-1)

> **Specification Reference:** [phase-11-canary-cutover-spec.md](file:///g:/telegram-backend/docs/phase-11-canary-cutover-spec.md)  
> **Governance Status:** `DRAFTED_FOR_REVIEW`  
> **Pre-Cutover Authorization Status:** `NOT_GRANTED`  
> **Production Status:** `SQLITE_ONLY` (Strictly Enforced)  
> **Authoritative Baseline Reference:** [source_baseline_manifest_v1.json](file:///g:/telegram-backend/docs/source_baseline_manifest_v1.json)  
> **Authoritative Date:** `2026-09-11`

---

## 1. Executive Summary & Purpose

This report provides a forensic evaluation of the **known versus unknown states** in the live production environment hosted on Render. 

Under the target migration architecture:
* The authoritative Desktop Gold database (`tennis_gold.sqlite`, 283,303,936 bytes, SHA-256 `2951176b...`) is an immutable, read-only telemetry archive.
* The local primary development database (`data/database.sqlite`, 545,472,512 bytes) serves as the developer baseline.
* The live production database deployed on Render persistent disk storage (`data/database.sqlite`) represents an active transactional store that has diverged over time through user interactions.

> [!WARNING]
> **ARCHITECTURAL RISK CLASSIFICATION (RISK-1):**  
> Until an authoritative physical snapshot is extracted from Render and audited against the local baseline manifest, the live production database state must be treated as an **`UNKNOWN_DELTA`**.  
> Under no circumstances may local database files be synced to production, as this would cause permanent, irrecoverable loss of real user accounts, session tokens, and referral revenue attribution.

---

## 2. Inventory of Knowns vs Unknowns by Domain

### 2.1 Domain: Identity, Authentication & User Management
| Table Name | Local Baseline State | Live Render Production State | Delta / Asymmetry Risk | Remediation Action |
| :--- | :--- | :--- | :--- | :--- |
| **`users`** | Seeded developer accounts & test users | Live Telegram bot users, verified members, Google OAuth logins | **HIGH:** Real user profiles, verification timestamps, and auth tokens | Point-in-time export; merge into staging PostgreSQL via ID crosswalk |

### 2.2 Domain: Affiliation, Clicks & Monetization
| Table Name | Local Baseline State | Live Render Production State | Delta / Asymmetry Risk | Remediation Action |
| :--- | :--- | :--- | :--- | :--- |
| **`referral_sites`** | Standard catalog of partner bookmakers | Configured partner URLs, active flags | **MEDIUM:** Potential live partner key or commission updates | Selective diffing; live Render values take precedence |
| **`referral_clicks`** | Test click events from development | Real user click IDs, affiliate partner keys, IP session hashes | **CRITICAL:** Real affiliate commission attribution | Append-only migration forward; zero deletion or overwrite |
| **`partner_conversions`**| Sample conversion callbacks | Live postback conversion receipts from affiliate networks | **CRITICAL:** Financial conversion and CPA records | Append-only ingestion into PostgreSQL `billing.conversions` |

### 2.3 Domain: AI Predictions & Editorial Settlement
| Table Name | Local Baseline State | Live Render Production State | Delta / Asymmetry Risk | Remediation Action |
| :--- | :--- | :--- | :--- | :--- |
| **`predictions`** | 1,444 local prediction runs | Live match predictions, auto-settled scores, channel message IDs | **HIGH:** Real-time settlement status (`WON`/`LOST`/`VOID`), channel IDs | Freshness window reconciliation; live status overrides local |
| **`settings`** | Default developer settings | Live `access_mode`, Telegram bot operational flags | **MEDIUM:** Live gate settings (e.g. `access_mode = 'verified_only'`) | Snapshot audit; live production settings preserved |

### 2.4 Domain: Dual-Write Outbox & Replication State
| Table Name | Local Baseline State | Live Render Production State | Delta / Asymmetry Risk | Remediation Action |
| :--- | :--- | :--- | :--- | :--- |
| **`postgres_dual_write_outbox`** | Staging test events (watermark `none`) | Production outbox events queued on persistent disk | **HIGH:** Any events queued during production operation | Mandatory zero-lag drain verification prior to cutover |

---

## 3. Forensic Snapshot Protocol (The Extraction Procedure)

To eliminate the `UNKNOWN_DELTA` status, the following operational runbook must be executed during an approved maintenance window:

```
                  RENDER PRODUCTION CLUSTER
                              │
               1. VACUUM INTO '/mnt/backups/...'
                              ▼
        ┌───────────────────────────────────────────┐
        │ render_prod_backup_YYYYMMDD_HHMMSS.sqlite │
        └─────────────────────┬─────────────────────┘
                              │
               2. Compute SHA-256 & Row Counts
                              ▼
        ┌───────────────────────────────────────────┐
        │  Live Render Evidence Bundle Artifact     │
        │  (render_live_evidence_bundle.json)       │
        └─────────────────────┬─────────────────────┘
                              │
               3. Forensic Comparison Script
                              ▼
        ┌───────────────────────────────────────────┐
        │  Reconciliation & Conflict Manifest       │
        │  - Classified New Entities (Users/Clicks) │
        │  - Certified 0 Overwrites of Live Data    │
        └─────────────────────┬─────────────────────┘
                              │
               4. Human Sign-Off (Decision 42)
```

---

## 4. Safety Constraints & Invariant Prohibitions

1. **Directional Flow Invariant:** All data synchronization flows **strictly from Live Render $\to$ Staging PostgreSQL**. Zero local developer records may be pushed to production.
2. **Read Immutability:** Until all pre-cutover evidence items (EVID-01 through EVID-11) are satisfied and signed off, production traffic remains 100% hardcoded to `SQLITE_ONLY`.
3. **No Direct Production Cutover:** Completion of this report does not grant production cutover authorization. Pre-cutover authorization remains **`NOT_GRANTED`**.
