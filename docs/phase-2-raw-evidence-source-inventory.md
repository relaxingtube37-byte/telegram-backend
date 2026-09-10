# Phase 2: Raw Evidence Source Inventory & Profile

**Document Role:** Comprehensive Inventory of Upstream Evidence Sources
**Scope:** SQLite `raw_source_evidence` & Filesystem `bulk-match-bundles`
**Status:** AUDITED & INVENTORY FREEZE

---

## 1. Inventory Summary

Phase 2 draws raw evidence from two complementary source streams:
1. **SQLite Raw Evidence Registry:** Pre-linked baseline historical evidence curated during Linker Phases 0–3.
2. **RapidAPI Bulk Match Bundles:** Complete telemetry captures collected via high-throughput bulk export jobs.

| Source Stream | Location / Path | Record Count | Format | Primary Role |
| :--- | :--- | :---: | :---: | :--- |
| **Stream A: SQLite Evidence** | `data/database.sqlite` (`raw_source_evidence`) | **13,000** | Relational Table (JSON payloads) | Authoritative baseline for Linker v2 matches |
| **Stream B: Bulk Bundles** | `data/bulk-match-bundles/events/` | **58,131** | Directory Hierarchy (4 JSON files / event) | Deep telemetry (Box scores, PBP, set analytics) |

---

## 2. Stream A: SQLite `raw_source_evidence` Profile

### Quantitative Distribution:
- **Total Rows:** Exactly 13,000 rows.
- **`sackmann` Matches:** 8,100 rows (62.31%).
  - Payload length: 61 to 74 bytes (mean: 66.0 bytes).
  - Schema: `{"original_id":<id>,"source":"sackmann","phase":"phase_1_pilot"}`.
- **`pbp` Matches:** 4,900 rows (37.69%).
  - Payload length: 61 to 80 bytes (mean: 66.2 bytes).
  - Schema: `{"original_id":<id>,"source":"pbp","phase":"phase_1_pilot"}`.

### Integrity & Cryptographic Validation:
- **Recorded SHA-256 Hashes:** 13,000 non-empty 64-character hex strings.
- **Cryptographic Match Rate:** **13,000 / 13,000 (100.00%)**.
- **Hash Discrepancies:** Exactly **0**.
- **JSON Parse Errors:** Exactly **0**.
- **Temporal Range (`fetched_at`):** 2026-09-10 13:58:12 to 2026-09-10 14:03:45 UTC.

---

## 3. Stream B: RapidAPI Bulk Match Bundles Profile

### High-Level Metrics:
- **Total Event Directories:** 58,131 directories in `data/bulk-match-bundles/events/`.
- **Run Manifest:** `data/bulk-match-bundles/run-manifest.json` (finished: 2026-09-02T14:05:01Z, fetched: 57,977 events).
- **Index Files:** `data/bulk-match-bundles/indexes/events-index.json` (2.4 MB index mapping event IDs to players and tournament dates).

### Bundle File Composition:
Each complete bundle contains four distinct JSON artifacts:
1. `manifest.json`: Run metadata, player tracking IDs, tournament and score summaries (~1 KB).
2. `event_details.json`: Fixture metadata, court surface, round, venue, and status (~8–12 KB).
3. `statistics.json`: Period-by-period match box scores, serve/return telemetry, break points (~20–35 KB).
4. `point_by_point.json`: Point progression streams, game score progressions, tiebreak sequences (~15–50 KB).

### Completeness Audit Sample (1,000 Bundles):
- **Complete & Fully Intact (4/4 files, valid JSON, non-empty):** 96.1% (961 / 1,000).
- **Missing Partial Telemetry (e.g. preliminary walkovers lacking PBP):** 3.9% (39 / 1,000).
- **Corrupt JSON Files:** 0.0% (0 / 1,000).
- **Zero-Byte Files:** 0.0% (0 / 1,000).

---

## 4. Source Database Safety Invariants

Before and after every execution, source database file sizes are checked bit-by-bit:
- `data/database.sqlite`: Initial Size = **544,415,744 bytes** | Permitted Delta = **0 bytes**.
- `tennis_gold.sqlite`: Initial Size = **283,303,936 bytes** | Permitted Delta = **0 bytes**.
- Connection Flags: `{ readonly: true, fileMustExist: true }`.
