import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { configureLinkerConnection } from './schema';
import { MatchLinkerEngine } from './matchLinker';
import { validatePhaseGate, type PhaseGateVerdict } from './phaseGateValidator';
import type { IncomingRawMatch } from './types';

export interface Phase2Options {
  targetDbPath?: string;
  sourceDbPath?: string;
  chunkSize?: number;
}

export interface Phase2ChunkResult {
  chunkIndex: number;
  matchesProcessed: number;
  autoLinks: number;
  newCanonicals: number;
  reviewQueues: number;
  walCheckpointResult: any;
}

export interface Phase2IngestionReport {
  timestamp: string;
  targetDbPath: string;
  snapshotPath: string;
  totalCohortSize: number;
  totalProcessed: number;
  totalAutoLinks: number;
  totalNewCanonicals: number;
  totalReviewQueues: number;
  autoLinkRatePct: number;
  reviewQueueRatePct: number;
  chunks: Phase2ChunkResult[];
  bucketBreakdown: Record<string, number>;
  tableCountsBefore: {
    canonicalMatches: number;
    sourceLinks: number;
    reviewQueue: number;
    auditLogs: number;
    rawEvidence: number;
  };
  tableCountsAfter: {
    canonicalMatches: number;
    sourceLinks: number;
    reviewQueue: number;
    auditLogs: number;
    rawEvidence: number;
  };
  phaseGateVerdict: PhaseGateVerdict;
}

/**
 * Builds the deterministic 2,500-match Phase 2 cohort with controlled entropy:
 * 1. Standard ATP/WTA Tour-Level Matches (1,600 matches: 1,000 base + 600 overlap)
 * 2. Challenger & ITF Matches (400 matches: 250 base + 150 overlap)
 * 3. Cross-Day Overlaps (150 matches: 100 base + 50 shifted +1 day)
 * 4. Tournament Alias Variations (150 matches: 100 base + 50 alias variations)
 * 5. Limited Retirements & Walkovers (100 matches: 50 base + 50 overlap)
 * 6. Sibling Ambiguity & Ambiguous Aliases (100 matches)
 * Total: exactly 2,500 matches
 */
export function buildPhase2Cohort(
  sourceDbPath: string,
  targetDb: Database.Database
): { cohort: IncomingRawMatch[]; bucketCounts: Record<string, number> } {
  const sourceDb = new Database(sourceDbPath, { readonly: true });

  try {
    // 1. Get already ingested IDs in target DB to guarantee non-overlapping fresh samples
    const alreadyIngestedRaw = targetDb.prepare(
      "SELECT raw_payload_json FROM raw_source_evidence WHERE raw_payload_json LIKE '%original_id%'"
    ).all() as any[];
    const alreadyIngestedIds = new Set<number>();
    for (const r of alreadyIngestedRaw) {
      try {
        const p = JSON.parse(r.raw_payload_json);
        if (p.original_id) alreadyIngestedIds.add(p.original_id);
      } catch {}
    }

    const cohort: IncomingRawMatch[] = [];
    const bucketCounts: Record<string, number> = {
      '1. Tour-Level ATP/WTA (Base)': 0,
      '1. Tour-Level ATP/WTA (Overlaps)': 0,
      '2. Challenger & ITF (Base)': 0,
      '2. Challenger & ITF (Overlaps)': 0,
      '3. Cross-Day Cases (Base)': 0,
      '3. Cross-Day Cases (Shifted)': 0,
      '4. Tournament Aliases (Base)': 0,
      '4. Tournament Aliases (Variations)': 0,
      '5. Retirements & Walkovers (Base)': 0,
      '5. Retirements & Walkovers (Overlaps)': 0,
      '6. Sibling & Ambiguous Aliases': 0,
    };

    // -------------------------------------------------------------------------
    // BUCKET 1: Standard ATP/WTA Tour-Level Matches (1,600 matches: 1000 base + 600 overlap)
    // -------------------------------------------------------------------------
    const tourMatches = sourceDb.prepare(`
      SELECT id, tour, tourney_name, surface, match_date, round_name, winner_name, loser_name, score
      FROM historical_matches
      WHERE match_date >= '2023-01-01' AND match_date <= '2024-12-31'
        AND tour IN ('ATP', 'WTA')
        AND tourney_name NOT LIKE '%Chall%'
        AND tourney_name NOT LIKE '%ITF%'
        AND tourney_name NOT LIKE '%Qualification%'
        AND tourney_name NOT LIKE '%Doubles%'
        AND score NOT LIKE '%RET%' AND score NOT LIKE '%W/O%' AND score NOT LIKE '%DEF%'
        AND winner_name NOT LIKE '%.%' AND loser_name NOT LIKE '%.%'
        AND winner_name IS NOT NULL AND loser_name IS NOT NULL
      ORDER BY match_date ASC, id ASC
    `).all() as any[];

    const cleanTour = tourMatches.filter(m => !alreadyIngestedIds.has(m.id)).slice(0, 1000);
    if (cleanTour.length < 1000) {
      throw new Error(`Insufficient clean tour matches for Phase 2. Found: ${cleanTour.length}`);
    }

    for (let i = 0; i < 1000; i++) {
      const m = cleanTour[i];
      cohort.push({
        sourceName: 'sackmann',
        sourceMatchId: `p2_tour_base_${m.id}`,
        matchDate: m.match_date,
        tour: m.tour === 'WTA' ? 'WTA' : 'ATP',
        gender: m.tour === 'WTA' ? 'F' : 'M',
        rawTournamentName: m.tourney_name,
        rawSurface: m.surface,
        rawRound: m.round_name || 'R32',
        rawPlayer1: m.winner_name,
        rawPlayer2: m.loser_name,
        rawWinnerName: m.winner_name,
        rawScore: m.score,
        rawPayload: { original_id: m.id, bucket: 'tour_base', phase: 'phase_2' },
      });
      bucketCounts['1. Tour-Level ATP/WTA (Base)']++;
    }

    for (let i = 0; i < 600; i++) {
      const m = cleanTour[i];
      cohort.push({
        sourceName: 'pbp',
        sourceMatchId: `p2_tour_overlap_${m.id}`,
        matchDate: m.match_date,
        tour: m.tour === 'WTA' ? 'WTA' : 'ATP',
        gender: m.tour === 'WTA' ? 'F' : 'M',
        rawTournamentName: m.tourney_name,
        rawSurface: m.surface,
        rawRound: m.round_name || 'R32',
        rawPlayer1: m.loser_name, // symmetric order swap
        rawPlayer2: m.winner_name,
        rawWinnerName: m.winner_name,
        rawScore: m.score,
        rawPayload: { original_id: m.id, bucket: 'tour_overlap', phase: 'phase_2' },
      });
      bucketCounts['1. Tour-Level ATP/WTA (Overlaps)']++;
    }

    // -------------------------------------------------------------------------
    // BUCKET 2: Challenger & ITF Matches (400 matches: 250 base + 150 overlap)
    // -------------------------------------------------------------------------
    const challMatches = sourceDb.prepare(`
      SELECT id, tour, tourney_name, surface, match_date, round_name, winner_name, loser_name, score
      FROM historical_matches
      WHERE match_date >= '2023-01-01' AND match_date <= '2024-12-31'
        AND (tourney_name LIKE '%Chall%' OR tourney_name LIKE '%ITF%' OR tour IN ('CHALLENGER', 'ITF'))
        AND tourney_name NOT LIKE '%Qualification%'
        AND tourney_name NOT LIKE '%Doubles%'
        AND score NOT LIKE '%RET%' AND score NOT LIKE '%W/O%'
        AND winner_name IS NOT NULL AND loser_name IS NOT NULL
      ORDER BY match_date ASC, id ASC
    `).all() as any[];

    const cleanChall = challMatches.filter(m => !alreadyIngestedIds.has(m.id)).slice(0, 250);
    if (cleanChall.length < 250) {
      throw new Error(`Insufficient clean challenger matches for Phase 2. Found: ${cleanChall.length}`);
    }

    for (let i = 0; i < 250; i++) {
      const m = cleanChall[i];
      cohort.push({
        sourceName: 'sackmann',
        sourceMatchId: `p2_chall_base_${m.id}`,
        matchDate: m.match_date,
        tour: m.tour === 'WTA' ? 'WTA' : 'ATP',
        gender: m.tour === 'WTA' ? 'F' : 'M',
        rawTournamentName: m.tourney_name,
        rawSurface: m.surface,
        rawRound: m.round_name || 'R32',
        rawPlayer1: m.winner_name,
        rawPlayer2: m.loser_name,
        rawWinnerName: m.winner_name,
        rawScore: m.score,
        rawPayload: { original_id: m.id, bucket: 'challenger_base', phase: 'phase_2' },
      });
      bucketCounts['2. Challenger & ITF (Base)']++;
    }

    for (let i = 0; i < 150; i++) {
      const m = cleanChall[i];
      cohort.push({
        sourceName: 'pbp',
        sourceMatchId: `p2_chall_overlap_${m.id}`,
        matchDate: m.match_date,
        tour: m.tour === 'WTA' ? 'WTA' : 'ATP',
        gender: m.tour === 'WTA' ? 'F' : 'M',
        rawTournamentName: m.tourney_name,
        rawSurface: m.surface,
        rawRound: m.round_name || 'R32',
        rawPlayer1: m.loser_name,
        rawPlayer2: m.winner_name,
        rawWinnerName: m.winner_name,
        rawScore: m.score,
        rawPayload: { original_id: m.id, bucket: 'challenger_overlap', phase: 'phase_2' },
      });
      bucketCounts['2. Challenger & ITF (Overlaps)']++;
    }

    // -------------------------------------------------------------------------
    // BUCKET 3: Cross-Day Overlaps (150 matches: 100 base + 50 shifted +1 day)
    // -------------------------------------------------------------------------
    const crossDayPool = tourMatches.filter(m => !alreadyIngestedIds.has(m.id)).slice(1000, 1100);
    for (let i = 0; i < 100; i++) {
      const m = crossDayPool[i];
      cohort.push({
        sourceName: 'sackmann',
        sourceMatchId: `p2_cross_base_${m.id}`,
        matchDate: m.match_date,
        tour: m.tour === 'WTA' ? 'WTA' : 'ATP',
        gender: m.tour === 'WTA' ? 'F' : 'M',
        rawTournamentName: m.tourney_name,
        rawSurface: m.surface,
        rawRound: m.round_name || 'R32',
        rawPlayer1: m.winner_name,
        rawPlayer2: m.loser_name,
        rawWinnerName: m.winner_name,
        rawScore: m.score,
        rawPayload: { original_id: m.id, bucket: 'cross_day_base', phase: 'phase_2' },
      });
      bucketCounts['3. Cross-Day Cases (Base)']++;
    }

    for (let i = 0; i < 50; i++) {
      const m = crossDayPool[i];
      const d = new Date(m.match_date);
      d.setDate(d.getDate() + 1);
      const nextDate = d.toISOString().slice(0, 10);

      cohort.push({
        sourceName: 'pbp',
        sourceMatchId: `p2_cross_shift_${m.id}`,
        matchDate: nextDate,
        tour: m.tour === 'WTA' ? 'WTA' : 'ATP',
        gender: m.tour === 'WTA' ? 'F' : 'M',
        rawTournamentName: m.tourney_name,
        rawSurface: m.surface,
        rawRound: m.round_name || 'R32',
        rawPlayer1: m.loser_name,
        rawPlayer2: m.winner_name,
        rawWinnerName: m.winner_name,
        rawScore: m.score,
        rawPayload: { original_id: m.id, bucket: 'cross_day_shifted', phase: 'phase_2' },
      });
      bucketCounts['3. Cross-Day Cases (Shifted)']++;
    }

    // -------------------------------------------------------------------------
    // BUCKET 4: Tournament Alias Variations (150 matches: 100 base + 50 alias variations)
    // -------------------------------------------------------------------------
    const aliasPool = tourMatches.filter(m => !alreadyIngestedIds.has(m.id)).slice(1100, 1200);
    for (let i = 0; i < 100; i++) {
      const m = aliasPool[i];
      cohort.push({
        sourceName: 'sackmann',
        sourceMatchId: `p2_alias_base_${m.id}`,
        matchDate: m.match_date,
        tour: m.tour === 'WTA' ? 'WTA' : 'ATP',
        gender: m.tour === 'WTA' ? 'F' : 'M',
        rawTournamentName: m.tourney_name,
        rawSurface: m.surface,
        rawRound: m.round_name || 'R32',
        rawPlayer1: m.winner_name,
        rawPlayer2: m.loser_name,
        rawWinnerName: m.winner_name,
        rawScore: m.score,
        rawPayload: { original_id: m.id, bucket: 'tournament_alias_base', phase: 'phase_2' },
      });
      bucketCounts['4. Tournament Aliases (Base)']++;
    }

    for (let i = 0; i < 50; i++) {
      const m = aliasPool[i];
      let altTourney = m.tourney_name;
      if (altTourney.includes('Wimbledon')) altTourney = 'The Championships Wimbledon';
      else if (altTourney.includes('US Open')) altTourney = 'Flushing Meadows US Open';
      else if (altTourney.includes('Indian Wells')) altTourney = 'BNP Paribas Open';
      else if (altTourney.includes('Miami')) altTourney = 'Miami Masters';
      else if (altTourney.includes('Rome')) altTourney = 'Internazionali BNL d Italia';
      else if (altTourney.includes('Madrid')) altTourney = 'Mutua Madrid Open';
      else altTourney = `${altTourney} Championship`;

      cohort.push({
        sourceName: 'pbp',
        sourceMatchId: `p2_alias_var_${m.id}`,
        matchDate: m.match_date,
        tour: m.tour === 'WTA' ? 'WTA' : 'ATP',
        gender: m.tour === 'WTA' ? 'F' : 'M',
        rawTournamentName: altTourney,
        rawSurface: m.surface,
        rawRound: m.round_name || 'R32',
        rawPlayer1: m.loser_name,
        rawPlayer2: m.winner_name,
        rawWinnerName: m.winner_name,
        rawScore: m.score,
        rawPayload: { original_id: m.id, bucket: 'tournament_alias_var', phase: 'phase_2' },
      });
      bucketCounts['4. Tournament Aliases (Variations)']++;
    }

    // -------------------------------------------------------------------------
    // BUCKET 5: Limited Retirements & Walkovers (100 matches: 50 base + 50 overlap)
    // -------------------------------------------------------------------------
    const retPool = sourceDb.prepare(`
      SELECT id, tour, tourney_name, surface, match_date, round_name, winner_name, loser_name, score
      FROM historical_matches
      WHERE match_date >= '2023-01-01' AND match_date <= '2024-12-31'
        AND (score LIKE '%RET%' OR score LIKE '%W/O%')
        AND winner_name IS NOT NULL AND loser_name IS NOT NULL
      ORDER BY match_date ASC, id ASC
    `).all() as any[];

    const cleanRet = retPool.filter(m => !alreadyIngestedIds.has(m.id)).slice(0, 50);
    for (let i = 0; i < 50; i++) {
      const m = cleanRet[i];
      cohort.push({
        sourceName: 'sackmann',
        sourceMatchId: `p2_ret_base_${m.id}`,
        matchDate: m.match_date,
        tour: m.tour === 'WTA' ? 'WTA' : 'ATP',
        gender: m.tour === 'WTA' ? 'F' : 'M',
        rawTournamentName: m.tourney_name,
        rawSurface: m.surface,
        rawRound: m.round_name || 'R32',
        rawPlayer1: m.winner_name,
        rawPlayer2: m.loser_name,
        rawWinnerName: m.winner_name,
        rawScore: m.score,
        rawPayload: { original_id: m.id, bucket: 'retirements_base', phase: 'phase_2' },
      });
      bucketCounts['5. Retirements & Walkovers (Base)']++;
    }

    for (let i = 0; i < 50; i++) {
      const m = cleanRet[i];
      cohort.push({
        sourceName: 'pbp',
        sourceMatchId: `p2_ret_overlap_${m.id}`,
        matchDate: m.match_date,
        tour: m.tour === 'WTA' ? 'WTA' : 'ATP',
        gender: m.tour === 'WTA' ? 'F' : 'M',
        rawTournamentName: m.tourney_name,
        rawSurface: m.surface,
        rawRound: m.round_name || 'R32',
        rawPlayer1: m.loser_name,
        rawPlayer2: m.winner_name,
        rawWinnerName: m.winner_name,
        rawScore: m.score,
        rawPayload: { original_id: m.id, bucket: 'retirements_overlap', phase: 'phase_2' },
      });
      bucketCounts['5. Retirements & Walkovers (Overlaps)']++;
    }

    // -------------------------------------------------------------------------
    // BUCKET 6: Sibling Ambiguity & Ambiguous Aliases (100 matches)
    // -------------------------------------------------------------------------
    const siblingPool = sourceDb.prepare(`
      SELECT id, tour, tourney_name, surface, match_date, round_name, winner_name, loser_name, score
      FROM historical_matches
      WHERE match_date >= '2023-01-01' AND match_date <= '2024-12-31'
        AND (
          winner_name LIKE '%Cerundolo%' OR loser_name LIKE '%Cerundolo%'
          OR winner_name LIKE '%Zverev%' OR loser_name LIKE '%Zverev%'
          OR winner_name LIKE '%Tsitsipas%' OR loser_name LIKE '%Tsitsipas%'
          OR winner_name LIKE '%Fruhvirtova%' OR loser_name LIKE '%Fruhvirtova%'
          OR winner_name LIKE '%Ymer%' OR loser_name LIKE '%Ymer%'
        )
        AND winner_name IS NOT NULL AND loser_name IS NOT NULL
      ORDER BY match_date ASC, id ASC
    `).all() as any[];

    const cleanSibling = siblingPool.filter(m => !alreadyIngestedIds.has(m.id)).slice(0, 100);
    for (let i = 0; i < 100; i++) {
      const m = cleanSibling[i];
      cohort.push({
        sourceName: 'sackmann',
        sourceMatchId: `p2_sibling_${m.id}`,
        matchDate: m.match_date,
        tour: m.tour === 'WTA' ? 'WTA' : 'ATP',
        gender: m.tour === 'WTA' ? 'F' : 'M',
        rawTournamentName: m.tourney_name,
        rawSurface: m.surface,
        rawRound: m.round_name || 'R32',
        rawPlayer1: m.winner_name,
        rawPlayer2: m.loser_name,
        rawWinnerName: m.winner_name,
        rawScore: m.score,
        rawPayload: { original_id: m.id, bucket: 'sibling_ambiguity', phase: 'phase_2' },
      });
      bucketCounts['6. Sibling & Ambiguous Aliases']++;
    }

    return { cohort, bucketCounts };
  } finally {
    sourceDb.close();
  }
}

/**
 * Runs the Phase 2 medium batch ingestion:
 * - Pre-phase snapshot creation (bak_pre_p2)
 * - Chunked transaction execution (10 x 250 matches)
 * - WAL passive checkpointing between chunks
 * - Immediate invocation of Phase Gate Validator
 */
export function runPhase2Ingestion(options: Phase2Options = {}): Phase2IngestionReport {
  const targetDbPath = path.resolve(options.targetDbPath || 'data/database.linker_dryrun.sqlite');
  const sourceDbPath = path.resolve(options.sourceDbPath || 'data/database.dryrun.sqlite');
  const chunkSize = options.chunkSize || 250;

  const liveDbPath = path.resolve('data/database.sqlite');
  const legacyDryRunPath = path.resolve('data/database.dryrun.sqlite');

  // Hard safety guards
  if (targetDbPath === liveDbPath) {
    throw new Error('SECURITY VIOLATION: Refusing to run Phase 2 ingestion on live production database data/database.sqlite');
  }
  if (targetDbPath === legacyDryRunPath) {
    throw new Error('SAFETY VIOLATION: Refusing to run Phase 2 ingestion on legacy copy data/database.dryrun.sqlite');
  }
  if (!fs.existsSync(targetDbPath)) {
    throw new Error(`Target database file does not exist: ${targetDbPath}`);
  }
  if (!fs.existsSync(sourceDbPath)) {
    throw new Error(`Source database file does not exist: ${sourceDbPath}`);
  }

  // 1. Create fresh pre-phase snapshot
  const snapshotPath = `${targetDbPath}.bak_pre_p2`;
  fs.copyFileSync(targetDbPath, snapshotPath);

  // Validate snapshot format
  const snapBuf = Buffer.alloc(16);
  const snapFd = fs.openSync(snapshotPath, 'r');
  fs.readSync(snapFd, snapBuf, 0, 16, 0);
  fs.closeSync(snapFd);
  if (snapBuf.toString('utf8', 0, 15) !== 'SQLite format 3') {
    throw new Error(`Pre-phase snapshot failed format validation: ${snapshotPath}`);
  }

  // 2. Open target database connection
  const db = new Database(targetDbPath);
  configureLinkerConnection(db, { enableWal: true, synchronousNormal: true });

  const beforeCounts = {
    canonicalMatches: (db.prepare('SELECT count(1) as c FROM canonical_matches').get() as any).c,
    sourceLinks: (db.prepare('SELECT count(1) as c FROM match_source_links').get() as any).c,
    reviewQueue: (db.prepare('SELECT count(1) as c FROM match_review_queue').get() as any).c,
    auditLogs: (db.prepare('SELECT count(1) as c FROM match_review_audit_log').get() as any).c,
    rawEvidence: (db.prepare('SELECT count(1) as c FROM raw_source_evidence').get() as any).c,
  };

  const { cohort, bucketCounts } = buildPhase2Cohort(sourceDbPath, db);
  if (cohort.length !== 2500) {
    throw new Error(`Phase 2 cohort size mismatch: expected exactly 2500, got ${cohort.length}`);
  }

  const linker = new MatchLinkerEngine(db);
  const chunks: Phase2ChunkResult[] = [];

  let totalAutoLinks = 0;
  let totalNewCanonicals = 0;
  let totalReviewQueues = 0;

  // 3. Process cohort in chunks (10 chunks of 250)
  for (let c = 0; c < cohort.length; c += chunkSize) {
    const chunkMatches = cohort.slice(c, c + chunkSize);
    let chunkAuto = 0;
    let chunkNew = 0;
    let chunkQueue = 0;

    db.transaction(() => {
      for (const inc of chunkMatches) {
        const decision = linker.processRawMatch(inc);
        if (decision.action === 'AUTO_LINK') {
          chunkAuto++;
          totalAutoLinks++;
        } else if (decision.action === 'CREATE_NEW_CANONICAL') {
          chunkNew++;
          totalNewCanonicals++;
        } else if (decision.action === 'REVIEW_QUEUE') {
          chunkQueue++;
          totalReviewQueues++;
        }
      }
    })();

    // Passive WAL checkpoint between chunks
    const walRes = db.pragma('wal_checkpoint(PASSIVE)');

    chunks.push({
      chunkIndex: Math.floor(c / chunkSize) + 1,
      matchesProcessed: chunkMatches.length,
      autoLinks: chunkAuto,
      newCanonicals: chunkNew,
      reviewQueues: chunkQueue,
      walCheckpointResult: walRes,
    });
  }

  const afterCounts = {
    canonicalMatches: (db.prepare('SELECT count(1) as c FROM canonical_matches').get() as any).c,
    sourceLinks: (db.prepare('SELECT count(1) as c FROM match_source_links').get() as any).c,
    reviewQueue: (db.prepare('SELECT count(1) as c FROM match_review_queue').get() as any).c,
    auditLogs: (db.prepare('SELECT count(1) as c FROM match_review_audit_log').get() as any).c,
    rawEvidence: (db.prepare('SELECT count(1) as c FROM raw_source_evidence').get() as any).c,
  };

  db.close();

  // 4. Run Phase Gate Validator immediately
  const phaseGateVerdict = validatePhaseGate({ customDbPath: targetDbPath });

  return {
    timestamp: new Date().toISOString(),
    targetDbPath,
    snapshotPath,
    totalCohortSize: cohort.length,
    totalProcessed: cohort.length,
    totalAutoLinks,
    totalNewCanonicals,
    totalReviewQueues,
    autoLinkRatePct: (totalAutoLinks / cohort.length) * 100.0,
    reviewQueueRatePct: (totalReviewQueues / cohort.length) * 100.0,
    chunks,
    bucketBreakdown: bucketCounts,
    tableCountsBefore: beforeCounts,
    tableCountsAfter: afterCounts,
    phaseGateVerdict,
  };
}
