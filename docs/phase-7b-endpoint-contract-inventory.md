# Phase 7B: Endpoint Contract Inventory
**Document Role:** Authoritative API Contract Reference & Response Inventory  
**Status:** VALIDATED VIA OFFLINE DRY-RUN (10/10 GATES PASS)  

---

## 1. Inventory Overview

This document provides the complete, field-by-field contract inventory for the endpoints audited under **Phase 7B**. Every field, scalar type, nullability constraint, enum domain, and access-gating behavior is explicitly documented to prevent contract drift during the PostgreSQL read model cutover.

---

## 2. Endpoint 1: `GET /api/webapp/predictions`

### 2.1. Route Definition
- **Path:** `/api/webapp/predictions`
- **Method:** `GET`
- **Query Parameters:**
  - `limit` *(optional, integer, default: 100)*: Maximum number of predictions to return.
- **Headers:**
  - `Authorization: Bearer <session_token>` *(optional)*: Authenticates user session for unlocked access.

### 2.2. Response Envelope
```typescript
interface WebappPredictionsResponse {
  predictions: WebappPredictionItem[];
  verified: boolean;
  access_mode: 'FREE' | 'REGISTRATION_REQUIRED' | 'PAID_REQUIRED';
  content_layers: {
    guest_can_see_summary: boolean;
    guest_can_see_stats: boolean;
    guest_can_see_ai_full: boolean;
  };
}
```

### 2.3. Field Dictionary (`WebappPredictionItem`)

| Field Name | Type | Nullable | Gated in Guest Mode | Description / Notes |
| :--- | :--- | :---: | :---: | :--- |
| `id` | `number` | No | No | Primary prediction identifier |
| `fixture_id` | `number` | No | No | Unique match fixture identifier |
| `tournament_name` | `string` | No | No | Tournament name (e.g. "ATP US Open") |
| `round_name` | `string` | No | No | Tournament round (e.g. "Final", "Quarter-final") |
| `surface` | `string` | No | No | Court surface ("Hard", "Clay", "Grass", "Carpet") |
| `match_date` | `string` | No | No | Scheduled date/time of match (ISO 8601 or YYYY-MM-DD) |
| `home_name` | `string` | No | No | Player 1 full display name |
| `away_name` | `string` | No | No | Player 2 full display name |
| `home_odds` | `number` | Yes | No | Decimal odds for Player 1 win (e.g. 1.65) |
| `away_odds` | `number` | Yes | No | Decimal odds for Player 2 win (e.g. 2.25) |
| `predicted_winner` | `string` | No | No | Predicted winning player name |
| `win_probability` | `number` | No | No | Calibrated win probability (0.0 to 1.0) |
| `confidence` | `string` | No | No | Confidence enum: `'HIGH'`, `'MEDIUM'`, `'LOW'` |
| `predicted_score` | `string` | Yes | Partial | Expected set/game score (e.g. "2-1"); preserved in teaser |
| `best_bet_selection` | `string` | Yes | **Redacted** | Specific recommended wager (e.g. "Over 22.5 Games") |
| `best_bet_market` | `string` | Yes | **Redacted** | Betting market category (e.g. "TOTAL_GAMES", "MATCH_WINNER") |
| `best_bet_ev` | `string` | Yes | **Redacted** | String representation of expected value (e.g. `"+7.2% EV"`) |
| `best_bet_rationale` | `string` | Yes | **Redacted** | Deep rationale explaining model betting edge |
| `alt_bet_selection` | `string` | Yes | **Redacted** | Alternative conservative betting selection |
| `alt_bet_market` | `string` | Yes | **Redacted** | Market for alternative betting selection |
| `key_factors` | `string[]` | No | **Redacted** | Array of key tactical bullet points; redacted to `undefined` for guests |
| `devils_advocate_risk` | `string` | Yes | **Redacted** | Model contrarian risk assessment |
| `ai_summary` | `string` | Yes | **Truncated** | Model summary narrative; truncated to 220 chars for guests |
| `home_image` | `string` | No | No | Player 1 headshot avatar URL |
| `away_image` | `string` | No | No | Player 2 headshot avatar URL |
| `home_id` | `string` | Yes | No | Unique identity ID for Player 1 |
| `away_id` | `string` | Yes | No | Unique identity ID for Player 2 |
| `status` | `string` | No | No | Match status enum (`'UPCOMING'`, `'LIVE'`, `'WON'`, `'LOST'`, `'VOID'`) |
| `result_score` | `string` | Yes | No | Final official score (e.g. "6-4 3-6 7-6") |
| `published_at` | `string` | No | No | Publication timestamp (ISO 8601) |
| `created_at` | `string` | No | No | Creation timestamp (ISO 8601) |
| `content_locked` | `boolean` | No | No | Access indicator (`false` for member, `true` for guest) |
| `content_layers` | `object` | No | No | Client policy flags object |

---

## 3. Endpoint 2: `GET /api/web/editorials/:idOrSlug` & `/api/webapp/matches/:idOrSlug/editorial`

### 3.1. Route Definition
- **Path:** `/api/web/editorials/:idOrSlug` and `/api/webapp/matches/:idOrSlug/editorial`
- **Method:** `GET`
- **Route Parameters:**
  - `idOrSlug`: Matches either numeric `fixture_id` or string SEO `slug` (e.g. `alcaraz-vs-sinner-wimbledon-998811`).
- **Access Rule:** Non-published drafts return `404 Not Found` for public requests.

### 3.2. Response Shape (Verified Member: 40 Keys vs Guest: 28 Keys)

| Key Name | JSON Type | Unlocked (Member) | Locked (Guest) | Notes |
| :--- | :--- | :---: | :---: | :--- |
| `id` | `number` | Present | Omitted (guest view) | Primary editorial record ID |
| `fixture_id` | `number` | Present | Present | Match fixture identifier |
| `slug` | `string` | Present | Present | Unique URL slug |
| `headline` | `string` | Present | Present | Main editorial headline |
| `title` | `string` | Present | Present | Client alias for headline |
| `subtitle` | `string` | Present (nullable) | Present (nullable) | Editorial deck or subhead |
| `summary` | `string` | Full text | Truncated (280 chars) | Core executive summary |
| `short_summary` | `string` | Full text | Truncated (280 chars) | Short synopsis |
| `guest_safe_summary` | `string` | Full text | Truncated (280 chars) | Redaction safe teaser |
| `tactical_analysis` | `string` | Full text | **Redacted (`undefined`)** | Detailed tactical breakdown |
| `surface_breakdown` | `string` | Full text | **Redacted (`undefined`)** | Court surface impact analysis |
| `h2h_breakdown` | `string` | Full text | **Redacted (`undefined`)** | Head-to-head match history analysis |
| `ai_analysis` | `string` | Present (nullable) | **Redacted (`undefined`)** | Raw AI generated breakdown |
| `key_facts` | `string[]` | Array (`[]` default) | Array (`[]` default) | Key takeaway bullets |
| `key_facts_json` | `string` | Stringified JSON | Omitted (guest view) | Legacy stringified compatibility |
| `data_bullets` | `string[]` | Array (`[]` default) | Redacted or Array | Deep statistical metrics |
| `data_bullets_json` | `string` | Stringified JSON | Omitted (guest view) | Legacy stringified compatibility |
| `tags` | `string[]` | Array (`[]` default) | Array (`[]` default) | Editorial classification tags |
| `tags_json` | `string` | Stringified JSON | Omitted (guest view) | Legacy stringified compatibility |
| `key_stats` | `object` | Parsed JSON / Null | Redacted or Object | Key quantitative metrics |
| `key_stats_json` | `string` | Stringified JSON | Redacted or String | Legacy stringified compatibility |
| `seo_metadata` | `object` | Structured Object | Structured Object | OpenGraph and Twitter meta |
| `seo_metadata_json` | `string` | Stringified JSON | Omitted (guest view) | Legacy stringified compatibility |
| `status_history` | `object[]` | Array of audit logs | Omitted (guest view) | Editorial review log |
| `status_history_json` | `string` | Stringified JSON | Omitted (guest view) | Legacy stringified compatibility |
| `share_text` | `string` | Present (nullable) | Present (nullable) | Social share snippet |
| `author_name` | `string` | Present | Present | Editorial byline |
| `editor_name` | `string` | Present (nullable) | Omitted (guest view) | Approving editor name |
| `seo_title` | `string` | Present (nullable) | Present (nullable) | HTML page title |
| `seo_description` | `string` | Present (nullable) | Present (nullable) | HTML meta description |
| `publish_status` | `string` | Enum | Enum | `'published'`, `'draft'`, etc. |
| `version` | `number` | Integer | Integer | Revision version |
| `ai_assisted` | `number` | Integer (1 or 0) | Omitted (guest view) | Flag indicating AI generation |
| `is_published` | `number` | Integer (1 or 0) | Omitted (guest view) | Legacy publish flag |
| `published_at` | `string` | ISO 8601 | Omitted (guest view) | Timestamp of publication |
| `created_at` | `string` | ISO 8601 | Omitted (guest view) | Record creation timestamp |
| `updated_at` | `string` | ISO 8601 | Omitted (guest view) | Last update timestamp |
| `content_locked` | `boolean` | `false` | `true` | Client display gating flag |
| `verified` | `boolean` | `true` | `false` | Access verification status |
| `access_mode` | `string` | String | String | Access control mode |
| `content_layers` | `object` | Object | Object | Layer permission flags |

---

## 4. Endpoint 3: `GET /api/webapp/matches/:fixtureId/analytics`

### 4.1. Route Definition
- **Path:** `/api/webapp/matches/:fixtureId/analytics`
- **Method:** `GET`
- **Route Parameters:**
  - `fixtureId`: Numerical match fixture identifier.

### 4.2. Response Shape
```typescript
interface AnalyticsResponse {
  status: 'SUCCESS';
  verified: boolean;
  access_mode: string;
  content_layers: ContentLayerFlags;
  fixture_id: number;
  data: MatchDeepAnalyticsReport | RedactedAnalyticsTeaser;
}
```

### 4.3. Data Structure Comparison

#### Unlocked Member (`MatchDeepAnalyticsReport`):
- `matchInfo`: `fixtureId`, `homeName`, `awayName`, `surface`, `matchDate`.
- `p1RollingForm`: `playerName`, `last5WinRatePct`, `last10WinRatePct`, `recentScores[]`.
- `p2RollingForm`: `playerName`, `last5WinRatePct`, `last10WinRatePct`, `recentScores[]`.
- `surfaceDynamics`: `surface`, `p1SurfaceWinPct`, `p2SurfaceWinPct`.
- `fatigueAndLoad`: `p1RestDays`, `p2RestDays`.
- `tacticalEdge`: `serveAdvantage`, `returnAdvantage`.
- `historicalH2H`: `totalPreMatchEncounters`, `p1Wins`, `p2Wins`.

#### Locked Guest Teaser (`RedactedAnalyticsTeaser`):
- `locked: true`
- `matchInfo`: Full public match meta preserved.
- `teaser.p1RollingForm`: Win rates preserved, `recentScores` redacted to `[]`.
- `teaser.p2RollingForm`: Win rates preserved, `recentScores` redacted to `[]`.
- `teaser.h2hSummary`: Total encounters and win counts preserved, recent scores redacted.
- `surfaceDynamics`, `fatigueAndLoad`, `tacticalEdge`: Completely stripped.

---

## 5. Endpoint 4: `GET /api/web/matches`

### 5.1. Route Definition
- **Path:** `/api/web/matches`
- **Method:** `GET`
- **Query Parameters:**
  - `limit` *(optional, integer, default: 100)*: Limit matches returned.

### 5.2. Response Structure
```typescript
interface WebMatchesResponse {
  status: 'SUCCESS';
  verified: boolean;
  access_mode: string;
  layers: {
    guest_stats_level: 'full' | 'none';
    guest_can_see_summary: boolean;
    guest_can_see_stats: boolean;
    guest_can_see_ai_full: boolean;
  };
  matches: WebMatchItem[];
}
```

Every item in `matches` matches the 33-field structure of `predictions`, with additional `guest_stats_level` annotation.

---

## 6. Endpoint 5: `GET /api/webapp/stats`

### 6.1. Route Definition
- **Path:** `/api/webapp/stats`
- **Method:** `GET`

### 6.2. Response Dictionary
| Key Name | Type | Example | Notes |
| :--- | :--- | :--- | :--- |
| `totalPredictions` | `number` | `100` | Total scored predictions in system |
| `wonCount` | `number` | `65` | Count of bets settled as WON |
| `lostCount` | `number` | `30` | Count of bets settled as LOST |
| `voidCount` | `number` | `5` | Count of bets settled as VOID / INTERRUPTED |
| `winRatePct` | `number` | `68` | Round percentage (`won / (won + lost) * 100`) |
| `activeCount` | `number` | `10` | Ongoing UPCOMING or LIVE matches |
| `settled` | `number` | `95` | `won + lost` total |
| `won` | `number` | `65` | Alias for `wonCount` |
| `lost` | `number` | `30` | Alias for `lostCount` |
| `upcoming` | `number` | `10` | Alias for `activeCount` |
| `verified` | `boolean` | `true` / `false` | Caller verification status |
| `access_mode` | `string` | `'REGISTRATION_REQUIRED'` | Current server access policy |
