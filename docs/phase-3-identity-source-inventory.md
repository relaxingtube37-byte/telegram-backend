# Phase 3 Source Inventory: Identity & Reference Registries

**Branch:** `staging/phase-1-ingestion-spec`  
**Execution Mode:** READ-ONLY / DRAFT-ONLY  
**Audited Upstream Databases:**  
1. `G:/telegram-backend/data/database.sqlite` (Primary Backend Runtime DB, 544,415,744 bytes)  
2. `G:/state football/data/tennis_gold.sqlite` (Deep Gold Storage DB, 283,303,936 bytes)  

---

## 1. Inventory Summary & Entity Matrix

| Entity Category | Source DB | Source Table | Physical Rows | Primary Key | Natural Candidate Key | Duplicates / Conflicts | Target PostgreSQL Entity |
| :--- | :--- | :--- | :---: | :--- | :--- | :---: | :--- |
| **Canonical Players** | `database.sqlite` | `canonical_players` | **1,765** | `canonical_player_id` | `full_name_standard` | 0 | `identity.players` |
| **Player Aliases** | `database.sqlite` | `player_aliases` | **2,861** | `alias_id` | `(source_name, normalized_token)` | 28 groups (56 rows) | `identity.player_aliases` |
| **Canonical Tournaments**| `database.sqlite` | `canonical_tournaments` | **1,183** | `canonical_tourney_id` | `(name_standard, tour)` | 0 | `identity.tournaments` |
| **Tournament Aliases** | `database.sqlite` | `tournament_aliases` | **1,378** | `alias_id` | `(source_name, normalized_token)` | 2 groups (4 rows) | `identity.tournament_aliases` |
| **Gold Player Profiles** | `tennis_gold.sqlite` | `gold_player_profiles` | **12,309** | `player_id` | `slug` / `full_name` | 0 | Enrichment Source |

---

## 2. Granular Table Analysis

### 2.1 Players (`canonical_players`)
- **File Path:** `G:/telegram-backend/data/database.sqlite`
- **Physical Rows:** Exactly 1,765 rows.
- **Key Columns:**
  - `canonical_player_id`: TEXT PK (1,765 / 1,765 unique strings, e.g. `cp_jannik_sinner`).
  - `full_name_standard`: TEXT NOT NULL (1,765 unique display names, 0 duplicates).
  - `first_name`: TEXT NULL (1,765 populated).
  - `last_name`: TEXT NOT NULL (1,765 populated).
  - `birth_date`: TEXT NULL (100% NULL in SQLite; candidate for gold enrichment).
  - `ioc_country`: TEXT NULL (1,757 populated, 8 NULLs; standard 3-letter codes).
  - `gender`: TEXT NOT NULL (`M`: 1,086, `F`: 679).
  - `hand`: TEXT NULL (`R`: 622, `L`: 17, `U`: 20, `NULL`: 1,106; candidate for gold enrichment).
  - `created_at` / `updated_at`: TIMESTAMPTZ representation.
- **Immutability Invariant:** Database opened `{ readonly: true, fileMustExist: true }`.

### 2.2 Player Aliases (`player_aliases`)
- **File Path:** `G:/telegram-backend/data/database.sqlite`
- **Physical Rows:** 2,861 raw records.
- **Duplicate & Conflict Breakdown:**
  - **28 Duplicate Groups (56 rows total):**
    - **27 Same-Player Groups:** Diacritic vs unaccented vendor variants mapping to the same player (e.g. `baez s` ➔ `Baez S.` and `Báez S.`). The display-rich accented token is preserved.
    - **1 True Identity Collision:** `jovic i` mapped to `cp_dusan_lajovic` (`Jovic I.`) and `cp_iva_jovic` (`Jović I.`). The mistaken mapping to Dusan Lajovic is decoupled; `jovic i` maps to Iva Jovic with `has_sibling_conflict = TRUE, is_verified = FALSE` and routes to quarantine.
  - **Net Deduplicated Admitted Aliases:** Exactly **2,833** rows.
  - **Orphan Count:** Exactly **0** orphan aliases (100% resolve to valid canonical players).

### 2.3 Tournament Directory (`canonical_tournaments`)
- **File Path:** `G:/telegram-backend/data/database.sqlite`
- **Physical Rows:** Exactly 1,183 rows.
- **Key Columns:**
  - `canonical_tourney_id`: TEXT PK (1,183 unique strings, e.g. `ct_atp_wimbledon`).
  - `name_standard`: TEXT NOT NULL (Clean standard tournament titles).
  - `tour`: TEXT NOT NULL (`ATP`: 781, `WTA`: 402).
  - `tour_level`: TEXT NOT NULL (`CHALLENGER`: 844, `ATP_250`: 249, `WTA_1000`: 28, `MASTERS_1000`: 23, `ATP_500`: 19, `GRAND_SLAM`: 15, `ITF`: 5).
  - `default_surface`: TEXT NOT NULL (`HARD`: 621, `CLAY`: 512, `GRASS`: 50).
  - `country_ioc` / `city`: Populated for 1,181 tournaments (2 international / combined finals NULL).
- **Natural Key Uniqueness:** Exactly 1,183 unique pairs for `(name_standard, tour)`.

### 2.4 Tournament Aliases (`tournament_aliases`)
- **File Path:** `G:/telegram-backend/data/database.sqlite`
- **Physical Rows:** 1,378 raw records.
- **Deduplication:**
  - 2 whitespace/casing duplicate groups collapsed into single canonical records.
  - Net Deduplicated Admitted Aliases: Exactly **1,376** rows.
  - Orphan Count: Exactly **0** orphan aliases (100% resolve to valid canonical tournaments).

### 2.5 Gold Biographical Profiles (`gold_player_profiles`)
- **File Path:** `G:/state football/data/tennis_gold.sqlite`
- **Physical Rows:** Exactly 12,309 records.
- **Biographical Enrichment Performance:**
  - Canonical Players Matched: 1,095 / 1,765 (62.0%).
  - Birth Dates Enriched: 1,031 players.
  - Heights Enriched: 766 players.
  - Weights Enriched: 582 players.
  - Handedness Enriched: 471 players.
  - Turned-Pro Years Enriched: 395 players.
- **Sanitization Invariant:** All extracted values undergo strict physiological check constraint validation prior to inclusion.
