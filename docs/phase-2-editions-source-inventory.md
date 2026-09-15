# Phase 2 Source Inventory: Tournament Editions & Calendars (2021–2026)

**Branch:** `staging/phase-1-ingestion-spec`
**Execution Mode:** READ-ONLY / DRAFT-ONLY
**Target PostgreSQL Entity:** `competition.tournament_editions`
**Scope:** Annual Tournament Editions across ATP, WTA, and Challenger tours (Calendar Years 2021–2026)

---

## 1. Executive Source Matrix

| # | Source Name | Source Type & Path | Total Rows | 2021–2026 Records | Key Edition Fields | Primary Strength | Read-Only Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **S1** | `canonical_tournaments` | SQLite Table (`data/database.sqlite`) | 1,183 | 1,183 | `canonical_tourney_id`, `name_standard`, `tour`, `default_surface`, `tour_level` | **Phase 1 Master Tournament Registry (Parent PKs)** | Verified (`{ readonly: true }`) |
| **S2** | `tournament_aliases` | SQLite Table (`data/database.sqlite`) | 1,378 (1,376 deduped) | 1,376 | `alias_id`, `canonical_tourney_id`, `source_name`, `normalized_token` | **Phase 1 Deterministic Tournament Lookup** | Verified (`{ readonly: true }`) |
| **S3** | `canonical_matches_v2` | SQLite Table (`data/database.sqlite`) | 7,505 | 7,505 | `canonical_tourney_id`, `match_date`, `surface`, `tour` | **Highest Confidence / Explicit FK Linking** | Verified (`{ readonly: true }`) |
| **S4** | `historical_matches` | SQLite Table (`data/database.sqlite`) | 115,223 | 115,223 (100%) | `tourney_name`, `tour`, `tourney_id`, `match_date`, `surface`, `draw_size` | **Primary Draw Size & Match Span Source** | Verified (`{ readonly: true }`) |
| **S5** | `canonical_matches` (v1) | SQLite Table (`data/database.sqlite`) | 140,432 | 140,432 (100%) | `tourney_name`, `tour`, `canonical_match_date`, `surface`, `tourney_level` | **Comprehensive Match Coverage (2021–2026)** | Verified (`{ readonly: true }`) |
| **S6** | `gold_matches_validated` | SQLite Table (`data/database.sqlite`) | 57,977 | 57,977 (2024–2026) | `tourney_name`, `tour`, `match_date`, `surface_raw`, `surface` | **Telemetry & Live Feed Alignment** | Verified (`{ readonly: true }`) |
| **S7** | `PRE_POPULATED_VENUES` | TypeScript Catalog (`state football/src/venue/prePopulatedVenues.ts`) | 85 master venues | Evergreen | `cpiScore`, `officialBall`, `surfaceBrand`, `hasRoof`, `altitudeM` | **Court Pace Index & Ball Brand Enrichment** | Static File Reference |
| **S8** | `TOURNAMENT_VENUE_DATA` | TypeScript Catalog (`state football/src/tournamentVenueData.ts`) | 62 venue dossiers | Evergreen | `altitude`, `timezone`, `city`, `lat`, `lon` | **Geographical & Environmental Intel** | Static File Reference |
| **S9** | Season CSV Files | CSV Files (`state football/2021-2026-data/`) | 6 files (~18 MB) | 2024–2026 | ATP & WTA Season CSV dumps | **Raw Sackmann / TennisMyLife Ground Truth** | File System Reference |

---

## 2. Granular Source Analysis

### 2.1 Parent Registry: `canonical_tournaments` (Source S1)
* **File:** `G:/telegram-backend/data/database.sqlite`
* **Table:** `canonical_tournaments`
* **Row Count:** 1,183
* **Primary Key:** `canonical_tourney_id` (TEXT, e.g. `ct_atp_wimbledon`, `ct_wta_roland_garros`)
* **Role in Phase 2:** Every non-quarantined edition **MUST** resolve its foreign key `tournament_id` to the deterministic UUIDv5 generated from this table in Phase 1 (`identity.tournaments`).
* **Attributes:** Standardized tournament name, tour (`ATP` or `WTA`), tour level (`GRAND_SLAM`, `MASTERS_1000`, `ATP_500`, etc.), default surface (`Hard`, `Clay`, `Grass`).

### 2.2 Token Resolution: `tournament_aliases` (Source S2)
* **File:** `G:/telegram-backend/data/database.sqlite`
* **Table:** `tournament_aliases`
* **Row Count:** 1,378 raw rows (1,376 deduplicated target tokens)
* **Foreign Key:** `canonical_tourney_id` ➔ `canonical_tournaments(canonical_tourney_id)`
* **Role in Phase 2:** Resolves raw tournament names appearing in match feeds (e.g. `'The Championships'`, `'Roland Garros (French Open)'`, `'Mutua Madrid Open'`) into canonical tournament IDs.

### 2.3 Shadow Linker Matches: `canonical_matches_v2` (Source S3)
* **File:** `G:/telegram-backend/data/database.sqlite`
* **Table:** `canonical_matches_v2`
* **Row Count:** 7,505 rows (all within 2021–2025)
* **Edition Coverage:** Exactly 299 distinct `(canonical_tourney_id, year)` pairs.
* **Key Strengths:**
  * Contains explicit `canonical_tourney_id` on every row (100% resolution rate to `canonical_tournaments`).
  * Surface and date data have undergone multi-source consensus vetting during linker dry-runs.
  * Serves as Tier 1 authoritative truth for edition dates and surfaces where available.

### 2.4 Historical Match Base: `historical_matches` (Source S4)
* **File:** `G:/telegram-backend/data/database.sqlite`
* **Table:** `historical_matches`
* **Row Count:** 115,223 rows (100% within 2021–2026)
* **Year Breakdown:**
  * 2021: 14,305 matches across 633 raw tournament names
  * 2022: 17,415 matches across 828 raw tournament names
  * 2023: 18,653 matches across 927 raw tournament names
  * 2024: 22,388 matches across 945 raw tournament names
  * 2025: 23,372 matches across 1,061 raw tournament names
  * 2026: 19,090 matches across 803 raw tournament names
* **Distinct Raw Groups:** 5,214 distinct `(tourney_name, tour, year)` groups.
* **Resolution Performance:**
  * 2,987 groups resolve directly via `name_standard`.
  * 1,166 groups resolve via `tournament_aliases`.
  * 1,061 groups represent qualifications, exhibitions, team events, or unmapped sponsor tokens (routed to quarantine).
* **Key Strengths:**
  * Only database table containing `draw_size` integers (e.g. 128, 64, 32, 28, 16).
  * Covers entire 2021–2026 span without gaps.

### 2.5 Operational Match Pool: `canonical_matches` (Source S5)
* **File:** `G:/telegram-backend/data/database.sqlite`
* **Table:** `canonical_matches`
* **Row Count:** 140,432 rows (100% within 2021–2026)
* **Year Breakdown:**
  * 2021: 14,298 matches
  * 2022: 17,406 matches
  * 2023: 18,644 matches
  * 2024: 33,657 matches
  * 2025: 32,728 matches
  * 2026: 23,699 matches
* **Distinct Raw Groups:** 5,226 distinct `(tourney_name, tour, year)` groups.
* **Role in Phase 2:** Cross-validates edition boundary dates (`min(date)`, `max(date)`) and captures matches from RapidAPI-only events not present in pure historical Sackmann files.

### 2.6 RapidAPI Bundle Pool: `gold_matches_validated` (Source S6)
* **File:** `G:/telegram-backend/data/database.sqlite`
* **Table:** `gold_matches_validated`
* **Row Count:** 57,977 rows (2024–2026)
* **Key Observations:**
  * Contains unnormalized RapidAPI string literals including country names, qualification tags, and doubles indicators (e.g. `'ATP Rome Masters, Italy'`, `'Abidjan 2, Cote d Ivoire'`, `'US Open, New York, USA, Qualifying'`).
  * Used as supplementary date validation for 2024–2026 tournaments.

### 2.7 Venue Intelligence & Technical Catalog: `prePopulatedVenues.ts` (Source S7)
* **File:** `G:/state football/src/venue/prePopulatedVenues.ts`
* **Object:** `PRE_POPULATED_VENUES`
* **Key Attributes:**
  * `cpiScore`: Court Pace Index integer (e.g. 41 for US Open, 37 for Australian Open, 24 for Roland Garros). Directly populates `competition.tournament_editions.court_pace_index`.
  * `officialBall`: Manufacturer and model (e.g. `'Wilson US Open Extra Duty'`, `'Dunlop Australian Open'`). Directly populates `competition.tournament_editions.balls_brand`.
  * `hasRoof`: Boolean indicating retractable stadium roof.

---

## 3. Quarantined & Conflict Categories

When candidate tournament records from match feeds cannot be conclusively proven to map to a canonical tournament, they are segregated into `phase-2-editions-conflicts.jsonl` under one of the following deterministic classifications:

1. `QUALIFICATION_DRAWS`: Matches belonging to preliminary qualifying rounds (e.g. `'Acapulco Chall. Men - Qualification'`, `'Alicante Chall. Men - Qualification'`). In standard tennis domain modeling, qualifying rounds are considered sub-events of the main tournament edition rather than independent editions.
2. `EXHIBITION_EVENTS`: Unsanctioned exhibition matches (e.g. `'Abu Dhabi Exhibition Men'`).
3. `TEAM_COMPETITIONS`: Non-tour team ties (e.g. `'ATP Cup ATP - Play Offs'`, `'Davis Cup'`).
4. `UNMAPPED_SPONSOR_STRING`: Feeds using localized or temporary commercial sponsor titles not currently cataloged in `tournament_aliases` (e.g. `'Abierto GNP Seguros - Monterrey, MEX'`).
5. `TEMPORAL_OUT_OF_BOUNDS`: Any fixture falling outside the mandated 2021–2026 scope.

---

## 4. Read-Only Safety Verification

* All source database connections are opened exclusively with `{ readonly: true, fileMustExist: true }`.
* File timestamps and byte sizes of all SQLite databases remain strictly invariant throughout Phase 2 execution.
