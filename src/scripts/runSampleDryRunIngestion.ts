import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { configureLinkerConnection } from '../linker/schema';
import { MatchLinkerEngine } from '../linker/matchLinker';
import { ReviewQueueService } from '../linker/reviewQueueService';
import type { IncomingRawMatch, LinkDecision } from '../linker/types';

export interface SampleIngestionRecord {
  index: number;
  bucket: string;
  expectedOutcome: 'AUTO_LINK' | 'REVIEW_QUEUE' | 'CREATE_NEW_CANONICAL';
  incoming: IncomingRawMatch;
  decision: LinkDecision;
  isFalsePositive: boolean;
}

export interface SampleIngestionReport {
  timestamp: string;
  totalSampleIngested: number;
  autoLinkCount: number;
  autoLinkPct: number;
  reviewQueueCount: number;
  reviewQueuePct: number;
  newCanonicalCount: number;
  newCanonicalPct: number;
  falsePositiveMerges: number;
  autoLinkPrecisionPct: number;
  vetoTriggerDistribution: Record<string, number>;
  bucketBreakdown: Record<
    string,
    {
      sampleCount: number;
      autoLinks: number;
      reviewQueue: number;
      newCanonicals: number;
      falsePositives: number;
    }
  >;
  adminActionsVerified: {
    approveVerified: boolean;
    approvedReviewId?: number;
    approvedCanonicalMatchId?: string;
    rejectVerified: boolean;
    rejectedReviewId?: number;
    rejectedSeparatedCanonicalId?: string;
    splitVerified: boolean;
    splitOriginalCanonicalId?: string;
    splitNewCanonicalId?: string;
  };
  tableCountDeltas: {
    before: {
      canonicalMatches: number;
      sourceLinks: number;
      reviewQueue: number;
      auditLogs: number;
      rawEvidence: number;
    };
    after: {
      canonicalMatches: number;
      sourceLinks: number;
      reviewQueue: number;
      auditLogs: number;
      rawEvidence: number;
    };
  };
}

export function generateSampleCohort(sourceDbPath: string): Array<{
  bucket: string;
  expectedOutcome: 'AUTO_LINK' | 'REVIEW_QUEUE' | 'CREATE_NEW_CANONICAL';
  incoming: IncomingRawMatch;
}> {
  const sourceDb = new Database(sourceDbPath, { readonly: true });
  const cohort: Array<{
    bucket: string;
    expectedOutcome: 'AUTO_LINK' | 'REVIEW_QUEUE' | 'CREATE_NEW_CANONICAL';
    incoming: IncomingRawMatch;
  }> = [];

  try {
    // -------------------------------------------------------------------------
    // BUCKET 1: Overlapping Tour Matches (40 matches = 20 base Sackmann + 20 incoming PBP)
    // -------------------------------------------------------------------------
    const slamMatches = sourceDb
      .prepare(`
        SELECT id, tour, tourney_name, surface, match_date, round_name, winner_name, loser_name, score
        FROM historical_matches
        WHERE (tourney_name LIKE '%Wimbledon%' OR tourney_name LIKE '%US Open%')
          AND score NOT LIKE '%RET%' AND score NOT LIKE '%W/O%' AND score NOT LIKE '%DEF%'
          AND match_date >= '2024-01-01'
        ORDER BY id ASC
        LIMIT 20
      `)
      .all() as any[];

    for (let i = 0; i < slamMatches.length; i++) {
      const m = slamMatches[i];
      const baseId = `sample_ingest_b1_base_${m.id}`;
      const overlapId = `sample_ingest_b1_pbp_${m.id}`;

      // Base presentation (Sackmann)
      cohort.push({
        bucket: '1. Tour Overlaps (Base)',
        expectedOutcome: 'CREATE_NEW_CANONICAL',
        incoming: {
          sourceName: 'sackmann',
          sourceMatchId: baseId,
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
          rawPayload: { original_id: m.id, source: 'sackmann', sample: true },
        },
      });

      // Overlap presentation (PBP)
      cohort.push({
        bucket: '1. Tour Overlaps (Incoming PBP)',
        expectedOutcome: 'AUTO_LINK',
        incoming: {
          sourceName: 'pbp',
          sourceMatchId: overlapId,
          matchDate: m.match_date,
          tour: m.tour === 'WTA' ? 'WTA' : 'ATP',
          gender: m.tour === 'WTA' ? 'F' : 'M',
          rawTournamentName: m.tourney_name,
          rawSurface: m.surface,
          rawRound: m.round_name || 'R32',
          rawPlayer1: m.loser_name, // symmetric order swapped
          rawPlayer2: m.winner_name,
          rawWinnerName: m.winner_name,
          rawScore: m.score,
          rawPayload: { original_id: m.id, source: 'pbp', sample: true },
        },
      });
    }

    // -------------------------------------------------------------------------
    // BUCKET 2: Sibling Ambiguity Adversarial Cases (15 matches)
    // -------------------------------------------------------------------------
    const siblingMatches = sourceDb
      .prepare(`
        SELECT id, tour, tourney_name, surface, match_date, round_name, winner_name, loser_name, score
        FROM historical_matches
        WHERE (winner_name LIKE '%Cerundolo%' OR loser_name LIKE '%Cerundolo%'
            OR winner_name LIKE '%Zverev%' OR loser_name LIKE '%Zverev%'
            OR winner_name LIKE '%Tsitsipas%' OR loser_name LIKE '%Tsitsipas%')
          AND match_date >= '2023-01-01'
        ORDER BY id ASC
        LIMIT 15
      `)
      .all() as any[];

    for (let i = 0; i < siblingMatches.length; i++) {
      const m = siblingMatches[i];
      cohort.push({
        bucket: '2. Sibling Ambiguity',
        expectedOutcome: 'REVIEW_QUEUE',
        incoming: {
          sourceName: 'sackmann',
          sourceMatchId: `sample_ingest_b2_sibling_${m.id}`,
          matchDate: m.match_date,
          tour: m.tour === 'WTA' ? 'WTA' : 'ATP',
          gender: m.tour === 'WTA' ? 'F' : 'M',
          rawTournamentName: m.tourney_name,
          rawSurface: m.surface,
          rawRound: m.round_name || 'R32',
          rawPlayer1: m.winner_name.includes('Cerundolo') ? 'Cerundolo' : m.winner_name,
          rawPlayer2: m.loser_name.includes('Cerundolo') ? 'Cerundolo' : m.loser_name,
          rawWinnerName: m.winner_name.includes('Cerundolo') ? 'Cerundolo' : m.winner_name,
          rawScore: m.score,
          rawPayload: { original_id: m.id, sibling_case: true, sample: true },
        },
      });
    }

    // -------------------------------------------------------------------------
    // BUCKET 3: Winner & Inverted Score Conflicts (15 matches)
    // -------------------------------------------------------------------------
    const conflictBase = sourceDb
      .prepare(`
        SELECT id, tour, tourney_name, surface, match_date, round_name, winner_name, loser_name, score
        FROM historical_matches
        WHERE tourney_name LIKE '%Roland Garros%'
          AND score LIKE '%6-%' AND score NOT LIKE '%RET%'
          AND match_date >= '2023-01-01'
        ORDER BY id ASC
        LIMIT 15
      `)
      .all() as any[];

    for (let i = 0; i < conflictBase.length; i++) {
      const m = conflictBase[i];
      if (i < 8) {
        // Winner Conflict: Candidate has winner m.winner_name, incoming asserts m.loser_name won
        cohort.push({
          bucket: '3. Winner & Score Conflicts (Swapped Winner)',
          expectedOutcome: 'REVIEW_QUEUE',
          incoming: {
            sourceName: 'pbp',
            sourceMatchId: `sample_ingest_b3_winner_${m.id}`,
            matchDate: m.match_date,
            tour: m.tour === 'WTA' ? 'WTA' : 'ATP',
            gender: m.tour === 'WTA' ? 'F' : 'M',
            rawTournamentName: m.tourney_name,
            rawSurface: m.surface,
            rawRound: m.round_name || 'R16',
            rawPlayer1: m.winner_name,
            rawPlayer2: m.loser_name,
            rawWinnerName: m.loser_name, // Inverted winner
            rawScore: m.score,
            rawPayload: { original_id: m.id, swapped_winner: true, sample: true },
          },
        });
      } else {
        // Inverted Score Conflict: e.g. 6-2 6-3 vs 2-6 3-6
        const parts = (m.score || '6-3 6-4').split(' ');
        const invertedScore = parts
          .map((set: string) => {
            const sub = set.split('-');
            return sub.length === 2 ? `${sub[1]}-${sub[0]}` : set;
          })
          .join(' ');

        cohort.push({
          bucket: '3. Winner & Score Conflicts (Inverted Score)',
          expectedOutcome: 'REVIEW_QUEUE',
          incoming: {
            sourceName: 'pbp',
            sourceMatchId: `sample_ingest_b3_invscore_${m.id}`,
            matchDate: m.match_date,
            tour: m.tour === 'WTA' ? 'WTA' : 'ATP',
            gender: m.tour === 'WTA' ? 'F' : 'M',
            rawTournamentName: m.tourney_name,
            rawSurface: m.surface,
            rawRound: m.round_name || 'R16',
            rawPlayer1: m.winner_name,
            rawPlayer2: m.loser_name,
            rawWinnerName: m.winner_name,
            rawScore: invertedScore,
            rawPayload: { original_id: m.id, inverted_score: true, sample: true },
          },
        });
      }
    }

    // -------------------------------------------------------------------------
    // BUCKET 4: Tournament Ambiguity & Cross-Day Cases (15 matches)
    // -------------------------------------------------------------------------
    const tourneyMatches = sourceDb
      .prepare(`
        SELECT id, tour, tourney_name, surface, match_date, round_name, winner_name, loser_name, score
        FROM historical_matches
        WHERE (tourney_name LIKE '%Masters%' OR tourney_name LIKE '%Rome%' OR tourney_name LIKE '%Madrid%')
          AND match_date >= '2023-01-01'
        ORDER BY id ASC
        LIMIT 15
      `)
      .all() as any[];

    for (let i = 0; i < tourneyMatches.length; i++) {
      const m = tourneyMatches[i];
      if (i < 8) {
        // Generic Unrecognized Tournament
        cohort.push({
          bucket: '4. Tournament Ambiguity (Generic Name)',
          expectedOutcome: 'REVIEW_QUEUE',
          incoming: {
            sourceName: 'pbp',
            sourceMatchId: `sample_ingest_b4_generic_${m.id}`,
            matchDate: m.match_date,
            tour: m.tour === 'WTA' ? 'WTA' : 'ATP',
            gender: m.tour === 'WTA' ? 'F' : 'M',
            rawTournamentName: 'Generic Tennis Invitational Cup',
            rawSurface: m.surface,
            rawRound: m.round_name || 'R32',
            rawPlayer1: m.winner_name,
            rawPlayer2: m.loser_name,
            rawWinnerName: m.winner_name,
            rawScore: m.score,
            rawPayload: { original_id: m.id, generic_tourney: true, sample: true },
          },
        });
      } else {
        // Cross-Day Presentation (+1 day)
        const d = new Date(m.match_date);
        d.setDate(d.getDate() + 1);
        const nextDay = d.toISOString().slice(0, 10);

        cohort.push({
          bucket: '4. Cross-Day (+1 Day)',
          expectedOutcome: 'AUTO_LINK',
          incoming: {
            sourceName: 'pbp',
            sourceMatchId: `sample_ingest_b4_crossday_${m.id}`,
            matchDate: nextDay,
            tour: m.tour === 'WTA' ? 'WTA' : 'ATP',
            gender: m.tour === 'WTA' ? 'F' : 'M',
            rawTournamentName: m.tourney_name,
            rawSurface: m.surface,
            rawRound: m.round_name || 'R32',
            rawPlayer1: m.winner_name,
            rawPlayer2: m.loser_name,
            rawWinnerName: m.winner_name,
            rawScore: m.score,
            rawPayload: { original_id: m.id, cross_day: true, sample: true },
          },
        });
      }
    }

    // -------------------------------------------------------------------------
    // BUCKET 5: Fresh Matches (15 matches)
    // -------------------------------------------------------------------------
    const freshMatches = sourceDb
      .prepare(`
        SELECT id, tour, tourney_name, surface, match_date, round_name, winner_name, loser_name, score
        FROM historical_matches
        WHERE match_date >= '2024-05-01' AND match_date <= '2024-05-15'
          AND tourney_name NOT LIKE '%Roland Garros%'
        ORDER BY id ASC
        LIMIT 15
      `)
      .all() as any[];

    for (let i = 0; i < freshMatches.length; i++) {
      const m = freshMatches[i];
      cohort.push({
        bucket: '5. Fresh Matches',
        expectedOutcome: 'CREATE_NEW_CANONICAL',
        incoming: {
          sourceName: 'sackmann',
          sourceMatchId: `sample_ingest_b5_fresh_${m.id}`,
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
          rawPayload: { original_id: m.id, fresh_match: true, sample: true },
        },
      });
    }
  } finally {
    sourceDb.close();
  }

  return cohort;
}

export function runSampleDryRunIngestion(
  targetDbPath: string = path.resolve('data/database.linker_dryrun.sqlite'),
  sourceDbPath: string = path.resolve('data/database.dryrun.sqlite')
): SampleIngestionReport {
  // Guard against live production DB and legacy dry-run copy
  const resolvedTarget = path.resolve(targetDbPath);
  const liveDbPath = path.resolve('data/database.sqlite');
  const legacyDryRunPath = path.resolve('data/database.dryrun.sqlite');

  if (resolvedTarget === liveDbPath) {
    throw new Error('SECURITY VIOLATION: Refusing to run sample dry-run ingestion on live production data/database.sqlite');
  }
  if (resolvedTarget === legacyDryRunPath) {
    throw new Error('SAFETY VIOLATION: Refusing to mutate legacy copy data/database.dryrun.sqlite');
  }

  // File-level safety backup before executing sample ingestion
  const backupPath = `${resolvedTarget}.bak_pre_sample`;
  fs.copyFileSync(resolvedTarget, backupPath);

  const db = new Database(resolvedTarget);
  configureLinkerConnection(db);

  // Measure baseline table counts
  const beforeCounts = {
    canonicalMatches: (db.prepare('SELECT count(1) as c FROM canonical_matches').get() as any).c,
    sourceLinks: (db.prepare('SELECT count(1) as c FROM match_source_links').get() as any).c,
    reviewQueue: (db.prepare('SELECT count(1) as c FROM match_review_queue').get() as any).c,
    auditLogs: (db.prepare('SELECT count(1) as c FROM match_review_audit_log').get() as any).c,
    rawEvidence: (db.prepare('SELECT count(1) as c FROM raw_source_evidence').get() as any).c,
  };

  const cohort = generateSampleCohort(sourceDbPath);
  const linker = new MatchLinkerEngine(db);

  const records: SampleIngestionRecord[] = [];
  const vetoCounts: Record<string, number> = {};
  const bucketBreakdown: Record<string, any> = {};

  let autoLinkCount = 0;
  let reviewQueueCount = 0;
  let newCanonicalCount = 0;
  let falsePositiveMerges = 0;

  for (let i = 0; i < cohort.length; i++) {
    const item = cohort[i];
    const decision = linker.processRawMatch(item.incoming);

    if (!bucketBreakdown[item.bucket]) {
      bucketBreakdown[item.bucket] = {
        sampleCount: 0,
        autoLinks: 0,
        reviewQueue: 0,
        newCanonicals: 0,
        falsePositives: 0,
      };
    }
    bucketBreakdown[item.bucket].sampleCount++;

    let isFalsePositive = false;

    if (decision.action === 'AUTO_LINK') {
      autoLinkCount++;
      bucketBreakdown[item.bucket].autoLinks++;

      // False Positive Verification
      const candidate = db
        .prepare('SELECT * FROM canonical_matches WHERE canonical_match_id = ?')
        .get(decision.canonicalMatchId) as any;

      if (!candidate) {
        isFalsePositive = true;
      } else {
        // Compare dates: must be within +/- 1 day
        const dateDiff = Math.abs(
          (new Date(item.incoming.matchDate).getTime() - new Date(candidate.match_date).getTime()) /
            (1000 * 60 * 60 * 24)
        );
        if (dateDiff > 1) {
          isFalsePositive = true;
        }
      }

      if (isFalsePositive) {
        falsePositiveMerges++;
        bucketBreakdown[item.bucket].falsePositives++;
      }
    } else if (decision.action === 'REVIEW_QUEUE') {
      reviewQueueCount++;
      bucketBreakdown[item.bucket].reviewQueue++;

      for (const veto of decision.vetoTriggers || []) {
        vetoCounts[veto] = (vetoCounts[veto] || 0) + 1;
      }
    } else if (decision.action === 'CREATE_NEW_CANONICAL') {
      newCanonicalCount++;
      bucketBreakdown[item.bucket].newCanonicals++;
    }

    records.push({
      index: i + 1,
      bucket: item.bucket,
      expectedOutcome: item.expectedOutcome,
      incoming: item.incoming,
      decision,
      isFalsePositive,
    });
  }

  // ---------------------------------------------------------------------------
  // Verify Admin Review Actions Post-Ingest
  // ---------------------------------------------------------------------------
  const reviewService = new ReviewQueueService(db);
  const adminActionsVerified = {
    approveVerified: false,
    approvedReviewId: undefined as number | undefined,
    approvedCanonicalMatchId: undefined as string | undefined,
    rejectVerified: false,
    rejectedReviewId: undefined as number | undefined,
    rejectedSeparatedCanonicalId: undefined as string | undefined,
    splitVerified: false,
    splitOriginalCanonicalId: undefined as string | undefined,
    splitNewCanonicalId: undefined as string | undefined,
  };

  // 1. Find an unreviewed item from this sample with a candidate to test APPROVE
  const approvableItem = db
    .prepare(`
      SELECT review_id, candidate_canonical_id, lock_version
      FROM match_review_queue
      WHERE incoming_source_id LIKE 'sample_ingest_%'
        AND candidate_canonical_id IS NOT NULL
        AND review_status = 'PENDING'
      LIMIT 1
    `)
    .get() as any;

  if (approvableItem) {
    const approveRes = reviewService.approve(approvableItem.review_id, {
      expectedLockVersion: approvableItem.lock_version,
      actor: 'sample_runner_admin',
      reason: 'Approved during sample dry-run verification',
    });

    if (approveRes.success && approveRes.status === 'APPROVED' && approveRes.lockVersion === approvableItem.lock_version + 1) {
      adminActionsVerified.approveVerified = true;
      adminActionsVerified.approvedReviewId = approvableItem.review_id;
      adminActionsVerified.approvedCanonicalMatchId = approveRes.canonicalMatchId;
    }
  }

  // 2. Find a review item from this sample to test REJECT
  const approvableReviewId = approvableItem ? approvableItem.review_id : -1;
  const rejectableItem = db
    .prepare(`
      SELECT review_id, lock_version
      FROM match_review_queue
      WHERE incoming_source_id LIKE 'sample_ingest_%'
        AND review_id != ?
        AND review_status = 'PENDING'
      LIMIT 1
    `)
    .get(approvableReviewId) as any;

  if (rejectableItem) {
    const rejectRes = reviewService.reject(rejectableItem.review_id, {
      expectedLockVersion: rejectableItem.lock_version,
      actor: 'sample_runner_admin',
      reason: 'Rejected winner conflict match during sample verification',
    });

    if (rejectRes.success && rejectRes.status === 'REJECTED' && rejectRes.lockVersion === rejectableItem.lock_version + 1) {
      adminActionsVerified.rejectVerified = true;
      adminActionsVerified.rejectedReviewId = rejectableItem.review_id;
      adminActionsVerified.rejectedSeparatedCanonicalId = rejectRes.separatedCanonicalId;
    }
  }

  // 3. Find an auto-linked 2-source match from this sample to test SPLIT
  const splittableMatch = db
    .prepare(`
      SELECT msl.canonical_match_id, cm.version
      FROM match_source_links msl
      JOIN canonical_matches cm ON msl.canonical_match_id = cm.canonical_match_id
      WHERE msl.source_name = 'pbp'
        AND msl.source_match_id LIKE 'sample_ingest_b1_%'
        AND cm.evidence_count >= 2
      LIMIT 1
    `)
    .get() as any;

  if (splittableMatch) {
    const splitRes = reviewService.split(splittableMatch.canonical_match_id, {
      sourceToDetach: 'pbp',
      expectedVersion: splittableMatch.version,
      actor: 'sample_runner_admin',
      reason: 'Split test on sample ingested match',
    });

    if (splitRes.success && splitRes.action === 'SPLIT' && splitRes.separatedCanonicalMatchId) {
      adminActionsVerified.splitVerified = true;
      adminActionsVerified.splitOriginalCanonicalId = splittableMatch.canonical_match_id;
      adminActionsVerified.splitNewCanonicalId = splitRes.separatedCanonicalMatchId;
    }
  }

  // Measure after table counts
  const afterCounts = {
    canonicalMatches: (db.prepare('SELECT count(1) as c FROM canonical_matches').get() as any).c,
    sourceLinks: (db.prepare('SELECT count(1) as c FROM match_source_links').get() as any).c,
    reviewQueue: (db.prepare('SELECT count(1) as c FROM match_review_queue').get() as any).c,
    auditLogs: (db.prepare('SELECT count(1) as c FROM match_review_audit_log').get() as any).c,
    rawEvidence: (db.prepare('SELECT count(1) as c FROM raw_source_evidence').get() as any).c,
  };

  db.close();

  const total = cohort.length;
  const autoLinkPrecisionPct = autoLinkCount > 0 ? ((autoLinkCount - falsePositiveMerges) / autoLinkCount) * 100 : 100.0;

  const report: SampleIngestionReport = {
    timestamp: new Date().toISOString(),
    totalSampleIngested: total,
    autoLinkCount,
    autoLinkPct: (autoLinkCount / total) * 100,
    reviewQueueCount,
    reviewQueuePct: (reviewQueueCount / total) * 100,
    newCanonicalCount,
    newCanonicalPct: (newCanonicalCount / total) * 100,
    falsePositiveMerges,
    autoLinkPrecisionPct,
    vetoTriggerDistribution: vetoCounts,
    bucketBreakdown,
    adminActionsVerified,
    tableCountDeltas: {
      before: beforeCounts,
      after: afterCounts,
    },
  };

  return report;
}

export function revertSampleIngestion(
  targetDbPath: string = path.resolve('data/database.linker_dryrun.sqlite')
): void {
  const resolvedTarget = path.resolve(targetDbPath);
  const backupPath = `${resolvedTarget}.bak_pre_sample`;

  if (!fs.existsSync(backupPath)) {
    throw new Error(`Cannot revert sample ingestion: backup file ${backupPath} not found`);
  }

  for (const suffix of ['', '-wal', '-shm']) {
    const p = resolvedTarget + suffix;
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch {}
    }
  }

  fs.copyFileSync(backupPath, resolvedTarget);
}

// CLI Execution
if (require.main === module) {
  const isRevert = process.argv.includes('--revert');
  const targetDb = path.resolve('data/database.linker_dryrun.sqlite');

  if (isRevert) {
    console.log('Reverting sample dry-run ingestion to pre-sample backup...');
    revertSampleIngestion(targetDb);
    console.log('✅ Revert completed successfully.');
    process.exit(0);
  }

  console.log('======================================================');
  console.log('  STARTING CONTROLLED SAMPLE DRY-RUN INGESTION        ');
  console.log('======================================================\n');

  const report = runSampleDryRunIngestion();

  console.log(`Total Matches Ingested:        ${report.totalSampleIngested}`);
  console.log(`Auto-Linked Matches:           ${report.autoLinkCount} (${report.autoLinkPct.toFixed(1)}%)`);
  console.log(`Routed to Review Queue:        ${report.reviewQueueCount} (${report.reviewQueuePct.toFixed(1)}%)`);
  console.log(`Created New Canonical Matches: ${report.newCanonicalCount} (${report.newCanonicalPct.toFixed(1)}%)`);
  console.log(`False Positive Merges:         ${report.falsePositiveMerges}`);
  console.log(`Auto-Link Precision:           ${report.autoLinkPrecisionPct.toFixed(2)}%\n`);

  console.log('--- Veto Trigger Distribution ---');
  for (const [veto, count] of Object.entries(report.vetoTriggerDistribution)) {
    console.log(`  - ${veto}: ${count}`);
  }

  console.log('\n--- Admin Review Actions Verified ---');
  console.log(`  Approve Action Verified: ${report.adminActionsVerified.approveVerified ? '✅ YES' : '❌ NO'} (Review #${report.adminActionsVerified.approvedReviewId} -> ${report.adminActionsVerified.approvedCanonicalMatchId})`);
  console.log(`  Reject Action Verified:  ${report.adminActionsVerified.rejectVerified ? '✅ YES' : '❌ NO'} (Review #${report.adminActionsVerified.rejectedReviewId} -> Separated ${report.adminActionsVerified.rejectedSeparatedCanonicalId})`);
  console.log(`  Split Action Verified:   ${report.adminActionsVerified.splitVerified ? '✅ YES' : '❌ NO'} (Original ${report.adminActionsVerified.splitOriginalCanonicalId} -> Detached ${report.adminActionsVerified.splitNewCanonicalId})`);

  console.log('\n--- Database Table Count Deltas ---');
  console.log(`  Canonical Matches: ${report.tableCountDeltas.before.canonicalMatches} -> ${report.tableCountDeltas.after.canonicalMatches} (+${report.tableCountDeltas.after.canonicalMatches - report.tableCountDeltas.before.canonicalMatches})`);
  console.log(`  Source Links:      ${report.tableCountDeltas.before.sourceLinks} -> ${report.tableCountDeltas.after.sourceLinks} (+${report.tableCountDeltas.after.sourceLinks - report.tableCountDeltas.before.sourceLinks})`);
  console.log(`  Review Queue:      ${report.tableCountDeltas.before.reviewQueue} -> ${report.tableCountDeltas.after.reviewQueue} (+${report.tableCountDeltas.after.reviewQueue - report.tableCountDeltas.before.reviewQueue})`);
  console.log(`  Audit Logs:        ${report.tableCountDeltas.before.auditLogs} -> ${report.tableCountDeltas.after.auditLogs} (+${report.tableCountDeltas.after.auditLogs - report.tableCountDeltas.before.auditLogs})`);
  console.log(`  Raw Evidence:      ${report.tableCountDeltas.before.rawEvidence} -> ${report.tableCountDeltas.after.rawEvidence} (+${report.tableCountDeltas.after.rawEvidence - report.tableCountDeltas.before.rawEvidence})`);

  // Write JSON artifact
  const jsonPath = path.resolve('data/linker_sample_ingestion_report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\nReport artifact saved to ${jsonPath}`);
}
