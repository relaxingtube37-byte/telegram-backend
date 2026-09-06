/**
 * Audit player_matches_validated layer (read-only).
 * Run: npx tsx src/scripts/auditValidatedLayer.ts [sinceDate]
 */
import { db } from '../db/connection';
import { initSchema } from '../db/schema';
import { getValidatedLayerAuditSummary } from '../services/playerMatchesValidated.service';
import { QUARANTINE_FLAGS } from '../validation/quarantineFlags';

initSchema();

const SINCE = process.argv[2] || '2024-01-01';

console.log('\n══════════════════════════════════════════════════════════════');
console.log(' PLAYER_MATCHES_VALIDATED LAYER AUDIT');
console.log('══════════════════════════════════════════════════════════════');
console.log(`Window: match_date >= ${SINCE}\n`);

const summary = getValidatedLayerAuditSummary(SINCE);
const total = Number(summary.total_rows || 0);
const pct = (n: number) => (total ? `${((n / total) * 100).toFixed(1)}%` : '0%');

console.log('── Usability summary ──');
console.log({
  total_rows: total,
  historical_usable: `${summary.historical_usable} (${pct(Number(summary.historical_usable))})`,
  backtest_usable: `${summary.backtest_usable} (${pct(Number(summary.backtest_usable))})`,
  roi_usable: `${summary.roi_usable} (${pct(Number(summary.roi_usable))})`,
  surface_usable: `${summary.surface_usable} (${pct(Number(summary.surface_usable))})`,
  raw_serve_usable: `${summary.raw_serve_usable} (${pct(Number(summary.raw_serve_usable))})`,
  rank_usable: `${summary.rank_usable} (${pct(Number(summary.rank_usable))})`,
  placeholder_serve: `${summary.placeholder_serve_rows} (${pct(Number(summary.placeholder_serve_rows))})`,
});

console.log('\n── Quarantine flag counts ──');
for (const flag of Object.values(QUARANTINE_FLAGS)) {
  const row = db
    .prepare(
      `
    SELECT COUNT(*) c FROM player_matches_validated
    WHERE match_date >= @since AND quarantine_flags LIKE '%' || @flag || '%'
  `,
    )
    .get({ since: SINCE, flag }) as { c: number };
  console.log(`  ${flag}: ${row.c} (${pct(row.c)})`);
}

console.log('\n── Surface normalized distribution ──');
const surfaces = db
  .prepare(
    `
  SELECT surface_normalized, COUNT(*) c
  FROM player_matches_validated
  WHERE match_date >= @since
  GROUP BY surface_normalized ORDER BY c DESC
`,
  )
  .all({ since: SINCE });
console.log(surfaces);

console.log('\n── Sample quarantined rows (outside top-100) ──');
const sample = db
  .prepare(
    `
  SELECT match_date, player_name, opponent_name, player_rank, opponent_rank, quarantine_flags
  FROM player_matches_validated
  WHERE match_date >= @since
    AND quarantine_flags LIKE '%QUARANTINE_OUTSIDE_TOP100%'
  LIMIT 3
`,
  )
  .all({ since: SINCE });
console.log(sample);

console.log('\nDone.\n');
