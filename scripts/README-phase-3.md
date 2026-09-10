# Phase 3 Ingestion Pipeline: Matches, Symmetric Participants & Results Tooling

**Branch:** `staging/phase-1-ingestion-spec`  
**Execution Environment:** OFFLINE / READ-ONLY SQLITE  
**Target PostgreSQL Entities:**  
- `matches.matches` (in `postgresSchemaV1.sql`)  
- `matches.match_participants` (in `postgresSchemaV1.sql`)  
- `matches.match_results` (in `postgresSchemaV1.sql`)  
**Parent Dependencies:**  
- Frozen Phase 1 Identity Registries (`commit 19660b1`): `identity.players` (1,765) & `identity.player_aliases` (2,833)  
- Frozen Phase 2 Tournament Editions (`commit 720efb8`): `competition.tournament_editions` (3,466)  

---

## 1. Overview & Purpose

The `scripts/dry-run-phase-3-matches.cjs` script provides an offline, read-only extraction and validation pipeline for populating matches, symmetric participant pairings, and official post-match results across the 2021 through 2026 professional tennis seasons.

### Core Objectives:
1. **Deterministic Parent & Player Resolution:** Every emitted match resolves to a verified Phase 2 `edition_id` and exactly two canonical Phase 1 `player_id` UUIDs.
2. **Symmetric Participant Structure:** In `matches.matches`, `player1_id < player2_id` is strictly enforced. Entrant rows in `matches.match_participants` (`side = 1` and `side = 2`) contain **zero winner leakage** (`is_winner` strictly `NULL`).
3. **Segregated Outcome Settlement:** Official outcomes belong strictly in `matches.match_results`. Result rows exist only when post-match evidence is complete and verified.
4. **Comprehensive Status Handling:** Classifies `'FINISHED'`, `'RETIRED'`, `'WALKOVER'`, `'DEFAULT'`, `'CANCELLED'`, and `'ABANDONED'` matches.
5. **Zero Fabrication:** If `actual_start_utc`, `duration_minutes`, or `retirement_detail` are missing, they remain authentic `NULL` values. If exact time of day is absent, `scheduled_start_utc` anchors to the verified match date at midnight UTC (`00:00:00.000Z`) per standard SQL `DATE -> TIMESTAMPTZ` semantics.
6. **Conflict & Quarantine Isolation:** Unresolvable records, qualifications, exhibitions, doubles, and conflicting draws are routed to `phase-3-match-conflicts.jsonl`.
7. **Deterministic UUIDv5 Primary Keys:** Generates reproducible `match_id` identifiers via RFC 4122 UUIDv5 (`NAMESPACE_MATCHES`).

---

## 2. Safety Invariants & Guardrails

| Invariant | Implementation Mechanism |
| :--- | :--- |
| **Fail-Closed Execution** | Halts immediately with exit code `1` if `--dry-run` is omitted. |
| **Read-Only SQLite Connections** | All database connections are opened with `{ readonly: true, fileMustExist: true }`. |
| **Zero Database Writes** | Never executes `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `VACUUM`, or PRAGMA writes. |
| **Zero Remote Connections** | 100% offline. Zero network connections to any PostgreSQL or cloud instance. |
| **Integrity Audit** | Verifies SQLite database file byte sizes before and after execution (Gate G9). |

---

## 3. Usage & CLI Commands

### Standard Dry-Run Execution:
```bash
node scripts/dry-run-phase-3-matches.cjs --dry-run
```

### Fail-Closed Demonstration:
```bash
# Omitting --dry-run will halt immediately:
node scripts/dry-run-phase-3-matches.cjs
# Exit Code: 1
# [SECURITY VIOLATION] FAIL-CLOSED EXECUTION HALTED
```

### Custom Output Directory (Optional):
```bash
node scripts/dry-run-phase-3-matches.cjs --dry-run --out-dir scratch/custom-output
```

---

## 4. Invariant Quality Gates (G1 - G10)

* **G1: Parent Edition Resolution:** 100% of accepted matches resolve to a verified Phase 2 `edition_id`.
* **G2: Participant Cardinality & Validity:** Every match has exactly two participants resolving to Phase 1 canonical player UUIDs (exact 2:1 ratio).
* **G3: Symmetrical Player Ordering:** 100% of matches strictly satisfy `player1_id < player2_id` (`ck_matches_symmetrical_order`).
* **G4: Zero Winner Leakage:** 100% of pre-match participant rows have `is_winner IS NULL`.
* **G5: Deterministic UUIDv5 Keys:** 100% of `match_id` primary keys verified reproducible.
* **G6: Unique Fixture Invariant:** Zero duplicate fixtures across the unified multi-source dataset.
* **G7: Post-Match Result Sufficiency:** Result rows emitted only when terminal status and distinct winner/loser evidence exists.
* **G8: Comprehensive Quarantine Emitting:** 100% of unresolved or conflicting records emitted with diagnostic reasons.
* **G9: Zero SQLite Mutation Guarantee:** Source SQLite database file byte size verified identical before and after run.
* **G10: Fail-Closed Execution Guarantee:** Halts on missing `--dry-run` flag.

---

## 5. Output Artifacts Specification

The dry-run pipeline generates six artifacts in `scratch/phase-3-dry-run-output/`:

1. `phase-3-matches.jsonl`: Clean match fixture records matching `matches.matches`.
2. `phase-3-match-participants.jsonl`: Symmetrical entrant metadata records matching `matches.match_participants`.
3. `phase-3-match-results.jsonl`: Settled outcome records matching `matches.match_results`.
4. `phase-3-match-conflicts.jsonl`: Quarantined candidate records with diagnostic reasoning tags.
5. `phase-3-validation-report.json`: Machine-readable audit payload detailing gates, counts, and distributions.
6. `phase-3-validation-report.md`: Human-readable markdown audit report.

---

## 6. Schema Review & Symmetric Design Notes

* **Symmetrical Participant Design:** Tennis prediction and feature pipelines are highly susceptible to lookahead bias when matches are stored with winner/loser columns. Storing participants symmetrically (`player1_id < player2_id`) with `side = 1` and `side = 2`, while keeping `is_winner IS NULL` in the entrant layer, guarantees 100% lookahead isolation.
* **Post-Match Result Settlement:** All post-match data (winner, loser, score, duration, retirement) is strictly isolated to `matches.match_results`.
