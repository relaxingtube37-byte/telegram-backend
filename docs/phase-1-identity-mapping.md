# Phase 1 Identity Mapping & Resolution Specification

**Branch:** `staging/phase-1-ingestion-spec`
**Target Engine:** PostgreSQL 16+ DDL (`postgresSchemaV1.sql`)
**Scope:** Canonical Players, Player Aliases, Canonical Tournaments, Tournament Aliases

---

## 1. Target Mapping Specification

### 1.1 Target Table: `identity.players`
Primary biographical registry for tennis athletes.

| Target Column | PostgreSQL Type | Nullable | Source Table & Column | Transformation & Normalization Rule | Fallback Rule | Authoritative? | Conflict Resolution Rule |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `player_id` | `UUID` | **NO** | `canonical_players.canonical_player_id` | Deterministic UUIDv5 generated via `uuidv5(canonical_player_id, NAMESPACE_PLAYERS)`. | Generates unique deterministic UUID. | **YES** | Primary Key. Invariant. |
| `full_name_standard` | `TEXT` | **NO** | `canonical_players.full_name_standard` | Cleaned trimmed string; accents preserved in display name; double spaces removed. | Must exist in source. | **YES** | Exact match. |
| `first_name` | `TEXT` | YES | `canonical_players.first_name` | Trimmed string. | If NULL in source, extracted as all tokens before final surname. | Source A | Standard whitespace split. |
| `last_name` | `TEXT` | **NO** | `canonical_players.last_name` | Trimmed string. | Extracted from `full_name_standard` if missing. | Source A | Must be populated. |
| `slug` | `TEXT` | **NO** | `gold_player_profiles.slug` / `players.slug` | Lowercase alphanumeric kebab-case: `kebabCase(full_name_standard)`. | Generated deterministically from `full_name_standard`. | Secondary | Suffix `-1`, `-2` on collision. |
| `birth_date` | `DATE` | YES | `gold_player_profiles.birth_timestamp` | Convert Unix epoch seconds to ISO date: `to_date(birth_timestamp, 'YYYY-MM-DD')`. | NULL if unrecorded. Never synthesize fake epoch. | Secondary | Preserve authentic NULL. |
| `country_ioc` | `CHAR(3)` | YES | `canonical_players.ioc_country` | Normalize 2-letter ISO (e.g. `IT`, `ES`, `US`) to 3-letter IOC (e.g. `ITA`, `ESP`, `USA`). | Secondary fallback to `gold_player_profiles.country_code`. | Source A | 3-letter IOC takes priority. |
| `gender` | `identity.gender_code` | **NO** | `canonical_players.gender` | Strict enum mapping: `'M'` ➔ `'M'`, `'F'` ➔ `'F'`. | Default to `'M'` only if tournament tour is ATP. | Source A | Target enum validation. |
| `hand` | `identity.player_hand` | **NO** | `canonical_players.hand` / `gold_player_profiles.plays_hand` | Enum mapping: `'R'`/`'right-handed'` ➔ `'R'`, `'L'`/`'left-handed'` ➔ `'L'`, `'Unknown'`. | Defaults to `'Unknown'`. Never assume right-handed without evidence. | Secondary | Target enum validation. |
| `height_cm` | `SMALLINT` | YES | `gold_player_profiles.height_cm` | Rounded integer (cm). Validate check constraint: `140 <= height_cm <= 230`. | NULL if out-of-range or absent. | Secondary | Discard corrupted values (<140 or >230). |
| `weight_kg` | `SMALLINT` | YES | `gold_player_profiles.weight_kg` | Rounded integer (kg). Validate check constraint: `40 <= weight_kg <= 140`. | NULL if out-of-range or absent. | Secondary | Discard corrupted values (<40 or >140). |
| `turned_pro_year` | `SMALLINT` | YES | `gold_player_profiles.turned_pro_year` | Integer year. Validate check constraint: `1968 <= turned_pro_year <= 2030`. | NULL if absent. | Secondary | Discard corrupted values. |
| `is_active` | `BOOLEAN` | **NO** | `tracked_players.is_active` | Boolean `TRUE`/`FALSE`. Default `TRUE`. | `TRUE` if active within 2024–2026 matches. | Source A | Active status flag. |
| `created_at` | `TIMESTAMPTZ` | **NO** | `canonical_players.created_at` | Parse ISO/SQLite timestamp into UTC timestamptz. | `clock_timestamp()` | Source A | Preserve original timestamp. |
| `updated_at` | `TIMESTAMPTZ` | **NO** | `canonical_players.updated_at` | Parse ISO/SQLite timestamp into UTC timestamptz. | `clock_timestamp()` | Source A | Preserve original timestamp. |

---

### 1.2 Target Table: `identity.player_aliases`
Deterministic string lookup dictionary mapping external vendor tokens to canonical `player_id`.

| Target Column | PostgreSQL Type | Nullable | Source Table & Column | Transformation & Normalization Rule | Fallback Rule | Authoritative? | Conflict Resolution Rule |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `alias_id` | `UUID` | **NO** | Derived | Deterministic UUIDv5: `uuidv5(source_name + ':' + normalized_token, NAMESPACE_ALIASES)`. | Generated. | **YES** | Primary Key. |
| `player_id` | `UUID` | **NO** | `player_aliases.canonical_player_id` | Foreign Key resolving to `identity.players(player_id)`. | Must resolve to existing player. | **YES** | Reject orphan aliases. |
| `source_name` | `VARCHAR(50)` | **NO** | `player_aliases.source_name` | Standardize source tag: `canonical`, `csv_style`, `atp_wta_api`, `sofascore`. | Must be non-empty string. | **YES** | Unique index component. |
| `raw_name` | `TEXT` | **NO** | `player_aliases.raw_name` | Preserve exact raw string as received upstream (including diacritics and dots). | Populated. | **YES** | Display/audit reference. |
| `normalized_token`| `TEXT` | **NO** | `player_aliases.normalized_token` | Unicode NFD decomposition, strip combining diacritics, lowercase, remove punctuation. | Recomputed via `normalizePlayerName()`. | **YES** | Unique index component. |
| `is_verified` | `BOOLEAN` | **NO** | `player_aliases.is_verified` | Convert 1 ➔ `TRUE`, 0 ➔ `FALSE`. | `FALSE` if ambiguous. | **YES** | Verification flag. |
| `has_sibling_conflict`| `BOOLEAN`| **NO** | `player_aliases.has_sibling_conflict` | Flag `TRUE` for shared surname aliases (Cerundolo, Zverev, Williams, Jovic). | `FALSE` for unambiguous tokens. | **YES** | Forces manual review. |
| `conflict_notes`| `TEXT` | YES | Derived | Diagnostic explanation (e.g. `'Collides with cp_dusan_lajovic in legacy SQLite'`). | NULL if no conflict. | Secondary | Audit documentation. |
| `created_at` | `TIMESTAMPTZ` | **NO** | `player_aliases.created_at` | Parse into UTC timestamptz. | `clock_timestamp()` | Source A | Preserve creation time. |

---

### 1.3 Target Table: `identity.tournaments`
Authoritative competition directory for ATP, WTA, and Challenger events.

| Target Column | PostgreSQL Type | Nullable | Source Table & Column | Transformation & Normalization Rule | Fallback Rule | Authoritative? | Conflict Resolution Rule |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `tournament_id` | `UUID` | **NO** | `canonical_tournaments.canonical_tourney_id` | Deterministic UUIDv5: `uuidv5(canonical_tourney_id, NAMESPACE_TOURNAMENTS)`. | Generated. | **YES** | Primary Key. Invariant. |
| `name_standard` | `TEXT` | **NO** | `canonical_tournaments.name_standard` | Title Case standard name without sponsor clutter. | Populated. | **YES** | Unique constraint component. |
| `tour` | `identity.tour_code` | **NO** | `canonical_tournaments.tour` | Strict Enum mapping: `'ATP'` ➔ `'ATP'`, `'WTA'` ➔ `'WTA'`. | Must exist in enum. | **YES** | Unique constraint component. |
| `tour_level` | `VARCHAR(30)` | **NO** | `canonical_tournaments.tour_level` | Retain standardized level string: `GRAND_SLAM`, `MASTERS_1000`, `ATP_500`, `ATP_250`, etc. | Must be non-empty. | **YES** | Standard level hierarchy. |
| `default_surface`| `competition.surface_type` | **NO** | `canonical_tournaments.default_surface`| Normalize uppercase to Title Case enum: `'HARD'` ➔ `'Hard'`, `'CLAY'` ➔ `'Clay'`, `'GRASS'` ➔ `'Grass'`. | Default to `'Unknown'`. | **YES** | Target enum validation. |
| `country_ioc` | `CHAR(3)` | YES | `canonical_tournaments.country_ioc` | Standard 3-letter IOC code (e.g. `GBR`, `FRA`, `USA`, `AUS`). | Normalize ISO-2 if present. | Source A | Standardize code. |
| `city` | `TEXT` | YES | `canonical_tournaments.city` | Trimmed city name. | NULL if absent. | Source A | Clean string. |
| `altitude_meters`| `SMALLINT` | YES | Derived / Future Enrichment | Elevation in meters above sea level (e.g. Madrid = 667m). | NULL during Phase 1. | Secondary | Authentic NULL. |
| `is_indoor` | `BOOLEAN` | **NO** | Derived from surface string | `TRUE` if surface contains 'Indoor' or 'Carpet'; otherwise `FALSE`. | `FALSE`. | Source A | Default boolean. |
| `is_active` | `BOOLEAN` | **NO** | Derived | `TRUE` for all currently maintained tour tournaments. | `TRUE`. | Source A | Active status. |
| `created_at` | `TIMESTAMPTZ` | **NO** | `canonical_tournaments.created_at` | Parse into UTC timestamptz. | `clock_timestamp()` | Source A | Preserve creation time. |
| `updated_at` | `TIMESTAMPTZ` | **NO** | `canonical_tournaments.updated_at` | Parse into UTC timestamptz. | `clock_timestamp()` | Source A | Preserve update time. |

---

### 1.4 Target Table: `identity.tournament_aliases`
Resolves external vendor strings, sponsor variations, and historical names to canonical `tournament_id`.

| Target Column | PostgreSQL Type | Nullable | Source Table & Column | Transformation & Normalization Rule | Fallback Rule | Authoritative? | Conflict Resolution Rule |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `alias_id` | `UUID` | **NO** | Derived | Deterministic UUIDv5: `uuidv5(source_name + ':' + normalized_token, NAMESPACE_TOURNAMENT_ALIASES)`. | Generated. | **YES** | Primary Key. |
| `tournament_id` | `UUID` | **NO** | `tournament_aliases.canonical_tourney_id` | Foreign Key resolving to `identity.tournaments(tournament_id)`. | Must resolve to valid tournament. | **YES** | Reject orphan aliases. |
| `source_name` | `VARCHAR(50)` | **NO** | `tournament_aliases.source_name` | Standardize tag: `canonical`, `historical`, `rapidapi`, `sofascore`. | Populated. | **YES** | Unique constraint component. |
| `raw_name` | `TEXT` | **NO** | `tournament_aliases.raw_name` | Raw tournament name as published in upstream feeds. | Populated. | **YES** | Audit trail. |
| `normalized_token`| `TEXT` | **NO** | `tournament_aliases.normalized_token` | Unicode NFD stripped, lowercase, collapsed spaces, punctuation removed. | Recomputed. | **YES** | Unique constraint component. |
| `is_verified` | `BOOLEAN` | **NO** | `tournament_aliases.is_verified` | Convert 1 ➔ `TRUE`, 0 ➔ `FALSE`. | `FALSE`. | **YES** | Verification flag. |
| `created_at` | `TIMESTAMPTZ` | **NO** | `tournament_aliases.created_at` | Parse into UTC timestamptz. | `clock_timestamp()` | Source A | Preserve creation time. |

---

## 2. Deterministic Identity Resolution Rules

### 2.1 Player Name Normalization Algorithm
```typescript
function normalizePlayerName(rawName: string): string {
  if (!rawName) return '';
  return rawName
    .normalize('NFD')                     // Decompose accented characters into base + diacritic
    .replace(/[\u0300-\u036f]/g, '')     // Strip all combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')       // Replace punctuation with spaces (retain hyphens)
    .replace(/\s+/g, ' ')                // Collapse consecutive whitespace
    .trim();
}
```
* **Examples:**
  * `Carlos Alcaraz` ➔ `carlos alcaraz`
  * `Báez S.` ➔ `baez s`
  * `Čilić M.` ➔ `cilic m`
  * `Jannik Sinner (ITA)` ➔ `jannik sinner ita` ➔ regex clean ➔ `jannik sinner`

### 2.2 Sibling & Ambiguous Surname Conflict Rules
When vendor feeds abbreviate players (e.g. `Cerundolo F.` vs `Cerundolo J.M.`, `Zverev A.` vs `Zverev M.`, `Williams S.` vs `Williams V.`):
1. If the token contains only a shared surname and single initial matching multiple active players (e.g. `cerundolo j` where both Juan Manuel and potential juniors exist):
   * `has_sibling_conflict` is set to `TRUE`.
   * `is_verified` is set to `FALSE`.
   * The linker candidate scorer vetoes auto-merging (`VETO_SIBLING_AMBIGUITY`) and routes incoming fixtures to `provenance.review_queue`.
2. Sibling aliases may only be verified when accompanied by full first names or deterministic ATP/WTA registration IDs.

### 2.3 Country Code Normalization (ISO-2 to IOC-3)
Standard translation matrix converting legacy 2-letter codes to IOC 3-letter codes:
```
IT -> ITA, ES -> ESP, US -> USA, FR -> FRA, DE -> GER, GB -> GBR, AU -> AUS,
AR -> ARG, RS -> SRB, HR -> CRO, CZ -> CZE, RU -> RUS, BR -> BRA, CL -> CHI,
CN -> CHN, JP -> JPN, NL -> NED, BE -> BEL, AT -> AUT, CH -> SUI, PL -> POL,
RO -> ROU, GR -> GRE, PT -> POR, SE -> SWE, NO -> NOR, FI -> FIN, DK -> DEN,
CA -> CAN, MX -> MEX, CO -> COL, PE -> PER, UY -> URU, ZA -> RSA, KZ -> KAZ,
UA -> UKR, BY -> BLR, SK -> SVK, BG -> BUL, HU -> HUN, IL -> ISR, IN -> IND
```
* If country code is already 3 characters, uppercase and validate against official IOC registry.
* If unresolvable or missing, store as `NULL`. Never substitute `'UNK'` or `'000'`.
* **Auditing & Enforcement:** The dry-run execution script records every distinct raw source country token, its normalized IOC code, and verifies `unmappedCount = 0` across all non-null entries in the machine-readable validation report (`phase-1-dry-run-validation-report.json`).

### 2.4 Handedness Normalization
```typescript
function normalizeHand(rawHand: string | null): 'R' | 'L' | 'Ambi' | 'Unknown' {
  if (!rawHand) return 'Unknown';
  const clean = rawHand.toLowerCase().trim();
  if (clean === 'r' || clean === 'right' || clean === 'right-handed') return 'R';
  if (clean === 'l' || clean === 'left' || clean === 'left-handed') return 'L';
  if (clean === 'ambi' || clean === 'ambidextrous') return 'Ambi';
  return 'Unknown';
}
```

### 2.5 Tournament Surface Normalization
```typescript
function normalizeSurface(rawSurface: string | null): 'Hard' | 'Clay' | 'Grass' | 'Carpet' | 'Unknown' {
  if (!rawSurface) return 'Unknown';
  const clean = rawSurface.toLowerCase().trim();
  if (clean.includes('hard') || clean.includes('acrylic')) return 'Hard';
  if (clean.includes('clay')) return 'Clay';
  if (clean.includes('grass')) return 'Grass';
  if (clean.includes('carpet') || clean.includes('indoor') || clean.includes('wood')) return 'Carpet';
  return 'Unknown';
}
```

---

## 3. Duplicate Resolution & Deduplication Rules

### 3.1 Resolving the 28 Player Alias Duplicate Groups
During Phase 1 dry-run extraction, duplicate `(source_name, normalized_token)` groups are handled as follows:
1. **Same-Player Groups (27 cases):**
   * Multiple raw strings normalize to the same token for the same `canonical_player_id` (e.g. `Baez S.` and `Báez S.` ➔ `baez s`).
   * **Rule:** Select the raw string that preserves native diacritics/accents as `raw_name` (e.g. preserve `Báez S.`). Discard duplicate entries to satisfy `uq_identity_player_aliases_source_token`.
2. **True Identity Conflict Group (1 case: `jovic i`):**
   * Legacy SQLite mistakenly mapped `Jovic I.` to `cp_dusan_lajovic` (alias ID 278) and `Jović I.` to `cp_iva_jovic` (alias ID 1000).
   * **Rule:** Discard the false mapping to Dusan Lajovic. Associate `jovic i` with `cp_iva_jovic`. Set `has_sibling_conflict = TRUE` and `is_verified = FALSE` to prevent automated merging in subsequent stages without manual review.

3. **Reconciliation Target Count:**
   * Source SQLite `player_aliases` contains **2,861** rows.
   * Target `identity.player_aliases` contains strictly **2,833** rows.
   * The 28 difference is accounted for by 28 duplicate token groups (56 rows) collapsed into 28 unique target tokens. Downstream migration planning and reconciliation checks must expect 2,833 records, not 2,861.

### 3.2 Resolving the 2 Tournament Alias Duplicate Groups
* Both groups (`bad homburg open powered by solarwatt bad homburg ger` and `jiangxi open jiujiang chn`) map to the exact same `canonical_tourney_id`.
* **Rule:** Select the cleanly spaced, proper-case string as authoritative `raw_name` and deduplicate by `(source_name, normalized_token)`.

---

## 4. Zero-Fabrication Integrity Guarantees

* **No Synthetic Zeros:** Unknown ranks, biometrics, heights, weights, or birth dates must be emitted as `NULL` (never `0`).
* **Check Constraint Validation:** Any biometrics outside physical ranges (`height_cm < 140` or `> 230`, `weight_kg < 40` or `> 140`) are sanitized to `NULL` to prevent constraint violations in PostgreSQL.
* **Audit Trail Preservation:** Every derived entity retains its lineage back to the originating SQLite primary key.
