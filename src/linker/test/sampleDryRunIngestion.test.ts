import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { initCanonicalLinkerSchema } from '../schema';
import { runSampleDryRunIngestion, revertSampleIngestion } from '../../scripts/runSampleDryRunIngestion';

const TEST_DB_PATH = path.resolve('data/test_sample_ingestion.sqlite');
const SOURCE_DB_PATH = path.resolve('data/database.dryrun.sqlite');
const LIVE_DB_PATH = path.resolve('data/database.sqlite');

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

async function assertTest(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    results.push({ name, passed: false, error: err.message });
    console.error(`  ❌ ${name}: ${err.message}`);
  }
}

async function runTestSuite() {
  console.log('\n======================================================');
  console.log('   SAMPLE DRY-RUN INGESTION TEST SUITE                ');
  console.log('======================================================\n');

  // Baseline production DB check
  const liveStatsBefore = fs.statSync(LIVE_DB_PATH);

  // Setup isolated test database with canonical schema
  for (const suffix of ['', '-wal', '-shm', '.bak_pre_sample']) {
    const p = TEST_DB_PATH + suffix;
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch {}
    }
  }

  const initialDb = new Database(TEST_DB_PATH);
  initCanonicalLinkerSchema(initialDb);

  // Seed sample canonical players so candidate resolution can match
  initialDb.exec(`
    INSERT INTO canonical_players (canonical_player_id, full_name_standard, last_name, gender) VALUES
    ('cp_carlos_alcaraz', 'Carlos Alcaraz', 'Alcaraz', 'M'),
    ('cp_novak_djokovic', 'Novak Djokovic', 'Djokovic', 'M'),
    ('cp_jannik_sinner', 'Jannik Sinner', 'Sinner', 'M'),
    ('cp_daniil_medvedev', 'Daniil Medvedev', 'Medvedev', 'M'),
    ('cp_alexander_zverev', 'Alexander Zverev', 'Zverev', 'M'),
    ('cp_francisco_cerundolo', 'Francisco Cerundolo', 'Cerundolo', 'M'),
    ('cp_juan_manuel_cerundolo', 'Juan Manuel Cerundolo', 'Cerundolo', 'M');

    INSERT INTO player_aliases (canonical_player_id, source_name, raw_name, normalized_token, has_sibling_conflict, is_verified) VALUES
    ('cp_francisco_cerundolo', 'sackmann', 'Cerundolo F.', 'cerundolo', 1, 0),
    ('cp_juan_manuel_cerundolo', 'sackmann', 'Cerundolo J.', 'cerundolo', 1, 0),
    ('cp_alexander_zverev', 'sackmann', 'Zverev A.', 'zverev', 1, 0);

    INSERT INTO canonical_tournaments (canonical_tourney_id, name_standard, tour, tour_level, default_surface) VALUES
    ('ct_wimbledon', 'Wimbledon', 'ATP', 'GRAND_SLAM', 'GRASS'),
    ('ct_us_open', 'US Open', 'ATP', 'GRAND_SLAM', 'HARD'),
    ('ct_roland_garros', 'Roland Garros', 'ATP', 'GRAND_SLAM', 'CLAY');
  `);
  initialDb.close();

  try {
    // 1. Safety Guard Checks
    console.log('[Phase 1: Hard Safety Guard Verifications]');

    await assertTest('Runner throws security violation if directed at live DB', () => {
      let threw = false;
      try {
        runSampleDryRunIngestion(LIVE_DB_PATH, SOURCE_DB_PATH);
      } catch (err: any) {
        threw = true;
        if (!err.message.includes('SECURITY VIOLATION')) throw err;
      }
      if (!threw) throw new Error('Failed to block live production database path!');
    });

    await assertTest('Runner throws safety violation if directed at legacy dry-run copy', () => {
      let threw = false;
      try {
        runSampleDryRunIngestion(SOURCE_DB_PATH, SOURCE_DB_PATH);
      } catch (err: any) {
        threw = true;
        if (!err.message.includes('SAFETY VIOLATION')) throw err;
      }
      if (!threw) throw new Error('Failed to block legacy dry-run copy DB path!');
    });

    // 2. Execution on Isolated Test Database
    console.log('\n[Phase 2: Controlled Sample Ingestion Execution]');

    let report: any = null;
    await assertTest('Execute sample ingestion of 100 deterministic matches', () => {
      report = runSampleDryRunIngestion(TEST_DB_PATH, SOURCE_DB_PATH);
      if (report.totalSampleIngested !== 100) {
        throw new Error(`Expected 100 sample matches, got ${report.totalSampleIngested}`);
      }
    });

    // 3. Precision & Metric Assertions
    console.log('\n[Phase 3: Decision Distribution & Precision Verification]');

    await assertTest('Zero false-positive merges detected (100% precision)', () => {
      if (report.falsePositiveMerges !== 0) {
        throw new Error(`False positives detected: ${report.falsePositiveMerges}`);
      }
      if (report.autoLinkPrecisionPct !== 100.0) {
        throw new Error(`Auto-link precision is ${report.autoLinkPrecisionPct}%, expected 100%`);
      }
    });

    await assertTest('Decision distribution spans all 3 bands with expected vetoes', () => {
      if (report.autoLinkCount === 0) throw new Error('No auto-links generated');
      if (report.reviewQueueCount === 0) throw new Error('No review items generated');
      if (report.newCanonicalCount === 0) throw new Error('No new canonical matches generated');

      // Veto distribution checks
      const vetoes = report.vetoTriggerDistribution;
      if (!vetoes['VETO_SIBLING_AMBIGUITY'] && !vetoes['VETO_UNCLEAR_TOURNAMENT']) {
        throw new Error('Expected sibling or tournament ambiguity veto triggers');
      }
    });

    // 4. Admin Review Actions Verification
    console.log('\n[Phase 4: Admin Review Actions Post-Ingest Verification]');

    await assertTest('Approve, reject, and split actions executed and verified on ingested sample', () => {
      if (!report.adminActionsVerified.approveVerified) {
        throw new Error('Approve action could not be verified on sample data');
      }
      if (!report.adminActionsVerified.rejectVerified) {
        throw new Error('Reject action could not be verified on sample data');
      }
      if (!report.adminActionsVerified.splitVerified) {
        throw new Error('Split action could not be verified on sample data');
      }
    });

    // 5. Reversibility Verification
    console.log('\n[Phase 5: Reversibility Verification]');

    await assertTest('Revert restores test database to exact pre-sample table counts', () => {
      revertSampleIngestion(TEST_DB_PATH);

      const dbAfterRevert = new Database(TEST_DB_PATH, { readonly: true });
      const countsAfterRevert = {
        canonicalMatches: (dbAfterRevert.prepare('SELECT count(1) as c FROM canonical_matches').get() as any).c,
        sourceLinks: (dbAfterRevert.prepare('SELECT count(1) as c FROM match_source_links').get() as any).c,
        reviewQueue: (dbAfterRevert.prepare('SELECT count(1) as c FROM match_review_queue').get() as any).c,
        auditLogs: (dbAfterRevert.prepare('SELECT count(1) as c FROM match_review_audit_log').get() as any).c,
        rawEvidence: (dbAfterRevert.prepare('SELECT count(1) as c FROM raw_source_evidence').get() as any).c,
      };
      dbAfterRevert.close();

      if (countsAfterRevert.canonicalMatches !== report.tableCountDeltas.before.canonicalMatches) {
        throw new Error(`Revert failed: canonical matches count ${countsAfterRevert.canonicalMatches} !== ${report.tableCountDeltas.before.canonicalMatches}`);
      }
      if (countsAfterRevert.sourceLinks !== report.tableCountDeltas.before.sourceLinks) {
        throw new Error(`Revert failed: source links count ${countsAfterRevert.sourceLinks} !== ${report.tableCountDeltas.before.sourceLinks}`);
      }
      if (countsAfterRevert.reviewQueue !== report.tableCountDeltas.before.reviewQueue) {
        throw new Error(`Revert failed: review queue count ${countsAfterRevert.reviewQueue} !== ${report.tableCountDeltas.before.reviewQueue}`);
      }
    });

    // 6. Production Database Integrity Check
    console.log('\n[Phase 6: Production Database Zero-Touch Verification]');

    await assertTest('Live production database data/database.sqlite has NOT been modified', () => {
      const liveStatsAfter = fs.statSync(LIVE_DB_PATH);
      if (liveStatsAfter.size !== liveStatsBefore.size) {
        throw new Error(`PRODUCTION DB MUTATED! Size changed from ${liveStatsBefore.size} to ${liveStatsAfter.size}`);
      }
      if (liveStatsAfter.mtime.getTime() !== liveStatsBefore.mtime.getTime()) {
        throw new Error(`PRODUCTION DB MUTATED! Timestamp changed from ${liveStatsBefore.mtime} to ${liveStatsAfter.mtime}`);
      }
    });

  } finally {
    // Teardown
    for (const suffix of ['', '-wal', '-shm', '.bak_pre_sample']) {
      const p = TEST_DB_PATH + suffix;
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {}
      }
    }
  }

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  console.log('\n======================================================');
  console.log(`TEST SUMMARY: ${passedCount} passed, ${failedCount} failed (${results.length} total)`);
  console.log('======================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test suite failed unexpectedly:', err);
  process.exit(1);
});
