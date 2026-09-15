import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { CanaryReadComparator } from '../../services/canaryReadComparator.service';

console.log('======================================================');
console.log('   CANARY READ COMPARATOR PRE-FLIGHT TEST SUITE       ');
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
  const dbPath = path.resolve('data/database.sqlite');
  const prodDb = new Database(dbPath, { readonly: true });
  const legacyCountBefore = (prodDb.prepare('SELECT count(1) as c FROM canonical_matches').get() as any).c;
  const v2CountBefore = (prodDb.prepare('SELECT count(1) as c FROM canonical_matches_v2').get() as any).c;

  // Find sample v2 match and sample legacy match
  const sampleV2Id = (prodDb.prepare('SELECT canonical_match_id FROM canonical_matches_v2 LIMIT 1').get() as any).canonical_match_id;
  const sampleLegacyId = (prodDb.prepare('SELECT canonical_match_id FROM canonical_matches LIMIT 1').get() as any).canonical_match_id;
  prodDb.close();

  // Test Suite 1: In-Memory Temp View Isolation & Read Integrity
  console.log('[Test Suite 1: In-Memory Temp View Isolation]');
  {
    const comparator = new CanaryReadComparator(dbPath);

    // Compare sample V2 match
    const resV2 = comparator.compareMatchById(sampleV2Id);
    assert(resV2.hasParity === true, 'Sample V2 match has semantic parity');
    assert(resV2.queryType === 'MATCH_BY_ID', 'Query type is MATCH_BY_ID');

    // Compare sample Legacy match
    const resLegacy = comparator.compareMatchById(sampleLegacyId);
    assert(resLegacy.hasParity === true, 'Sample Legacy match has semantic parity');

    // Compare batch query by date
    const resBatch = comparator.compareMatchesByDate('2024-01-14', 10);
    assert(resBatch.hasParity === true, 'Batch query by date has semantic parity');

    comparator.close();
  }

  // Test Suite 2: Zero Mutation Verification on Production DB
  console.log('\n[Test Suite 2: Zero Mutation on Production Database]');
  {
    const verifyDb = new Database(dbPath, { readonly: true });
    const legacyCountAfter = (verifyDb.prepare('SELECT count(1) as c FROM canonical_matches').get() as any).c;
    const v2CountAfter = (verifyDb.prepare('SELECT count(1) as c FROM canonical_matches_v2').get() as any).c;
    const integrity = (verifyDb.pragma('integrity_check') as any[])[0]?.integrity_check;
    const fkErrors = (verifyDb.pragma('foreign_key_check') as any[]).length;

    // Check if any permanent view named canonical_matches_operational exists on disk
    const onDiskView = verifyDb.prepare("SELECT count(1) as c FROM sqlite_master WHERE type='view' AND name='canonical_matches_operational'").get() as any;
    verifyDb.close();

    assert(legacyCountBefore === legacyCountAfter, `Legacy matches strictly untouched: ${legacyCountAfter}`);
    assert(legacyCountAfter === 140432, 'Legacy count remains strictly at 140,432');
    assert(v2CountBefore === v2CountAfter, `V2 matches strictly untouched: ${v2CountAfter}`);
    assert(integrity === 'ok', 'Database integrity remains ok');
    assert(fkErrors === 0, 'Foreign key check has 0 errors');
    assert(onDiskView.c === 0, 'Zero on-disk view created: canonical_matches_operational does NOT exist in schema');
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
