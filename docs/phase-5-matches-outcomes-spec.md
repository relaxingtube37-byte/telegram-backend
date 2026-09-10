# Phase 5: Matches & Outcomes Pipeline Specification

## 1. Executive Overview

This specification establishes the architectural, mathematical, and data integrity standards for **Phase 5: Matches & Outcomes Pipeline** within the tennis AI modeling and sports state platform.

The Phase 5 pipeline ingests match fixtures, assigns deterministic identities, enforces symmetric participant pairing (zero lookahead bias), decouples pre-match fixtures from post-match outcomes, maintains rich cross-source provenance, and reconciles incoming records against the operational baseline view (`canonical_matches_operational`).

---

## 2. Architectural Invariants & Guarantees

### 2.1 Schema Layering & Entity Separation
The pipeline strictly adheres to the canonical PostgreSQL 16 schema defined in `db/postgres-schema-v1.sql`:
1. **`matches.matches` (Core Fixture Lifecycle):**
   - Represents the pre-match fixture scheduled within a specific tournament edition.
   - Contains temporal timestamps (`scheduled_start_utc`, `actual_start_utc`), round nomenclature, match format (`best_of` 3 or 5), surface, indoor status, and execution state (`status`).
   - Completely independent of the match winner or score.
2. **`matches.match_participants` (Symmetric Participant Layer):**
   - Exactly two participant records per match (`side = 1` and `side = 2`).
   - Symmetrical ordering invariant: Player with the lexicographically smaller UUID is assigned to `side = 1`, and the larger UUID to `side = 2` ($p_1 < p_2$).
   - **Zero Lookahead Bias:** The `is_winner` flag is kept strictly decoupled / `NULL` in the participant layer to eliminate predictive leakage in training and inference pipelines.
   - Pre-match telemetry (seed, entry status, pre-match ATP/WTA ranking, and ranking points) is captured cleanly per participant.
3. **`matches.match_results` (Settled Outcome Layer):**
   - Exclusively models final match outcomes: `winner_player_id`, `loser_player_id`, `score_string`, `duration_minutes`, and `is_retirement_or_wo`.
   - Invariant: `winner_player_id` and `loser_player_id` must strictly belong to the two participants of the referenced match.
   - Invariant: Matches that are `SCHEDULED`, `IN_PROGRESS`, `CANCELLED`, or unsettled remain in `matches.matches` and **never** enter `matches.match_results`.
4. **`provenance.source_match_links` & `provenance.field_provenance`:**
   - Multi-source cross-linking: Records from modern consensus, legacy canonical, and historical archives are unified to a single canonical `match_id`.
   - Every contributing source ID (e.g. `canonical_matches_v2` ID, `canonical_matches` ID, Sackmann `historical_matches` ID, RapidAPI `rapid_event_id`) is permanently retained with confidence scores.
5. **`conflicts.jsonl` (Review Queue):**
   - Discrepant outcomes (differing winners, incompatible scores, or conflicting calendar instances) are routed to a structured review queue rather than being silently merged or overwritten.

---

## 3. Deterministic Identity & Fingerprinting

### 3.1 Namespace & UUIDv5 Derivation
All primary identifiers are generated using RFC 4122 UUIDv5 hashing with a fixed namespace to ensure 100% deterministic reproducibility across multiple runs:
- **Namespace UUID:** `6ba7b815-9dad-11d1-80b4-00c04fd430c8`
- **Natural Match Fingerprint:**
  $$\text{Fingerprint} = \text{norm}(\text{edition\_id}) + \text{":"} + \text{norm}(\text{round\_name}) + \text{":"} + \min(p_1, p_2) + \text{":"} + \max(p_1, p_2)$$
- **Primary Key:**
  $$\text{match\_id} = \text{UUIDv5}(\text{Fingerprint}, \text{NAMESPACE\_MATCHES})$$

### 3.2 Participant Keying
Participant records are uniquely keyed by the composite primary key:
$$\text{PRIMARY KEY } (\text{match\_id}, \text{side})$$
with a strict uniqueness constraint on:
$$\text{UNIQUE } (\text{match\_id}, \text{player\_id})$$
This guarantees that a player cannot be paired against themselves ($p_1 \ne p_2$).

---

## 4. Source Precedence Hierarchy

To prevent arbitrary data overwrite and preserve high-fidelity telemetry, incoming sources are processed in a strict four-tier hierarchy:

| Tier | Source Entity | Role & Precedence | Behavior |
| :---: | :--- | :--- | :--- |
| **Tier 1** | `canonical_matches_v2` | Primary Modern Authority | Establishes the definitive fixture and outcome. Highest priority for all attributes. |
| **Tier 2** | `canonical_matches` | Legacy Canonical Pool | Extends coverage across historical seasons. Enriches metadata (ranks, seeds, durations, timestamps). Merges into Tier 1 when fingerprint matches and outcomes align. |
| **Tier 3** | `historical_matches` | Historical Fallback | Sackmann archive baseline (fully mapped via `source_a_historical_match_id`). Preserves foundational stats and archive IDs. |
| **Tier 4** | `canonical_matches_operational` | Read-Only Comparison Baseline | Evaluated purely as a diagnostic benchmark (147,937 rows) to measure coverage gaps, non-singles exclusions, and unresolved candidate counts. Never mutates canonical tables. |

---

## 5. Conflict & Quarantine Policies

### 5.1 Outcome Conflict Classification
If a candidate match matches an existing fixture's natural fingerprint but exhibits one of the following anomalies, it is classified as a conflict and emitted to `conflicts.jsonl`:
1. `WINNER_MISMATCH`: Incoming winner differs from established winner.
2. `SCORE_CONTRADICTION`: Significant score conflict between sources.
3. `DATE_DISPARITY`: Match dates diverge by more than 7 days, indicating a distinct tournament instance or rescheduled fixture.

### 5.2 Quarantine Taxonomy
Candidates failing quality criteria are diverted to `quarantine.jsonl`:
- `UNRESOLVED_EDITION`: Tournament name or canonical ID cannot be resolved to a valid Phase 4 `edition_id` (e.g. 25,209 "Unknown Tournament" records).
- `UNRESOLVED_PLAYER_1` / `UNRESOLVED_PLAYER_2` / `UNRESOLVED_BOTH_PLAYERS`: Competitor names not present in the frozen Phase 3 canonical player registry.
- `IDENTICAL_PLAYERS`: Winner and loser resolve to the same player identity ($p_1 = p_2$).
- `NON_SINGLES_MATCH`: Doubles, mixed doubles, or wheelchair fixtures.
- `SPECULATIVE_DRAW`: Unplayed bracket placeholders.
- `QUALIFICATION_DRAWS`: Unmapped pre-tournament qualifying rounds.
- `EXHIBITION_OR_TEAM`: Non-tour exhibition matches or team events (Davis Cup, Laver Cup, United Cup).

---

## 6. Ten Quality Acceptance Gates (G1–G10)

| Gate ID | Gate Name | Pass Condition |
| :--- | :--- | :--- |
| **G1** | Parent Edition Resolution | 100% of accepted matches resolve to a verified Phase 4 `edition_id` (0 orphans). |
| **G2** | Exactly Two Participants | Every accepted match has exactly two participant rows (`side` 1 and 2, $p_1 < p_2$). |
| **G3** | Zero Self-Matches | 0 matches with $p_1 = p_2$. |
| **G4** | Participant Outcome Membership | 100% of winners and losers in `match_results` exist in `match_participants`. |
| **G5** | Pre-Match / Outcome Decoupling | Unsettled matches remain in `matches` and are excluded from `match_results`. |
| **G6** | Score & Status Consistency | Status (`FINISHED`, `RETIRED`, `WALKOVER`) coheres with `score_string` and retirement flags. |
| **G7** | Cross-Source Provenance | 100% of deduplicated matches maintain links to their original source IDs in `source_match_links`. |
| **G8** | Strict Conflict & Quarantine Isolation | Conflicting outcomes logged to `conflicts.jsonl`; unmapped rows isolated to `quarantine.jsonl`. |
| **G9** | Bitwise Deterministic Reproducibility | Multiple execution runs yield identical counts, UUIDs, fingerprints, and manifest SHA-256 hashes. |
| **G10** | Zero Database & Runtime Mutation | SQLite file sizes and hashes invariant (0 bytes delta); 0 PostgreSQL queries; 0 edits to `src/` or `server/`. |

---

## 7. Safety & Compliance Mandates

1. **Read-Only Operation:** All SQLite connections must use `{ readonly: true, fileMustExist: true }`.
2. **PostgreSQL Safeguard:** Zero connections or write queries permitted.
3. **Fail-Closed Runner:** Script execution must immediately halt with exit code 1 if `--dry-run` is omitted.
4. **Durable Memory Integrity:** Project memory notes must be updated with architectural findings and kept strictly unstaged.
