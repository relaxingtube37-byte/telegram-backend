import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import {
  OperationalReadCutoverController,
  PLAYER_MATCHES_VALIDATED_REPOINTED_SQL,
  PLAYER_MATCHES_VALIDATED_LEGACY_SQL,
  CANONICAL_MODELING_MATCHES_2024_PLUS_SQL,
} from '../../scripts/cutoverOperationalReads';

console.log('======================================================');
console.log('  PHASE 4 STAGE 3 CUTOVER CONTROLLER TEST SUITE       ');
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
  const prodDbPath = path.resolve('data/database.sqlite');
  const sandboxDbPath = path.resolve('data/backups/sandbox_cutover_test.sqlite');

  // Clean sandbox if exists
  if (fs.existsSync(sandboxDbPath)) {
    try { fs.unlinkSync(sandboxDbPath); } catch {}
  }

  // Suite 1: Production DB Current Isolation Check
  console.log('[Test Suite 1: Production Database Pre-Cutover Verification]');
  {
    const prodDb = new Database(prodDbPath, { readonly: true });
    try {
      const pmvDdl = (prodDb.prepare(
        "SELECT sql FROM sqlite_master WHERE type='view' AND name='player_matches_validated'"
      ).get() as any).sql;

      // Production view MUST still reference legacy canonical_matches
      assert(
        pmvDdl.includes('LEFT JOIN canonical_matches h'),
        'Live player_matches_validated references legacy canonical_matches'
      );
      assert(
        !pmvDdl.includes('canonical_matches_operational'),
        'Live player_matches_validated DOES NOT reference canonical_matches_operational'
      );

      const opViewExists = (prodDb.prepare(
        "SELECT count(1) as c FROM sqlite_master WHERE type='view' AND name='canonical_matches_operational'"
      ).get() as any).c;
      assert(opViewExists === 1, 'canonical_matches_operational exists on production disk');

      const legacyCount = (prodDb.prepare('SELECT count(1) as c FROM canonical_matches').get() as any).c;
      const v2Count = (prodDb.prepare('SELECT count(1) as c FROM canonical_matches_v2').get() as any).c;
      assert(legacyCount === 140432, 'Legacy canonical_matches count is exactly 140,432');
      assert(v2Count === 7505, 'V2 canonical_matches_v2 count is exactly 7,505');
    } finally {
      prodDb.close();
    }
  }

  // Suite 2: Dry Run Safety on Production DB
  console.log('\n[Test Suite 2: Dry Run Execution Safety]');
  {
    const controller = new OperationalReadCutoverController({
      targetDbPath: prodDbPath,
      isDryRun: true,
    });

    const report = await controller.cutover();
    assert(report.mode === 'DRY_RUN', 'Report mode is DRY_RUN');
    assert(report.status === 'SUCCESS', 'Dry-run status is SUCCESS');
    assert(report.activeReadSource === 'canonical_matches (legacy)', 'Active read source reported as legacy');
    assert(report.probes.length === 5, 'All 5 validation probes executed');
    assert(report.probes.every((p) => p.passed), 'All 5 validation probes passed');

    // Re-verify production DB has zero modifications
    const prodDb = new Database(prodDbPath, { readonly: true });
    try {
      const pmvDdl = (prodDb.prepare(
        "SELECT sql FROM sqlite_master WHERE type='view' AND name='player_matches_validated'"
      ).get() as any).sql;
      assert(
        pmvDdl.includes('LEFT JOIN canonical_matches h'),
        'Production view strictly untouched after dry run'
      );
    } finally {
      prodDb.close();
    }
  }

  // Suite 3: Real Database Sandbox Cutover and Revert Drill
  console.log('\n[Test Suite 3: Sandbox Cutover & Revert Cycle (Full DB Clone)]');
  {
    const prodDb = new Database(prodDbPath, { readonly: true });
    await prodDb.backup(sandboxDbPath);
    prodDb.close();

    // Execute cutover on sandbox
    const sandboxController = new OperationalReadCutoverController({
      targetDbPath: sandboxDbPath,
      isDryRun: false,
    });

    const cutoverReport = await sandboxController.cutover();
    assert(cutoverReport.mode === 'EXECUTE', 'Sandbox cutover mode is EXECUTE');
    assert(cutoverReport.status === 'SUCCESS', 'Sandbox cutover status is SUCCESS');
    assert(cutoverReport.activeReadSource === 'canonical_matches_operational', 'Active read source repointed to operational view');

    // Verify sandbox view definition changed
    const sbDb = new Database(sandboxDbPath, { readonly: true });
    const repointedDdl = (sbDb.prepare(
      "SELECT sql FROM sqlite_master WHERE type='view' AND name='player_matches_validated'"
    ).get() as any).sql;
    assert(
      repointedDdl.includes('canonical_matches_operational'),
      'Sandbox player_matches_validated correctly repointed to canonical_matches_operational'
    );
    sbDb.close();

    // Revert sandbox cutover
    const revertReport = sandboxController.revert();
    assert(revertReport.mode === 'REVERT', 'Sandbox revert mode is REVERT');
    assert(revertReport.status === 'SUCCESS', 'Sandbox revert status is SUCCESS');
    assert(revertReport.activeReadSource === 'canonical_matches (legacy)', 'Sandbox read source reverted to legacy');

    // Verify sandbox view definition reverted
    const sbDbAfter = new Database(sandboxDbPath, { readonly: true });
    const revertedDdl = (sbDbAfter.prepare(
      "SELECT sql FROM sqlite_master WHERE type='view' AND name='player_matches_validated'"
    ).get() as any).sql;
    assert(
      revertedDdl.includes('LEFT JOIN canonical_matches h'),
      'Sandbox player_matches_validated reverted back to legacy canonical_matches'
    );
    assert(
      !revertedDdl.includes('canonical_matches_operational'),
      'Sandbox player_matches_validated does not reference operational view after revert'
    );
    sbDbAfter.close();

    // Cleanup sandbox
    try { fs.unlinkSync(sandboxDbPath); } catch {}
  }

  // Suite 4: Final Production DB Invariant Assertion
  console.log('\n[Test Suite 4: Final Production Database Invariant Assertion]');
  {
    const prodDb = new Database(prodDbPath, { readonly: true });
    try {
      const pmvDdl = (prodDb.prepare(
        "SELECT sql FROM sqlite_master WHERE type='view' AND name='player_matches_validated'"
      ).get() as any).sql;
      assert(
        pmvDdl.includes('LEFT JOIN canonical_matches h'),
        'FINAL ASSERTION: Production player_matches_validated is STILL on legacy'
      );
      assert(
        !pmvDdl.includes('canonical_matches_operational'),
        'FINAL ASSERTION: Production read cutover has NOT occurred'
      );
    } finally {
      prodDb.close();
    }
  }

  console.log(`\n======================================================`);
  console.log(`  TEST RESULTS: ${passedTests} passed, ${failedTests} failed`);
  console.log(`======================================================\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('[TEST SUITE ERROR]:', err);
  process.exit(1);
});
