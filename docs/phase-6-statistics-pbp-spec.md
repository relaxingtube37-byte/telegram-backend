# Phase 6: Statistics, Sets, Games & PBP Dry-Run Specification

## 1. Executive Overview & Official Milestone Status

This specification establishes the architectural, mathematical, and data integrity standards for **Phase 6: Statistics, Sets, Games & Point-by-Point (PBP) Dry-Run** within the tennis AI modeling and sports analytics platform.

### Official Pre-Execution Status
- **Phase 6 Dry-Run Status:** **PENDING** (Execution in progress)
- **Phase 5 Prerequisite:** **CLOSED** (Commit `022571f`; 11/11 gates PASS; Δ=0 reconciliation)
- **PostgreSQL Ingestion:** **NO-GO** (Draft artifacts strictly offline in scratch)
- **Production Cutover:** **NO-GO** (Cutover strictly prohibited until Phase 10 live parity)

---

## 2. Scope & Target Tables

Phase 6 populates four canonical PostgreSQL 16 tables defined in `db/postgres-schema-v1.sql`:

| Target Table | Role | Primary Key |
| :--- | :--- | :--- |
| `statistics.match_player_statistics` | Per-player box-score stats (aces, DFs, serve %, break points) | `(match_id, player_id)` |
| `matches.match_sets` | Set-level score breakdown | `(match_id, set_number)` |
| `matches.match_games` | Game-level outcome & server identity | `(match_id, set_number, game_number)` |
| `matches.match_points` | Point-level PBP telemetry | `(point_id)` BIGSERIAL |

---

## 3. Architectural Invariants

### 3.1 Foreign-Key Anchor: Phase 5 Canonical Match Set

All Phase 6 records must be anchored to **Phase 5 accepted canonical matches** via `match_id`. The 66,383 quarantined match source records must **never** contribute to Phase 6 canonical output.

```
Phase 6 linkage chain:
  source record
    ↓  via canonical_match_id or rapid_event_id
  provenance.source_match_links  (Phase 5 output)
    ↓  match_id
  matches.matches  (75,692 canonical fixtures)
    ↓
  statistics.match_player_statistics / matches.match_sets / matches.match_games / matches.match_points
```

### 3.2 NULL Preservation Policy (STRICT)

> [!IMPORTANT]
> **`missing ≠ zero` | `unknown ≠ zero` | `not recorded ≠ zero`**
>
> If a source has not recorded a statistic, the value **must remain `NULL`** in dry-run JSONL output. It must **never** be synthesized as `0`, a placeholder value, or any default.
>
> **DDL vs Policy conflict:** The canonical DDL (`statistics.match_player_statistics`) uses `NOT NULL DEFAULT 0` for numeric stat columns. This is the PostgreSQL storage contract. However, the dry-run JSONL output uses `NULL` to represent "not recorded by source." When inserting into PostgreSQL, `NULL` JSONL values will be replaced by `0` via the DDL default — this is acceptable **only if** the `is_placeholder_serve` flag is simultaneously set to `TRUE` on any row where stat columns are fabricated by default. For rows with genuine zero values (e.g., 0 aces confirmed), the value `0` is valid. The distinction must be tracked in `field_provenance.jsonl`.

### 3.3 Participant Resolution Policy

Statistics must be resolved to **canonical `player_id` UUIDs** from the Phase 3 frozen player registry. Winner/loser are resolved from the Phase 5 `matches.match_results` output — **not** by re-reading raw player names from source. If a `player_id` cannot be resolved to a confirmed Phase 5 participant for the referenced match, the row is quarantined.

### 3.4 Score String Parsing for Set Breakdown

Set scores are parsed from the `score` column of `gold_matches_validated` (format: `"6-4 3-6 7-5"`). Each space-separated token becomes one `match_sets` row:
```
"6-4 3-6 7-5" → set_number=1 side1_games=6 side2_games=4
                → set_number=2 side1_games=3 side2_games=6
                → set_number=3 side1_games=7 side2_games=5
```
Side 1 = `player_id_low` (Phase 5 symmetry: smaller UUID = side 1). Side 2 = `player_id_high`.

Tiebreak notation (e.g., `"7-6(3)"`) → `tiebreak_score = "3"` (loser's tiebreak points).

---

## 4. Source Stream Hierarchy (Tiers)

| Tier | Source | Role | Linkage | Count |
| :---: | :--- | :--- | :--- | :---: |
| **Tier 1** | `gold_matches_validated` (gold SQLite) | Primary box stats + score string + PBP bundle path | Direct `canonical_match_id` field | 58,131 |
| **Tier 2** | `canonical_matches` / `historical_matches` (backend SQLite) | Extended Sackmann-sourced stats (115,223 rows with stats) | Via `provenance.source_match_links` → `source_match_id` | 115,223 |
| **Tier 3** | `bulk-match-bundles/events/{rapid_event_id}/point_by_point.json` | PBP set/game/point hierarchy | Via Tier 1 `rapid_event_id` + `bundle_storage_path` | 600 events |

**Precedence:** Tier 1 wins on any field conflict. Tier 2 enriches fields missing from Tier 1. Tier 3 is the exclusive source for `match_games` and `match_points`.

---

## 5. DDL Schema — Final Authoritative Naming

All naming is resolved from `db/postgres-schema-v1.sql`. There is no `analytics.matchpbpmetrics` table — that name appeared in earlier drafts and is **superseded**:

```sql
matches.match_sets     PRIMARY KEY (match_id, set_number)
matches.match_games    PRIMARY KEY (match_id, set_number, game_number)
matches.match_points   PRIMARY KEY point_id BIGSERIAL (no natural key)
statistics.match_player_statistics  PRIMARY KEY (match_id, player_id)
```

The `pbp_metrics.jsonl` output artifact captures derived PBP analytics (rally lengths, serve speeds from point descriptions) that map to `match_points` columns: `rally_length`, `serve_speed_kph`, `shot_outcome`.

---

## 6. Conflict & Quarantine Policies

### 6.1 Quarantine Reasons
- `ORPHAN_MATCH`: Statistics source record cannot be linked to any Phase 5 canonical `match_id`.
- `QUARANTINED_MATCH_EXCLUDED`: Source record's match is in Phase 5 `quarantine.jsonl`.
- `UNRESOLVED_PLAYER`: `player_id` cannot be resolved from Phase 5 participants.
- `INVALID_SET_SCORE`: Parsed set score contains negative games, impossible scores, or inconsistent count vs. match result.
- `DUPLICATE_STATS`: Two source records provide conflicting statistics for the same `(match_id, player_id)`.
- `IMPOSSIBLE_STAT`: Individual stat value violates constraint (e.g., `first_won > first_in`, `bp_saved > bp_faced`).
- `SET_GAME_COUNT_MISMATCH`: Number of parsed sets is inconsistent with `best_of` or match result.
- `ORPHAN_GAME`: Game record references a `(match_id, set_number)` not present in `match_sets` output.
- `MISSING_PARENT_MATCH`: Game or point references a `match_id` not in Phase 5 canonical match set.

### 6.2 Conflict Classification
- `STAT_VALUE_CONFLICT`: Tier 1 and Tier 2 report different non-null values for the same stat field.
- `SET_SCORE_CONFLICT`: Two sources report different set-level scores for the same match.

---

## 7. Fifteen Quality Acceptance Gates (G1–G15)

| Gate | Name | Pass Condition |
| :--- | :--- | :--- |
| **G1** | Parent Match Resolution | 100% of canonical stat rows link to a Phase 5 `match_id` (0 orphans). |
| **G2** | Quarantined Match Exclusion | 0 statistics rows for any match in Phase 5 `quarantine.jsonl`. |
| **G3** | Player Stats Per Match ≤ 2 | Every match has at most 2 `match_player_statistics` rows. |
| **G4** | Player Participant Membership | Every `player_id` in stats exists in the Phase 5 `match_participants` for that match. |
| **G5** | Valid Set Numbers | All `set_number` values are in range `[1..5]`; no set_number = 0 or > best_of. |
| **G6** | Set Score vs Match Result Coherence | Total sets won by winner > total sets won by loser (where result is known). |
| **G7** | Non-Negative Set Games | 0 rows with `side1_games < 0` or `side2_games < 0`. |
| **G8** | match_sets Natural Key Uniqueness | `(match_id, set_number)` is unique across all emitted set rows. |
| **G9** | No Orphan Games | Every `match_games` row has a parent `(match_id, set_number)` in `match_sets` output. |
| **G10** | PBP Match Resolution | All PBP game/point rows resolve to a Phase 5 canonical `match_id`. |
| **G11** | NULL Preservation | 0 rows where a genuinely unrecorded stat has been fabricated as `0` without `is_placeholder_serve = TRUE`. |
| **G12** | Field Provenance Coverage | Every non-null stat field has a `field_provenance` record tracing source, source_match_id, and tier. |
| **G13** | Deterministic Reproducibility | Identical UUIDs, counts, and SHA-256 hashes across two dry-run executions. |
| **G14** | Zero Database Mutation | SQLite size and SHA-256 invariant (0 bytes delta). 0 PostgreSQL connections. |
| **G15** | Baseline Reconciliation Closure | `admitted_stat_rows + quarantined_stat_rows = total_source_stat_rows`; Δ = 0. |

---

## 8. Safety & Compliance Mandates

1. **Read-Only SQLite**: All connections must use `{ readonly: true, fileMustExist: true }`.
2. **No PostgreSQL**: Zero connections or write queries permitted.
3. **Fail-Closed**: Script exits with code 1 if `--dry-run` is not passed.
4. **No Runtime Drift**: Zero modifications to `src/` or `server/`.
5. **NULL Policy**: Unrecorded statistics remain `NULL` in JSONL output.
6. **Phase 5 Dependency**: Must load frozen Phase 5 output artifacts from `scratch/phase-5-matches-outcomes-output/`.
7. **Memory Integrity**: `project-memory/MEMORY.md` updated with findings and kept strictly unstaged.

---

## 9. Safety Declaration

> [!IMPORTANT]
> Schema validated on local/staging PostgreSQL specifications only; production runtime unchanged; SQLite untouched; cutover prohibited until Phase 10 parity.
> این فاز contract parity را ثابت می‌کند، نه production read parity را. production parity طبق برنامه در Phase 10 و با canary comparator سنجیده می‌شود.
> قبولی 15/15 به معنی آمادگی برای ادامه‌ی فاز بعدی است، نه مجوز cutover.
