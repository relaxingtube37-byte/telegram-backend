# Phase 5: Matches & Outcomes Field Mapping Specification

## 1. Overview

This document provides field-by-field transformation rules, data types, sanitization routines, and normalization logic for mapping SQLite match entities into the PostgreSQL 16 `matches` and `provenance` schemas.

---

## 2. Target Entity Mappings

### 2.1 Table: `matches.matches` (Table 7/28)

| PostgreSQL Column | Target Type | Source Field(s) | Transformation & Mapping Logic |
| :--- | :--- | :--- | :--- |
| `match_id` | `UUID PK` | `edition_id`, `round_name`, `p1_uuid`, `p2_uuid` | RFC 4122 UUIDv5 using namespace `6ba7b815-9dad-11d1-80b4-00c04fd430c8` hashed over `${edition_id}:${round_name}:${min_player_id}:${max_player_id}`. |
| `edition_id` | `UUID FK` | `canonical_tourney_id` / `tourney_name`, `match_date`, `tour` | Foreign key referencing `competition.tournament_editions(edition_id)`. Resolved via Phase 4 edition registry. |
| `scheduled_start_utc` | `TIMESTAMPTZ` | `canonical_start_utc` / `match_date` | If UTC timestamp available, parsed directly; otherwise synthesized as `${match_date}T00:00:00.000Z`. |
| `actual_start_utc` | `TIMESTAMPTZ NULL`| `canonical_start_utc` | Exact start timestamp if confirmed from live telemetry, otherwise `NULL`. |
| `round_name` | `VARCHAR(30)` | `round_name` | Normalized to standard codes (`F`, `SF`, `QF`, `R16`, `R32`, `R64`, `R128`, `RR`, `Q1`, `Q2`, `Q3`). Defaults to `R32` if unrecorded. |
| `match_num` | `SMALLINT NULL` | `match_num` | Sanitized integer $> 0$; otherwise `NULL`. |
| `best_of` | `SMALLINT` | `best_of`, `tour`, `edition._parent_canonical_id` | Enforces integer `3` or `5`. Men's Grand Slam main draws default to `5`; all others default to `3`. |
| `surface` | `competition.surface_type` | `surface` / `edition.actual_surface` | Mapped to enum: `'Hard'`, `'Clay'`, `'Grass'`, `'Carpet'`, `'Unknown'`. Falls back to tournament edition surface. |
| `is_indoor` | `BOOLEAN` | `surface`, `tourney_name` | `TRUE` if surface or tournament name explicitly specifies "indoor", otherwise `FALSE`. |
| `status` | `matches.match_status_type`| `match_status`, `score`, `is_retirement_or_wo` | Mapped to enum: `'FINISHED'`, `'RETIRED'`, `'WALKOVER'`, `'DEFAULT'`, `'CANCELLED'`, `'IN_PROGRESS'`, `'SCHEDULED'`. |
| `source_mask` | `INTEGER` | `source_mask`, `source_presence` | Bitmask encoding source presence: `1 = Sackmann/v2`, `2 = RapidAPI/Legacy`, `3 = Both`. |
| `created_at` | `TIMESTAMPTZ` | Deterministic timestamp | Timestamp of ingestion record creation. |
| `updated_at` | `TIMESTAMPTZ` | Deterministic timestamp | Timestamp of last metadata update. |

---

### 2.2 Table: `matches.match_participants` (Table 8/28)

| PostgreSQL Column | Target Type | Source Field(s) | Transformation & Mapping Logic |
| :--- | :--- | :--- | :--- |
| `match_id` | `UUID FK` | Synthetic / `match_id` | Foreign key referencing `matches.matches(match_id)`. Part of composite PK. |
| `side` | `SMALLINT` | UUID comparison | `1` for the player with `player_id == min(p1, p2)`; `2` for `player_id == max(p1, p2)`. Part of composite PK. |
| `player_id` | `UUID FK` | `winner_canonical_id`, `loser_canonical_id`, `canonical_winner_name`, `canonical_loser_name` | Foreign key referencing `identity.players(player_id)`. Resolved via Phase 3 player registry. |
| `seed` | `SMALLINT NULL` | `winner_seed`, `loser_seed` | Participant tournament seed ($1 \le seed \le 128$). Otherwise `NULL`. |
| `entry_status` | `VARCHAR(10) NULL`| `winner_entry`, `loser_entry` | Qualification/wildcard status (`'Q'`, `'WC'`, `'LL'`, `'PR'`, `'SE'`). Sanitized uppercase. |
| `pre_match_rank` | `INTEGER NULL` | `winner_rank`, `loser_rank` | ATP/WTA ranking prior to match commencement ($1 \le rank \le 5000$). Otherwise `NULL`. |
| `pre_match_rank_points`| `INTEGER NULL` | `winner_rank_points`, `loser_rank_points` | ATP/WTA ranking points prior to match commencement ($\ge 0$). Otherwise `NULL`. |
| `is_winner` | `BOOLEAN NULL` | Outcome decoupling & zero lookahead | Strictly `NULL` in the participant table by architectural contract to eliminate predictive lookahead leakage. Legacy consumers requiring `is_winner` access it via compatibility views (`public.player_matches_validated`), which compute `(p.player_id = r.winner_player_id)` dynamically. |
| `created_at` | `TIMESTAMPTZ` | Deterministic timestamp | Timestamp of participant record creation. |

---

### 2.3 Table: `matches.match_results` (Table 9/28)

| PostgreSQL Column | Target Type | Source Field(s) | Transformation & Mapping Logic |
| :--- | :--- | :--- | :--- |
| `match_id` | `UUID PK FK` | `matches.match_id` | Primary key referencing `matches.matches(match_id)`. Exists only for settled matches. |
| `winner_player_id` | `UUID FK` | `winner_canonical_id`, `canonical_winner_name` | Foreign key referencing `identity.players(player_id)`. Must equal one of the match participants. |
| `loser_player_id` | `UUID FK` | `loser_canonical_id`, `canonical_loser_name` | Foreign key referencing `identity.players(player_id)`. Must equal the opposite participant. Invariant: `winner <> loser`. |
| `score_string` | `TEXT` | `canonical_score`, `score`, `gm_score` | Sanitized game/set score string (e.g. `'6-4,7-6(5),6-2'`). Quotes stripped. |
| `retirement_detail` | `TEXT NULL` | `score` | Extracted textual detail if retirement noted (e.g. `'RET'`, `'W/O'`). |
| `is_retirement_or_wo`| `BOOLEAN` | `is_retirement_or_wo`, `match_status` | `TRUE` if match ended prematurely via retirement, walkover, or default; otherwise `FALSE`. |
| `duration_minutes` | `SMALLINT NULL` | `minutes`, `hm_minutes`, `cm_minutes` | Match duration in minutes ($1 \le minutes \le 900$). Otherwise `NULL`. |
| `settled_at` | `TIMESTAMPTZ` | Deterministic timestamp | Timestamp outcome was verified. |

---

### 2.4 Table: `provenance.source_match_links` (Table 20/28)

| PostgreSQL Column | Target Type | Source Field(s) | Transformation & Mapping Logic |
| :--- | :--- | :--- | :--- |
| `link_id` | `BIGSERIAL PK` | Auto-increment / sequence | Unique link identifier. |
| `match_id` | `UUID FK` | `matches.match_id` | Foreign key referencing `matches.matches(match_id)`. |
| `source_name` | `VARCHAR(50)` | Source identity | Contributing stream: `'canonical_matches_v2'`, `'canonical_matches'`, `'sackmann'`, `'rapidapi'`. |
| `source_match_id` | `VARCHAR(100)` | Primary source identifier | Raw record ID from source table (e.g. `cm_2024-...`, `p1_base_961688`, `rapid_12345`). |
| `evidence_id` | `UUID FK` | Deterministic UUID | RFC 4122 UUIDv5 hashed over `${source_name}:${source_match_id}` referencing raw evidence. |
| `confidence_score` | `NUMERIC(5,2)` | Tier authority | `100.0` for Tier 1 v2 consensus; `95.0` for Tier 2 cross-matched; `90.0` for Tier 2 single-source. |
| `scorer_version` | `VARCHAR(20)` | Static version | `'v2.1.0'`. |
| `rule_version` | `VARCHAR(20)` | Static version | `'v2.1.0'`. |
| `link_status` | `VARCHAR(20)` | Consensus flag | `'CONFIRMED'`. |
| `linked_at` | `TIMESTAMPTZ` | Deterministic timestamp | Ingestion timestamp. |

---

### 2.5 Table: `provenance.field_provenance` (Table 21/28)

| PostgreSQL Column | Target Type | Source Field(s) | Transformation & Mapping Logic |
| :--- | :--- | :--- | :--- |
| `provenance_id` | `BIGSERIAL PK` | Auto-increment / sequence | Unique field provenance identifier. |
| `match_id` | `UUID FK` | `matches.match_id` | Foreign key referencing `matches.matches(match_id)`. |
| `field_name` | `VARCHAR(50)` | Field name | Audited field name (e.g. `'canonical_score'`, `'winner_id'`, `'surface'`, `'status'`). |
| `source_name` | `VARCHAR(50)` | Source stream | Contributing source stream. |
| `source_match_id` | `VARCHAR(100)` | Raw source key | Source key providing the attribute value. |
| `evidence_id` | `UUID FK` | Deterministic UUID | RFC 4122 UUIDv5 hashed over `${source_name}:${source_match_id}`. |
| `raw_value` | `TEXT NULL` | Raw scalar value | Exact literal string value before transformation. |
| `confidence` | `NUMERIC(5,2)` | Tier weight | `100.0` for Tier 1; `90.0` to `95.0` for Tier 2. |
| `recorded_at` | `TIMESTAMPTZ` | Deterministic timestamp | Ingestion timestamp. |

---

## 3. Enumeration Normalization Rules

### 3.1 Match Status Mapping
```javascript
function classifyMatchStatus(score, isRetOrWo, rawStatus) {
  const s = (score || '').trim().toUpperCase();
  if (s.includes('W/O') || s.includes('WALKOVER')) return 'WALKOVER';
  if (s.includes('RET') || s.includes("RET'D") || s.includes('RETIRED')) return 'RETIRED';
  if (s.includes('DEF') || s.includes('DEFAULT')) return 'DEFAULT';
  if (s.includes('CANC') || s.includes('CANCELLED') || s.includes('CANCELED')) return 'CANCELLED';
  if (s.includes('ABD') || s.includes('ABANDONED')) return 'ABANDONED';
  if (s.includes('INT') || s.includes('INTERRUPTED')) return 'INTERRUPTED';
  if (rawStatus === 'FINISHED' || (!isRetOrWo && s.length > 0 && /\d/.test(s))) return 'FINISHED';
  if (rawStatus === 'IN_PROGRESS' || rawStatus === 'LIVE') return 'IN_PROGRESS';
  return 'SCHEDULED';
}
```

### 3.2 Round Nomenclature Mapping
- `'F'`, `'FINAL'`, `'1ST'` $\rightarrow$ `'F'`
- `'SF'`, `'SEMI-FINALS'`, `'SEMIFINALS'`, `'1/2-FINALS'` $\rightarrow$ `'SF'`
- `'QF'`, `'QUARTER-FINALS'`, `'QUARTERFINALS'`, `'1/4-FINALS'` $\rightarrow$ `'QF'`
- `'R16'`, `'1/8-FINALS'`, `'ROUND OF 16'`, `'FOURTH ROUND'` $\rightarrow$ `'R16'`
- `'R32'`, `'1/16-FINALS'`, `'ROUND OF 32'`, `'THIRD ROUND'` $\rightarrow$ `'R32'`
- `'R64'`, `'1/32-FINALS'`, `'ROUND OF 64'`, `'SECOND ROUND'` $\rightarrow$ `'R64'`
- `'R128'`, `'1/64-FINALS'`, `'ROUND OF 128'`, `'FIRST ROUND'` $\rightarrow$ `'R128'`
- `'RR'`, `'ROUND ROBIN'` $\rightarrow$ `'RR'`
- Qualifying matches $\rightarrow$ `'Q1'`, `'Q2'`, `'Q3'`
