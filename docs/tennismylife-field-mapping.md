# TennisMyLife Field Mapping & Transformation Dictionary

## 1. Executive Summary & Mapping Philosophy

This document defines the field-level transformation dictionary mapping raw **TennisMyLife (TML)** CSV attributes to canonical PostgreSQL schemas established in \`db/postgres-schema-v1.sql\`.

### 1.1 Fundamental Mapping Rules
1. **Secondary Authority:** TennisMyLife attributes serve as validation cross-checks and enrichment candidates. They never overwrite canonical consensus.
2. **Decoupled Entrant & Outcome Modeling:** Entrants are mapped symmetrically to \`matches.match_participants\` without lookahead bias (\`is_winner\` is never stored in entrant records). Outcomes are isolated exclusively to \`matches.match_results\`.
3. **The Zero-Coercion Invariant (G17 Guard):** Missing or non-applicable numeric attributes (e.g. unrecorded serve statistics) are strictly transformed to \`NULL\`. Converting unrecorded statistics to \`0\` is strictly forbidden.
4. **Physical Invariant Enforcement:** Service statistics must obey physical conservation laws before admission ($1\text{stWon} \le 1\text{stIn}$, $\text{bpSaved} \le \text{bpFaced}$, non-negative counts).

---

## 2. Complete 50-Field Mapping Dictionary

| # | TennisMyLife Field | Target Domain / Table | Candidate Target Field | Confidence | Transformation / Normalization Rules & Notes |
| :---: | :--- | :--- | :--- | :---: | :--- |
| 1 | \`tourney_id\` | \`provenance.source_match_links\` | \`external_tournament_id\` | **HIGH** | Retained as source provenance metadata. Format: \`YYYY-XXXX\`. |
| 2 | \`tourney_name\` | \`competition.tournament_editions\` | \`edition_name\` | **HIGH** | Normalized via Unicode NFD, stripped of diacritics and commercial sponsor prefixes. |
| 3 | \`surface\` | \`competition.tournament_editions\` | \`actual_surface\` | **HIGH** | Controlled enum: \`Hard\`, \`Clay\`, \`Grass\`, \`Carpet\`, \`Unknown\`. |
| 4 | \`draw_size\` | \`competition.tournament_editions\` | \`draw_size\` | **MEDIUM** | Integer sanitized between 4 and 128. Null if unrecorded. |
| 5 | \`tourney_level\` | \`competition.tournament_editions\` | \`tier\` | **HIGH** | Mapped to canonical tier enum (\`G\` $\to$ \`GRAND_SLAM\`, \`M\` $\to$ \`MASTERS_1000\`, \`A\` $\to$ \`ATP_500_250\`, \`C\` $\to$ \`CHALLENGER\`). |
| 6 | \`indoor\` | \`matches.matches\` | \`is_indoor\` | **HIGH** | Boolean mapping: \`'I'\` $\to$ \`true\`, \`'O'\` $\to$ \`false\`, blank $\to$ \`null\`. |
| 7 | \`tourney_date\` | \`matches.matches\` | \`scheduled_start_utc\` | **HIGH** | ISO \`YYYY-MM-DD\` conversion from integer \`YYYYMMDD\`. Used for date range bounding. |
| 8 | \`match_num\` | \`matches.matches\` | \`match_num\` | **MEDIUM** | Bracket sequence number. Stored as integer or \`null\`. |
| 9 | \`winner_id\` | \`provenance.field_provenance\` | \`source_player_id\` | **HIGH** | Source player identifier (ATP alphanumeric or WTA numeric). Retained for provenance cross-check. |
| 10 | \`winner_seed\` | \`matches.match_participants\` | \`seed\` | **HIGH** | Assigned to winner's participant record. Integer or \`null\`. |
| 11 | \`winner_entry\` | \`matches.match_participants\` | \`entry_status\` | **HIGH** | Entrant classification (\`WC\`, \`Q\`, \`LL\`, \`PR\`, \`SE\`, \`Alt\`). Null if direct acceptance. |
| 12 | \`winner_name\` | \`identity.players\` | \`full_name_standard\` | **HIGH** | Resolved via Phase 3 canonical player registry and alias lookup table. |
| 13 | \`winner_hand\` | \`identity.players\` | \`hand\` | **MEDIUM** | Biometric enrichment candidate: \`'R'\` $\to$ \`RIGHT\`, \`'L'\` $\to$ \`LEFT\`, \`'A'\` $\to$ \`AMBIDEXTROUS\`, else \`null\`. |
| 14 | \`winner_ht\` | \`identity.players\` | \`height_cm\` | **MEDIUM** | Biometric enrichment candidate: Integer height in centimeters. |
| 15 | \`winner_ioc\` | \`identity.players\` | \`country_ioc\` | **HIGH** | Standard 3-letter Olympic / ISO alpha-3 country code. |
| 16 | \`winner_age\` | \`matches.match_participants\` | \`age_at_match\` | **HIGH** | Precise participant age at tournament time. Float value. |
| 17 | \`winner_rank\` | \`matches.match_participants\` | \`pre_match_rank\` | **HIGH** | Historical ATP/WTA singles ranking position at match cutoff. Integer. |
| 18 | \`winner_rank_points\` | \`matches.match_participants\` | \`pre_match_rank_points\` | **HIGH** | Historical ranking points total. Integer. |
| 19 | \`loser_id\` | \`provenance.field_provenance\` | \`source_player_id\` | **HIGH** | Source player identifier for defeated competitor. |
| 20 | \`loser_seed\` | \`matches.match_participants\` | \`seed\` | **HIGH** | Assigned to loser's participant record. Integer or \`null\`. |
| 21 | \`loser_entry\` | \`matches.match_participants\` | \`entry_status\` | **HIGH** | Entrant classification for defeated competitor. |
| 22 | \`loser_name\` | \`identity.players\` | \`full_name_standard\` | **HIGH** | Resolved via Phase 3 canonical player registry and alias lookup table. |
| 23 | \`loser_hand\` | \`identity.players\` | \`hand\` | **MEDIUM** | Biometric enrichment candidate for defeated competitor. |
| 24 | \`loser_ht\` | \`identity.players\` | \`height_cm\` | **MEDIUM** | Biometric enrichment candidate for defeated competitor. |
| 25 | \`loser_ioc\` | \`identity.players\` | \`country_ioc\` | **HIGH** | Standard 3-letter country code for defeated competitor. |
| 26 | \`loser_age\` | \`matches.match_participants\` | \`age_at_match\` | **HIGH** | Precise participant age at tournament time. |
| 27 | \`loser_rank\` | \`matches.match_participants\` | \`pre_match_rank\` | **HIGH** | Historical ATP/WTA singles ranking position. |
| 28 | \`loser_rank_points\` | \`matches.match_participants\` | \`pre_match_rank_points\` | **HIGH** | Historical ranking points total. |
| 29 | \`score\` | \`matches.match_results\` | \`score_string\` | **HIGH** | Formatted score string (e.g. \`6-4 3-6 7-6(5)\`). Stripped of quotes. Walkovers (\`W/O\`) and retirements (\`RET\`) flagged. |
| 30 | \`best_of\` | \`matches.matches\` | \`best_of\` | **HIGH** | Maximum sets scheduled (3 or 5). |
| 31 | \`round\` | \`matches.matches\` | \`round_name\` | **HIGH** | Uppercase canonical round code: \`F\`, \`SF\`, \`QF\`, \`R16\`, \`R32\`, \`R64\`, \`R128\`, \`RR\`, \`Q1\`, \`Q2\`, \`Q3\`. |
| 32 | \`minutes\` | \`matches.match_results\` | \`duration_minutes\` | **HIGH** | Official match duration in minutes. Integer or \`null\`. |
| 33 | \`w_ace\` | \`statistics.player_match_stats\` | \`aces\` | **VERY HIGH** | Winner aces count. Integer or \`null\` (G17 guard). |
| 34 | \`w_df\` | \`statistics.player_match_stats\` | \`double_faults\` | **VERY HIGH** | Winner double faults count. Integer or \`null\`. |
| 35 | \`w_svpt\` | \`statistics.player_match_stats\` | \`service_points_total\` | **VERY HIGH** | Winner total service points played. |
| 36 | \`w_1stIn\` | \`statistics.player_match_stats\` | \`first_serves_in\` | **VERY HIGH** | Winner first serves landed in. |
| 37 | \`w_1stWon\` | \`statistics.player_match_stats\` | \`first_serve_points_won\` | **VERY HIGH** | Winner points won when first serve was in ($1\text{stWon} \le 1\text{stIn}$). |
| 38 | \`w_2ndWon\` | \`statistics.player_match_stats\` | \`second_serve_points_won\` | **VERY HIGH** | Winner points won on second serve ($2\text{ndWon} \le \text{svpt} - 1\text{stIn}$). |
| 39 | \`w_SvGms\` | \`statistics.player_match_stats\` | \`service_games_played\` | **VERY HIGH** | Winner total service games. |
| 40 | \`w_bpSaved\` | \`statistics.player_match_stats\` | \`break_points_saved\` | **VERY HIGH** | Winner break points saved ($\text{bpSaved} \le \text{bpFaced}$). |
| 41 | \`w_bpFaced\` | \`statistics.player_match_stats\` | \`break_points_faced\` | **VERY HIGH** | Winner break points faced total. |
| 42 | \`l_ace\` | \`statistics.player_match_stats\` | \`aces\` | **VERY HIGH** | Loser aces count. Integer or \`null\`. |
| 43 | \`l_df\` | \`statistics.player_match_stats\` | \`double_faults\` | **VERY HIGH** | Loser double faults count. Integer or \`null\`. |
| 44 | \`l_svpt\` | \`statistics.player_match_stats\` | \`service_points_total\` | **VERY HIGH** | Loser total service points played. |
| 45 | \`l_1stIn\` | \`statistics.player_match_stats\` | \`first_serves_in\` | **VERY HIGH** | Loser first serves landed in. |
| 46 | \`l_1stWon\` | \`statistics.player_match_stats\` | \`first_serve_points_won\` | **VERY HIGH** | Loser points won on first serve ($1\text{stWon} \le 1\text{stIn}$). |
| 47 | \`l_2ndWon\` | \`statistics.player_match_stats\` | \`second_serve_points_won\` | **VERY HIGH** | Loser points won on second serve. |
| 48 | \`l_SvGms\` | \`statistics.player_match_stats\` | \`service_games_played\` | **VERY HIGH** | Loser total service games. |
| 49 | \`l_bpSaved\` | \`statistics.player_match_stats\` | \`break_points_saved\` | **VERY HIGH** | Loser break points saved ($\text{bpSaved} \le \text{bpFaced}$). |
| 50 | \`l_bpFaced\` | \`statistics.player_match_stats\` | \`break_points_faced\` | **VERY HIGH** | Loser break points faced total. |

---

## 3. Core Normalization Algorithms

### 3.1 Date Normalization
```text
normalizeDate(raw):
  if raw matches /^\d{8}$/:
    return raw[0..3] + "-" + raw[4..5] + "-" + raw[6..7]
  else if raw matches /^\d{4}-\d{2}-\d{2}$/:
    return raw
  return null
```

### 3.2 Surface Normalization
```text
normalizeSurface(surf):
  s = toLower(trim(surf))
  if s contains "hard"    => "Hard"
  if s contains "clay"    => "Clay"
  if s contains "grass"   => "Grass"
  if s contains "carpet"  => "Carpet"
  default                 => "Unknown"
```

### 3.3 Score & Outcome Classification
```text
classifyStatus(score):
  s = toUpper(trim(score))
  if s contains "W/O" or "WALKOVER" => status = "WALKOVER", is_retirement_or_wo = true
  if s contains "RET" or "RETIRED"  => status = "RETIRED",  is_retirement_or_wo = true
  if s contains "DEF" or "DEFAULT"  => status = "DEFAULT",  is_retirement_or_wo = true
  if hasDigits(s)                   => status = "FINISHED", is_retirement_or_wo = false
  default                           => status = "SCHEDULED", is_retirement_or_wo = false
```

---

## 4. Operational Invariant Statement

“TennisMyLife dry-run evidence was acquired and evaluated as a secondary validation/enrichment source. No canonical database or production runtime was modified.”
