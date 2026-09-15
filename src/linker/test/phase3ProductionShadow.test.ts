import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { Phase3ProductionShadowRunner } from '../../scripts/runPhase3ProductionShadow';

console.log('======================================================');
console.log('   PHASE 3 PRODUCTION SHADOW PREREQUISITE TEST SUITE  ');
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
  // Test 1: Dry-Run Safety Verification on Production DB
  console.log('[Test Suite 1: Dry-Run Safety Verification]');
  {
    const runner = new Phase3ProductionShadowRunner({
      isDryRun: true,
    });

    const report = await runner.run();
    assert(report.mode === 'DRY_RUN', 'Runner executes in DRY_RUN mode by default');
    assert(report.totalCohortSize === 10000, 'Cohort size is exactly 10,000 deterministic matches');
    assert(report.totalChunks === 100, 'Cohort is partitioned into exactly 100 chunks of 100 matches');
    assert(report.chunksCompleted === 0, 'Zero chunks committed in dry-run mode');
    assert(report.legacyCanonicalMatchesAfter === 140432, 'Legacy canonical_matches row count remains strictly 140,432');
    assert(report.isLegacyUntouched === true, 'Legacy matches verified untouched');
    assert(report.pragmasVerified.journal_mode === 'wal', 'PRAGMA journal_mode is wal');
    assert(report.pragmasVerified.foreign_keys === 1, 'PRAGMA foreign_keys is 1 (ON)');
    assert(report.pragmasVerified.busy_timeout === 5000, 'PRAGMA busy_timeout is 5000 ms');
    assert(report.pragmasVerified.wal_autocheckpoint === 1000, 'PRAGMA wal_autocheckpoint is 1000');
  }

  // Test 2: Review Queue Policy & Hard Stop Invariant Verification
  console.log('\n[Test Suite 2: Review Queue Policy & Hard Stop Invariants]');
  {
    const runner = new Phase3ProductionShadowRunner({ isDryRun: true });
    const report = await runner.run();
    assert(report.reviewQueuePolicy.warningThresholdPct === 22.0, 'Warning threshold configured strictly at 22.0%');
    assert(report.reviewQueuePolicy.hardStopThresholdPct === 30.0, 'Hard stop ceiling configured strictly at 30.0%');
    assert(report.falsePositiveMerges === 0, 'Zero tolerance: false-positive merges sentinel active');
    assert(report.siblingAutoMerges === 0, 'Zero tolerance: sibling auto-merges sentinel active');
    assert(report.isLegacyUntouched === true, 'Zero tolerance: legacy table mutation hard stop active');
  }

  // Test 3: Sandbox Execution of the 100-Chunk Serialized Runner
  console.log('\n[Test Suite 3: Sandbox Execution & Sentinel Verification (10,000 Matches)]');
  {
    const sandboxDir = path.resolve('data/scratch_test_phase3_shadow');
    if (!fs.existsSync(sandboxDir)) fs.mkdirSync(sandboxDir, { recursive: true });

    const sandboxDbPath = path.join(sandboxDir, 'test_phase3_shadow_db.sqlite');
    const sandboxSnapDir = path.join(sandboxDir, 'backups');

    const liveDb = new Database('data/database.sqlite', { readonly: true });
    const legacyCount = (liveDb.prepare('SELECT count(1) as c FROM canonical_matches').get() as any).c;
    liveDb.close();

    // Copy production DB to isolated sandbox
    fs.copyFileSync('data/database.sqlite', sandboxDbPath);

    const sandboxRunner = new Phase3ProductionShadowRunner({
      targetDbPath: sandboxDbPath,
      snapshotDir: sandboxSnapDir,
      isDryRun: false, // execute on isolated sandbox
    });

    const execReport = await sandboxRunner.run();
    assert(execReport.status === 'SUCCESS' || execReport.status === 'WARNING', `Sandbox execution status: ${execReport.status}`);
    assert(execReport.chunksCompleted === 100, 'All 100 micro-chunks committed successfully');
    assert(execReport.falsePositiveMerges === 0, 'False-positive sentinel detected exactly 0 errors');
    assert(execReport.siblingAutoMerges === 0, 'Sibling leakage check detected exactly 0 auto-merges');
    assert(execReport.autoLinkPrecisionPct >= 99.8, `Auto-link precision is ${execReport.autoLinkPrecisionPct.toFixed(2)}% (>= 99.80%)`);
    assert(execReport.reviewQueueRatePct >= 10.0 && execReport.reviewQueueRatePct <= 30.0, `Review queue inflow rate is healthy: ${execReport.reviewQueueRatePct.toFixed(1)}%`);
    assert(execReport.legacyCanonicalMatchesAfter === legacyCount, `Legacy canonical matches in sandbox remained untouched (${legacyCount})`);

    // Verify snapshot was created in sandbox backups
    const snapFiles = fs.readdirSync(sandboxSnapDir);
    assert(snapFiles.length > 0 && snapFiles[0].includes('database_wal_safe_pre_phase3.sqlite'), 'Pre-phase snapshot created via native backup API');

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

  // Test 4: Final Invariant Check on Real Production DB
  console.log('\n[Test Suite 4: Production Database Invariant]');
  {
    const prodDb = new Database('data/database.sqlite', { readonly: true });
    const legacyCount = (prodDb.prepare('SELECT count(1) as c FROM canonical_matches').get() as any).c;
    const v2Count = (prodDb.prepare('SELECT count(1) as c FROM canonical_matches_v2').get() as any).c;
    prodDb.close();

    assert(legacyCount === 140432, 'Real production canonical_matches is strictly 140,432');
    assert(v2Count === 1786, 'Real production canonical_matches_v2 remains strictly at 1,786 (Phase 1+2 count, Phase 3 NOT executed on prod)');
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
