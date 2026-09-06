import { db } from '../db/connection';
import { getPlayerArchive, getPlayerMatchBundle } from '../services/playerArchive.service';
import { PersistentPoolService } from '../services/persistentPool.service';

const nameArg = process.argv[2] || 'Sinner';

const player = db
  .prepare(
    `SELECT * FROM tracked_players WHERE full_name LIKE @q OR rapid_player_id = @id LIMIT 1`,
  )
  .get({ q: `%${nameArg}%`, id: Number(nameArg) || 0 }) as Record<string, unknown> | undefined;

if (!player) {
  console.error('Player not found:', nameArg);
  process.exit(1);
}

const playerId = Number(player.id);
console.log('PLAYER:', player.full_name, '| id:', playerId, '| rapid:', player.rapid_player_id);

const archive = getPlayerArchive(playerId)!;
const { summary, matches } = archive;

console.log('\n========== SUMMARY ==========');
console.log(`Total matches in player table: ${summary.total}`);
console.log(`CSV serve stats:             ${summary.withCsvStats} (${summary.csvStatsPct}%)`);
console.log(`API match statistics:        ${summary.withApiStatistics} (${summary.apiStatsPct}%)`);
console.log(`API point-by-point:          ${summary.withApiPbp} (${summary.pbpPct}%)`);
console.log(`FULL (stats + PBP):          ${summary.full} (${summary.fullCoveragePct}%)`);
console.log(`Breakdown: csv_only=${summary.csv_only} | api_basic=${summary.api_basic} | stats=${summary.stats} | full=${summary.full}`);

const missingCsv = matches.filter((m) => !m.hasCsvStats);
const missingStats = matches.filter((m) => !m.hasApiStatistics);
const missingPbp = matches.filter((m) => !m.hasApiPbp);
const hasEventIncomplete = matches.filter(
  (m) => m.rapidEventId && (!m.hasApiStatistics || !m.hasApiPbp),
);

console.log('\n========== GAPS ==========');
console.log(`No CSV serve stats:          ${missingCsv.length}`);
console.log(`No API statistics:           ${missingStats.length}`);
console.log(`No API PBP:                  ${missingPbp.length}`);
console.log(`Has API eventId but no bundle: ${hasEventIncomplete.length}`);

console.log('\n========== MATCH-BY-MATCH (all ${matches.length}) ==========');
console.log('date       | opponent                  | level     | CSV | Stats | PBP | eventId');
for (const m of matches) {
  const opp = m.opponent.slice(0, 25).padEnd(25);
  console.log(
    `${m.matchDate} | ${opp} | ${m.completeness.padEnd(9)} | ${m.hasCsvStats ? ' Y ' : ' N '} | ${m.hasApiStatistics ? '  Y  ' : '  N  '} | ${m.hasApiPbp ? ' Y ' : ' N '} | ${m.rapidEventId ?? '-'}`,
  );
}

console.log('\n========== CACHE SPOT-CHECK ==========');
const fullMatches = matches.filter((m) => m.completeness === 'full');
for (const m of fullMatches.slice(0, 3)) {
  const bundle = getPlayerMatchBundle(playerId, m.id);
  const statsBytes = JSON.stringify(bundle?.api?.statistics ?? {}).length;
  const pbpBytes = JSON.stringify(bundle?.api?.pointByPoint ?? {}).length;
  console.log(
    `FULL OK: ${m.matchDate} vs ${m.opponent} | stats ${statsBytes}B | pbp ${pbpBytes}B | csv w_svpt=${bundle?.historical?.w_svpt ?? 'n/a'}`,
  );
}

const incompleteWithEvent = hasEventIncomplete.slice(0, 5);
for (const m of incompleteWithEvent) {
  const eid = m.rapidEventId!;
  const cachedStats = PersistentPoolService.get(PersistentPoolService.buildKey('event_statistics', [eid]));
  const cachedPbp = PersistentPoolService.get(PersistentPoolService.buildKey('event_pbp', [eid]));
  console.log(
    `INCOMPLETE: ${m.matchDate} vs ${m.opponent} | event ${eid} | pool stats=${!!cachedStats} pbp=${!!cachedPbp}`,
  );
}

console.log('\n========== VERDICT ==========');
if (summary.full === summary.total && summary.withCsvStats === summary.total) {
  console.log('✅ COMPLETE — every match has CSV stats + API stats + PBP');
} else if (summary.full === 0 && summary.api_basic > 0) {
  console.log('❌ NOT COMPLETE — matches listed from API but bundles not fetched. Run Sync with higher maxBundleFetches.');
} else {
  console.log(`⚠️ PARTIAL — ${summary.full}/${summary.total} matches fully complete (stats+PBP)`);
  console.log(`   ${summary.withCsvStats}/${summary.total} have CSV serve stats`);
  console.log(`   ${hasEventIncomplete.length} matches need API bundle fetch`);
  console.log('   Action: press Sync again (increases bundles each run, max 40 per sync by default)');
}
