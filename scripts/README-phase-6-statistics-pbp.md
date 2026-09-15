# Phase 6: Statistics, Sets, Games & PBP — Runner README

## Overview

`dry-run-phase-6-statistics-pbp.cjs` is the Phase 6 offline dry-run runner for the tennis AI migration pipeline. It extracts and validates player box statistics, set-score breakdowns, game-level outcomes, and point-by-point telemetry from three source tiers, linking all records to the 75,692 Phase 5 canonical matches.

**This runner is 100% read-only and offline. It writes nothing to PostgreSQL, SQLite, or production systems.**

---

## Prerequisites

| Requirement | Detail |
| :--- | :--- |
| Node.js | v18+ |
| `better-sqlite3` | Installed (`npm install`) |
| Phase 5 output | `scratch/phase-5-matches-outcomes-output/` must be complete |
| Gold SQLite | `G:/state football/data/tennis_gold.sqlite` (read-only) |
| Backend SQLite | `data/database.sqlite` (read-only) |
| PBP bundles | `G:/state football/data/bulk-match-bundles/events/` |

---

## Usage

```bash
# Standard dry-run (required --dry-run flag)
node scripts/dry-run-phase-6-statistics-pbp.cjs --dry-run

# Custom output directory
node scripts/dry-run-phase-6-statistics-pbp.cjs --dry-run --out-dir ./scratch/phase-6-custom-output
```

The script **fails immediately** (exit code 1) if `--dry-run` is not provided.

---

## Output Files

All output written to `scratch/phase-6-statistics-pbp-output/` (or `--out-dir`):

| File | Contents |
| :--- | :--- |
| `match_player_statistics.jsonl` | Per-player box stats per match (aces, DFs, serve%, BP) |
| `match_sets.jsonl` | Set-level game scores parsed from score strings |
| `match_games.jsonl` | Game-level PBP outcomes (server, winner, break) |
| `match_points.jsonl` | Point-level PBP telemetry (server side, shot outcome) |
| `pbp_metrics.jsonl` | Reserved — derived PBP metrics (currently empty) |
| `field_provenance.jsonl` | Field-level source tracing for every non-null stat |
| `conflicts.jsonl` | Stat conflicts between sources |
| `quarantine.jsonl` | All excluded rows with reason codes |
| `validation-report.json` | Machine-readable gate results |
| `validation-report.md` | Human-readable gate results |
| `manifest.json` | SHA-256 checksums for all output files |

---

## Source Tiers

| Tier | Source | Role |
| :---: | :--- | :--- |
| 1 | `gold_matches_validated` (gold SQLite) | Primary box stats + set scores via `canonical_match_id` |
| 2 | `canonical_matches` (backend SQLite) | Sackmann stats — enriches NULL fields only (no overwrite) |
| 3 | `bulk-match-bundles/events/*/point_by_point.json` | PBP set/game/point hierarchy |

---

## Quality Gates (G1–G15)

| Gate | Pass Condition |
| :--- | :--- |
| G1 | 100% of stat rows link to a Phase 5 canonical `match_id` |
| G2 | 0 stat rows for Phase 5 quarantined matches |
| G3 | ≤ 2 player statistics rows per match |
| G4 | Every `player_id` in stats is a Phase 5 participant for that match |
| G5 | All `set_number` values in [1..5] and ≤ `best_of` |
| G6 | Winner wins more sets than loser (where result is known) |
| G7 | 0 rows with negative game counts |
| G8 | `(match_id, set_number)` uniqueness in `match_sets` |
| G9 | 0 orphan game rows (parent set must exist) |
| G10 | All PBP game/point rows resolve to a Phase 5 `match_id` |
| G11 | 0 rows with genuinely unrecorded stats fabricated as zero |
| G12 | Every non-null stat field has a field_provenance record |
| G13 | All output `match_id` values are valid Phase 5 UUIDs |
| G14 | SQLite size and SHA-256 invariant (0 bytes delta) |
| G15 | `admitted + quarantined = total_source_rows` (Δ = 0) |

---

## NULL Policy

> **`missing ≠ zero` | `unknown ≠ zero` | `not recorded ≠ zero`**

- Unrecorded stats are output as `null` in JSONL, never as `0`.
- Rows with `is_placeholder_serve = true` contain serve stats that may be synthetic fills per source data — the flag marks this explicitly.
- When ingested to PostgreSQL, `null` JSONL fields will adopt the DDL `DEFAULT 0` only if `is_placeholder_serve = TRUE` marks the fill as synthetic.

---

## Safety Guarantees

- Zero PostgreSQL connections or queries.
- All SQLite connections: `{ readonly: true, fileMustExist: true }`.
- Exit code 1 if `--dry-run` flag missing.
- Exit code 1 if any quality gate fails.
- SHA-256 hash verified on both SQLite files before and after execution.
- Zero modifications to `src/`, `server/`, or any production file.

---

## Quarantine Reason Codes

| Code | Meaning |
| :--- | :--- |
| `ORPHAN_MATCH` | Source row cannot be linked to any Phase 5 canonical match |
| `QUARANTINED_MATCH_EXCLUDED` | Match is in Phase 5 quarantine — stats excluded |
| `UNRESOLVED_PLAYER` | Player cannot be resolved to a Phase 5 participant |
| `INVALID_SET_SCORE` | Set score string unparseable or contains invalid values |
| `SET_GAME_COUNT_MISMATCH` | Set count inconsistent with `best_of` |
| `IMPOSSIBLE_STAT` | Stat value violates logical constraint (e.g. `first_won > first_in`) |
| `INVALID_BUNDLE` | PBP bundle JSON is corrupt or unreadable |
| `ORPHAN_GAME` | Game references a set not present in `match_sets` output |
