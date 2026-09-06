/**
 * Phase 2 — generated data quality audit (validated layer, Top-200 players).
 * Run: npx tsx src/scripts/auditGeneratedDataQuality.ts [sinceDate]
 */
import { db } from '../db/connection';
import { initSchema } from '../db/schema';

initSchema();

const SINCE = process.argv[2] || '2024-01-01';
const TOP_RANK_CUTOFF = 200;

type MetricRow = {
  total_rows: number;
  placeholder_serve_rows: number;
  unknown_surface_rows: number;
  score_filled_rows: number;
  rank_usable_rows: number;
};

function pct(n: number, total: number): string {
  return total ? `${((n / total) * 100).toFixed(1)}%` : '0.0%';
}

const topPlayerIds = db
  .prepare(
    `
  SELECT tracked_player_id
  FROM (
    SELECT
      tracked_player_id,
      MIN(player_rank) AS best_rank
    FROM player_matches_validated
    WHERE match_date >= @since
      AND is_rank_usable = 1
      AND player_rank BETWEEN 1 AND @topRank
    GROUP BY tracked_player_id
  )
  ORDER BY best_rank ASC
  LIMIT @topRank
`,
  )
  .all({ since: SINCE, topRank: TOP_RANK_CUTOFF }) as Array<{ tracked_player_id: number }>;

const playerIdList = topPlayerIds.map((r) => r.tracked_player_id);
console.log('\n══════════════════════════════════════════════════════════════');
console.log(' GENERATED DATA QUALITY AUDIT (Phase 2)');
console.log('══════════════════════════════════════════════════════════════');
console.log(`Window: match_date >= ${SINCE}`);
console.log(`Cohort: Top-${TOP_RANK_CUTOFF} tracked players (${playerIdList.length} found)\n`);

if (playerIdList.length === 0) {
  console.log('No Top-200 player rows in window — run ingestion or widen since date.\n');
  process.exit(0);
}

const placeholders = playerIdList.map(() => '?').join(',');
const metrics = db
  .prepare(
    `
  SELECT
    COUNT(*) AS total_rows,
    SUM(is_placeholder_serve) AS placeholder_serve_rows,
    SUM(CASE WHEN surface_normalized = 'Unknown' THEN 1 ELSE 0 END) AS unknown_surface_rows,
    SUM(CASE WHEN TRIM(COALESCE(score, '')) != '' AND score != 'W/O' THEN 1 ELSE 0 END) AS score_filled_rows,
    SUM(is_rank_usable) AS rank_usable_rows
  FROM player_matches_validated
  WHERE match_date >= ?
    AND tracked_player_id IN (${placeholders})
`,
  )
  .get(SINCE, ...playerIdList) as MetricRow;

const total = Number(metrics.total_rows || 0);
const placeholder = Number(metrics.placeholder_serve_rows || 0);
const unknownSurface = Number(metrics.unknown_surface_rows || 0);
const scoreFilled = Number(metrics.score_filled_rows || 0);
const rankUsable = Number(metrics.rank_usable_rows || 0);

console.log('── Top-200 cohort rates ──');
console.log({
  total_rows: total,
  placeholder_serve_rate: `${placeholder} (${pct(placeholder, total)})`,
  unknown_surface_rate: `${unknownSurface} (${pct(unknownSurface, total)})`,
  score_fill_rate: `${scoreFilled} (${pct(scoreFilled, total)})`,
  rank_usable_rate: `${rankUsable} (${pct(rankUsable, total)})`,
});

console.log('\n── Acceptance targets (DATA_POLICY) ──');
console.log({
  score_fill_target: '≥ 95% for Top-200 recent rows',
  score_fill_pass: scoreFilled / Math.max(total, 1) >= 0.95,
  placeholder_serve_note: 'High rate → Statistical agent must downweight serve KPIs',
});

console.log('\n── Surface distribution (Top-200 cohort) ──');
const surfaces = db
  .prepare(
    `
  SELECT surface_normalized, COUNT(*) AS c
  FROM player_matches_validated
  WHERE match_date >= ?
    AND tracked_player_id IN (${placeholders})
  GROUP BY surface_normalized
  ORDER BY c DESC
`,
  )
  .all(SINCE, ...playerIdList);
console.log(surfaces);

console.log('\nDone.\n');
