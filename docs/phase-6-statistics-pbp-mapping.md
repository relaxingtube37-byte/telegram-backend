# Phase 6: Statistics, Sets, Games & PBP Field Mapping

## 1. Overview

This document specifies field-level transformation rules from source columns to canonical PostgreSQL target tables for **Phase 6: Statistics, Sets, Games & PBP**.

---

## 2. `statistics.match_player_statistics` Mapping

### Source → Target Field Map

| Source Column (Tier 1/2) | Target Column | Rule | NULL Policy |
| :--- | :--- | :--- | :--- |
| `w_ace` / `l_ace` | `aces` | Winner row uses `w_ace`; loser row uses `l_ace` | NULL if source is NULL |
| `w_df` / `l_df` | `double_faults` | Winner → `w_df`; loser → `l_df` | NULL if source is NULL |
| `w_svpt` / `l_svpt` | `svpt` | Winner → `w_svpt`; loser → `l_svpt` | NULL if source is NULL |
| `w_1stIn` / `l_1stIn` | `first_in` | First serve in count | NULL if source is NULL |
| `w_1stWon` / `l_1stWon` | `first_won` | Points won on first serve | NULL if source is NULL |
| `w_2ndWon` / `l_2ndWon` | `second_won` | Points won on second serve | NULL if source is NULL |
| `w_SvGms` / `l_SvGms` | `sv_gms` | Service games played | NULL if source is NULL |
| `w_bpSaved` / `l_bpSaved` | `bp_saved` | Break points saved | NULL if source is NULL |
| `w_bpFaced` / `l_bpFaced` | `bp_faced` | Break points faced | NULL if source is NULL |
| `w_first_return_won` / `l_first_return_won` | `first_return_won` | Points won returning first serve | NULL if source is NULL |
| `w_second_return_won` / `l_second_return_won` | `second_return_won` | Points won returning second serve | NULL if source is NULL |
| `w_bp_converted` / `l_bp_converted` | `bp_converted` | Break points converted | NULL if source is NULL |
| *(derived from match result)* | `bp_opportunities` | = opponent's `bp_faced` (symmetric) | NULL if `bp_faced` is NULL |
| `w_total_points_won` / `l_total_points_won` | `total_points_won` | Total points won in match | NULL if source is NULL |
| `is_placeholder_serve` | `is_placeholder_serve` | Boolean flag — TRUE if serve stats are synthetically filled | Always mapped |
| *(Phase 5 result lookup)* | `match_id` | From Phase 5 `match_results.winner_player_id` / `loser_player_id` | Required; quarantine if absent |
| *(Phase 5 participant lookup)* | `player_id` | Resolved canonical UUID from Phase 3 player registry via Phase 5 participants | Required; quarantine if absent |

### Player Row Construction

For each match with statistics:
1. **Winner row**: `player_id = winner_player_id` (from Phase 5 `match_results`), map all `w_*` columns.
2. **Loser row**: `player_id = loser_player_id`, map all `l_*` columns.
3. Both rows share the same `match_id`.

### Placeholder Serve Handling

```text
IF is_placeholder_serve = 1 (source row):
  → Set is_placeholder_serve = TRUE in output
  → Stat values (aces, df, svpt, etc.) may represent synthetic fills
  → Do NOT fabricate NULL values as 0
  → Preserve source-reported numeric values as-is with the TRUE flag
```

### Validation Constraints Applied Before Admission

```text
first_in <= svpt           (cannot serve more in than total serve points)
first_won <= first_in      (cannot win more first-serve points than first serves in)
bp_saved <= bp_faced       (cannot save more BPs than faced)
all numeric fields >= 0    (quarantine negative values)
```

---

## 3. `matches.match_sets` Mapping

### Score String Parsing

Source: `score` column in `gold_matches_validated` (format: `"6-4 3-6 7-5"` or `"7-6(3) 6-4"`)

```text
Algorithm:
1. Split score string by spaces → array of set tokens
2. For each token at index i (0-based):
   - set_number = i + 1
   - If token matches r/^(\d+)-(\d+)\((\d+)\)$/: tiebreak set
     side1_games = parseInt(group1)
     side2_games = parseInt(group2)
     tiebreak_score = group3 (loser's tiebreak points)
   - If token matches r/^(\d+)-(\d+)$/: regular set
     side1_games = parseInt(group1)
     side2_games = parseInt(group2)
     tiebreak_score = NULL
   - Else: quarantine with INVALID_SET_SCORE
3. Validate: side1_games >= 0 AND side2_games >= 0
4. Validate: set_number <= best_of
```

**Side mapping (from Phase 5 participant symmetry):**
- `side1_games` = games won by `player_id` with `side = 1` (lower UUID)
- `side2_games` = games won by `player_id` with `side = 2` (higher UUID)

**Note:** The `winner` from Phase 5 `match_results` is NOT necessarily `side = 1`. Winner identity must be derived from Phase 5 `match_results.winner_player_id`, cross-referenced to the `side` assigned in `match_participants`.

| Source Field | Target Column | Rule |
| :--- | :--- | :--- |
| Parsed token index + 1 | `set_number` | 1-indexed; must be in [1..5] |
| Parsed side1_games | `side1_games` | Games won by side 1 player; must be ≥ 0 |
| Parsed side2_games | `side2_games` | Games won by side 2 player; must be ≥ 0 |
| Tiebreak group (if present) | `tiebreak_score` | Loser's tiebreak points as TEXT; NULL if no tiebreak |
| `minutes` (match total) | `duration_seconds` | NULL — set-level duration not available from score string |

---

## 4. `matches.match_games` Mapping (from PBP bundles)

Source: `bulk-match-bundles/events/{rapid_event_id}/point_by_point.json`

PBP JSON structure:
```json
{
  "pointByPoint": [
    {
      "set": 1,
      "games": [
        {
          "game": 1,
          "score": "4-3",
          "points": [
            { "homePoint": "15", "awayPoint": "0", "pointDescription": 2, "homePointType": 1, "awayPointType": 5 }
          ]
        }
      ]
    }
  ]
}
```

| PBP Field | Target Column | Rule |
| :--- | :--- | :--- |
| `set` | `set_number` | Direct; must match a `match_sets` row |
| `game` | `game_number` | Game number within set |
| *(derived from point sequence)* | `server_player_id` | Inferred from serve point types; homePointType=1=ACE,2=WINNER infers server side |
| *(derived from last point winner)* | `winner_player_id` | Side that won the last point of the game |
| *(derived from score change)* | `is_break_of_serve` | TRUE if server lost the game |
| *(concatenated point outcomes)* | `point_sequence` | Compact string of point outcomes per game |
| *(count of deuce extensions)* | `deuce_count` | Count of times game went to deuce |

**homePointType / awayPointType mapping:**
```text
1 = ACE
2 = WINNER
3 = FORCED_ERROR
4 = DOUBLE_FAULT
5 = UNFORCED_ERROR
0 = OTHER
```

---

## 5. `matches.match_points` Mapping (from PBP bundles)

Each `points` array element within a game becomes one `match_points` row:

| PBP Field | Target Column | Rule |
| :--- | :--- | :--- |
| *(parent set)* | `set_number` | From parent set object |
| *(parent game)* | `game_number` | From parent game object |
| *(point index in game)* | `point_number` | 1-indexed within game |
| *(derived from server inference)* | `server_side` | Side 1 or 2; derived from game server inference |
| *(server's opposite)* | `receiver_side` | 3 - server_side |
| *(last point winner side)* | `point_winner_side` | Side that won this point |
| *(from pointType=ACE or serve context)* | `serve_speed_kph` | NULL — speed data not present in source bundles |
| *(not available in source)* | `rally_length` | NULL — rally length not in source |
| *(homePointType / awayPointType mapped)* | `shot_outcome` | `ACE`, `WINNER`, `FORCED_ERROR`, `DOUBLE_FAULT`, `UNFORCED_ERROR`, `OTHER` |

---

## 6. Field Provenance Schema (per stat record)

Every emitted stat field logs a `field_provenance.jsonl` record:

```json
{
  "record_id": "<match_id>:<player_id>:<field_name>",
  "match_id": "uuid",
  "player_id": "uuid",
  "field_name": "aces",
  "source_tier": 1,
  "source_name": "gold_matches_validated",
  "source_match_id": "cm_atp_2024-...",
  "raw_value": 7,
  "is_null": false,
  "is_placeholder": false
}
```

---

## 7. Quarantine Schema

```json
{
  "source_name": "gold_matches_validated",
  "source_match_id": "cm_atp_...",
  "source_row_id": 12345,
  "reason": "ORPHAN_MATCH",
  "detail": "canonical_match_id not found in Phase 5 source_match_links",
  "data_snapshot": {}
}
```
