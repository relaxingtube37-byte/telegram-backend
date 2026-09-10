# Phase 4 Ingestion Pipeline: Stats, Sets & PBP Telemetry Tooling

**Branch:** `staging/phase-1-ingestion-spec`  
**Execution Environment:** OFFLINE / READ-ONLY SQLITE  
**Target PostgreSQL Entities:**  
- `statistics.match_player_statistics` (in `postgresSchemaV1.sql`)  
- `matches.match_sets` (in `postgresSchemaV1.sql`)  
- `matches.match_games` (in `postgresSchemaV1.sql`)  
- `matches.match_points` (Formally deferred per `postgresSchemaV1.sql` policy)  
**Parent Dependencies:**  
- Frozen Phase 1 Identity Registries: `identity.players` & `identity.player_aliases` (`commit 19660b1`)  
- Frozen Phase 2 Tournament Editions: `competition.tournament_editions` (`commit 720efb8`)  
- Frozen Phase 3 Matches, Participants & Results: `matches.matches`, `matches.match_participants`, `matches.match_results` (`commit 9b2e461`)  

---

## 1. Overview & Purpose

The `scripts/dry-run-phase-4-stats-pbp.cjs` script provides an offline, read-only extraction and validation pipeline for populating detailed match telemetry (box scores, set breakdowns, and game-level sequences) across the 2021 through 2026 professional tennis seasons.

### Core Objectives:
1. **Symmetric Box Scores:** Populates `statistics.match_player_statistics` with aces, double faults, service points, return metrics, and break point conversions strictly mapped to `side = 1` and `side = 2`. Zero winner/loser target semantics.
2. **Formal Set Breakdowns:** Populates `matches.match_sets` with games won by Side 1 and Side 2, tiebreak scores, and authentic recorded set durations (`duration_seconds`).
3. **Game Progressions:** Decompresses `game_sequence_json` from `gold_match_pbp_analytics` to populate `matches.match_games` with game numbers, server side, winner side, break indicators, and deuce counts.
4. **Point-Level Deferral:** Formally defers `matches.match_points` from relational emission to prevent 35M+ row relational bloat, adhering to the canonical decision in `postgresSchemaV1.sql` (lines 446–448), while preserving raw JSON point streams in storage.
5. **Zero Fabrication:** Missing set durations or unrecorded telemetry fields remain authentic `NULL` values. Legacy placeholder serve stats are explicitly flagged via `is_placeholder_serve = TRUE`.
6. **Desktop vs Backend Drift Resolution:** Resolves schema drift by using `tennis_gold.sqlite` as authoritative for set duration and game progression, while maintaining `database.sqlite` as the cross-source linkage backbone.

---

## 2. Safety Invariants & Guardrails

| Invariant | Implementation Mechanism |
| :--- | :--- |
| **Fail-Closed Execution** | Halts immediately with exit code `1` if `--dry-run` is omitted. |
| **Read-Only SQLite Connections** | All database connections opened with `{ readonly: true, fileMustExist: true }`. |
| **Zero Database Writes** | Never executes `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `VACUUM`, or PRAGMA writes. |
| **Zero Remote Connections** | 100% offline. Zero network connections to any PostgreSQL or cloud instance. |
| **Integrity Audit** | Verifies SQLite database file byte sizes before and after execution (Gate G9). |

---

## 3. Usage & CLI Commands

### Standard Dry-Run Execution:
```bash
node scripts/dry-run-phase-4-stats-pbp.cjs --dry-run
```

### Fail-Closed Demonstration:
```bash
# Omitting --dry-run will halt immediately:
node scripts/dry-run-phase-4-stats-pbp.cjs
# Exit Code: 1
# [SECURITY VIOLATION] FAIL-CLOSED EXECUTION HALTED
```

### Custom Output Directory (Optional):
```bash
node scripts/dry-run-phase-4-stats-pbp.cjs --dry-run --out-dir scratch/custom-output
```

---

## 4. Invariant Quality Gates (G1 - G10)

* **G1: Parent Match Resolution:** 100% of emitted statistics and set rows resolve to an accepted Phase 3 `match_id`.
* **G2: Participant Player Validity:** 100% of statistics rows resolve to a valid Phase 3 participant `player_id`.
* **G3: Symmetrical Statistics Invariant:** Zero statistics rows contain winner/loser target semantics; side is strictly `1` or `2`.
* **G4: Set Sequence & Non-Negative Games:** `set_number` between 1 and 5, unique per match, with non-negative game scores (`side1_games >= 0`, `side2_games >= 0`).
* **G5: Symmetric Set Remapping:** Side 1 and Side 2 games mapped consistently with Phase 3 participant ordering.
* **G6: Game Progression Validity:** All `matches.match_games` rows have valid `server_side` (1 or 2), `winner_side` (1 or 2), and `game_number >= 1`.
* **G7: Zero Fabrication Guarantee:** Unrecorded set durations remain authentic `NULL`s; placeholder serve stats explicitly flagged.
* **G8: Comprehensive Quarantine Emitting:** 100% of unresolvable or corrupted telemetry records emitted with diagnostic reasons.
* **G9: Zero SQLite Mutation Guarantee:** Source SQLite database file byte sizes verified bit-for-bit identical before and after run.
* **G10: Fail-Closed Execution Guarantee:** Halts on missing `--dry-run` flag.

---

## 5. Output Artifacts Specification

The dry-run pipeline generates seven artifacts in `scratch/phase-4-dry-run-output/`:

1. `phase-4-match-player-statistics.jsonl`: Symmetrical box score rows matching `statistics.match_player_statistics`.
2. `phase-4-match-sets.jsonl`: Set-by-set breakdown rows matching `matches.match_sets`.
3. `phase-4-match-games.jsonl`: Game progression records matching `matches.match_games`.
4. `phase-4-match-points.jsonl`: Explicitly deferred zero-record artifact with audit documentation.
5. `phase-4-conflicts.jsonl`: Quarantined candidate records with diagnostic reasoning tags.
6. `phase-4-validation-report.json`: Machine-readable audit payload detailing gates, counts, and distributions.
7. `phase-4-validation-report.md`: Human-readable markdown audit report.
