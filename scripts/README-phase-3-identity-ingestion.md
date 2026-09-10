# Phase 3: Identity Ingestion Pipeline Dry-Run Runner

This directory contains the deterministic offline dry-run runner and identity validation suite for Phase 3 of the tennis data migration pipeline.

---

## 1. Overview & Objectives

`dry-run-phase-3-identity-ingestion.cjs` executes an automated, read-only extraction, normalization, and integrity audit of upstream identity registries, preparing for ingestion into the canonical PostgreSQL schema (`identity.players`, `identity.player_aliases`, `identity.tournaments`, `identity.tournament_aliases`).

Key Tasks:
- Extract **1,765** canonical players from read-only SQLite `canonical_players`.
- Extract **2,861** player aliases, normalize tokens, and deduplicate to **2,833** unique records.
- Audit biographical enrichment against **12,309** profiles from `gold_player_profiles` in `tennis_gold.sqlite`.
- Extract **1,183** canonical tournaments from read-only SQLite `canonical_tournaments`.
- Extract **1,378** tournament aliases and deduplicate to **1,376** unique records.
- Synthesize deterministic, collision-free UUIDv5 identifiers for every player, tournament, and alias.
- Isolate ambiguous mappings and cross-player token collisions (`jovic i`) to `phase-3-identity-conflicts.jsonl`.
- Verify **zero orphan aliases** (100% foreign key resolution to valid canonical parents).
- Guarantee byte-level immutability of source SQLite databases (0 bytes delta).

---

## 2. Safety Invariants & Guardrails

- **Read-Only SQLite:** Source databases (`data/database.sqlite` and `tennis_gold.sqlite`) are opened strictly with `{ readonly: true, fileMustExist: true }`. File sizes are verified before and after execution (0 bytes delta required).
- **No PostgreSQL Connection:** Operates 100% offline without live database connections or network sockets.
- **No Network Calls:** Zero network or external API requests.
- **Fail-Closed Execution:** Requires explicit `--dry-run` CLI flag. Invocation without this flag halts immediately with exit code 1.
- **Codebase Immutability:** Zero modifications to `src/`, `server/`, or runtime application code.
- **Cutover Prohibited:** Live production cutover is strictly **NO-GO** until Phase 10 live parity.

---

## 3. Invocation Commands

### Fail-Closed Behavior Verification
```bash
node scripts/dry-run-phase-3-identity-ingestion.cjs
# Expected output:
# [SECURITY VIOLATION] FAIL-CLOSED EXECUTION HALTED
# Missing mandatory flag: --dry-run
# Process exit code: 1
```

### Full Offline Dry-Run Execution
```bash
node scripts/dry-run-phase-3-identity-ingestion.cjs --dry-run
```

---

## 4. Generated Artifacts

Outputs are saved in `scratch/phase-3-identity-output/`:

| Artifact | Format | Description |
| :--- | :--- | :--- |
| `identity_players.jsonl` | JSONL | 1,765 canonical player records matching `identity.players`. |
| `identity_player_aliases.jsonl` | JSONL | 2,833 deduplicated player alias records matching `identity.player_aliases`. |
| `identity_tournaments.jsonl` | JSONL | 1,183 canonical tournament records matching `identity.tournaments`. |
| `identity_tournament_aliases.jsonl` | JSONL | 1,376 deduplicated tournament alias records matching `identity.tournament_aliases`. |
| `phase-3-identity-conflicts.jsonl` | JSONL | Quarantined ambiguous / cross-player token collisions (`jovic i`). |
| `phase-3-identity-validation-report.json` | JSON | Machine-readable validation gate assessment results (10/10 PASS). |
| `phase-3-identity-validation-report.md` | Markdown | Comprehensive audit report summarizing all 10 quality gates and identity metrics. |

---

## 5. 10 Quality Gates Verified

1. **G1 (Player PK Uniqueness):** Exactly 1,765 / 1,765 unique UUIDv5 values (0 collisions).
2. **G2 (Player Slug Uniqueness):** Exactly 1,765 / 1,765 unique slugs (disambiguated on collision).
3. **G3 (Player Gender Enum Conformance):** 100% valid in `('M', 'F', 'MIXED')`.
4. **G4 (Player Biometric Sanity):** Heights [140–230 cm], weights [40–130 kg], pro years [1968–2035] (0 violations).
5. **G5 (Tournament Surface Enum Conformance):** 100% valid in `('Hard', 'Clay', 'Grass', 'Carpet', 'Unknown')`.
6. **G6 (Tournament Natural Key Uniqueness):** Exactly 1,183 unique `(name_standard, tour)` pairs.
7. **G7 (Player Alias FK Integrity):** Exactly 0 orphan player aliases (`orphan_count == 0`).
8. **G8 (Tournament Alias FK Integrity):** Exactly 0 orphan tournament aliases (`orphan_count == 0`).
9. **G9 (Alias Token Uniqueness & Conflict Quarantine):** 2,833 player tokens, 1,376 tourney tokens, `jovic i` collision quarantined.
10. **G10 (Zero SQLite Mutation Guarantee):** Backend delta: 0 bytes, Gold delta: 0 bytes.

---

## 6. Strict Safety Declarations

> **Schema validated on local/staging PostgreSQL only; production runtime unchanged; SQLite untouched; cutover prohibited until Phase 10 parity.**
>
> این فاز contract parity را ثابت می‌کند، نه production read parity را. production parity طبق برنامه در Phase 10 و با canary comparator سنجیده می‌شود.
>
> قبولی 10/10 به معنی آمادگی برای ادامه‌ی فاز بعدی است، نه مجوز cutover. خود برنامه صریحاً NO-GO می‌دهد تا وقتی Phase 10 parity روی ترافیک واقعی تأیید نشده باشد.
