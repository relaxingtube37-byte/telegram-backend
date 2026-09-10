# Phase 1 Source Inventory: Identity & Reference Registries

**Branch:** `staging/phase-1-ingestion-spec`
**Execution Mode:** READ-ONLY / DRAFT-ONLY
**Audited Databases:**
1. `G:/telegram-backend/data/database.sqlite` (Primary Backend Runtime DB, 544 MB)
2. `G:/state football/data/tennis_gold.sqlite` (Deep Gold Storage DB, 283 MB)
3. `G:/telegram-backend/data/database.linker_dryrun.sqlite` (Isolated Dry-Run DB, 20 MB)

---

## 1. Executive Summary & Inventory Matrix

| Entity Category | Source DB | Table Name | Physical Rows | Columns | Primary Key | Natural Key | Duplicates | Canonical Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Canonical Players** | `database.sqlite` | `canonical_players` | 1,765 | 10 | `canonical_player_id` | `full_name_standard` | 0 | **Primary Authoritative Baseline** |
| **Player Aliases** | `database.sqlite` | `player_aliases` | 2,861 | 8 | `alias_id` | `(source_name, normalized_token)` | 28 groups (56 rows) | **Authoritative Lookup Mapping** |
| **Canonical Tournaments**| `database.sqlite` | `canonical_tournaments`| 1,183 | 9 | `canonical_tourney_id`| `(name_standard, tour)` | 0 | **Primary Authoritative Baseline** |
| **Tournament Aliases** | `database.sqlite` | `tournament_aliases` | 1,378 | 7 | `alias_id` | `(source_name, normalized_token)` | 2 groups (4 rows) | **Authoritative Lookup Mapping** |
| **Gold Player Profiles**| `tennis_gold.sqlite`| `gold_player_profiles`| 12,309 | 15 | `player_id` | `slug` / `full_name` | 0 | **Biometric & Historical Enrichment** |
| **Top 300 Seed Players**| `database.sqlite` | `players` | 300 | 19 | `id` | `player_id` / `slug` | 0 | **Public Profile & SEO Enrichment** |
| **Tracked Active Players**| `database.sqlite` | `tracked_players` | 401 | 19 | `id` | `rapid_player_id` | 0 | **API Ingestion Tracking Registry** |
| **Canonical Matches (v1)**| `database.sqlite` | `canonical_matches` | 140,432 | 79 | `id` | `canonical_match_id` | 0 | **Legacy Operational Read Source** |
| **Canonical Matches (v2)**| `database.sqlite` | `canonical_matches_v2` | 7,505 | 17 | `canonical_match_id` | `(edition_id, round, p1, p2)` | 0 | **Symmetric Shadow Fixtures** |
| **Historical Match Pool**| `database.sqlite` | `historical_matches` | 115,223 | 66 | `historical_match_id` | `(match_date, winner, loser)` | 0 | **Sackmann CSV Historical Base** |

---

## 2. Granular Table Analysis

### 2.1 Players: `canonical_players`
* **File Path:** `G:/telegram-backend/data/database.sqlite`
* **Table Name:** `canonical_players`
* **Row Count:** 1,765
* **Column Count:** 10
* **Primary Key:** `canonical_player_id` (TEXT, e.g. `cp_jannik_sinner`, `cp_carlos_alcaraz`)
* **Candidate Natural Key:** `full_name_standard` (TEXT NOT NULL)
* **Schema Breakdown:**
  * `canonical_player_id`: TEXT PK (Non-null: 1,765 / 1,765)
  * `full_name_standard`: TEXT NOT NULL (100% populated, 0 duplicates)
  * `first_name`: TEXT NULL (Populated: 1,765 / 1,765)
  * `last_name`: TEXT NOT NULL (Populated: 1,765 / 1,765)
  * `birth_date`: TEXT NULL (100% NULL in SQLite — primary candidate for enrichment from `gold_player_profiles`)
  * `ioc_country`: TEXT NULL (Populated: 1,757 / 1,765; 8 NULLs; mixes 2-letter ISO and 3-letter IOC codes)
  * `gender`: TEXT NOT NULL (`M`: 1,086, `F`: 679)
  * `hand`: TEXT NULL (`R`: 622, `L`: 17, `U`: 20, `NULL`: 1,106 — primary candidate for enrichment)
  * `created_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  * `updated_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
* **Duplicate Count:** 0 duplicate names across the entire table.
* **Canonical Status:** **Authoritative Core Baseline**. Every active and recent professional player referenced in v2 matches originates here.
* **Read-Only Safety Status:** 100% verified. Connection opened with `{ readonly: true }`.

### 2.2 Player Aliases: `player_aliases`
* **File Path:** `G:/telegram-backend/data/database.sqlite`
* **Table Name:** `player_aliases`
* **Row Count:** 2,861
* **Column Count:** 8
* **Primary Key:** `alias_id` (INTEGER AUTOINCREMENT)
* **Candidate Natural Key:** `(source_name, normalized_token)`
* **Foreign Key:** `canonical_player_id` ➔ `canonical_players(canonical_player_id)`
* **Schema Breakdown:**
  * `alias_id`: INTEGER PK
  * `canonical_player_id`: TEXT NOT NULL
  * `source_name`: TEXT NOT NULL (Sources: `canonical`, `csv_style`, `atp_wta_api`, `sofascore`)
  * `raw_name`: TEXT NOT NULL (Raw vendor token, e.g. `Sinner J.`, `Alcaraz C.`, `Djokovic N.`)
  * `normalized_token`: TEXT NOT NULL (Stripped of accents, lowercase, trimmed)
  * `is_verified`: INTEGER NOT NULL (0 or 1)
  * `has_sibling_conflict`: INTEGER NOT NULL (0 or 1; 95 aliases flagged with 1)
  * `created_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
* **Duplicate & Collision Analysis:**
  * **28 duplicate token groups** discovered in SQLite.
  * **27 groups are Same-Player duplicates:** Accented vs unaccented vendor variants mapping to the identical `canonical_player_id` (e.g. `baez s` ➔ `Baez S.` and `Báez S.`).
  * **1 group is a True Identity Conflict:** `jovic i` mapped to both `cp_dusan_lajovic` (`Jovic I.`) and `cp_iva_jovic` (`Jović I.`).
* **Canonical Status:** **Authoritative Token Resolution Dictionary**. Must be deduplicated during migration into PostgreSQL's `identity.player_aliases` unique constraint.

### 2.3 Tournament Identities: `canonical_tournaments`
* **File Path:** `G:/telegram-backend/data/database.sqlite`
* **Table Name:** `canonical_tournaments`
* **Row Count:** 1,183
* **Column Count:** 9
* **Primary Key:** `canonical_tourney_id` (TEXT, e.g. `ct_atp_wimbledon`, `ct_atp_roland_garros`)
* **Candidate Natural Key:** `(name_standard, tour)`
* **Schema Breakdown:**
  * `canonical_tourney_id`: TEXT PK (1,183 / 1,183 non-null)
  * `name_standard`: TEXT NOT NULL (Clean standard tournament title)
  * `tour`: TEXT NOT NULL (`ATP`: 781, `WTA`: 402)
  * `tour_level`: TEXT NOT NULL (`CHALLENGER`: 844, `ATP_250`: 249, `WTA_1000`: 28, `MASTERS_1000`: 23, `ATP_500`: 19, `GRAND_SLAM`: 15, `ITF`: 5)
  * `default_surface`: TEXT NOT NULL (`HARD`: 621, `CLAY`: 512, `GRASS`: 50)
  * `country_ioc`: TEXT NULL (Populated: 1,181 / 1,183; 2 NULLs)
  * `city`: TEXT NULL (Populated: 1,181 / 1,183; 2 NULLs)
  * `created_at`: TEXT NOT NULL
  * `updated_at`: TEXT NOT NULL
* **Duplicate Count:** 0 duplicates across `(name_standard, tour)`.
* **Canonical Status:** **Authoritative Tournament Baseline**.

### 2.4 Tournament Aliases: `tournament_aliases`
* **File Path:** `G:/telegram-backend/data/database.sqlite`
* **Table Name:** `tournament_aliases`
* **Row Count:** 1,378
* **Column Count:** 7
* **Primary Key:** `alias_id` (INTEGER AUTOINCREMENT)
* **Candidate Natural Key:** `(source_name, normalized_token)`
* **Foreign Key:** `canonical_tourney_id` ➔ `canonical_tournaments(canonical_tourney_id)`
* **Duplicate Analysis:**
  * Exactly **2 duplicate token groups** found:
    1. `bad homburg open powered by solarwatt bad homburg ger` (c=2): Double-space vs single-space formatting in raw name. Both map to `ct_wta_bad_homburg_open_powered_by_solarwatt_bad_homburg_ger`.
    2. `jiangxi open jiujiang chn` (c=2): Casing variation in raw city name (`Jiujiang` vs `JIUJIANG`). Both map to `ct_wta_jiangxi_open_jiujiang_chn`.
  * **0 cross-tournament conflicts.**
* **Canonical Status:** **Authoritative Tournament Resolution Dictionary**.

### 2.5 Player Profile Enrichment: `gold_player_profiles`
* **File Path:** `G:/state football/data/tennis_gold.sqlite`
* **Table Name:** `gold_player_profiles`
* **Row Count:** 12,309
* **Column Count:** 15
* **Primary Key:** `player_id` (INTEGER, RapidAPI / vendor ID)
* **Candidate Natural Key:** `slug` / `full_name`
* **Schema Breakdown:**
  * `player_id`: INTEGER PK
  * `full_name`: TEXT NOT NULL
  * `short_name`: TEXT NULL (e.g. `R. Gasquet`, `C. Alcaraz`)
  * `slug`: TEXT NULL (e.g. `gasquet-richard`, `alcaraz-carlos`)
  * `gender`: TEXT NULL (`M` / `F`)
  * `country_code`: TEXT NULL (2-letter ISO code, e.g. `FR`, `ES`, `IT`, `US`)
  * `plays_hand`: TEXT NULL (`right-handed`: 2,337, `left-handed`: 222, `NULL`: 9,750)
  * `height_cm`: REAL NULL (Populated: 2,842 / 12,309)
  * `weight_kg`: REAL NULL (Populated: 2,514 / 12,309)
  * `birth_timestamp`: INTEGER NULL (Unix epoch seconds; Populated: 4,374 / 12,309)
  * `turned_pro_year`: INTEGER NULL (Populated: 1,605 / 12,309)
  * `birth_city`: TEXT NULL
  * `residence_city`: TEXT NULL
* **Overlap with `canonical_players`:**
  * 1,053 out of 1,765 canonical players (59.7%) match by exact normalized name.
  * Provides verified `height_cm` for 736 canonical players.
  * Provides verified `birth_date` (from `birth_timestamp`) for 989 canonical players.
  * Provides verified `plays_hand` for 892 canonical players where SQLite currently has `NULL`.
* **Canonical Status:** **Secondary Enrichment Source** for biometrics and career milestones.

### 2.6 Public & WebApp Profiles: `players`
* **File Path:** `G:/telegram-backend/data/database.sqlite`
* **Table Name:** `players`
* **Row Count:** 300
* **Column Count:** 19
* **Primary Key:** `id` (INTEGER)
* **Candidate Natural Key:** `player_id` (RapidAPI ID) / `slug`
* **Unique Assets:** Contains curated AI dossiers (`ai_dossier_json`), surface-specific win rates (`surface_stats_json`), playstyle taxonomies, current top-300 rankings, and WebP avatar headshots.
* **Canonical Status:** **Tertiary Enrichment Source** for public-facing editorial and tactical profile fields.

---

## 3. External Source Identifiers & Namespaces

| Namespace | Format / Type | Example Value | Source Systems | Target Destination |
| :--- | :--- | :--- | :--- | :--- |
| `rapid_player_id` | Integer (32-bit) | `206570` (Sinner), `275322` (Alcaraz) | `tracked_players`, `gold_player_profiles`, `players` | `identity.player_aliases (source_name='rapidapi')` |
| `rapid_event_id` | Integer (32-bit) | `11925844`, `12489102` | `gold_matches_validated`, `player_match_index` | `raw.source_evidence(source_match_id)`, `provenance.source_match_links` |
| `historical_match_id`| Integer (32-bit)| `2024-1001`, `94812` | `historical_matches`, `canonical_matches` | `provenance.source_match_links(source_name='sackmann')` |
| `canonical_player_id`| String (`cp_*`) | `cp_jannik_sinner` | SQLite v2 Linker engine | Transitional bridge to `identity.players(player_id)` UUID |
| `canonical_tourney_id`| String (`ct_*`) | `ct_atp_wimbledon` | SQLite v2 Linker engine | Transitional bridge to `identity.tournaments(tournament_id)` UUID |

---

## 4. Existing Merge, Conflict & Linker Logic

The linker engine in `src/linker/` currently implements:
1. **Symmetric Candidate Pairing:** Pairs matches using strictly ordered entrant IDs (`player_low_id < player_high_id`).
2. **Deterministic Veto Rules (8 Hard Gates):**
   * Temporal date drift $> \pm 1$ day.
   * Entrant identity contradiction (non-matching player IDs).
   * Contradicting match outcomes (Source A winner $\ne$ Source B winner).
   * Incompatible set scores (e.g. `2-0` vs `0-2`).
   * Sibling alias ambiguity (unverified surname match with `has_sibling_conflict = 1`).
   * Tour level contradiction (e.g. Grand Slam vs Challenger).
   * Surface contradiction (e.g. Clay vs Grass).
   * Walkover/retirement status inversion.
3. **Review Queue Routing:** All candidate merges scoring between 70.00 and 89.99, or triggering a soft veto, are routed to `match_review_queue` with optimistic locking (`lock_version = 1`) and immutable audit logging to `match_review_audit_log`.

---

## 5. Read-Only Safety Verification

* All source SQLite connections are opened exclusively with `{ readonly: true }`.
* Zero PRAGMA writes (`foreign_keys = ON`, `journal_mode = WAL`) are issued against production files during dry-run inspection.
* Physical database byte sizes and timestamps remain unchanged:
  * `G:/telegram-backend/data/database.sqlite`: 544,415,744 bytes (Unmutated)
  * `G:/state football/data/tennis_gold.sqlite`: 283,303,936 bytes (Unmutated)
