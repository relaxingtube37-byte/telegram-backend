# PostgreSQL Phase 3: Identity & Tournament Editions Migration Specification

**Document Role:** Authoritative Architectural Design, Ingestion Strategy & Data Dictionary  
**Target Engine:** Disposable Local PostgreSQL Staging Cluster (Port 54346)  
**Execution Script:** [`scripts/run-postgres-phase-3-identity.cjs`](file:///G:/telegram-backend/scripts/run-postgres-phase-3-identity.cjs)  
**Phase Status:** PHASE 3 COMPLETE (12/12 GATES PASS)

---

## 1. Executive Summary & Migration Scope

The objective of **PostgreSQL Phase 3: Identity and Tournament Editions Migration** is to establish the canonical entity registry layer (`identity` and `competition` schemas) in the canonical PostgreSQL relational architecture.

This phase imports canonical players, player aliases, canonical tournaments, tournament aliases, and verified tournament editions, while maintaining strict isolation, zero mutation of existing Phase 2 provenance records, zero modification to authoritative SQLite databases, and strict dual-run idempotency.

### Target Schemas & Tables:
1. **`identity.players`:** Exactly **1,765** canonical player entities enriched with exact-match profiles from `gold_player_profiles`.
2. **`identity.player_aliases`:** Exactly **2,833** admitted aliases (out of 2,861 raw aliases accounted for; 27 duplicate tokens deduplicated, 1 cross-player token collision quarantined to `provenance.review_queue`).
3. **`identity.tournaments`:** Exactly **1,183** canonical tournament competitions across ATP, WTA, and Challenger circuits.
4. **`identity.tournament_aliases`:** Exactly **1,376** admitted tournament aliases (out of 1,378 raw aliases accounted for; 2 duplicate tokens deduplicated).
5. **`competition.tournament_editions`:** Exactly **3,466** verified tournament editions where an authoritative parent tournament mapping exists.
6. **`provenance.review_queue`:** Exactly **1,224** items (Phase 2 baseline of 1,223 + 1 quarantined ambiguous token collision `jovic i`).
7. **`matches.*` & `statistics.*`:** Strictly **0** rows imported (no matches or boxscore statistics in Phase 3).

---

## 2. Input Artifacts & Migration Lineage

```
scratch/phase-3-identity-output/
 ├── identity_players.jsonl            (1,765 rows)  ──────► identity.players
 ├── identity_player_aliases.jsonl     (2,833 rows)  ──────► identity.player_aliases
 ├── identity_tournaments.jsonl        (1,183 rows)  ──────► identity.tournaments
 ├── identity_tournament_aliases.jsonl (1,376 rows)  ──────► identity.tournament_aliases
 └── phase-3-identity-conflicts.jsonl  (1 row)       ──────► provenance.review_queue

scratch/phase-4-competition-editions-output/
 └── competition_tournament_editions.jsonl (3,466 rows) ──► competition.tournament_editions

scratch/tennismylife-staging-admission/ (Phase 2 Provenance Baseline - Invariant)
 ├── source-evidence-staging.jsonl     (13,263 rows) ──────► raw.source_evidence (Unchanged)
 ├── match-link-staging.jsonl          (3,807 rows)  ──────► provenance.source_match_links (Unchanged)
 ├── field-provenance-staging.jsonl    (186 rows)    ──────► provenance.field_provenance (Unchanged)
 └── approval-queue.jsonl              (1,223 rows)  ──────► provenance.review_queue (+1 collision item)
```

---

## 3. Detailed Data Dictionary & Mapping Rules

### 3.1. `identity.players` (Canonical Player Registry)

| Column | Type | Constraints | Source Field / Transformation | Description |
| :--- | :--- | :--- | :--- | :--- |
| `player_id` | `UUID` | `PRIMARY KEY` | `player_id` | Deterministic UUIDv5 generated from `canonical_player:<id>`. |
| `full_name_standard` | `TEXT` | `NOT NULL` | `full_name_standard` | Canonical normalized full name (e.g. "Jannik Sinner"). |
| `first_name` | `TEXT` | `NULL` | `first_name` | First name if available; authentic `NULL` preserved. |
| `last_name` | `TEXT` | `NOT NULL` | `last_name` | Family name / surname. |
| `birth_date` | `DATE` | `NULL` | `gold_player_profiles.birth_timestamp` | Converted from Unix epoch seconds to ISO `YYYY-MM-DD`. `NULL` if absent. |
| `country_ioc` | `CHAR(3)` | `NULL` | `ioc_country` / `country_code` | 3-letter IOC code (e.g. `ITA`, `ESP`, `USA`). |
| `gender` | `identity.gender_code`| `NOT NULL` | `gender` | Enum: `'M'`, `'F'`, `'MIXED'`. |
| `hand` | `identity.player_hand`| `NOT NULL` | `hand` / `plays_hand` | Enum: `'R'`, `'L'`, `'Ambi'`, default `'Unknown'`. Never assumed without evidence. |
| `height_cm` | `SMALLINT` | `140 <= val <= 230` | `height_cm` | Biographical height from gold profiles; out-of-bounds sanitized to `NULL`. |
| `weight_kg` | `SMALLINT` | `40 <= val <= 130` | `weight_kg` | Biographical weight from gold profiles; out-of-bounds sanitized to `NULL`. |
| `turned_pro_year` | `SMALLINT` | `1968 <= val <= 2035`| `turned_pro_year` | Year player turned pro; out-of-bounds sanitized to `NULL`. |
| `ranking_current` | `INTEGER` | `NULL` | `NULL` | Reserved for live ranking ingestion (Phase 7+). |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | `created_at` | Immutable creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL` | `updated_at` | Last updated timestamp. |

#### Biographical Enrichment Constraints:
1. **Exact Canonical Match Only:** Only profiles from `gold_player_profiles` whose exact normalized name matches the canonical standard are admitted.
2. **Never Overwrite Non-Null:** Canonical attributes in SQLite take precedence; enrichment only populates missing attributes.
3. **Preserve Authentic NULL:** Never synthesize fake default birthdays or physical stats.
4. **Never Create Unresolved Players:** Ingestion strictly binds to the 1,765 canonical entities.

---

### 3.2. `identity.player_aliases` (Source Token Mappings)

| Column | Type | Constraints | Transformation & Handling |
| :--- | :--- | :--- | :--- |
| `alias_id` | `UUID` | `PRIMARY KEY` | Deterministic UUIDv5 (`player_alias:<id>`). |
| `player_id` | `UUID` | `REFERENCES identity.players(player_id)` | Foreign key to canonical player parent. |
| `source_name` | `VARCHAR(50)` | `NOT NULL` | Source identifier (`csv_style`, `flashscore`, `rapidapi`, etc.). |
| `raw_name` | `TEXT` | `NOT NULL` | Unmodified external name string (e.g. "Alcaraz C."). |
| `normalized_token` | `TEXT` | `NOT NULL` | Lowercase alphanumeric ASCII token (e.g. "alcaraz c"). |
| `is_verified` | `BOOLEAN` | `NOT NULL DEFAULT FALSE` | Set to `TRUE` for unique disambiguated mappings. |
| `has_sibling_conflict`| `BOOLEAN` | `NOT NULL DEFAULT FALSE` | Preserves sibling-conflict flag for players sharing initial/surname (e.g. Alcaraz C., Zverev A., Cerundolo F.). |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | Ingestion timestamp. |

- **Natural Key Constraint:** `CONSTRAINT uq_identity_player_aliases_source_token UNIQUE (source_name, normalized_token)`.
- **Accounting Breakdown:** 2,861 total aliases = 2,833 admitted + 27 duplicate tokens deduplicated + 1 true cross-player collision quarantined.

---

### 3.3. `identity.tournaments` (Canonical Tournament Registry)

| Column | Type | Constraints | Transformation & Handling |
| :--- | :--- | :--- | :--- |
| `tournament_id` | `UUID` | `PRIMARY KEY` | Deterministic UUIDv5 (`canonical_tourney:<id>`). |
| `name_standard` | `TEXT` | `NOT NULL` | Standardized canonical competition name (e.g. "Roland Garros", "Acapulco"). |
| `tour` | `identity.tour_code` | `NOT NULL` | Enum: `'ATP'`, `'WTA'`, `'ITF'`, `'CHALLENGER'`, `'COMBINED'`. |
| `tour_level` | `VARCHAR(30)` | `NOT NULL` | Classification level (`GRAND_SLAM`, `MASTERS_1000`, `ATP_500`, `ATP_250`, `CHALLENGER`, `WTA_1000`, etc.). |
| `default_surface` | `competition.surface_type` | `NOT NULL` | Default court surface (`'Hard'`, `'Clay'`, `'Grass'`, `'Carpet'`, `'Unknown'`). |
| `country_ioc` | `CHAR(3)` | `NULL` | Host country IOC code. |
| `city` | `TEXT` | `NULL` | Host city name. |
| `altitude_meters` | `SMALLINT` | `-500 <= val <= 5000` | Venue altitude in meters above sea level. |
| `is_indoor` | `BOOLEAN` | `NOT NULL DEFAULT FALSE` | Indoor/outdoor indicator. |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | Ingestion timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL` | Last update timestamp. |

- **Natural Key Constraint:** `CONSTRAINT uq_identity_tournaments_name_tour UNIQUE (name_standard, tour)`.

---

### 3.4. `identity.tournament_aliases` (Tournament Source Token Mappings)

| Column | Type | Constraints | Transformation & Handling |
| :--- | :--- | :--- | :--- |
| `alias_id` | `UUID` | `PRIMARY KEY` | Deterministic UUIDv5 (`tournament_alias:<id>`). |
| `tournament_id` | `UUID` | `REFERENCES identity.tournaments(tournament_id)` | Foreign key to canonical tournament parent. |
| `source_name` | `VARCHAR(50)` | `NOT NULL` | External provider key (`flashscore`, `csv_style`, etc.). |
| `raw_name` | `TEXT` | `NOT NULL` | Provider tournament string. |
| `normalized_token` | `TEXT` | `NOT NULL` | Normalized tournament string for token matching. |
| `is_verified` | `BOOLEAN` | `NOT NULL DEFAULT FALSE` | Verification state. |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | Ingestion timestamp. |

- **Natural Key Constraint:** `CONSTRAINT uq_identity_tournament_aliases_source_token UNIQUE (source_name, normalized_token)`.
- **Accounting Breakdown:** 1,378 total aliases = 1,376 admitted + 2 duplicate tokens deduplicated.

---

### 3.5. `competition.tournament_editions` (Calendar Edition Registry)

| Column | Type | Constraints | Transformation & Handling |
| :--- | :--- | :--- | :--- |
| `edition_id` | `UUID` | `PRIMARY KEY` | Deterministic UUIDv5 (`competition_edition:<tourney_id>:<year>`). |
| `tournament_id` | `UUID` | `REFERENCES identity.tournaments(tournament_id)` | Foreign key to canonical parent tournament (100% resolution required). |
| `year` | `SMALLINT` | `1968 <= val <= 2040` | Calendar year of edition. |
| `edition_name` | `TEXT` | `NOT NULL` | Display edition title (e.g. "Acapulco 2021"). |
| `start_date` | `DATE` | `NOT NULL` | Opening tournament fixture date. |
| `end_date` | `DATE` | `NOT NULL CHECK (end_date >= start_date)` | Final fixture date. |
| `actual_surface` | `competition.surface_type` | `NOT NULL` | Actual tournament edition surface. |
| `draw_size` | `SMALLINT` | `4 <= val <= 128` | Main draw singles bracket size. |
| `court_pace_index` | `SMALLINT` | `10 <= val <= 100` | Measured court pace index. |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | Ingestion timestamp. |

- **Natural Key Constraint:** `CONSTRAINT uq_competition_tournament_editions_tourney_year UNIQUE (tournament_id, year)`.
- **Authoritative Invariant:** Only editions with an authoritative canonical parent tournament in `identity.tournaments` are admitted (3,466 total).

---

## 4. Ambiguity Quarantine & Sibling-Conflict Isolation

### Collision Incident: `csv_style::jovic i`
- **Conflict Description:** Token `jovic i` maps ambiguously to two distinct canonical players:
  1. `cp_dusan_lajovic` (raw: "Jovic I.") - legacy abbreviated parsing artifact
  2. `cp_iva_jovic` (raw: "Jović I.") - WTA professional player
- **Ingestion Handling:**
  - Token is decoupled from automatic canonical assignment.
  - Sibling-conflict flag is asserted.
  - Quarantined into `provenance.review_queue`:
    - `staging_id`: Deterministic UUID derived from `IDENTITY_CONFLICT:csv_style::jovic i`.
    - `candidate_match_id`: `NULL`.
    - `incoming_source`: `'csv_style'`.
    - `incoming_source_id`: `'IDENTITY_CONFLICT:jovic i'`.
    - `veto_triggers`: `ARRAY['CROSS_PLAYER_TOKEN_COLLISION', 'SIBLING_AMBIGUITY']::text[]`.
    - `review_status`: `'ISOLATED_CONFLICT_REVIEW'`.

---

## 5. Quality Acceptance Gates (12/12)

| Gate | Criterion | Validation Target | Target Invariant |
| :--- | :--- | :---: | :--- |
| **G1** | Canonical Players Count | **1,765** | 100% of canonical players imported with enriched attributes. |
| **G2** | Player Aliases Accounted For | **2,861** | 2,833 admitted, 27 deduplicated, 1 conflict queued. |
| **G3** | Canonical Tournaments Count | **1,183** | 100% of canonical tournaments imported. |
| **G4** | Tournament Aliases Accounted For | **1,378** | 1,376 admitted, 2 deduplicated. |
| **G5** | Authoritative Editions Count | **3,466** | 100% of editions resolve to authoritative parent. |
| **G6** | Zero Orphan Aliases | **0** | Foreign keys for player and tournament aliases strictly validated. |
| **G7** | Phase 2 Provenance Invariance | **13,263 / 3,807 / 186** | Phase 2 evidence, links, and field provenance 100% unchanged. |
| **G8** | Zero Match & Statistics Import | **0 / 0** | `matches.matches` and `statistics.*` strictly empty. |
| **G9** | Dual-Run Idempotency | **+0 rows** | Second pass execution is 100% no-op. |
| **G10** | Cryptographic Determinism | **Bitwise Identical** | Table content MD5 digests identical across runs. |
| **G11** | Zero SQLite Mutation | **$\Delta = 0$ bytes** | `database.sqlite` and `tennis_gold.sqlite` bitwise unchanged. |
| **G12** | Zero Production Contact | **Port 54346** | Strictly isolated to disposable local PostgreSQL staging cluster. |
