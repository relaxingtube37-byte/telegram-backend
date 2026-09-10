# Phase 5: Matches & Outcomes Dry-Run Runner

## 1. Overview

`scripts/dry-run-phase-5-matches-outcomes.cjs` executes the offline ingestion, entity deduplication, symmetric participant assignment, outcome decoupling, and provenance tracking for **Phase 5: Matches & Outcomes Pipeline**.

The tool operates under strict fail-closed constraints, ensuring that no production PostgreSQL queries or SQLite database writes can take place.

---

## 2. CLI Usage & Verification

### 2.1 Fail-Closed Invariant Check
The script requires the mandatory `--dry-run` flag. If executed without this flag, it halts immediately with exit code 1:
```bash
node scripts/dry-run-phase-5-matches-outcomes.cjs
```
Expected output:
```
================================================================================
 [SECURITY VIOLATION] FAIL-CLOSED EXECUTION HALTED
 Missing mandatory flag: --dry-run
================================================================================
```

### 2.2 Standard Offline Dry-Run Execution
```bash
node scripts/dry-run-phase-5-matches-outcomes.cjs --dry-run
```

### 2.3 Custom Output Directory Execution
```bash
node scripts/dry-run-phase-5-matches-outcomes.cjs --dry-run --out-dir scratch/custom-phase-5-output
```

---

## 3. Upstream Dependencies

The runner requires the frozen artifacts from Phase 3 and Phase 4:
1. `scratch/phase-3-identity-output/identity_players.jsonl`
2. `scratch/phase-3-identity-output/identity_player_aliases.jsonl`
3. `scratch/phase-3-identity-output/identity_tournaments.jsonl`
4. `scratch/phase-3-identity-output/identity_tournament_aliases.jsonl`
5. `scratch/phase-4-competition-editions-output/competition_tournament_editions.jsonl`

---

## 4. Generated Artifacts

All outputs are saved to `scratch/phase-5-matches-outcomes-output/`:
- `matches.jsonl`: Pre-match fixtures mapped to `matches.matches`.
- `match_participants.jsonl`: Symmetrical participant records mapped to `matches.match_participants` (`side` 1 & 2, $p_1 < p_2$, 0 winner leakage).
- `match_results.jsonl`: Settled match outcomes mapped to `matches.match_results`.
- `source_match_links.jsonl`: Provenance links across contributing streams mapped to `provenance.source_match_links`.
- `field_provenance.jsonl`: Field-level attribution records mapped to `provenance.field_provenance`.
- `conflicts.jsonl`: Isolated outcome discrepancies (winner conflicts between calendar instances) mapped to `provenance.review_queue`.
- `quarantine.jsonl`: Unmapped tournament editions, missing player identities, doubles, and exhibitions.
- `validation-report.json`: Machine-readable audit report evaluating all 10 gates.
- `validation-report.md`: Human-readable summary of pipeline execution and metrics.
- `manifest.json`: Cryptographic SHA-256 hashes of all output datasets.

---

## 5. Ten Quality Acceptance Gates (G1–G10)

| Gate ID | Gate Name | Pass Condition |
| :--- | :--- | :--- |
| **G1** | Parent Edition Resolution | 100% of accepted matches resolve to a verified Phase 4 `edition_id` (0 orphans). |
| **G2** | Exactly Two Participants | Every accepted match has exactly two participant records (`side` 1 & 2, $p_1 < p_2$). |
| **G3** | Zero Self-Matches | 0 matches with identical players ($p_1 \ne p_2$). |
| **G4** | Participant Outcome Membership | 100% of winners and losers belong to the match participant pair. |
| **G5** | Pre-Match / Outcome Decoupling | Unsettled fixtures remain in `matches` and are excluded from `match_results`. |
| **G6** | Score & Status Consistency | Status (`FINISHED`, `RETIRED`, `WALKOVER`) coheres with score string and retirement flags. |
| **G7** | Cross-Source Provenance | 100% of cross-source duplicates linked to canonical match with preserved source IDs. |
| **G8** | Conflict & Quarantine Isolation | Conflicting outcomes logged to `conflicts.jsonl`; unmapped rows isolated to `quarantine.jsonl`. |
| **G9** | Deterministic Reproducibility | Stable, collision-free RFC 4122 UUIDv5 primary keys. |
| **G10** | Zero Database Mutation | SQLite size/hash delta is 0 bytes; zero PostgreSQL connections. |

---

## 6. Mandatory Safety Invariants

> [!IMPORTANT]
> Schema validated on local/staging PostgreSQL specifications only; production runtime unchanged; SQLite untouched; cutover prohibited until Phase 10 parity.
> این فاز contract parity را ثابت می‌کند، نه production read parity را. production parity طبق برنامه در Phase 10 و با canary comparator سنجیده می‌شود.
> قبولی 10/10 به معنی آمادگی برای ادامه‌ی فاز بعدی است، نه مجوز cutover. خود برنامه صریحاً NO-GO می‌دهد تا وقتی Phase 10 parity روی ترافیک واقعی تأیید نشده باشد.
