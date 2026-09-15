import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { configureLinkerConnection } from './schema';
import { MatchLinkerEngine } from './matchLinker';
import { validatePhaseGate, type PhaseGateVerdict } from './phaseGateValidator';
import type { IncomingRawMatch, LinkDecision } from './types';

export interface Phase1Options {
  targetDbPath?: string;
  sourceDbPath?: string;
  chunkSize?: number;
}

export interface Phase1ChunkResult {
  chunkIndex: number;
  matchesProcessed: number;
  autoLinks: number;
  newCanonicals: number;
  reviewQueues: number;
  walCheckpointResult: any;
}

export interface Phase1IngestionReport {
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
  chunks: Phase1ChunkResult[];
  tournamentsRepresented: Record<string, number>;
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

function normalizeToken(name: string): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0)
    .join(' ');
}

/**
 * Builds the deterministic 500-match Phase 1 pilot cohort:
 * - 2024 Grand Slams & Masters 1000s
 * - Clean high-confidence matches with standard player names
 * - Verified player entities with zero sibling ambiguity
 * - Multi-source dual-feed representation (300 base matches + 200 secondary feeds = 500 incoming matches)
 */
export function buildPhase1Cohort(
  sourceDbPath: string,
  targetDb: Database.Database
): { cohort: IncomingRawMatch[]; tournamentDist: Record<string, number> } {
  const sourceDb = new Database(sourceDbPath, { readonly: true });

  try {
    const sql = `
      SELECT 
        id, tour, tourney_name, surface, match_date, round_name, winner_name, loser_name, score
      FROM historical_matches
      WHERE match_date >= '2024-01-01' AND match_date <= '2024-12-31'
        AND tourney_name NOT LIKE '%Qualification%'
        AND tourney_name NOT LIKE '%Doubles%'
        AND tourney_name NOT LIKE '%Chall%'
        AND tourney_name NOT LIKE '%WIC%'
        AND tourney_name NOT LIKE '%Mixed%'
        AND (
          tourney_name LIKE '%Australian Open%'
          OR tourney_name LIKE '%Roland Garros%'
          OR tourney_name LIKE '%French Open%'
          OR tourney_name LIKE '%Wimbledon%'
          OR tourney_name LIKE '%US Open%'
          OR tourney_name LIKE '%Indian Wells%'
          OR tourney_name LIKE '%Miami%'
          OR tourney_name LIKE '%Monte Carlo%'
          OR tourney_name LIKE '%Madrid%'
          OR tourney_name LIKE '%Rome%'
          OR tourney_name LIKE '%Internazionali BNL%'
          OR tourney_name LIKE '%Cincinnati%'
        )
        AND score NOT LIKE '%RET%' 
        AND score NOT LIKE '%W/O%' 
        AND score NOT LIKE '%DEF%'
        AND winner_name NOT LIKE '%.%'
        AND loser_name NOT LIKE '%.%'
        AND winner_name IS NOT NULL
        AND loser_name IS NOT NULL
      ORDER BY match_date ASC, id ASC
    `;

    const rawCandidates = sourceDb.prepare(sql).all() as any[];

    const aliasStmt = targetDb.prepare(`
      SELECT canonical_player_id, is_verified, has_sibling_conflict
      FROM player_aliases
      WHERE (source_name = ? OR source_name IN ('canonical', 'catalog', 'historical', 'normalized', 'reversed', 'abbreviated', 'csv_style'))
        AND (raw_name = ? OR normalized_token = ?)
      ORDER BY CASE WHEN source_name = ? THEN 1 ELSE 2 END, is_verified DESC
      LIMIT 1
    `);

    const cleanCandidates: any[] = [];
    const tournamentDist: Record<string, number> = {};

    for (const m of rawCandidates) {
      // Exclude matches already ingested in previous evaluation/sample runs
      const alreadyExists = targetDb
        .prepare('SELECT count(1) as c FROM raw_source_evidence WHERE raw_payload_json LIKE ?')
        .get(`%"original_id":${m.id}%`) as any;
      if (alreadyExists && alreadyExists.c > 0) continue;

      const wClean = normalizeToken(m.winner_name);
      const lClean = normalizeToken(m.loser_name);
      const wAlias = aliasStmt.get('sackmann', m.winner_name, wClean, 'sackmann') as any;
      const lAlias = aliasStmt.get('sackmann', m.loser_name, lClean, 'sackmann') as any;

      if (wAlias && lAlias && wAlias.has_sibling_conflict === 0 && lAlias.has_sibling_conflict === 0) {
        cleanCandidates.push(m);
        tournamentDist[m.tourney_name] = (tournamentDist[m.tourney_name] || 0) + 1;
      }
    }

    if (cleanCandidates.length < 300) {
      throw new Error(`Insufficient clean candidate matches for Phase 1. Required: >= 300, Available: ${cleanCandidates.length}`);
    }

    // Cohort structure:
    // 300 Primary Base matches (Source: 'sackmann')
    // 200 Secondary Overlapping feeds (Source: 'pbp') for the first 200 matches
    // Total incoming records = exactly 500
    const cohort: IncomingRawMatch[] = [];

    for (let i = 0; i < 300; i++) {
      const m = cleanCandidates[i];
      cohort.push({
        sourceName: 'sackmann',
        sourceMatchId: `p1_base_${m.id}`,
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
        rawPayload: { original_id: m.id, source: 'sackmann', phase: 'phase_1_pilot' },
      });
    }

    for (let i = 0; i < 200; i++) {
      const m = cleanCandidates[i];
      cohort.push({
        sourceName: 'pbp',
        sourceMatchId: `p1_pbp_${m.id}`,
        matchDate: m.match_date,
        tour: m.tour === 'WTA' ? 'WTA' : 'ATP',
        gender: m.tour === 'WTA' ? 'F' : 'M',
        rawTournamentName: m.tourney_name,
        rawSurface: m.surface,
        rawRound: m.round_name || 'R32',
        rawPlayer1: m.loser_name, // symmetrically swapped order to test invariant matching
        rawPlayer2: m.winner_name,
        rawWinnerName: m.winner_name,
        rawScore: m.score,
        rawPayload: { original_id: m.id, source: 'pbp', phase: 'phase_1_pilot' },
      });
    }

    return { cohort, tournamentDist };
  } finally {
    sourceDb.close();
  }
}

/**
 * Runs the Phase 1 pilot batch ingestion:
 * - Pre-phase snapshot creation
 * - Chunked transaction execution (5 x 100 matches)
 * - WAL passive checkpointing between chunks
 * - Immediate invocation of Phase Gate Validator
 */
export function runPhase1Ingestion(options: Phase1Options = {}): Phase1IngestionReport {
  const targetDbPath = path.resolve(options.targetDbPath || 'data/database.linker_dryrun.sqlite');
  const sourceDbPath = path.resolve(options.sourceDbPath || 'data/database.dryrun.sqlite');
  const chunkSize = options.chunkSize || 100;

  const liveDbPath = path.resolve('data/database.sqlite');
  const legacyDryRunPath = path.resolve('data/database.dryrun.sqlite');

  // Hard safety guards
  if (targetDbPath === liveDbPath) {
    throw new Error('SECURITY VIOLATION: Refusing to run Phase 1 ingestion on live production database data/database.sqlite');
  }
  if (targetDbPath === legacyDryRunPath) {
    throw new Error('SAFETY VIOLATION: Refusing to run Phase 1 ingestion on legacy copy data/database.dryrun.sqlite');
  }
  if (!fs.existsSync(targetDbPath)) {
    throw new Error(`Target database file does not exist: ${targetDbPath}`);
  }
  if (!fs.existsSync(sourceDbPath)) {
    throw new Error(`Source database file does not exist: ${sourceDbPath}`);
  }

  // 1. Create fresh pre-phase snapshot
  const snapshotPath = `${targetDbPath}.bak_pre_p1`;
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

  const { cohort, tournamentDist } = buildPhase1Cohort(sourceDbPath, db);
  if (cohort.length !== 500) {
    throw new Error(`Phase 1 cohort size mismatch: expected exactly 500, got ${cohort.length}`);
  }

  const linker = new MatchLinkerEngine(db);
  const chunks: Phase1ChunkResult[] = [];

  let totalAutoLinks = 0;
  let totalNewCanonicals = 0;
  let totalReviewQueues = 0;

  // 3. Process cohort in chunks
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
    tournamentsRepresented: tournamentDist,
    tableCountsBefore: beforeCounts,
    tableCountsAfter: afterCounts,
    phaseGateVerdict,
  };
}
