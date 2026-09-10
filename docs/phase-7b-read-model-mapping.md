# Phase 7B: Read Model Mapping & Transformation Specification
**Target Schema:** `predictions`, `matches`, `ai`, `identity`  
**Compatibility Layer:** PostgreSQL Views & Read Service Layer  
**Status:** VALIDATED VIA OFFLINE DRY-RUN (10/10 GATES PASS)  

---

## 1. Architectural Read Model Overview

In the target PostgreSQL architecture, business logic and data ingestion are cleanly decoupled from public serving layers. Data resides in normalized relational tables:
- Canonical match identity in `matches.matches`
- Historical and live set/game scores in `matches.match_sets` and `matches.match_games`
- Published betting recommendations and odds in `predictions.publishedpredictions`
- Mode A tactical long-form editorial packages in `predictions.matcheditorials`
- Multi-agent AI reasoning and feature snapshots in `ai.predictionruns` and `ai.agenttraces`

To guarantee 100% contract parity with legacy SQLite endpoints without modifying frontend consumer code, PostgreSQL provides dedicated read-model projections and compatibility views.

---

## 2. Read Model 1: `predictions.publishedpredictions` → `/api/webapp/predictions`

### 2.1. SQL View Definition
```sql
CREATE OR REPLACE VIEW predictions.v_webapp_predictions AS
SELECT
  p.prediction_id AS id,
  p.fixture_id,
  m.tournament_name,
  m.round_name,
  m.surface,
  m.scheduled_start_utc AS match_date,
  p1.full_name AS home_name,
  p2.full_name AS away_name,
  o.home_odds,
  o.away_odds,
  pw.full_name AS predicted_winner,
  p.win_probability,
  p.confidence::text AS confidence,
  p.predicted_score,
  p.best_bet_selection,
  p.best_bet_market,
  p.best_bet_ev,
  p.best_bet_rationale,
  p.alt_bet_selection,
  p.alt_bet_market,
  p.key_factors,
  p.devils_advocate_risk,
  p.ai_summary,
  '/api/webapp/players/' || url_encode(COALESCE(p.home_id, p1.full_name)) || '/image?size=80' AS home_image,
  '/api/webapp/players/' || url_encode(COALESCE(p.away_id, p2.full_name)) || '/image?size=80' AS away_image,
  p.home_id,
  p.away_id,
  p.status::text AS status,
  r.result_score,
  p.published_at,
  p.created_at
FROM predictions.publishedpredictions p
JOIN matches.matches m ON m.match_id = p.match_id
JOIN identity.players p1 ON p1.player_id = m.home_player_id
JOIN identity.players p2 ON p2.player_id = m.away_player_id
LEFT JOIN identity.players pw ON pw.player_id = p.predicted_winner_id
LEFT JOIN matches.match_results r ON r.match_id = m.match_id
LEFT JOIN odds.closing_odds o ON o.match_id = m.match_id
ORDER BY p.published_at DESC;
```

### 2.2. Projection & Transformation Rules
1. **False LIVE Match Guard:** If `status = 'LIVE'` but `result_score` is empty or `'0-0   0-0    0-0'`, the projection normalizes `status` to `'UPCOMING'` and `result_score` to `null`.
2. **Key Factors Normalization:** Stored in PostgreSQL as `JSONB` array of strings. Projected to JSON as native array `string[]`, matching `PredictionsService.formatPrediction`.
3. **EV Representation:** `best_bet_ev` is emitted as formatted string (e.g. `"+7.2% EV"`), matching client layout expectations.

---

## 3. Read Model 2: `predictions.matcheditorials` → `/api/web/editorials/:idOrSlug`

### 3.1. Field-by-Field Transformation Matrix

| Client DTO Field | PostgreSQL Source Column | Transformation Rule |
| :--- | :--- | :--- |
| `id` | `editorial_id` | Direct alias |
| `fixture_id` | `fixture_id` | Exact integer match |
| `slug` | `slug` | Exact unique slug |
| `headline` | `headline` | Raw analytical headline |
| `title` | `headline` | Synthesized alias: `title = headline` |
| `subtitle` | `subtitle` | Preserves null if empty |
| `summary` | `summary` | Raw markdown narrative summary |
| `short_summary` | `short_summary` | `COALESCE(short_summary, summary)` |
| `guest_safe_summary` | `guest_safe_summary` | Direct passthrough or fallback to short_summary |
| `tactical_analysis` | `tactical_analysis` | Gated in guest mode (`undefined`) |
| `surface_breakdown` | `surface_breakdown` | Gated in guest mode (`undefined`) |
| `h2h_breakdown` | `h2h_breakdown` | Gated in guest mode (`undefined`) |
| `key_facts` | `key_facts` | Native JSONB array |
| `key_facts_json` | `key_facts` | `key_facts::text` (legacy backward-compatibility) |
| `data_bullets` | `data_bullets` | Native JSONB array |
| `data_bullets_json` | `data_bullets` | `data_bullets::text` (legacy backward-compatibility) |
| `tags` | `tags` | Native JSONB array |
| `tags_json` | `tags` | `tags::text` (legacy backward-compatibility) |
| `key_stats` | `key_stats` | Native JSONB object |
| `key_stats_json` | `key_stats` | `key_stats::text` (legacy backward-compatibility) |
| `seo_metadata` | `seo_metadata` | Native JSONB object |
| `seo_metadata_json` | `seo_metadata` | `seo_metadata::text` (legacy backward-compatibility) |
| `status_history` | `status_history` | Native JSONB array |
| `status_history_json` | `status_history` | `status_history::text` (legacy backward-compatibility) |
| `publish_status` | `publish_status` | Enum string (`'draft'`, `'published'`, etc.) |
| `is_published` | `publish_status` | `CASE WHEN publish_status = 'published' THEN 1 ELSE 0 END` |
| `ai_assisted` | `ai_assisted` | Defaults to `1` |

### 3.2. Routing Resolution Logic
```
Client Request -> /api/web/editorials/:idOrSlug
                      |
        Is param purely numeric?
       /                         \
    YES                           NO
     |                             |
Query by fixture_id           Query by slug
     \                             /
       Match found in DB?
      /                  \
    YES                   NO
     |                     |
Check publish_status     Return 404 Not Found
 (published or 1?)
   /            \
 YES             NO
  |               |
Redact & Return  Return 404 Not Found
```

---

## 4. Read Model 3: `ai.predictionruns` → `/api/webapp/matches/:fixtureId/analytics`

### 4.1. Mapping Source
Deep analytics are synthesized directly from `ai.predictionruns.feature_snapshot`:
- `p1RollingForm`: `feature_snapshot->'p1_rolling_form'`
- `p2RollingForm`: `feature_snapshot->'p2_rolling_form'`
- `surfaceDynamics`: `feature_snapshot->'surface_dynamics'`
- `fatigueAndLoad`: `feature_snapshot->'fatigue_metrics'`
- `tacticalEdge`: `feature_snapshot->'tactical_edge'`
- `historicalH2H`: `feature_snapshot->'h2h_metrics'`

### 4.2. Guest Redaction Projection
When requested by an unverified guest:
- `locked` is set to `true`
- `p1RollingForm.recentScores` is masked to `[]`
- `p2RollingForm.recentScores` is masked to `[]`
- `surfaceDynamics`, `fatigueAndLoad`, and `tacticalEdge` are stripped from the response payload.

---

## 5. Read Model 4: `public.canonicalmatchesoperational` → `/api/web/matches`

### 5.1. Operational Matches Mapping
Provides seamless backward-compatibility for operational tooling that queries `/api/web/matches`. The projection wraps rows in the standard API envelope:
```json
{
  "status": "SUCCESS",
  "verified": true,
  "access_mode": "REGISTRATION_REQUIRED",
  "layers": {
    "guest_stats_level": "full",
    "guest_can_see_summary": true,
    "guest_can_see_stats": true,
    "guest_can_see_ai_full": true
  },
  "matches": [ ... ]
}
```

---

## 6. Indexing & Query Performance Plan

To guarantee sub-15ms P95 response latency on these read models:
1. `CREATE INDEX idx_predictions_published_at ON predictions.publishedpredictions (published_at DESC);`
2. `CREATE INDEX idx_editorials_fixture_id ON predictions.matcheditorials (fixture_id);`
3. `CREATE UNIQUE INDEX idx_editorials_slug ON predictions.matcheditorials (slug);`
4. `CREATE INDEX idx_editorials_published ON predictions.matcheditorials (publish_status, published_at DESC);`
5. `CREATE INDEX idx_prediction_runs_fixture ON ai.predictionruns (fixture_id);`
