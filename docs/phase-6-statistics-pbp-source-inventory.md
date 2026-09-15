# Phase 6: Statistics, Sets, Games & PBP Source Inventory

## 1. Executive Summary

This document details all source streams, upstream dependencies, and linkage mechanics for **Phase 6: Statistics, Sets, Games & PBP Dry-Run**.

### Official Status
- **Phase 6 Dry-Run Status:** **PENDING**
- **Phase 5 Prerequisite:** **CLOSED** (Commit `022571f`; 75,692 canonical matches; 81,554 source links)
- **PostgreSQL Ingestion:** **NO-GO**
- **Production Cutover:** **NO-GO**

---

## 2. Upstream Canonical Dependencies (from Phase 5 output)

| Artifact | Location | Count | Role |
| :--- | :--- | :---: | :--- |
| `matches.jsonl` | `scratch/phase-5-matches-outcomes-output/` | 75,692 | Frozen canonical match registry with `match_id`, `edition_id`, `best_of`, `status`, `player1_id`, `player2_id` |
| `match_results.jsonl` | `scratch/phase-5-matches-outcomes-output/` | 75,690 | Settled outcomes: `winner_player_id`, `loser_player_id`, `score_string` |
| `match_participants.jsonl` | `scratch/phase-5-matches-outcomes-output/` | 151,384 | Participant pairs with `side`, `player_id` for each match |
| `source_match_links.jsonl` | `scratch/phase-5-matches-outcomes-output/` | 81,554 | Cross-source links: `match_id` ↔ `source_match_id` per source |
| `quarantine.jsonl` | `scratch/phase-5-matches-outcomes-output/` | 66,383 | Match IDs that must be excluded from Phase 6 stats |

---

## 3. SQLite Source Stream Inventory

### Tier 1: `gold_matches_validated` (gold SQLite — primary)

| Property | Value |
| :--- | :--- |
| Database | `G:/state football/data/tennis_gold.sqlite` |
| Table | `gold_matches_validated` |
| Total rows | 58,131 |
| Rows with `canonical_match_id` | 58,131 (100%) |
| Rows with `w_ace IS NOT NULL` | ~44,000 (based on has_stats_bundle) |
| Rows with `has_stats_bundle = 1` | surveyed |
| Rows with `has_pbp_bundle = 1` | surveyed |
| Linkage | Direct `canonical_match_id` field → resolves to Phase 5 `source_match_links` |

**Available box stat columns:**
`w_ace`, `w_df`, `w_svpt`, `w_1stIn`, `w_1stWon`, `w_2ndWon`, `w_SvGms`, `w_bpSaved`, `w_bpFaced`,
`l_ace`, `l_df`, `l_svpt`, `l_1stIn`, `l_1stWon`, `l_2ndWon`, `l_SvGms`, `l_bpSaved`, `l_bpFaced`,
`w_total_points_won`, `l_total_points_won`, `w_bp_converted`, `l_bp_converted`,
`w_first_return_won`, `l_first_return_won`, `w_second_return_won`, `l_second_return_won`,
`minutes`, `is_placeholder_serve`, `score` (set scores as space-separated string)

**Linkage to PBP bundles:** `bundle_storage_path` field → `data/bulk-match-bundles/events/{rapid_event_id}/`

### Tier 2: `canonical_matches` / `historical_matches` (backend SQLite)

| Property | Value |
| :--- | :--- |
| Database | `data/database.sqlite` |
| Table A | `canonical_matches` (140,432 rows; 115,223 with `w_ace IS NOT NULL`) |
| Table B | `historical_matches` (115,223 rows; 115,223 with `w_ace IS NOT NULL`) |
| Linkage | Via `provenance.source_match_links`: `source_match_id` = `canonical_match_id` column |
| Stat columns | Same as Tier 1: `w_ace`, `w_df`, `w_svpt`, `w_1stIn`, `w_1stWon`, `w_2ndWon`, `w_SvGms`, `w_bpSaved`, `w_bpFaced`, `l_*` equivalents, `minutes` |
| Note | `canonical_matches` is superset of `historical_matches` — Tier 2A (`canonical_matches`) takes precedence over Tier 2B |

**Coverage note:** 103,507 of 115,223 Tier 2 stat rows have `w_svpt > 0` (non-zero confirmed serves). 82,029 rows have `is_placeholder_serve = 1` — these represent matches where serve stats are synthetically filled. Under Phase 6 NULL policy, `is_placeholder_serve = TRUE` rows must set `is_placeholder_serve = TRUE` in output and treat the numeric stats as approximate.

### Tier 3: PBP Bundles (bulk-match-bundles)

| Property | Value |
| :--- | :--- |
| Location | `G:/state football/data/bulk-match-bundles/events/{rapid_event_id}/` |
| Total event directories | 600 |
| Files per event | `manifest.json` + `point_by_point.json` |
| PBP JSON structure | `{ pointByPoint: [ { set: N, games: [ { game: N, score: "...", points: [...] } ] } ] }` |
| Point fields | `homePoint`, `awayPoint`, `pointDescription`, `homePointType`, `awayPointType` |
| Average games per event | ~25 (2–3 sets) to ~50+ (4–5 sets) |
| Average points per event | ~100–270 |
| Linkage | Via Tier 1 `rapid_event_id` → bundle directory path |

**Sample bundle counts (5 events):**
- Event 16868097: 2 sets, 17 games, 76 points
- Event 16868949: 3 sets, 25 games, 151 points
- Event 16901470: 4 sets, 34 games, 172 points
- Event 16901471: 5 sets, 51 games, 270 points
- Event 16901472: 4 sets, 42 games, 251 points

---

## 4. Telemetry Source: `gold_match_telemetry`

| Property | Value |
| :--- | :--- |
| Table | `gold_match_telemetry` (gold SQLite) |
| Total rows | 58,131 |
| Rows with `w_max_points_in_row IS NOT NULL` | 54,315 |
| Available columns | `w_max_points_in_row`, `l_max_points_in_row`, `w_max_games_in_row`, `l_max_games_in_row`, venue metadata, `first_to_serve_winner` |
| Role | Supplementary match-level telemetry — does NOT contain set-level score breakdown |
| Note | This table does not produce `match_sets` rows; it enriches match-level context only |

---

## 5. Source Coverage Estimates

| Output Table | Primary Source | Expected Admitted Rows | Expected Source Range |
| :--- | :--- | :--- | :--- |
| `statistics.match_player_statistics` | Tier 1 gold + Tier 2 Sackmann | 2 rows per stat-covered match | Intersect of 75,692 canonical matches × stat coverage |
| `matches.match_sets` | Tier 1 score string parsing | ~2–3 sets per match average | Intersect of 75,692 canonical × score availability |
| `matches.match_games` | Tier 3 PBP bundles | ~25 games per 600-bundle event | ≤ 600 events × ~25 games |
| `matches.match_points` | Tier 3 PBP bundles | ~150 points per 600-bundle event | ≤ 600 events × ~150 points |

---

## 6. Reconciliation Baseline

The Phase 6 reconciliation must satisfy:

```text
ASSERTION D: admitted_stat_rows + quarantined_stat_rows = total_source_stat_rows (Δ = 0)
ASSERTION E: Every admitted stat row links to one of the 75,692 Phase 5 canonical matches
ASSERTION F: 0 stat rows for any of the 66,383 Phase 5 quarantined match source records
```

These assertions extend the §4A policy from Phase 5 to the statistics domain.

---

## 7. Known Risks & Mitigations

| Risk | Mitigation |
| :--- | :--- |
| `is_placeholder_serve` stats synthesized as zeros | Flag `is_placeholder_serve = TRUE` in output; do not treat as genuine measurements |
| Set score parse ambiguity (retirement mid-set, e.g. "3-1 RET") | Quarantine rows with non-numeric set tokens; log to `quarantine.jsonl` with `INVALID_SET_SCORE` |
| PBP bundle `home/away` side mapping ambiguity | Map `home = player1_id` (lower UUID = side 1) consistently via Phase 5 participant side assignment |
| PBP bundle events not linked to Phase 5 canonical matches | Quarantine with `ORPHAN_MATCH`; do not admit to canonical tables |
| Duplicate stat rows from Tier 1 and Tier 2 | Tier 1 wins; Tier 2 fills only genuinely NULL fields; conflicts logged to `conflicts.jsonl` |
