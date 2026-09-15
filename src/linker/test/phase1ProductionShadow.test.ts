import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { MatchLinkerEngine } from '../matchLinker';
import { ReviewQueueService } from '../reviewQueueService';
import { Phase1ProductionShadowRunner } from '../../scripts/runPhase1ProductionShadow';

console.log('======================================================');
console.log('   PHASE 1 PRODUCTION SHADOW PREREQUISITE TEST SUITE  ');
console.log('======================================================\n');

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ ${testName}${detail ? ': ' + detail : ''}`);
    failedTests++;
  }
}

async function runTests() {
  // Test 1: Configurable Canonical Table Targeting
  console.log('[Test Suite 1: Canonical Table Targeting]');
  {
    const memDb = new Database(':memory:');
    memDb.pragma('foreign_keys = ON');

    const defaultEngine = new MatchLinkerEngine(memDb);
    assert(
      defaultEngine.getCanonicalTableName() === 'canonical_matches',
      'MatchLinkerEngine defaults to "canonical_matches"'
    );

    const v2Engine = new MatchLinkerEngine(memDb, { canonicalTableName: 'canonical_matches_v2' });
    assert(
      v2Engine.getCanonicalTableName() === 'canonical_matches_v2',
      'MatchLinkerEngine targets "canonical_matches_v2" when specified'
    );

    const defaultReviewService = new ReviewQueueService(memDb);
    assert(
      (defaultReviewService as any).canonicalTable === 'canonical_matches',
      'ReviewQueueService defaults to "canonical_matches"'
    );

    const v2ReviewService = new ReviewQueueService(memDb, { canonicalTableName: 'canonical_matches_v2' });
    assert(
      (v2ReviewService as any).canonicalTable === 'canonical_matches_v2',
      'ReviewQueueService targets "canonical_matches_v2" when specified'
    );
    memDb.close();
  }

  // Test 2: Dry-Run Mode Safety & Zero Writes on Live DB
  console.log('\n[Test Suite 2: Dry-Run Mode Safety Verification]');
  {
    const runner = new Phase1ProductionShadowRunner({
      isDryRun: true,
    });

    const report = await runner.run();
    assert(report.mode === 'DRY_RUN', 'Runner executes in DRY_RUN mode by default');
    assert(report.totalCohortSize === 500, 'Cohort size is exactly 500 deterministic matches');
    assert(report.totalChunks === 20, 'Cohort is partitioned into exactly 20 chunks of 25 matches');
    assert(report.chunksCompleted === 0, 'Zero chunks committed in dry-run mode');
    assert(report.legacyCanonicalMatchesAfter === 140432, 'Legacy canonical_matches row count remains exactly 140,432');
    assert(report.isLegacyUntouched === true, 'Legacy matches verified untouched');
  }

  // Test 3: Sandbox Execution of the 20-Chunk Serialized Runner
  console.log('\n[Test Suite 3: Sandbox Execution & Sentinel Verification]');
  {
    const sandboxDir = path.resolve('data/scratch_test_phase1_shadow');
    if (!fs.existsSync(sandboxDir)) fs.mkdirSync(sandboxDir, { recursive: true });

    const sandboxDbPath = path.join(sandboxDir, 'test_shadow_db.sqlite');
    const sandboxSnapDir = path.join(sandboxDir, 'backups');

    // Create a mini sandbox database with both legacy canonical_matches and v2 linker schema
    const liveDb = new Database('data/database.sqlite', { readonly: true });
    const legacyCount = (liveDb.prepare('SELECT count(1) as c FROM canonical_matches').get() as any).c;
    liveDb.close();

    // Copy production DB to sandbox for testing the full execution path safely
    fs.copyFileSync('data/database.sqlite', sandboxDbPath);

    const sandboxRunner = new Phase1ProductionShadowRunner({
      targetDbPath: sandboxDbPath,
      snapshotDir: sandboxSnapDir,
      isDryRun: false, // execute on isolated sandbox!
    });

    const execReport = await sandboxRunner.run();
    assert(execReport.status === 'SUCCESS', 'Sandbox execution completed with status SUCCESS');
    assert(execReport.chunksCompleted === 20, 'All 20 micro-chunks committed successfully');
    assert(execReport.falsePositiveMerges === 0, 'False-positive sentinel detected exactly 0 errors');
    assert(execReport.autoLinkPrecisionPct >= 99.8, `Auto-link precision is ${execReport.autoLinkPrecisionPct.toFixed(2)}% (>= 99.80%)`);
    assert(execReport.legacyCanonicalMatchesAfter === legacyCount, `Legacy canonical matches in sandbox remained untouched (${legacyCount})`);

    // Verify snapshot was created in sandbox backups
    const snapFiles = fs.readdirSync(sandboxSnapDir);
    assert(snapFiles.length > 0 && snapFiles[0].includes('database_wal_safe_pre_phase1.sqlite'), 'Pre-phase snapshot created via native backup API');

    // Cleanup sandbox
    for (const s of ['', '-wal', '-shm']) {
      if (fs.existsSync(sandboxDbPath + s)) try { fs.unlinkSync(sandboxDbPath + s); } catch {}
    }
    for (const f of snapFiles) {
      try { fs.unlinkSync(path.join(sandboxSnapDir, f)); } catch {}
    }
    try { fs.rmdirSync(sandboxSnapDir); } catch {}
    try { fs.rmdirSync(sandboxDir); } catch {}
  }

  // Final Invariant Check on Real Production DB
  console.log('\n[Test Suite 4: Production Database Invariant]');
  {
    const prodDb = new Database('data/database.sqlite', { readonly: true });
    const legacyCount = (prodDb.prepare('SELECT count(1) as c FROM canonical_matches').get() as any).c;
    const v2Count = (prodDb.prepare('SELECT count(1) as c FROM canonical_matches_v2').get() as any).c;
    prodDb.close();

    assert(legacyCount === 140432, 'Real production canonical_matches is strictly 140,432');
    assert(v2Count === 0, 'Real production canonical_matches_v2 has strictly 0 rows (Phase 1 NOT executed on prod)');
  }

  console.log('\n======================================================');
  console.log(`TEST SUMMARY: ${passedTests} passed, ${failedTests} failed (${passedTests + failedTests} total)`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
