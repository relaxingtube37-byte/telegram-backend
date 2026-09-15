# TennisMyLife Candidate Review Pass: Engineering & Audit Specification

## 1. Executive Summary & Objective

This document defines the formal engineering specification, accounting principles, validation rules, and quality gates for the **TennisMyLife Candidate Review Pass**. 

Following the completion of the Read-Only Comparison Dry-Run, this review pass performs a rigorous, deterministic candidate assessment across:
- **1,459 unique source players** (`source_player_id`)
- **791 unique canonical players matched** against the Phase 3 registry
- **669 unresolved unique players** isolated in quarantine
- **1,678 new-match candidates** staged for future canonical fixture expansion
- **186 fill-null service telemetry candidates** evaluated for non-destructive enrichment
- **917 field-level statistic conflicts** audited and isolated without mutating canonical data
- **13,263 total source match rows** partitioned into an exhaustive, mutually exclusive ledger

---

## 2. Hard Invariants & Safety Constraints

The review pass operates under strict fail-closed constraints:

1. **100% Read-Only Offline Execution:** Zero PostgreSQL database connections, zero TCP sockets opened to external services.
2. **Zero SQLite Mutation:** Pre- and post-execution SHA-256 digests and file sizes of `data/database.sqlite` (544,415,744 bytes) and `tennis_gold.sqlite` (283,303,936 bytes) must maintain an exact $\Delta = 0$ byte delta.
3. **Upstream Artifact Immutability:** Upstream Phase 3 (`identity_players.jsonl`), Phase 5 (`matches.jsonl`), and Phase 6 (`match_player_statistics.jsonl`) artifacts must remain bit-for-bit invariant.
4. **Exhaustive Exclusive Accounting:** Every source match row ($13,263$) must be assigned **exactly one** final disposition. Zero silent row loss, zero unassigned rows, zero duplicate assignments.
5. **Non-Destructive Telemetry Quarantine:** Under no circumstances may divergent TennisMyLife telemetry overwrite existing Phase 6 canonical statistics. All 917 prioritized conflicts are routed to immutable audit logs.
6. **Physical Invariant Enforcement:** Fill-null candidates are admitted if and only if they satisfy non-negativity and physical game constraints ($svpt \ge first\_in \ge first\_won$, $bp\_faced \ge bp\_saved$). Missing values are never coerced to zero.
7. **Identity Isolation:** Unresolved competitors (669 unique players) and ambiguous identities remain strictly quarantined. No speculative canonical players or aliases may be auto-created.
8. **Bitwise Cryptographic Determinism:** Executing two full passes back-to-back must produce 100% identical SHA-256 hashes across all output artifacts.

---

## 3. Data Models & Disposition Taxonomies

### 3.1 Exclusive Ledger (`exclusive-ledger.jsonl`)
Every evaluated match row is classified into one of five mutually exclusive states:

| Final Disposition | Category | Qualification Criteria | Count |
| :--- | :--- | :--- | :---: |
| **`ADMITTED_EXISTING_CANONICAL`** | ADMITTED | Matches existing Phase 5 canonical fixture with 100% winner consensus | **2,129** |
| **`CANDIDATE_NEW_MATCH`** | STAGED_CANDIDATE | Both entrants and tournament edition unambiguously canonical; match absent from Phase 5 | **1,678** |
| **`QUARANTINED_UNRESOLVED_PLAYER`** | QUARANTINE | One or both competitors outside canonical Phase 3 player registry | **3,125** |
| **`QUARANTINED_NON_SINGLES_OR_UNSUPPORTED`** | QUARANTINE | Qualifying rounds (1,342) or team events (Davis Cup, United Cup) | **2,937** |
| **`QUARANTINED_UNRESOLVED_EDITION`** | QUARANTINE | Tournament edition could not be matched to Phase 4 canonical edition layer | **3,394** |
| **Total Accounted Rows** | **ALL** | $\sum \text{Dispositions} = \text{Total Source Rows}$ | **13,263** |

### 3.2 Fill-Null Telemetry Review (`fill-null-review.jsonl`)
Evaluates 186 candidate rows where Phase 6 recorded `NULL` and TennisMyLife provides non-null telemetry:
- **Disposition `ADMIT_ENRICHMENT_SAFE`:** Metric is non-negative, fits physical match constraints, and enriches missing telemetry safely.
- **Disposition `REJECT_INVARIANT_VIOLATION`:** Metric violates physical boundary rules (e.g. negative integers or $first\_won > first\_in$).

### 3.3 Stat Conflict Review (`stat-conflict-review.jsonl`)
Evaluates 917 prioritized field-level discrepancies where Phase 6 and TennisMyLife report divergent values:
- **Divergence Tiers:**
  - `HIGH_DIVERGENCE_COUNTING`: $10 \le \text{diff} < 20$ points/games (471 rows).
  - `SUBSTANTIAL_DIVERGENCE`: $20 \le \text{diff} < 50$ points/games (386 rows).
  - `EXTREME_DIVERGENCE`: $\text{diff} \ge 50$ points/games (60 rows).
- **Disposition `MAINTAIN_PHASE6_ISOLATE_TML`:** Phase 6 canonical values remain authoritative and unchanged; TennisMyLife values are logged for researcher audit.

### 3.4 Match Candidate Review (`match-candidate-review.jsonl`)
Evaluates 1,678 new-match candidates where both competitors and tournament editions are verified:
- **Quality Tiers:**
  - `TIER_1_TOUR_MAIN_DRAW`: ATP (825) and WTA (547) tour fixtures (1,372 rows). Prime candidates for Phase 5 expansion.
  - `TIER_2_CHALLENGER_CANONICAL`: Top-tier canonical players competing in Challenger draws (211 rows).
  - `TIER_3_ONGOING_CANDIDATE`: Ongoing live tournament fixtures (95 rows).
- **Disposition `STAGED_FOR_FUTURE_CANONICAL_EXPANSION`:** Preserved with symmetric low/high player ordering and full provenance tags.

---

## 4. Quality Acceptance Gates

| Gate ID | Condition & Rule | Pass Threshold |
| :--- | :--- | :---: |
| **QG1** | **Exhaustive Row Disposition** | Exactly 13,263 rows accounted for in `exclusive-ledger.jsonl` |
| **QG2** | **Fill-Null Accounting** | Exactly 186 candidates audited in `fill-null-review.jsonl` |
| **QG3** | **Stat Conflict Accounting** | Exactly 917 prioritized conflicts audited in `stat-conflict-review.jsonl` |
| **QG4** | **Match Candidate Accounting** | Exactly 1,678 new match candidates audited in `match-candidate-review.jsonl` |
| **QG5** | **Zero Silent Row Loss** | Total volume = Admitted + Candidates + Quarantined ($13,263$) |
| **QG6** | **NULL Preservation** | Zero missing values coerced to zero |
| **QG7** | **Zero Ambiguous Autolinks** | Sibling homonyms and unverified players quarantined |
| **QG8** | **Zero PostgreSQL Connection** | 0 connection attempts; 100% offline |
| **QG9** | **SQLite Immutability** | 0 byte delta on `database.sqlite` and `tennis_gold.sqlite` |
| **QG10** | **Upstream File Invariance** | Phase 3, 5, and 6 outputs bit-for-bit unchanged |
| **QG11** | **Bitwise Determinism** | 100% identical SHA-256 hashes across Pass 1 and Pass 2 |

Final verdict must evaluate to **PASS**.
