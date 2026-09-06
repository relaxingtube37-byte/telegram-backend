import fs from 'node:fs';
import path from 'node:path';

const B = path.resolve('data/bulk-match-bundles/events');

type Issue = { eventId: number; issue: string };

function hasRealServe(stats: unknown): boolean {
  const periods = (stats as { statistics?: Array<{ period: string; groups?: Array<{ statisticsItems?: unknown[] }> }> })
    .statistics;
  const all = periods?.find((p) => p.period === 'ALL');
  const item = all?.groups
    ?.flatMap((g) => g.statisticsItems || [])
    .find((i) => (i as { key?: string }).key === 'firstServeAccuracy') as
    | { homeValue?: number; awayValue?: number; homeTotal?: number }
    | undefined;
  if (!item) return false;
  const home = Number(item.homeValue || 0);
  const away = Number(item.awayValue || 0);
  const total = Number(item.homeTotal || 0);
  return home > 0 || away > 0 || total > 0;
}

function hasPbp(pbp: unknown): boolean {
  const sets = (pbp as { pointByPoint?: unknown[] })?.pointByPoint;
  return Array.isArray(sets) && sets.length > 0;
}

const ids = fs.existsSync(B) ? fs.readdirSync(B).filter((n) => /^\d+$/.test(n)) : [];
const issues: Issue[] = [];
let allThreeOk = 0;
let realServe = 0;
let withPbp = 0;
let missingFiles = 0;
let badManifest = 0;

for (const id of ids) {
  const eventId = Number(id);
  const dir = path.join(B, id);
  const manifestPath = path.join(dir, 'manifest.json');
  const statsPath = path.join(dir, 'statistics.json');
  const pbpPath = path.join(dir, 'point_by_point.json');
  const detailsPath = path.join(dir, 'event_details.json');

  if (!fs.existsSync(manifestPath)) {
    issues.push({ eventId, issue: 'missing manifest' });
    badManifest++;
    continue;
  }

  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    statistics_status?: string;
    pbp_status?: string;
    details_status?: string;
  };

  const statOk = m.statistics_status === 'ok' || m.statistics_status === 'cached';
  const pbpOk = m.pbp_status === 'ok' || m.pbp_status === 'cached';
  const detailsOk = m.details_status === 'ok' || m.details_status === 'cached';

  if (statOk && pbpOk && detailsOk) allThreeOk++;
  else {
    issues.push({
      eventId,
      issue: `manifest: stat=${m.statistics_status} pbp=${m.pbp_status} details=${m.details_status}`,
    });
  }

  for (const [label, p] of [
    ['statistics.json', statsPath],
    ['point_by_point.json', pbpPath],
    ['event_details.json', detailsPath],
  ] as const) {
    if (!fs.existsSync(p)) {
      issues.push({ eventId, issue: `missing ${label}` });
      missingFiles++;
    }
  }

  if (fs.existsSync(statsPath)) {
    try {
      const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
      if (hasRealServe(stats)) realServe++;
      else issues.push({ eventId, issue: 'no real serve counts in statistics' });
    } catch {
      issues.push({ eventId, issue: 'bad statistics.json' });
    }
  }

  if (fs.existsSync(pbpPath)) {
    try {
      const pbp = JSON.parse(fs.readFileSync(pbpPath, 'utf8'));
      if (hasPbp(pbp)) withPbp++;
      else issues.push({ eventId, issue: 'empty point-by-point' });
    } catch {
      issues.push({ eventId, issue: 'bad point_by_point.json' });
    }
  }
}

const uniqueBadEvents = new Set(issues.map((i) => i.eventId)).size;

console.log(
  JSON.stringify(
    {
      bundles_checked: ids.length,
      all_three_ok: allThreeOk,
      real_serve_ok: realServe,
      pbp_nonempty: withPbp,
      events_with_any_issue: uniqueBadEvents,
      issue_samples: issues.slice(0, 15),
      pass_rate_pct: ids.length ? Math.round((allThreeOk / ids.length) * 1000) / 10 : 0,
      verdict:
        ids.length > 0 && uniqueBadEvents === 0
          ? 'ALL_OK'
          : ids.length > 0 && allThreeOk / ids.length >= 0.95
            ? 'MOSTLY_OK'
            : 'CHECK_ISSUES',
    },
    null,
    2,
  ),
);
