import { db } from '../db/connection';
import { BackendTennisApi } from '../dataPool/dataPool.tennisApi';
import { PersistentPoolService } from '../services/persistentPool.service';

async function checkMatch(row: Record<string, unknown>, label: string) {
  const eid = Number(row.rapid_event_id);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`CHECK: ${label}`);
  console.log('='.repeat(60));
  console.log('Date:', row.match_date);
  console.log('Opponent:', row.opponent_name);
  console.log('Score (DB):', row.score || row.hist_score);
  console.log('Tournament:', row.tourney_name);
  console.log('Event ID:', eid);
  console.log('Our index: csvStats=', row.has_csv_stats, '| apiStats=', row.has_api_statistics, '| pbp=', row.has_api_pbp);

  const cachedStats = PersistentPoolService.get(PersistentPoolService.buildKey('event_statistics', [eid]));
  const cachedPbp = PersistentPoolService.get(PersistentPoolService.buildKey('event_pbp', [eid]));
  console.log('\n--- Saved in our DB? ---');
  console.log('Statistics in pool_cache:', cachedStats ? `YES (${JSON.stringify(cachedStats).length} bytes)` : 'NO');
  console.log('PBP in pool_cache:', cachedPbp ? `YES (${JSON.stringify(cachedPbp).length} bytes)` : 'NO');

  console.log('\n--- Live API right now ---');
  const [stats, pbp, details] = await Promise.all([
    BackendTennisApi.getEventStatistics(eid),
    BackendTennisApi.getEventPointByPoint(eid),
    BackendTennisApi.getEventDetails(eid),
  ]);

  const statsPayload = stats as { statistics?: Array<{ period?: string; groups?: unknown[] }> };
  const pbpPayload = pbp as { pointByPoint?: Array<{ set?: number; games?: unknown[] }> };
  const detailsPayload = details as { event?: { homeTeam?: { name?: string }; awayTeam?: { name?: string }; status?: { type?: string } } };

  const hasStats = Boolean(statsPayload?.statistics?.length);
  const hasPbp = Boolean(pbpPayload?.pointByPoint?.length);

  console.log('Statistics from API:', hasStats ? 'YES' : 'NO');
  if (statsPayload?.statistics?.[0]?.groups) {
    const groups = statsPayload.statistics[0].groups as Array<{ groupName?: string }>;
    console.log('  Groups:', groups.map((g) => g.groupName).filter(Boolean).join(', '));
  }
  console.log('PBP from API:', hasPbp ? 'YES' : 'NO');
  if (pbpPayload?.pointByPoint?.[0]) {
    const sets = pbpPayload.pointByPoint;
    console.log('  Sets in PBP:', sets.length);
    const games = sets[0]?.games?.length ?? sets[1]?.games?.length ?? 0;
    console.log('  Games in first set chunk:', games);
  }

  const ev = detailsPayload?.event;
  console.log('Match:', ev?.homeTeam?.name, 'vs', ev?.awayTeam?.name, '| status:', ev?.status?.type);
  console.log('Raw sizes: stats', JSON.stringify(stats ?? {}).length, 'B | pbp', JSON.stringify(pbp ?? {}).length, 'B');

  console.log('\n>>> RESULT: API has statistics =', hasStats, '| PBP =', hasPbp);
  console.log('>>> We saved it =', Boolean(cachedStats), '|', Boolean(cachedPbp));
}

async function main() {
  const apiBasic = db
    .prepare(
      `
    SELECT pmi.*, h.score as hist_score, h.tourney_name
    FROM player_match_index pmi
    LEFT JOIN historical_matches h ON h.id = pmi.historical_match_id
    WHERE pmi.tracked_player_id = 1
      AND pmi.match_date >= '2024-01-01'
      AND pmi.completeness = 'api_basic'
      AND pmi.rapid_event_id IS NOT NULL
    ORDER BY pmi.match_date DESC
    LIMIT 1
  `,
    )
    .get() as Record<string, unknown> | undefined;

  const full = db
    .prepare(
      `
    SELECT pmi.*, h.score as hist_score, h.tourney_name
    FROM player_match_index pmi
    LEFT JOIN historical_matches h ON h.id = pmi.historical_match_id
    WHERE pmi.tracked_player_id = 1
      AND pmi.completeness = 'full'
      AND pmi.match_date >= '2024-01-01'
    ORDER BY pmi.match_date DESC
    LIMIT 1
  `,
    )
    .get() as Record<string, unknown> | undefined;

  if (apiBasic) {
    await checkMatch(apiBasic, '2024+ match NOT yet downloaded (api_basic)');
  }
  if (full) {
    await checkMatch(full, '2024+ match marked FULL in our DB');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
