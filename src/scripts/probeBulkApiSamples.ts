/**
 * Probe RapidAPI statistics + PBP for diverse match types (3-set, 5-set, tournaments).
 * Saves raw JSON samples under data/api-probe-samples/
 *
 * Run: npx tsx src/scripts/probeBulkApiSamples.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/connection';
import { BackendTennisApi } from '../dataPool/dataPool.tennisApi';

const OUT = path.resolve('data/api-probe-samples');

interface SampleRow {
  label: string;
  rapid_event_id: number;
  match_date: string;
  tourney_name: string | null;
  score: string | null;
  best_of: number | null;
  player_name: string;
  opponent_name: string;
}

function setCountFromScore(score: string | null): number {
  if (!score) return 0;
  const parts = score.trim().split(/\s+/).filter((p) => /^\d/.test(p));
  return parts.length;
}

function pickSamples(): SampleRow[] {
  const base = db
    .prepare(
      `
    SELECT
      COALESCE(pmi.rapid_event_id, h.rapid_event_id) AS rapid_event_id,
      pmi.match_date,
      COALESCE(pmi.tourney_name, h.tourney_name) AS tourney_name,
      COALESCE(pmi.score, h.score) AS score,
      h.best_of,
      tp.full_name AS player_name,
      pmi.opponent_name
    FROM player_match_index pmi
    JOIN tracked_players tp ON tp.id = pmi.tracked_player_id
    LEFT JOIN historical_matches h ON h.id = pmi.historical_match_id
    WHERE tp.is_active = 1 AND tp.current_rank <= 200
      AND pmi.match_date >= '2024-01-01'
      AND COALESCE(pmi.rapid_event_id, h.rapid_event_id) IS NOT NULL
      AND COALESCE(pmi.score, h.score) IS NOT NULL
      AND TRIM(COALESCE(pmi.score, h.score, '')) != ''
  `,
    )
    .all() as Omit<SampleRow, 'label'>[];

  const picks: SampleRow[] = [];
  const used = new Set<number>();

  const want = (label: string, pred: (r: Omit<SampleRow, 'label'>) => boolean) => {
    const row = base.find((r) => !used.has(r.rapid_event_id) && pred(r));
    if (!row) return;
    used.add(row.rapid_event_id);
    picks.push({ ...row, label });
  };

  want('three_set_match', (r) => setCountFromScore(r.score) === 3);
  want('five_set_match', (r) => setCountFromScore(r.score) >= 5 || Number(r.best_of) === 5);
  want('two_set_match', (r) => setCountFromScore(r.score) === 2);
  want('grand_slam', (r) => /australian|roland|wimbledon|us open|french open/i.test(r.tourney_name || ''));
  want('masters_1000', (r) => /miami|indian wells|monte carlo|madrid|rome|cincinnati|shanghai|paris/i.test(r.tourney_name || ''));
  want('challenger', (r) => /chall/i.test(r.tourney_name || ''));
  want('recent_2026', (r) => r.match_date >= '2026-01-01');
  want('early_2024', (r) => r.match_date < '2024-03-01');

  return picks.slice(0, 8);
}

function summarizeStats(stats: unknown): Record<string, unknown> {
  const s = stats as {
    statistics?: Array<{
      period?: string;
      groups?: Array<{ groupName?: string; statisticsItems?: Array<{ name?: string; home?: string; away?: string }> }>;
    }>;
  };
  if (!s?.statistics?.length) return { hasData: false };

  const periods = s.statistics.map((p) => p.period).filter(Boolean);
  const allGroup = s.statistics.find((p) => String(p.period || '').toUpperCase() === 'ALL') || s.statistics[0];
  const groups = (allGroup?.groups || []).map((g) => ({
    name: g.groupName,
    items: (g.statisticsItems || []).slice(0, 6).map((i) => ({ name: i.name, home: i.home, away: i.away })),
    itemCount: (g.statisticsItems || []).length,
  }));

  return { hasData: true, periods, groups };
}

function summarizePbp(pbp: unknown): Record<string, unknown> {
  const p = pbp as { pointByPoint?: Array<{ set?: number; games?: Array<{ game?: number; points?: unknown[] }> }> };
  if (!p?.pointByPoint?.length) return { hasData: false };

  const sets = p.pointByPoint.map((s) => ({
    set: s.set,
    games: (s.games || []).length,
    sampleGame: (s.games || [])[0]
      ? {
          game: s.games![0].game,
          pointCount: (s.games![0].points || []).length,
          firstPoint: (s.games![0].points || [])[0],
        }
      : null,
  }));

  return { hasData: true, setCount: sets.length, sets };
}

function summarizeDetails(details: unknown): Record<string, unknown> {
  const d = details as {
    event?: {
      id?: number;
      startTimestamp?: number;
      tournament?: { name?: string; category?: { name?: string } };
      roundInfo?: { round?: number; name?: string };
      homeTeam?: { name?: string };
      awayTeam?: { name?: string };
      status?: { type?: string; description?: string };
      winnerCode?: number;
    };
  };
  const ev = d?.event;
  if (!ev) return { hasData: false };

  const ts = ev.startTimestamp ? new Date(ev.startTimestamp * 1000).toISOString() : null;

  return {
    hasData: true,
    id: ev.id,
    tournament: ev.tournament?.name,
    category: ev.tournament?.category?.name,
    round: ev.roundInfo?.name,
    home: ev.homeTeam?.name,
    away: ev.awayTeam?.name,
    startTimestamp: ev.startTimestamp,
    startUtc: ts,
    status: ev.status?.type,
    statusDesc: ev.status?.description,
    winnerCode: ev.winnerCode,
  };
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function probeOne(sample: SampleRow): Promise<Record<string, unknown>> {
  const dir = path.join(OUT, sample.label);
  fs.mkdirSync(dir, { recursive: true });

  writeJson(path.join(dir, 'db_context.json'), sample);

  const [statistics, pointByPoint, details] = await Promise.all([
    BackendTennisApi.getEventStatistics(sample.rapid_event_id),
    BackendTennisApi.getEventPointByPoint(sample.rapid_event_id),
    BackendTennisApi.getEventDetails(sample.rapid_event_id),
  ]);

  writeJson(path.join(dir, 'statistics.raw.json'), statistics ?? { _empty: true });
  writeJson(path.join(dir, 'point_by_point.raw.json'), pointByPoint ?? { _empty: true });
  writeJson(path.join(dir, 'event_details.raw.json'), details ?? { _empty: true });

  const summary = {
    label: sample.label,
    rapid_event_id: sample.rapid_event_id,
    db_score: sample.score,
    db_sets: setCountFromScore(sample.score),
    bytes: {
      statistics: JSON.stringify(statistics ?? {}).length,
      pbp: JSON.stringify(pointByPoint ?? {}).length,
      details: JSON.stringify(details ?? {}).length,
    },
    statistics: summarizeStats(statistics),
    pointByPoint: summarizePbp(pointByPoint),
    eventDetails: summarizeDetails(details),
  };

  writeJson(path.join(dir, 'summary.json'), summary);
  return summary;
}

async function main(): Promise<void> {
  const samples = pickSamples();
  console.log(`\nProbing ${samples.length} diverse matches → ${OUT}\n`);

  const results: Record<string, unknown>[] = [];
  for (const sample of samples) {
    console.log(`▶ ${sample.label} | event ${sample.rapid_event_id} | ${sample.match_date} | ${sample.score}`);
    const summary = await probeOne(sample);
    results.push(summary);
    const st = summary.statistics as { hasData?: boolean };
    const pb = summary.pointByPoint as { hasData?: boolean; setCount?: number };
    const det = summary.eventDetails as { hasData?: boolean; startUtc?: string; tournament?: string };
    console.log(
      `  stats=${st.hasData ? 'YES' : 'NO'} | pbp=${pb.hasData ? `YES (${pb.setCount} sets)` : 'NO'} | time=${det.startUtc || 'n/a'} | ${det.tournament || sample.tourney_name}`,
    );
  }

  writeJson(path.join(OUT, 'probe-report.json'), {
    probed_at: new Date().toISOString(),
    sample_count: results.length,
    results,
  });

  console.log(`\n✅ Saved under ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
