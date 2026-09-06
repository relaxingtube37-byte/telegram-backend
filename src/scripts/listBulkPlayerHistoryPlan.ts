/**
 * List bulk player-history fetch plan (rankings + events/previous pages).
 *
 * Run: npm run bulk:list-player-history
 */

import {
  estimateHistoryFetch,
  fetchTopRankedPlayers,
  type RankedPlayer,
} from '../services/bulkPlayerHistoryFetch.service';
import { RateLimitedTennisClient } from '../services/bulkMatchBundleFetch.service';

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const rankLimit = Number(arg('--rank-limit', '200'));
const fromDate = arg('--from', '2024-01-01');
const toDate = arg('--to', '2026-12-31');
const live = process.argv.includes('--live');

async function main(): Promise<void> {
  let players: RankedPlayer[] = [];

  if (live) {
    const client = new RateLimitedTennisClient(8);
    const ranked = await fetchTopRankedPlayers(client, rankLimit);
    players = [...ranked.atp, ...ranked.wta];
    console.log('\n(Live rankings fetched from API)\n');
  } else {
    console.log('\n(Dry estimate only — add --live to fetch rankings now)\n');
    players = Array.from({ length: rankLimit * 2 }, (_, i) => ({
      rapid_player_id: i + 1,
      full_name: `player-${i + 1}`,
      short_name: null,
      country_code: null,
      tour: i < rankLimit ? 'ATP' : 'WTA',
      gender: i < rankLimit ? 'M' : 'F',
      current_rank: (i % rankLimit) + 1,
      ranking_points: null,
    }));
  }

  const estimate = estimateHistoryFetch(players, 9);

  console.log('══════════════════════════════════════════════════════════════');
  console.log(' BULK PLAYER HISTORY PLAN');
  console.log('══════════════════════════════════════════════════════════════\n');
  console.log({
    rankLimitPerTour: rankLimit,
    totalPlayers: players.length,
    dateWindow: { fromDate, toDate },
    eventsPerPage: 30,
    note: 'API returns 30 matches/page (not 130). Stop when page goes before fromDate.',
    ...estimate,
  });

  if (live && players.length) {
    console.log('\n── Top 5 ATP ──');
    for (const p of players.filter((x) => x.tour === 'ATP').slice(0, 5)) {
      console.log(`#${p.current_rank} ${p.full_name} (id=${p.rapid_player_id})`);
    }
    console.log('\n── Top 5 WTA ──');
    for (const p of players.filter((x) => x.tour === 'WTA').slice(0, 5)) {
      console.log(`#${p.current_rank} ${p.full_name} (id=${p.rapid_player_id})`);
    }
  }

  console.log('\nRun fetch: npm run bulk:fetch-player-history -- --req-per-sec 8 --resume');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
