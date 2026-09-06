/**
 * Sample N cohort events and check API hit rate (details / statistics / PBP).
 * Run: npx tsx src/scripts/probeBulkApiCoverage.ts --sample 30
 */

import { BackendTennisApi } from '../dataPool/dataPool.tennisApi';
import { listTopRankedTrackedEvents } from '../services/bulkMatchBundleFetch.service';

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const sampleSize = Number(arg('--sample', '30'));

async function main(): Promise<void> {
  const events = listTopRankedTrackedEvents({ fromDate: '2024-01-01', toDate: '2026-12-31', rankMax: 200 });
  const step = Math.max(1, Math.floor(events.length / sampleSize));
  const sample = events.filter((_, i) => i % step === 0).slice(0, sampleSize);

  let detailsOk = 0;
  let statsOk = 0;
  let pbpOk = 0;

  for (const ev of sample) {
    const [details, stats, pbp] = await Promise.all([
      BackendTennisApi.getEventDetails(ev.rapid_event_id),
      BackendTennisApi.getEventStatistics(ev.rapid_event_id),
      BackendTennisApi.getEventPointByPoint(ev.rapid_event_id),
    ]);
    const hasDetails = Boolean((details as { event?: { id?: number } })?.event?.id);
    const hasStats = Boolean((stats as { statistics?: unknown[] })?.statistics?.length);
    const hasPbp = Boolean((pbp as { pointByPoint?: unknown[] })?.pointByPoint?.length);
    if (hasDetails) detailsOk++;
    if (hasStats) statsOk++;
    if (hasPbp) pbpOk++;
  }

  console.log(
    JSON.stringify(
      {
        cohort_events: events.length,
        sampled: sample.length,
        details_ok: detailsOk,
        statistics_ok: statsOk,
        pbp_ok: pbpOk,
        details_pct: `${((detailsOk / sample.length) * 100).toFixed(1)}%`,
        statistics_pct: `${((statsOk / sample.length) * 100).toFixed(1)}%`,
        pbp_pct: `${((pbpOk / sample.length) * 100).toFixed(1)}%`,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
