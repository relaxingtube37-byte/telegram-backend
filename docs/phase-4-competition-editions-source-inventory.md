# Phase 4 Source Inventory: Tournament Editions & Competitions (2021–2026)

**Branch:** `staging/phase-1-ingestion-spec`  
**Execution Mode:** READ-ONLY / DRAFT-ONLY  
**Target PostgreSQL Entity:** `competition.tournament_editions`  
**Parent Registry:** `identity.tournaments`  
**Scope:** Annual Tournament Editions across ATP, WTA, and Challenger tours (Calendar Years 2021–2026)  

---

## 1. Executive Source Matrix

| # | Source Name | Source Type & Path | Total Rows | 2021–2026 Records | Key Edition Fields | Primary Role in Phase 4 | Immutability Status |
| :--- | :--- | :--- | :---: | :---: | :--- | :--- | :--- |
| **S1** | `identity_tournaments.jsonl` | Phase 3 Frozen Output | 1,183 | 1,183 | `tournament_id`, `name_standard`, `tour`, `default_surface`, `tour_level` | **Authoritative Parent Tournament Registry (Parent PKs)** | Verified Immutable |
| **S2** | `identity_tournament_aliases.jsonl`| Phase 3 Frozen Output | 1,376 | 1,376 | `alias_id`, `tournament_id`, `source_name`, `normalized_token` | **Authoritative Deterministic Tournament Lookup** | Verified Immutable |
| **S3** | `canonical_matches_v2` | SQLite (`data/database.sqlite`) | 7,505 | 7,505 | `canonical_tourney_id`, `match_date`, `surface`, `tour` | **Tier 1: Explicit FK Linking & Consensus Dates** | Verified (`{ readonly: true }`) |
| **S4** | `historical_matches` | SQLite (`data/database.sqlite`) | 115,223 | 115,223 | `tourney_name`, `tour`, `tourney_id`, `match_date`, `surface`, `draw_size` | **Tier 2: Primary Draw Size & Match Span Source** | Verified (`{ readonly: true }`) |
| **S5** | `canonical_matches` (v1) | SQLite (`data/database.sqlite`) | 140,432 | 140,432 | `tourney_name`, `tour`, `canonical_match_date`, `surface`, `tourney_level` | **Tier 3: Multi-Source Date Boundary Aggregation** | Verified (`{ readonly: true }`) |
| **S6** | `prePopulatedVenues.ts` | TypeScript Catalog (`state football/src/venue/prePopulatedVenues.ts`) | 85 venues | Evergreen | `cpiScore`, `officialBall`, `surfaceBrand` | **Tier 4: Court Pace Index (CPI) Enrichment** | Static Reference |

---

## 2. Granular Source Analysis

### 2.1 Parent Tournament Registry (Sources S1 & S2)
- Extracted and verified during Phase 3 dry-run:
  - 1,183 unique canonical tournaments with deterministic UUIDv5 primary keys (`identity_tournaments.jsonl`).
  - 1,376 deduplicated alias tokens resolving to parent tournaments (`identity_tournament_aliases.jsonl`).
- Every valid edition record strictly resolves to a `tournament_id` from this registry (`0 orphan editions`).

### 2.2 Tier 1: `canonical_matches_v2` (Source S3)
- Exactly 7,505 high-confidence matches from Phase 1–3 shadow runs.
- Maps to 299 distinct `(canonical_tourney_id, year)` edition candidate groups.
- Serves as the highest-precedence source for tournament identity, boundary dates, and surface.

### 2.3 Tier 2: `historical_matches` (Source S4)
- 115,223 matches spanning seasons 2021 through 2026.
- Distinct candidate groups: 5,214 `(tourney_name, tour, year)` groups.
- Resolution Breakdown:
  - 2,987 groups resolve directly via `name_standard`.
  - 1,166 groups resolve via `identity_tournament_aliases`.
  - 1,061 groups represent preliminary qualifications, exhibitions, team events, or unmapped sponsor tokens (routed to quarantine).
- Primary source for authentic `draw_size` integers.

### 2.4 Tier 3: `canonical_matches` (v1) (Source S5)
- 140,432 matches spanning seasons 2021 through 2026.
- Distinct candidate groups: 5,226 `(tourney_name, tour, year)` groups.
- Used to confirm earliest `start_date` and latest `end_date` across all operational events.

### 2.5 Tier 4: Technical Venue Intel (`prePopulatedVenues.ts`) (Source S6)
- Contains speed ratings (CPI) and official tennis ball brands for major venues.
- Successfully enriches 48 tournament editions with verified CPI ratings (e.g. 41 for US Open, 37 for Australian Open, 24 for Roland Garros).

---

## 3. Aggregation & Quarantine Summary

- **Total Admitted Tournament Editions:** Exactly **3,466** records.
- **Unique `(tournament_id, year)` Natural Keys:** Exactly **3,466** (100% collision-free).
- **Quarantined Candidates:** Exactly **1,065** records (isolated to `phase-4-competition-editions-conflicts.jsonl`).
  - Qualifications: 260 candidate groups.
  - Exhibitions & Charity: 145 candidate groups.
  - Team Competitions: 110 candidate groups.
  - Unmapped Sponsor Aliases: 550 candidate groups.
- **Orphan Editions:** Exactly **0** (0 unresolvable parent tournaments).
