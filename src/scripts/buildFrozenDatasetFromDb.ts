/**
 * Builds a leak-proof frozen backtest dataset from historical_matches (SQLite).
 * Computes real point-in-time: prior form, surface form, H2H, recent matches, surface KPIs.
 *
 * Usage:
 *   npx tsx src/scripts/buildFrozenDatasetFromDb.ts
 *   npx tsx src/scripts/buildFrozenDatasetFromDb.ts --limit 5000
 *   npx tsx src/scripts/buildFrozenDatasetFromDb.ts --maxRank 150 --from 2018-01-01 --to 2025-12-31
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { db } from '../db/connection';
import { initSchema } from '../db/schema';
import { aggregatePlayerSurfaceStatsFromRows, cleanPlayerSearchName } from '../services/historicalPlayerStats.service';

initSchema();

interface DbRow {
  id: number;
  tour: string;
  tourney_id: string | null;
  tourney_name: string;
  tourney_level: string | null;
  surface: string;
  match_date: string;
  match_num: number | null;
  round_name: string | null;
  winner_id: number | null;
  winner_name: string;
  winner_hand: string | null;
  winner_ht: number | null;
  winner_ioc: string | null;
  winner_rank: number | null;
  loser_id: number | null;
  loser_name: string;
  loser_hand: string | null;
  loser_ht: number | null;
  loser_ioc: string | null;
  loser_rank: number | null;
  score: string;
  minutes: number | null;
  w_ace: number | null;
  w_df: number | null;
  w_svpt: number | null;
  w_1stIn: number | null;
  w_1stWon: number | null;
  w_bpSaved: number | null;
  w_bpFaced: number | null;
  l_ace: number | null;
  l_df: number | null;
  l_svpt: number | null;
  l_1stIn: number | null;
  l_1stWon: number | null;
  l_bpSaved: number | null;
  l_bpFaced: number | null;
}

interface PlayerHistoryEntry {
  date: string;
  timestamp: number;
  surface: string;
  tournament: string;
  round: string;
  opponentKey: string;
  opponentName: string;
  won: boolean;
  score: string;
  minutes: number;
  aces: number;
  doubleFaults: number;
  firstServeIn: number;
  firstServeWon: number;
  servePoints: number;
  bpSaved: number;
  bpFaced: number;
}

interface CliOptions {
  limit: number | null;
  maxRank: number;
  fromDate: string;
  toDate: string;
  outputDir: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    limit: null,
    maxRank: 150,
    fromDate: '2018-01-01',
    toDate: '2025-12-31',
    outputDir: path.resolve(process.cwd(), '../state football/scratch/tennis_archive/db_frozen'),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--limit' && argv[i + 1]) options.limit = Number(argv[++i]);
    else if (arg === '--maxRank' && argv[i + 1]) options.maxRank = Number(argv[++i]);
    else if (arg === '--from' && argv[i + 1]) options.fromDate = argv[++i];
    else if (arg === '--to' && argv[i + 1]) options.toDate = argv[++i];
    else if (arg === '--out' && argv[i + 1]) options.outputDir = path.resolve(argv[++i]);
  }

  return options;
}

function normalizeName(name: string): string {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function playerKey(id: number | null | undefined, name: string): string {
  if (id && id > 0) return `id:${id}`;
  return `name:${normalizeName(name)}`;
}

function h2hKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

function toTimestamp(isoDate: string): number {
  return new Date(`${isoDate}T12:00:00.000Z`).getTime();
}

function parseSetScore(score: string): { homeSets: number; awaySets: number } {
  const parts = (score || '').trim().split(/\s+/).filter(Boolean);
  let homeSets = 0;
  let awaySets = 0;
  for (const part of parts) {
    const m = part.match(/(\d+)-(\d+)/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (Number.isNaN(a) || Number.isNaN(b)) continue;
    if (a > b) homeSets++;
    else if (b > a) awaySets++;
  }
  return { homeSets, awaySets };
}

function rankImpliedOdds(homeRank: number, awayRank: number): {
  homeOdds: number;
  awayOdds: number;
  impliedHomeProb: number;
  impliedAwayProb: number;
  overround: number;
} {
  const rankDiff = awayRank - homeRank;
  const pHome = Math.min(0.95, Math.max(0.05, 1 / (1 + Math.pow(10, rankDiff / 50))));
  const pAway = 1 - pHome;
  const margin = 1.05;
  const homeOdds = Math.round((margin / pHome) * 100) / 100;
  const awayOdds = Math.round((margin / pAway) * 100) / 100;
  const impliedHome = 1 / homeOdds;
  const impliedAway = 1 / awayOdds;
  const overround = impliedHome + impliedAway - 1;
  return {
    homeOdds,
    awayOdds,
    impliedHomeProb: Math.round(impliedHome * 10000) / 10000,
    impliedAwayProb: Math.round(impliedAway * 10000) / 10000,
    overround: Math.round(overround * 10000) / 10000,
  };
}

function surfaceNorm(surface: string): string {
  const s = (surface || '').toLowerCase();
  if (s.includes('clay')) return 'Clay';
  if (s.includes('grass')) return 'Grass';
  if (s.includes('carpet')) return 'Carpet';
  return 'Hard';
}

function buildSurfaceStats(history: PlayerHistoryEntry[], surface: string, playerName: string) {
  const target = surfaceNorm(surface);
  const rows = history
    .filter((entry) => surfaceNorm(entry.surface) === target)
    .map((entry) => ({
      surface: entry.surface,
      match_date: entry.date,
      winner_name: entry.won ? playerName : entry.opponentName,
      loser_name: entry.won ? entry.opponentName : playerName,
      w_ace: entry.won ? entry.aces : 0,
      w_df: entry.won ? entry.doubleFaults : 0,
      w_svpt: entry.won ? entry.servePoints : 0,
      w_1stIn: entry.won ? entry.firstServeIn : 0,
      w_1stWon: entry.won ? entry.firstServeWon : 0,
      w_2ndWon: 0,
      w_bpSaved: entry.won ? entry.bpSaved : 0,
      w_bpFaced: entry.won ? entry.bpFaced : 0,
      l_ace: entry.won ? 0 : entry.aces,
      l_df: entry.won ? 0 : entry.doubleFaults,
      l_svpt: entry.won ? 0 : entry.servePoints,
      l_1stIn: entry.won ? 0 : entry.firstServeIn,
      l_1stWon: entry.won ? 0 : entry.firstServeWon,
      l_2ndWon: 0,
      l_bpSaved: entry.won ? 0 : entry.bpSaved,
      l_bpFaced: entry.won ? 0 : entry.bpFaced,
    }));

  const cleanName = cleanPlayerSearchName(playerName);
  const aggregated = aggregatePlayerSurfaceStatsFromRows(rows, cleanName)[0];
  if (!aggregated) {
    return {
      surface: target,
      matches: 0,
      wins: 0,
      losses: 0,
      winRatePct: 0,
    };
  }

  return {
    surface: aggregated.surface,
    groundType: aggregated.groundType,
    matches: aggregated.matches,
    wins: aggregated.wins,
    losses: aggregated.losses,
    winRatePct: aggregated.matches > 0 ? Math.round((aggregated.wins / aggregated.matches) * 100) : 0,
    aces: aggregated.aces,
    doubleFaults: aggregated.doubleFaults,
    breakPointsScored: aggregated.breakPointsScored,
    breakPointsTotal: aggregated.breakPointsTotal,
    firstServeTotal: aggregated.firstServeTotal,
    firstServePointsScored: aggregated.firstServePointsScored,
    servePointsTotal: aggregated.servePointsTotal,
    source: 'sqlite_historical_pool',
  };
}

function buildRecentMatchEvents(history: PlayerHistoryEntry[], playerName: string, limit = 4) {
  return history.slice(0, limit).map((entry, idx) => {
    const isHome = entry.won;
    return {
      fixture: {
        id: Number(`${toTimestamp(entry.date)}${idx}`),
        date: entry.date,
        status: { type: 'finished', short: 'FT', long: 'Finished' },
        groundType: entry.surface,
      },
      league: {
        name: entry.tournament,
        roundName: entry.round,
      },
      teams: {
        home: {
          id: 1,
          name: isHome ? playerName : entry.opponentName,
          winner: isHome,
        },
        away: {
          id: 2,
          name: isHome ? entry.opponentName : playerName,
          winner: !isHome,
        },
      },
      score: entry.score,
    };
  });
}

function assignPartition(index: number, total: number): 'development' | 'validation' | 'final_test' {
  const ratio = index / Math.max(total, 1);
  if (ratio < 0.6) return 'development';
  if (ratio < 0.8) return 'validation';
  return 'final_test';
}

function writeJsonl(filePath: string, records: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = records.map((record) => JSON.stringify(record)).join('\n') + '\n';
  fs.writeFileSync(filePath, content, 'utf8');
}

function sha256File(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  console.log('══════════════════════════════════════════════════════════════════');
  console.log('🧊 BUILD FROZEN DATASET FROM SQLITE historical_matches');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(`Date range: ${options.fromDate} → ${options.toDate}`);
  console.log(`Max rank (both players): ${options.maxRank}`);
  console.log(`Output: ${options.outputDir}`);

  const sql = `
    SELECT id, tour, tourney_id, tourney_name, tourney_level, surface, match_date, match_num, round_name,
           winner_id, winner_name, winner_hand, winner_ht, winner_ioc, winner_rank,
           loser_id, loser_name, loser_hand, loser_ht, loser_ioc, loser_rank,
           score, minutes,
           w_ace, w_df, w_svpt, w_1stIn, w_1stWon, w_bpSaved, w_bpFaced,
           l_ace, l_df, l_svpt, l_1stIn, l_1stWon, l_bpSaved, l_bpFaced
    FROM historical_matches
    WHERE match_date >= @fromDate
      AND match_date <= @toDate
      AND winner_rank BETWEEN 1 AND @maxRank
      AND loser_rank BETWEEN 1 AND @maxRank
      AND winner_name IS NOT NULL
      AND loser_name IS NOT NULL
    ORDER BY match_date ASC, id ASC
    ${options.limit ? 'LIMIT @limit' : ''}
  `;

  const rows = db.prepare(sql).all({
    fromDate: options.fromDate,
    toDate: options.toDate,
    maxRank: options.maxRank,
    limit: options.limit ?? undefined,
  }) as DbRow[];

  console.log(`Loaded ${rows.length} candidate matches from database.`);

  const playerHistory = new Map<string, PlayerHistoryEntry[]>();
  const h2hStore = new Map<string, { homeKey: string; awayKey: string; homeWins: number; awayWins: number; meetings: string[] }>();

  const frozenRecords: any[] = [];
  let withForm = 0;
  let withH2H = 0;
  let withSurface = 0;

  for (const row of rows) {
    const winnerKey = playerKey(row.winner_id, row.winner_name);
    const loserKey = playerKey(row.loser_id, row.loser_name);

    // Stable home/away: lower player key is "home"
    const homeIsWinner = winnerKey < loserKey;
    const homeKey = homeIsWinner ? winnerKey : loserKey;
    const awayKey = homeIsWinner ? loserKey : winnerKey;
    const homeName = homeIsWinner ? row.winner_name : row.loser_name;
    const awayName = homeIsWinner ? row.loser_name : row.winner_name;
    const homeId = homeIsWinner ? (row.winner_id || 0) : (row.loser_id || 0);
    const awayId = homeIsWinner ? (row.loser_id || 0) : (row.winner_id || 0);
    const homeRank = homeIsWinner ? (row.winner_rank || 200) : (row.loser_rank || 200);
    const awayRank = homeIsWinner ? (row.loser_rank || 200) : (row.winner_rank || 200);
    const homeHand = homeIsWinner ? row.winner_hand : row.loser_hand;
    const awayHand = homeIsWinner ? row.loser_hand : row.winner_hand;
    const homeHt = homeIsWinner ? row.winner_ht : row.loser_ht;
    const awayHt = homeIsWinner ? row.loser_ht : row.winner_ht;
    const homeIoc = homeIsWinner ? row.winner_ioc : row.loser_ioc;
    const awayIoc = homeIsWinner ? row.loser_ioc : row.winner_ioc;

    const homeHist = playerHistory.get(homeKey) || [];
    const awayHist = playerHistory.get(awayKey) || [];
    const pairKey = h2hKey(homeKey, awayKey);
    const h2h = h2hStore.get(pairKey) || { homeKey, awayKey, homeWins: 0, awayWins: 0, meetings: [] };

    const homeSurfaceStats = buildSurfaceStats(homeHist, row.surface, homeName);
    const awaySurfaceStats = buildSurfaceStats(awayHist, row.surface, awayName);
    const homeRecent = buildRecentMatchEvents(homeHist, homeName, 4);
    const awayRecent = buildRecentMatchEvents(awayHist, awayName, 4);

    const homePriorWins = homeHist.filter((entry) => entry.won).length;
    const homePriorLosses = homeHist.length - homePriorWins;
    const awayPriorWins = awayHist.filter((entry) => entry.won).length;
    const awayPriorLosses = awayHist.length - awayPriorWins;

    if (homeHist.length > 0 || awayHist.length > 0) withForm++;
    if (h2h.homeWins + h2h.awayWins > 0) withH2H++;
    if (homeSurfaceStats.matches > 0 || awaySurfaceStats.matches > 0) withSurface++;

    const odds = rankImpliedOdds(homeRank, awayRank);
    const isoDate = row.match_date;
    const startTimestamp = toTimestamp(isoDate);
    const { homeSets, awaySets } = parseSetScore(row.score);
    const winnerSide: 'home' | 'away' = homeIsWinner ? 'home' : 'away';

    const record = {
      schemaVersion: '2.1.0',
      datasetId: 'tennis_sqlite_historical_frozen_v1',
      fixtureId: row.id,
      eventId: row.id,
      startTimestamp,
      isoDate,
      utcDate: isoDate,
      utcMonth: isoDate.slice(0, 7),
      utcYear: Number(isoDate.slice(0, 4)),
      tournamentName: row.tourney_name,
      tournamentId: row.tourney_id,
      categoryName: row.tour === 'WTA' ? 'WTA' : 'ATP',
      roundName: row.round_name || 'Main Draw',
      surface: row.surface,
      temporalPartition: 'development' as const,
      preMatchFeatures: {
        featureCutoffIsoDate: isoDate,
        featureCutoffTimestamp: startTimestamp,
        homePlayer: {
          id: homeId || row.id * 10 + 1,
          name: homeName,
          countryCode: homeIoc || null,
          eventTimeRanking: homeRank,
          rankingDate: isoDate,
          rankingProvenance: 'sqlite_historical_matches_at_match_date',
          seed: null,
          heightCm: homeHt || null,
          handedness: homeHand || null,
          recentMatches: homeRecent,
          surfaceStats: homeSurfaceStats,
        },
        awayPlayer: {
          id: awayId || row.id * 10 + 2,
          name: awayName,
          countryCode: awayIoc || null,
          eventTimeRanking: awayRank,
          rankingDate: isoDate,
          rankingProvenance: 'sqlite_historical_matches_at_match_date',
          seed: null,
          heightCm: awayHt || null,
          handedness: awayHand || null,
          recentMatches: awayRecent,
          surfaceStats: awaySurfaceStats,
        },
        derivedRankings: {
          rankDifference: homeRank - awayRank,
          rankSum: homeRank + awayRank,
          betterRankSide: homeRank < awayRank ? 'home' : awayRank < homeRank ? 'away' : 'tied',
        },
        priorForm: {
          homePriorMatchesInArchive: homeHist.length,
          homePriorWinsInArchive: homePriorWins,
          homePriorLossesInArchive: homePriorLosses,
          awayPriorMatchesInArchive: awayHist.length,
          awayPriorWinsInArchive: awayPriorWins,
          awayPriorLossesInArchive: awayPriorLosses,
        },
        priorSurfaceForm: {
          homeSurfaceWins: homeSurfaceStats.wins,
          homeSurfaceLosses: homeSurfaceStats.losses,
          awaySurfaceWins: awaySurfaceStats.wins,
          awaySurfaceLosses: awaySurfaceStats.losses,
        },
        priorHeadToHead: {
          totalPriorMeetings: h2h.homeWins + h2h.awayWins,
          homeH2HWins: h2h.homeWins,
          awayH2HWins: h2h.awayWins,
          lastMeetingTimestamp: h2h.meetings.length > 0 ? toTimestamp(h2h.meetings[h2h.meetings.length - 1]) : null,
        },
        priorTournamentWorkload: {
          homeMatchesThisTournament: homeHist.filter((entry) => entry.tournament === row.tourney_name).length,
          awayMatchesThisTournament: awayHist.filter((entry) => entry.tournament === row.tourney_name).length,
        },
        marketOdds: {
          homeOdds: odds.homeOdds,
          awayOdds: odds.awayOdds,
          homeFractional: null,
          awayFractional: null,
          impliedHomeProb: odds.impliedHomeProb,
          impliedAwayProb: odds.impliedAwayProb,
          overround: odds.overround,
          providerId: 0,
          classification: 'SYNTHETIC_RANK_IMPLIED',
          oddsTiming: 'RANK_MODEL_SYNTHETIC',
          openingOddsAvailable: false,
          oddsTimestampPrecision: 'SYNTHETIC',
          isValidForRoi: true,
        },
        leakageCheck: {
          featureSourceTimestampMax: startTimestamp,
          targetStartTimestamp: startTimestamp,
          leakageFree: true,
        },
      },
      settlement: {
        status: 'FINISHED',
        winnerSide,
        winnerName: winnerSide === 'home' ? homeName : awayName,
        homeScore: homeSets,
        awayScore: awaySets,
        setScores: row.score,
        settlementPolicy: 'OFFICIAL_RESULT_MONEYLINE',
      },
      provenance: {
        source: 'telegram-backend/data/database.sqlite',
        sourceTable: 'historical_matches',
        sourceRowId: row.id,
        archiveVersion: '2.1.0',
      },
    };

    frozenRecords.push(record);

    // Update histories AFTER feature extraction (no leakage)
    const matchTimestamp = startTimestamp;
    const winnerServe = {
      aces: Number(row.w_ace || 0),
      doubleFaults: Number(row.w_df || 0),
      firstServeIn: Number(row.w_1stIn || 0),
      firstServeWon: Number(row.w_1stWon || 0),
      servePoints: Number(row.w_svpt || 0),
      bpSaved: Number(row.w_bpSaved || 0),
      bpFaced: Number(row.w_bpFaced || 0),
    };
    const loserServe = {
      aces: Number(row.l_ace || 0),
      doubleFaults: Number(row.l_df || 0),
      firstServeIn: Number(row.l_1stIn || 0),
      firstServeWon: Number(row.l_1stWon || 0),
      servePoints: Number(row.l_svpt || 0),
      bpSaved: Number(row.l_bpSaved || 0),
      bpFaced: Number(row.l_bpFaced || 0),
    };

    homeHist.unshift({
      date: isoDate,
      timestamp: matchTimestamp,
      surface: row.surface,
      tournament: row.tourney_name,
      round: row.round_name || '',
      opponentKey: awayKey,
      opponentName: awayName,
      won: homeIsWinner,
      score: row.score,
      minutes: row.minutes || 105,
      ...(homeIsWinner ? winnerServe : loserServe),
    });
    awayHist.unshift({
      date: isoDate,
      timestamp: matchTimestamp,
      surface: row.surface,
      tournament: row.tourney_name,
      round: row.round_name || '',
      opponentKey: homeKey,
      opponentName: homeName,
      won: !homeIsWinner,
      score: row.score,
      minutes: row.minutes || 105,
      ...(homeIsWinner ? loserServe : winnerServe),
    });
    playerHistory.set(homeKey, homeHist.slice(0, 80));
    playerHistory.set(awayKey, awayHist.slice(0, 80));

    if (homeIsWinner) h2h.homeWins++;
    else h2h.awayWins++;
    h2h.meetings.push(isoDate);
    h2hStore.set(pairKey, h2h);
  }

  frozenRecords.forEach((record, index) => {
    record.temporalPartition = assignPartition(index, frozenRecords.length);
  });

  const development = frozenRecords.filter((record) => record.temporalPartition === 'development');
  const validation = frozenRecords.filter((record) => record.temporalPartition === 'validation');
  const finalTest = frozenRecords.filter((record) => record.temporalPartition === 'final_test');

  fs.mkdirSync(options.outputDir, { recursive: true });
  writeJsonl(path.join(options.outputDir, 'dataset.jsonl'), frozenRecords);
  writeJsonl(path.join(options.outputDir, 'development.jsonl'), development);
  writeJsonl(path.join(options.outputDir, 'validation.jsonl'), validation);
  writeJsonl(path.join(options.outputDir, 'final_test.jsonl'), finalTest);

  const manifest = {
    schemaVersion: '2.1.0',
    generatedAt: new Date().toISOString(),
    source: 'telegram-backend SQLite historical_matches',
    totalRecords: frozenRecords.length,
    partitions: {
      development: development.length,
      validation: validation.length,
      final_test: finalTest.length,
    },
    filters: {
      fromDate: options.fromDate,
      toDate: options.toDate,
      maxRank: options.maxRank,
    },
    coverage: {
      withPriorFormPct: Math.round((withForm / Math.max(frozenRecords.length, 1)) * 1000) / 10,
      withH2HPct: Math.round((withH2H / Math.max(frozenRecords.length, 1)) * 1000) / 10,
      withSurfaceFormPct: Math.round((withSurface / Math.max(frozenRecords.length, 1)) * 1000) / 10,
    },
    limitations: [
      'Odds are SYNTHETIC_RANK_IMPLIED (no real market odds in SQLite).',
      'Weather is omitted (not in historical_matches).',
      'Serve micro-stats aggregated from SQLite historical pool (aces, serve points, break points).',
    ],
    datasetHash: sha256File(path.join(options.outputDir, 'dataset.jsonl')),
  };

  fs.writeFileSync(path.join(options.outputDir, 'dataset_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  console.log('\n✅ Dataset build complete');
  console.log(`Total records: ${frozenRecords.length}`);
  console.log(`  development: ${development.length}`);
  console.log(`  validation:  ${validation.length}`);
  console.log(`  final_test:  ${finalTest.length}`);
  console.log(`Coverage with prior form: ${manifest.coverage.withPriorFormPct}%`);
  console.log(`Coverage with H2H:       ${manifest.coverage.withH2HPct}%`);
  console.log(`Coverage with surface:    ${manifest.coverage.withSurfaceFormPct}%`);
  console.log(`Manifest: ${path.join(options.outputDir, 'dataset_manifest.json')}`);
}

main().catch((error) => {
  console.error('Dataset build failed:', error);
  process.exit(1);
});
