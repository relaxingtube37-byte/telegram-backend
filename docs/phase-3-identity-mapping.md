# Phase 3 Identity Mapping & Resolution Specification

**Branch:** `staging/phase-1-ingestion-spec`  
**Target Engine:** Canonical PostgreSQL 16+ DDL (`db/postgres-schema-v1.sql`)  
**Scope:** Canonical Players, Player Aliases, Canonical Tournaments, Tournament Aliases  

---

## 1. Target Schema Mapping Specifications

### 1.1 Target Table: `identity.players`
Primary canonical biographical registry for professional tennis players.

| Target Column | PostgreSQL Type | Nullable | Source Table & Column | Transformation & Normalization Rule | Fallback Rule | Conflict & Sanitization Rule |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `player_id` | `UUID` | **NO** | `canonical_players.canonical_player_id` | Deterministic UUIDv5: `uuidv5('canonical_player:' + id, NAMESPACE_PLAYERS)`. | Deterministic synthesis. | Primary Key. Invariant across all phases. |
| `full_name_standard` | `TEXT` | **NO** | `canonical_players.full_name_standard` | Trimmed string; accents and hyphens preserved for display; collapsed spaces. | Source value required. | Canonical display standard. |
| `first_name` | `TEXT` | YES | `canonical_players.first_name` | Trimmed string. | If NULL, extracted as tokens preceding final surname. | Standard split. |
| `last_name` | `TEXT` | **NO** | `canonical_players.last_name` | Trimmed string. | Extracted from `full_name_standard` if NULL. | Required surname. |
| `birth_date` | `DATE` | YES | `gold_player_profiles.birth_timestamp` | Convert Unix epoch seconds to ISO date `YYYY-MM-DD`. | `NULL` if absent. | Never synthesize placeholder timestamps. |
| `country_ioc` | `CHAR(3)` | YES | `canonical_players.ioc_country` | Normalize ISO-2/legacy names to standard 3-letter IOC codes (e.g. `USA`, `ESP`, `SRB`). | Secondary fallback to gold profile country. | Unmapped values set to `NULL`. |
| `gender` | `identity.gender_code` | **NO** | `canonical_players.gender` | Strict enum mapping: `'M'` ➔ `'M'`, `'F'` ➔ `'F'`, `'MIXED'` ➔ `'MIXED'`. | Inferred from tour if absent. | Must strictly match enum. |
| `hand` | `identity.player_hand` | **NO** | `canonical_players.hand` / `gold_player_profiles.plays_hand` | Normalized enum: `'R'`/`'right-handed'` ➔ `'R'`, `'L'`/`'left-handed'` ➔ `'L'`, `'Ambi'`, default `'Unknown'`. | `'Unknown'` if absent. | Never assume right-handed without evidence. |
| `height_cm` | `SMALLINT` | YES | `gold_player_profiles.height_cm` | Rounded integer (cm). Enforces check constraint: `140 <= height_cm <= 230`. | `NULL` if absent or out-of-bounds. | Values $<140$ or $>230$ sanitized to `NULL`. |
| `weight_kg` | `SMALLINT` | YES | `gold_player_profiles.weight_kg` | Rounded integer (kg). Enforces check constraint: `40 <= weight_kg <= 130`. | `NULL` if absent or out-of-bounds. | Values $<40$ or $>130$ sanitized to `NULL`. |
| `turned_pro_year`| `SMALLINT` | YES | `gold_player_profiles.turned_pro_year` | Integer year. Enforces check constraint: `1968 <= turned_pro_year <= 2035`. | `NULL` if absent or out-of-bounds. | Values $<1968$ or $>2035$ sanitized to `NULL`. |
| `ranking_current`| `INTEGER` | YES | `canonical_players.ranking_current` | Current official ATP/WTA ranking position. | `NULL` if unranked. | Zero values converted to `NULL`. |
| `created_at` | `TIMESTAMPTZ` | **NO** | `canonical_players.created_at` | Converted to UTC ISO 8601 timestamptz. | `clock_timestamp()` | Audit preservation. |
| `updated_at` | `TIMESTAMPTZ` | **NO** | `canonical_players.updated_at` | Converted to UTC ISO 8601 timestamptz. | `clock_timestamp()` | Audit preservation. |

---

### 1.2 Target Table: `identity.player_aliases`
Deterministic string lookup dictionary mapping external vendor tokens to canonical `player_id`.

| Target Column | PostgreSQL Type | Nullable | Source Table & Column | Transformation & Normalization Rule | Fallback Rule | Conflict & Quarantine Rule |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `alias_id` | `UUID` | **NO** | Derived | Deterministic UUIDv5: `uuidv5('player_alias:' + source_name + ':' + normalized_token, NAMESPACE_PLAYER_ALIASES)`. | Deterministic synthesis. | Primary Key. Invariant. |
| `player_id` | `UUID` | **NO** | `player_aliases.canonical_player_id` | Foreign Key resolving to `identity.players(player_id)`. | Must resolve to valid player. | Reject orphan aliases (`orphan_count == 0`). |
| `source_name` | `VARCHAR(50)` | **NO** | `player_aliases.source_name` | Source provider tag: `canonical`, `csv_style`, `atp_wta_api`, `sofascore`. | Non-empty string. | Composite unique key component. |
| `raw_name` | `TEXT` | **NO** | `player_aliases.raw_name` | Exact raw string upstream, preserving accents and punctuation. | Populated string. | Audit and display reference. |
| `normalized_token`| `TEXT` | **NO** | `player_aliases.normalized_token` | Unicode NFD decomposed, accents stripped, lowercase, whitespace collapsed. | Recomputed via `normalizePlayerName()`. | Composite unique key component. |
| `is_verified` | `BOOLEAN` | **NO** | `player_aliases.is_verified` | Convert 1 ➔ `TRUE`, 0 ➔ `FALSE`. | `FALSE` if conflict detected. | Verification indicator. |
| `has_sibling_conflict`| `BOOLEAN`| **NO** | `player_aliases.has_sibling_conflict` | Flag `TRUE` for shared surname tokens (e.g. Cerundolo, Zverev, Williams, Jovic). | `FALSE` for unique tokens. | Requires explicit human/admin review. |
| `created_at` | `TIMESTAMPTZ` | **NO** | `player_aliases.created_at` | Converted to UTC ISO 8601 timestamptz. | `clock_timestamp()` | Audit preservation. |

---

### 1.3 Target Table: `identity.tournaments`
Authoritative competition directory for ATP, WTA, Challenger, and ITF tournament series.

| Target Column | PostgreSQL Type | Nullable | Source Table & Column | Transformation & Normalization Rule | Fallback Rule | Conflict & Validation Rule |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `tournament_id` | `UUID` | **NO** | `canonical_tournaments.canonical_tourney_id` | Deterministic UUIDv5: `uuidv5('canonical_tournament:' + id, NAMESPACE_TOURNAMENTS)`. | Deterministic synthesis. | Primary Key. Invariant. |
| `name_standard` | `TEXT` | **NO** | `canonical_tournaments.name_standard` | Standard non-commercial title (e.g. `'Australian Open'`, `'Indian Wells Masters'`). | Source value. | Composite unique key component. |
| `tour` | `identity.tour_code` | **NO** | `canonical_tournaments.tour` | Strict Enum mapping: `'ATP'`, `'WTA'`, `'CHALLENGER'`, `'ITF'`, `'COMBINED'`. | Valid enum required. | Composite unique key component. |
| `tour_level` | `VARCHAR(30)` | **NO** | `canonical_tournaments.tour_level` | Standard tier: `GRAND_SLAM`, `MASTERS_1000`, `ATP_500`, `ATP_250`, `CHALLENGER`, `WTA_1000`. | Non-empty string. | Hierarchy verification. |
| `default_surface`| `competition.surface_type`| **NO**| `canonical_tournaments.default_surface` | Normalize to Title Case enum: `'Hard'`, `'Clay'`, `'Grass'`, `'Carpet'`, `'Unknown'`. | Default `'Unknown'`. | Strict enum validation. |
| `country_ioc` | `CHAR(3)` | YES | `canonical_tournaments.country_ioc` | Standard 3-letter IOC code (e.g. `GBR`, `FRA`, `USA`, `AUS`). | `NULL` if absent. | Normalized country standard. |
| `city` | `TEXT` | YES | `canonical_tournaments.city` | Trimmed city name. | `NULL` if absent. | Clean string. |
| `altitude_meters`| `SMALLINT` | YES | Derived / Future Enrichment | Elevation above sea level in meters. Check: `-500 <= altitude_meters <= 5000`. | `NULL` during Phase 3. | Authentic NULL (no synthetic zeros). |
| `is_indoor` | `BOOLEAN` | **NO** | Derived from surface string | `TRUE` if surface contains 'Indoor' or 'Carpet'; otherwise `FALSE`. | `FALSE`. | Boolean flag. |
| `created_at` | `TIMESTAMPTZ` | **NO** | `canonical_tournaments.created_at` | Converted to UTC ISO 8601 timestamptz. | `clock_timestamp()` | Audit preservation. |
| `updated_at` | `TIMESTAMPTZ` | **NO** | `canonical_tournaments.updated_at` | Converted to UTC ISO 8601 timestamptz. | `clock_timestamp()` | Audit preservation. |

---

### 1.4 Target Table: `identity.tournament_aliases`
Resolves external vendor tournament names, sponsor variations, and historical aliases to canonical `tournament_id`.

| Target Column | PostgreSQL Type | Nullable | Source Table & Column | Transformation & Normalization Rule | Fallback Rule | Conflict & Quarantine Rule |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `alias_id` | `UUID` | **NO** | Derived | Deterministic UUIDv5: `uuidv5('tourney_alias:' + source_name + ':' + normalized_token, NAMESPACE_TOURNAMENT_ALIASES)`. | Deterministic synthesis. | Primary Key. Invariant. |
| `tournament_id` | `UUID` | **NO** | `tournament_aliases.canonical_tourney_id` | Foreign Key resolving to `identity.tournaments(tournament_id)`. | Must resolve to valid tournament. | Reject orphan aliases (`orphan_count == 0`). |
| `source_name` | `VARCHAR(50)` | **NO** | `tournament_aliases.source_name` | Provider tag: `canonical`, `historical`, `rapidapi`, `sofascore`. | Non-empty string. | Composite unique key component. |
| `raw_name` | `TEXT` | **NO** | `tournament_aliases.raw_name` | Upstream tournament string as received from feeds. | Populated string. | Audit reference. |
| `normalized_token`| `TEXT` | **NO** | `tournament_aliases.normalized_token` | Unicode NFD decomposed, accents stripped, lowercase, collapsed whitespace. | Recomputed. | Composite unique key component. |
| `is_verified` | `BOOLEAN` | **NO** | `tournament_aliases.is_verified` | Convert 1 ➔ `TRUE`, 0 ➔ `FALSE`. | `FALSE`. | Verification flag. |
| `created_at` | `TIMESTAMPTZ` | **NO** | `tournament_aliases.created_at` | Converted to UTC ISO 8601 timestamptz. | `clock_timestamp()` | Audit preservation. |

---

## 2. Deduplication & Conflict Isolation Standards

### 2.1 Player Alias Deduplication Standard
Upstream SQLite `player_aliases` contains 2,861 raw records. To satisfy the PostgreSQL unique constraint:
```sql
CONSTRAINT uq_identity_player_aliases_source_token UNIQUE (source_name, normalized_token)
```
The pipeline applies deterministic deduplication:
1. **Same-Player Token Duplication (27 groups, 54 rows):**
   - When multiple raw aliases share the exact same `(source_name, normalized_token)` and point to the **same** `canonical_player_id` (e.g. diacritic variation `djokovic n` vs `đoković n`), the record with the accented display name is retained, and redundant duplicates are pruned.
2. **Cross-Player Conflict Quarantine (1 group, 2 rows: `jovic i`):**
   - The token `jovic i` collides between Dusan Lajovic (mistaken legacy mapping) and Iva Jovic (authentic mapping).
   - Rather than guessing or silently merging, the mistaken link is severed: `jovic i` is routed to Iva Jovic with `has_sibling_conflict = TRUE, is_verified = FALSE`.
   - The conflict record is explicitly logged into `scratch/phase-3-identity-output/phase-3-identity-conflicts.jsonl`.
3. **Net Admitted Count:** Exactly **2,833** canonical alias records.

### 2.2 Tournament Alias Deduplication Standard
Upstream SQLite `tournament_aliases` contains 1,378 raw records.
- 2 whitespace/casing duplicate groups collapsed into single authoritative records.
- Net Admitted Count: Exactly **1,376** canonical alias records satisfying `uq_identity_tournament_aliases_source_token`.
