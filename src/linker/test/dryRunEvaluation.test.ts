import fs from 'fs';
import path from 'path';
import { generateEvaluationCohort } from '../../scripts/runDryRunEvaluation';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

const LIVE_DB_PATH = path.resolve('data/database.sqlite');
const LEGACY_DRYRUN_PATH = path.resolve('data/database.dryrun.sqlite');

function runTests() {
  console.log('=== STARTING 1000-MATCH EVALUATION COHORT INTEGRITY TESTS ===');

  assert(fs.existsSync(LIVE_DB_PATH), `Live DB must exist at ${LIVE_DB_PATH}`);
  const liveStatBefore = fs.statSync(LIVE_DB_PATH);

  assert(fs.existsSync(LEGACY_DRYRUN_PATH), `Legacy dryrun DB must exist at ${LEGACY_DRYRUN_PATH}`);
  const legacyStatBefore = fs.statSync(LEGACY_DRYRUN_PATH);

  // 1. Generate cohort from legacy copy
  const cohort = generateEvaluationCohort(LEGACY_DRYRUN_PATH);
  console.log(`Total cohort items generated: ${cohort.length}`);
  assert(cohort.length === 1000, `Expected exactly 1000 matches, got ${cohort.length}`);
  console.log('✓ Test 1 Passed: Cohort generator produced exactly 1,000 matches');

  // 2. Validate all 8 buckets present
  const buckets = new Set(cohort.map(c => c.bucket));
  console.log('Buckets generated:', Array.from(buckets));
  assert(buckets.size >= 8, `Expected at least 8 buckets, got ${buckets.size}`);
  console.log('✓ Test 2 Passed: All 8 core evaluation buckets are represented');

  // 3. Validate match schema structure for all 1000 items
  for (let i = 0; i < cohort.length; i++) {
    const item = cohort[i];
    assert(!!item.incoming.sourceName, `Item ${i} missing sourceName`);
    assert(!!item.incoming.matchDate, `Item ${i} missing matchDate`);
    assert(!!item.incoming.tour, `Item ${i} missing tour`);
    assert(!!item.incoming.rawTournamentName, `Item ${i} missing rawTournamentName`);
    assert(!!item.incoming.rawPlayer1, `Item ${i} missing rawPlayer1`);
    assert(!!item.incoming.rawPlayer2, `Item ${i} missing rawPlayer2`);
  }
  console.log('✓ Test 3 Passed: All 1,000 matches conform to IncomingRawMatch schema');

  // 4. Verify live and legacy copied databases were NOT touched
  const liveStatAfter = fs.statSync(LIVE_DB_PATH);
  assert(liveStatBefore.mtimeMs === liveStatAfter.mtimeMs, 'Live database must NOT be modified');
  assert(liveStatBefore.size === liveStatAfter.size, 'Live database size must NOT change');

  const legacyStatAfter = fs.statSync(LEGACY_DRYRUN_PATH);
  assert(legacyStatBefore.mtimeMs === legacyStatAfter.mtimeMs, 'Legacy dryrun DB must NOT be modified');
  assert(legacyStatBefore.size === legacyStatAfter.size, 'Legacy dryrun DB size must NOT change');
  console.log('✓ Test 4 Passed: Live database and legacy dryrun copy were 100% untouched');

  console.log('================================================================');
  console.log('ALL 4 EVALUATION COHORT INTEGRITY TESTS PASSED');
  console.log('================================================================');
}

if (require.main === module) {
  try {
    runTests();
  } catch (err: any) {
    console.error('TEST FAILURE:', err.message);
    process.exit(1);
  }
}
