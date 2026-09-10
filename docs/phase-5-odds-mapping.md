# Phase 5: Odds & Market History Mapping Specification (Corrected Architecture)
**Target Schemas:** `markets.bookmakers`, `markets.market_odds_ticks`  
**Mapping Strategy:** Participant Identity Symmetrical Remapping, True Point-in-Time Capture Timestamping  
**Authoritative Reference:** `postgresSchemaV1.sql` (Lines 553–590)  

---

## 1. Target Schema Column Mapping

### Table 1: `markets.bookmakers`

| Target Column | PostgreSQL Type | Nullable | Source Field / Transformation | Description / Constraints |
| :--- | :--- | :---: | :--- | :--- |
| `bookmaker_id` | `SMALLSERIAL PRIMARY KEY` | No | Auto-generated sequential integer (1, 2, 3...) | Unique sportsbook identifier |
| `bookmaker_key` | `VARCHAR(50) UNIQUE` | No | Normalized lowercase slug (e.g. `'bet365'`, `'sofascore_consensus'`) | Unique lookup key |
| `display_name` | `TEXT` | No | Human-readable provider title | Official sportsbook label |
| `is_active` | `BOOLEAN` | No | `TRUE` | Operational availability flag |
| `created_at` | `TIMESTAMPTZ` | No | Current timestamp | Record creation audit |

#### Canonical Bookmaker Registry:
```json
[
  { "bookmaker_id": 1, "bookmaker_key": "bet365", "display_name": "Bet365", "is_active": true },
  { "bookmaker_id": 2, "bookmaker_key": "sofascore_consensus", "display_name": "Sofascore / RapidAPI Consensus (Provider 1)", "is_active": true },
  { "bookmaker_id": 3, "bookmaker_key": "pinnacle", "display_name": "Pinnacle Sports", "is_active": true },
  { "bookmaker_id": 4, "bookmaker_key": "closing_composite", "display_name": "Closing Line Composite Snapshot", "is_active": true }
]
```

---

### Table 2: `markets.market_odds_ticks`

| Target Column | PostgreSQL Type | Nullable | Source Field / Derivation | Architectural Invariant Rule |
| :--- | :--- | :---: | :--- | :--- |
| `tick_id` | `BIGSERIAL PRIMARY KEY` | No | Sequential tick integer | Monotonically increasing identifier |
| `match_id` | `UUID` | No | Phase 3 Match UUID | Foreign key referencing `matches.matches(match_id)` |
| `bookmaker_id` | `SMALLINT` | No | Resolved from `markets.bookmakers` | Foreign key referencing `markets.bookmakers(bookmaker_id)` |
| `market_type` | `markets.market_category` | No | `'MONEYLINE'` or `'SET_1_WINNER'` | Standardized market category enum |
| `selection_side` | `SMALLINT` | No | `1` (Player 1) or `2` (Player 2) | **Derived strictly from participant identity** (`player1_id` vs `player2_id`); CHECK constraint `IN (1, 2)` |
| `line` | `NUMERIC(5, 2)` | Yes | `NULL` for Moneyline / Set Winner | Line handicap (reserved for totals/spreads) |
| `decimal_odds` | `NUMERIC(7, 3)` | No | Converted decimal odds | Must satisfy `decimal_odds > 1.000` |
| `is_closing_line` | `BOOLEAN` | No | `TRUE` for closing snapshots / pre-match finals | Differentiates closing line from intraday quotes |
| `is_live` | `BOOLEAN` | No | `FALSE` | Pre-match / closing lines |
| `captured_at_utc`| `TIMESTAMPTZ` | **Yes (NULL)** | Authentic source observation timestamp | **NULL for undated closing snapshots**. Never substitute match start! |
| `reference_match_start_utc` | `TIMESTAMPTZ` | No | `matches.matches.scheduled_start_utc` | Independent reference anchor for match start |
| `created_at` | `TIMESTAMPTZ` | No | Current timestamp | Audit generation timestamp |

---

## 2. Participant-Side Independence (Anti-Leakage Remapping)

### Architectural Invariant: Zero Outcome Dependency
In legacy data schemas, columns are organized under winner/loser headers (`winner_odds`, `loser_odds`, `w_odds_match`, `l_odds_match`).  
**Mapping rule:** Under no circumstances may `selection_side` (1 vs 2) be derived from `match_results.winner_player_id`. The participant ordering is frozen before the match begins (`player1_id` is alphabetically smaller than `player2_id` from Phase 1 registration).

### Pure Identity-Based Remapping Formula
Let $M$ be the canonical Phase 3 match fixture with participants $P_1$ (`player1_id`) and $P_2$ (`player2_id`).  
Let the source record specify selections on Player $A$ with odds $O_A$ and Player $B$ with odds $O_B$:

$$\begin{aligned}
\text{If } \text{id}(A) == P_1 \land \text{id}(B) == P_2 &\implies \begin{cases} \text{selection\_side} = 1, & \text{odds} = O_A, & \text{player\_id} = P_1 \\ \text{selection\_side} = 2, & \text{odds} = O_B, & \text{player\_id} = P_2 \end{cases} \\
\text{If } \text{id}(B) == P_1 \land \text{id}(A) == P_2 &\implies \begin{cases} \text{selection\_side} = 1, & \text{odds} = O_B, & \text{player\_id} = P_1 \\ \text{selection\_side} = 2, & \text{odds} = O_A, & \text{player\_id} = P_2 \end{cases}
\end{aligned}$$

### Role of `phase-3-match-results.jsonl`: Post-Match Settlement Audit Only
The `results` dataset is **never consulted** during extraction or side assignment.  
Instead, a post-extraction validation audit verifies that in 2-way Moneyline markets:
$$\frac{\text{Confirmed Winning Selections}}{\text{Total Moneyline Selections}} = 50.00\%$$
This confirms perfect statistical symmetry without outcome leakage.

---

## 3. Timestamp Capture Policy & Lookahead Prevention

### The Capture Timestamp Rule
- `captured_at_utc` must represent a **real observation timestamp** recorded by the data collection agent at the moment of quote observation.
- **Never substitute `scheduled_start_utc` for `captured_at_utc`**. A match's scheduled start is the time players take the court, not the moment a bookmaker published or scraped an odds quote.

### Source Classification Matrix:
1. **Authentic Dated Ticks (`scratch/cache/.../odds_*.json`):**
   - Contains `requestTimestamp` or `responseTimestamp`.
   - If $\text{timestamp} \le \text{scheduled\_start\_utc} \implies$ `_timing_quality: 'AUTHENTIC_POINT_IN_TIME'`, `_is_backtest_safe: true`.
   - If $\text{timestamp} > \text{scheduled\_start\_utc} \implies$ `_timing_quality: 'RETROSPECTIVE_ARCHIVAL_FETCH'`, `_is_backtest_safe: false`.
2. **Undated Closing Snapshots (`gold_matches_validated` & `canonical_matches`):**
   - No intraday observation timestamp exists in the legacy source.
   - `captured_at_utc = NULL`.
   - `reference_match_start_utc = scheduled_start_utc`.
   - `_timing_quality: 'CLOSING_SNAPSHOT_UNDATED'` or `'LEGACY_CSV_CLOSING'`.
   - `_is_backtest_safe = false` (usable *strictly* as a closing price benchmark; prohibited from being used as an intraday pre-match signal).

---

## 4. Fractional to Decimal Odds Normalization

When ingesting British fractional odds from RapidAPI responses (e.g. `"10/3"`, `"11/50"`, `"67/100"`), decimal odds are calculated as:

$$\text{Decimal Odds} = 1.0 + \frac{\text{Numerator}}{\text{Denominator}}$$

Examples:
- `"10/3"` $\to 1 + 3.3333 = 4.333$
- `"11/50"` $\to 1 + 0.2200 = 1.220$
- `"1/2"` $\to 1 + 0.5000 = 1.500$
- `"67/100"` $\to 1 + 0.6700 = 1.670$

All values are rounded to 3 decimal places (`NUMERIC(7, 3)`).

---

## 5. Traceability & Lineage Preservation

Every emitted JSONL tick preserves complete provenance metadata:
```json
{
  "tick_id": 1042,
  "match_id": "1f386942-f388-5649-bf4f-c31d595d7f4d",
  "bookmaker_id": 1,
  "market_type": "MONEYLINE",
  "selection_side": 1,
  "line": null,
  "decimal_odds": 2.150,
  "is_closing_line": true,
  "is_live": false,
  "captured_at_utc": null,
  "reference_match_start_utc": "2024-01-14T00:00:00.000Z",
  "_source_table": "gold_matches_validated",
  "_source_id": "11924510",
  "_bookmaker_key": "bet365",
  "_timing_quality": "CLOSING_SNAPSHOT_UNDATED",
  "_is_backtest_safe": false,
  "_selection_player_id": "0702fc87-fb03-50bd-9961-7546d0c6a622"
}
```
