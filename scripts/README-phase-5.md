# Phase 5: Odds & Market History Dry-Run Tool (Corrected Architecture)

## Overview

The `dry-run-phase-5-odds.cjs` script executes the deterministic extraction, normalization, and quality validation pipeline for tennis market telemetry covering the 2021–2026 seasons.

Target Schemas:
- `markets.bookmakers` (Canonical sportsbook provider registry)
- `markets.market_odds_ticks` (Point-in-time and closing market odds ticks)

---

## Architectural Guarantees & Corrected Invariants

1. **Participant-Side Independence (Zero Outcome Leakage):** Selection sides (`selection_side = 1` vs `2`) are derived **strictly from participant player identities** (`player1_id` vs `player2_id`) established in Phase 3 prior to match completion. Outcome data (`winner_player_id`) is NEVER consulted during odds mapping and is restricted solely to post-match settlement audit verification.
2. **Zero Timestamp Fabrication:** For undated closing snapshots where no intra-day observation timestamp exists, `captured_at_utc` is set to `NULL`. The match's scheduled start time is preserved in an independent `reference_match_start_utc` field and is never substituted as capture time.
3. **Lookahead Anti-Leakage:** Retrospective batch fetches and undated closing lines are explicitly classified with `_is_backtest_safe = false` to protect ML model backtests from lookahead contamination.
4. **Synthetic Model Quarantine:** 100% of DTMC Markov simulated fair odds (`model_fair`) are quarantined and excluded from market ticks.
5. **Zero Database Mutations:** Connects to `data/database.sqlite` and `G:/state football/data/tennis_gold.sqlite` strictly with `{ readonly: true, fileMustExist: true }`. Validates that source database byte sizes remain bit-for-bit identical before and after execution.
6. **Dry-Run Enforcement:** Execution mandates the explicit `--dry-run` CLI flag. Invoking without `--dry-run` halts immediately with exit code 1.

---

## Usage

### Standard Execution:
```bash
node scripts/dry-run-phase-5-odds.cjs --dry-run
```

### Custom Output Directory:
```bash
node scripts/dry-run-phase-5-odds.cjs --dry-run --out-dir ./custom-output-dir
```

### Fail-Closed Demonstration:
```bash
# Will halt immediately with exit code 1
node scripts/dry-run-phase-5-odds.cjs
```

---

## Output Artifacts

All artifacts are written to `scratch/phase-5-dry-run-output/`:

| Artifact | Format | Description |
| :--- | :---: | :--- |
| `phase-5-bookmakers.jsonl` | JSONL | Canonical sportsbooks (Bet365, Sofascore Consensus, Pinnacle, Composite). |
| `phase-5-market-odds-ticks.jsonl` | JSONL | Symmetrically remapped Moneyline and Set 1 Winner odds ticks. |
| `phase-5-odds-conflicts.jsonl` | JSONL | Quarantined records (synthetic model fair odds, unlinked events, bad odds). |
| `phase-5-validation-report.json` | JSON | Machine-readable validation gate audit. |
| `phase-5-validation-report.md` | Markdown | Executive quality gate summary and metric distributions. |

---

## Invariant Quality Gates

- **G1: Parent Match Resolution:** 100% of emitted ticks resolve to accepted Phase 3 match fixtures.
- **G2: Canonical Bookmaker Key:** 100% of ticks resolve to registered active sportsbooks.
- **G3: Symmetrical Participant Invariant:** Selection sides derived purely from participant IDs; 50/50 win ratio verified in post-match audit.
- **G4: Positive Decimal Odds Constraint:** 100% of odds satisfy `decimal_odds > 1.000` (PostgreSQL check constraint).
- **G5: Zero Timestamp Fabrication Guarantee:** All undated closing snapshots have `captured_at_utc = null`; match start preserved separately.
- **G6: Lookahead Anti-Leakage Guarantee:** Zero ticks post-dating match start are marked as backtest safe.
- **G7: Synthetic Model Odds Rejection:** 100% of simulated DTMC Markov fair odds are quarantined.
- **G8: Comprehensive Quarantine Emitting:** Diagnostic codes attached to all quarantined rows.
- **G9: Zero SQLite Mutation Guarantee:** 0 byte change across all source databases.
- **G10: Fail-Closed Execution Guarantee:** Halts on missing `--dry-run`.
