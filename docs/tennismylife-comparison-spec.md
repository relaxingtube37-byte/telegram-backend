# TennisMyLife Comparison Dry-Run Specification

## 1. Executive Summary & Architectural Scope

This specification establishes the architectural, mathematical, and data integrity standards for the **TennisMyLife Comparison Dry-Run Pipeline** within the tennis AI modeling and PostgreSQL migration platform.

The objective of this comparison dry-run is to systematically cross-examine modern 2024 TennisMyLife (TML) datasets against frozen canonical registries and outcomes produced in upstream phases:
- **Phase 3:** Canonical Players & Tournaments (\`scratch/phase-3-identity-output/\`)
- **Phase 4:** Tournament Editions (\`scratch/phase-4-competition-editions-output/\`)
- **Phase 5:** Canonical Matches & Outcomes (\`scratch/phase-5-matches-outcomes-output/\`)
- **Phase 6:** Statistics & Telemetry (\`scratch/phase-6-statistics-pbp-output/\`)

### 1.1 Secondary Authority & Invariant Safeguards
TennisMyLife is evaluated strictly as a **secondary validation and enrichment source**:
- **No Canonical Writes:** Zero modifications to canonical player, tournament, edition, match, or statistics tables.
- **Zero Database Mutation:** Offline read-only execution. SQLite source databases (\`data/database.sqlite\` and \`tennis_gold.sqlite\`) remain bit-for-bit unchanged ($\Delta = 0$ bytes, identical SHA-256).
- **Zero PostgreSQL Queries:** 100% offline; zero connections opened.
- **No Value Coercion:** Missing numerical attributes (e.g. unrecorded serve telemetry) remain strictly \`NULL\` (never coerced to \`0\`).
- **No Point-by-Point (PBP) or Odds Claim:** TennisMyLife contains neither betting market odds nor shot-by-shot rally sequences.

---

## 2. Dataset Scope & Input Boundaries

The comparison dry-run targets five sampled modern datasets acquired during the source inventory:
1. **ATP Tour 2024:** \`2024.csv\` (3,076 rows)
2. **WTA Tour 2024:** \`2024_wta.csv\` (2,658 rows)
3. **ATP Challenger 2024:** \`2024_challenger.csv\` (6,063 rows)
4. **ATP Qualifying 2024:** \`atp_quali/2024_atp_quali.csv\` (1,342 rows)
5. **Ongoing Live Snapshots:** \`ongoing_tourneys.csv\` (124 rows)

Total evaluation volume: **13,263 source rows**.

---

## 3. Player Linkage & Classification Precedence

Every competitor appearing as a winner or loser in a TennisMyLife row is classified according to a strict 6-tier precedence hierarchy:

| Classification | Precedence | Criteria |
| :--- | :---: | :--- |
| \`EXACT_VERIFIED_SOURCE_ID\` | 1 | Exact match on established external player ID (e.g. ATP code or Sackmann ID). |
| \`VERIFIED_ALIAS\` | 2 | Normalized name token matches a verified alias in \`identity_player_aliases.jsonl\` with \`is_verified = true\` and \`has_sibling_conflict = false\`. |
| \`EXACT_NAME_COUNTRY\` | 3 | Normalized standard full name matches a unique canonical player in \`identity_players.jsonl\` with matching non-empty IOC country code. |
| \`CANDIDATE_REVIEW\` | 4 | Normalized name matches a unique canonical player, but country code differs or is unrecorded in source. |
| \`AMBIGUOUS_HOMONYM\` | 5 | Multiple canonical players share the same normalized name, or \`has_sibling_conflict = true\`. |
| \`UNRESOLVED\` | 6 | Competitor does not match any canonical player or alias. Routed to \`unresolved-players.jsonl\`. |

> [!CAUTION]
> Ambiguous homonyms and unmapped lower-tier competitors are never automatically merged into canonical entities. They are isolated to review or quarantine.

---

## 4. Tournament & Edition Linkage

Tournament identity resolution distinguishes between tier, draw stage, and competition format:

| Classification | Criteria | Behavior |
| :--- | :--- | :--- |
| \`EXISTING_VERIFIED_EDITION\` | Tournament alias + tour + year matches a verified record in \`competition_tournament_editions.jsonl\`. | Admitted for match candidate fingerprinting. |
| \`EXISTING_TOURNAMENT_YEAR_MATCH\` | Tournament recognized in \`identity_tournaments.jsonl\`, but specific annual edition is absent in Phase 4. | Candidate for new edition creation in Phase 4 expansion. |
| \`CANDIDATE_EDITION\` | Recognized tournament with calendar or surface discrepancies requiring human review. | Routed to candidate queue. |
| \`QUALIFYING_EVENT\` | Qualification draw dataset (e.g. \`atp_quali\`) or round \`Q1\`, \`Q2\`, \`Q3\`. | **Never merged with main draw editions.** Quarantined as non-main-draw. |
| \`TEAM_OR_EXHIBITION\` | Davis Cup, United Cup, Laver Cup, or non-tour exhibitions. | **Never merged with official tour events.** Quarantined. |
| \`UNRESOLVED\` | Unrecognized tournament name. | Routed to \`unresolved-tournaments.jsonl\`. |

---

## 5. Match Fingerprinting & Classification

Where a tournament edition and both competitors are resolved ($p_1 \ne p_2$), the canonical natural match fingerprint is formulated:
```text
Fingerprint := edition_id ":" scheduled_date ":" round ":" player_id_low ":" player_id_high
```
where $\text{player\_id\_low} = \min(p_1, p_2)$ and $\text{player\_id\_high} = \max(p_1, p_2)$.

Match Classifications:
1. \`EXISTING_CANONICAL_MATCH\`: Fingerprint matches an established Phase 5 canonical fixture, and match outcome (winner and score) agrees.
2. \`POSSIBLE_CANONICAL_MATCH\`: Matches edition and competitors within $\pm 2$ day scheduling window.
3. \`NEW_MATCH_CANDIDATE\`: Valid edition and valid canonical competitors, but no existing Phase 5 fixture exists (potential historical gap fill). Emitted to \`new-match-candidates.jsonl\`.
4. \`DUPLICATE_WITHIN_TML\`: Duplicate match observed within the same TennisMyLife dataset.
5. \`CONFLICT_WITH_CANONICAL\`: Matches canonical participants and edition, but winner or score contradicts Phase 5. Emitted to \`conflicts.jsonl\`.
6. \`UNRESOLVED_PLAYER\`: One or both competitors unresolved.
7. \`UNRESOLVED_EDITION\`: Tournament edition unresolved.
8. \`NON_SINGLES_OR_UNSUPPORTED\`: Qualifying draw, doubles, team tie, or exhibition.
9. \`INVALID_ROW\`: Corrupt row or missing mandatory date/score/identity fields.

### 5.1 Permanent Regression Fixtures
The fingerprinting logic hardens against collapsing distinct matches:
- **Hua Hin 2024 (WTA):** January vs September editions must remain separate.
- **Australian Open 2026 Qualifying:** Qualifying rounds must remain separate from main draw fixtures.
- **Davis Cup 2023:** Separate international ties must not collapse into one annual tie.
- **Shanghai Asian Challenger 2023:** Adjacent-day matches must remain distinct.

---

## 6. Statistics Telemetry Comparison & Invariants

For every match resolving to \`EXISTING_CANONICAL_MATCH\`, the 18 service telemetry attributes (\`aces\`, \`double_faults\`, \`svpt\`, \`first_in\`, \`first_won\`, \`second_won\`, \`sv_gms\`, \`bp_saved\`, \`bp_faced\` for both winner and loser) are compared against Phase 6 \`match_player_statistics.jsonl\`.

### 6.1 Field Comparison Taxonomy
- \`AGREES\`: Existing canonical statistic matches TennisMyLife value exactly ($\Delta = 0$).
- \`FILL_NULL_CANDIDATE\`: Existing canonical field is \`NULL\`; TennisMyLife provides a physically valid non-null value.
- \`CONFLICT_REVIEW\`: Existing canonical value differs from TennisMyLife value. Isolated to review.
- \`SOURCE_INVALID\`: TennisMyLife value violates physical conservation invariants.
- \`NOT_COMPARABLE\`: Field missing on both sides (retained as \`NULL\`).

### 6.2 Physical Conservation Invariants
1. Non-negative counts: $\text{stat} \ge 0$.
2. First serve bound: $\text{first\_won} \le \text{first\_in}$.
3. Second serve bound: $\text{second\_won} \le (\text{svpt} - \text{first\_in})$.
4. Break point bound: $\text{bp\_saved} \le \text{bp\_faced}$.
5. Walkovers (\`W/O\`): Must have \`NULL\` statistics (never filled with zeroes).
6. Retirements (\`RET\`): Preserved as authentic partial-match statistics.

---

## 7. Determinism & Safety Gates

### 7.1 Deterministic Dual-Pass Verification
The comparison runner executes two identical back-to-back passes over the source files, asserting 100% bit-for-bit identical SHA-256 digests across all 11 output artifacts:
- \`player-links.jsonl\`
- \`tournament-links.jsonl\`
- \`match-links.jsonl\`
- \`stat-comparisons.jsonl\`
- \`new-match-candidates.jsonl\`
- \`conflicts.jsonl\`
- \`quarantine.jsonl\`
- \`unresolved-players.jsonl\`
- \`unresolved-tournaments.jsonl\`
- \`coverage-report.json\`
- \`validation-report.json\`

### 7.2 Safety Quality Gates
1. **Zero PostgreSQL Connection:** 100% offline.
2. **SQLite Immutability:** Pre/post byte size and SHA-256 hash invariant ($\Delta = 0$).
3. **Phase 5 Artifact Invariance:** Unchanged SHA-256 digests.
4. **Phase 6 Artifact Invariance:** Unchanged SHA-256 digests.
5. **No Production Source Modified:** Zero code touched in \`src/\` or \`server/\`.
6. **No Ambiguous Identity Autolinked:** Sibling homonyms and unverified players quarantined.
7. **No Canonical Write:** Zero writes to canonical entities.
8. **No Missing-to-Zero Coercion:** Missing telemetry strictly preserved as \`NULL\`.
9. **No Silent Row Loss:** Every source row accounted for in ledger.
10. **All Conflicts Preserved:** Contradictory outcomes recorded in \`conflicts.jsonl\`.
11. **Explainable Quarantine:** 100% of quarantined records have documented reasons.

---

## 8. Binding Operational Statement

> “TennisMyLife was compared against the existing dataset in read-only mode. No canonical database, SQLite source, Phase 5 output, Phase 6 output, or production runtime was modified. TennisMyLife results are classified as validation and enrichment candidates only.”
