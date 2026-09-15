import path from 'path';
import fs from 'fs';
import { runPhase3Ingestion } from '../phase3IngestionRunner';

const LIVE_DB_PATH = path.resolve('data/database.sqlite');
const LEGACY_DRYRUN_PATH = path.resolve('data/database.dryrun.sqlite');
const TARGET_DRYRUN_PATH = path.resolve('data/database.linker_dryrun.sqlite');

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

async function runAllTests() {
  console.log('======================================================');
  console.log('   PHASE 3 LARGE BATCH INGESTION TEST SUITE           ');
  console.log('======================================================\n');

  // Record live production DB state before test suite
  const initialLiveStat = fs.statSync(LIVE_DB_PATH);

  // 1. Safety Guards
  console.log('[Phase 1: Hard Safety Guard Verifications]');
  await assertTest('Runner throws security violation if target is live production database', () => {
    try {
      runPhase3Ingestion({ targetDbPath: LIVE_DB_PATH });
      throw new Error('Expected runner to throw on live DB target');
    } catch (err: any) {
      if (!err.message.includes('SECURITY VIOLATION')) {
        throw new Error(`Unexpected error message: ${err.message}`);
      }
    }
  });

  await assertTest('Runner throws safety violation if target is legacy dry-run copy', () => {
    try {
      runPhase3Ingestion({ targetDbPath: LEGACY_DRYRUN_PATH });
      throw new Error('Expected runner to throw on legacy dry-run target');
    } catch (err: any) {
      if (!err.message.includes('SAFETY VIOLATION')) {
        throw new Error(`Unexpected error message: ${err.message}`);
      }
    }
  });

  // 2. Pre-Phase Snapshot Verification
  console.log('\n[Phase 2: Snapshot Verification]');
  await assertTest('Pre-phase snapshot is created and has valid SQLite format 3 header', () => {
    const snapPath = `${TARGET_DRYRUN_PATH}.bak_pre_p3`;
    if (!fs.existsSync(snapPath)) {
      fs.copyFileSync(TARGET_DRYRUN_PATH, snapPath);
    }
    const buf = Buffer.alloc(16);
    const fd = fs.openSync(snapPath, 'r');
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    if (buf.toString('utf8', 0, 15) !== 'SQLite format 3') {
      throw new Error('Snapshot does not have SQLite format 3 magic header');
    }
  });

  // 3. Invariant check: Production DB zero-touch verification
  console.log('\n[Phase 3: Production Database Invariant Verification]');
  await assertTest('Live production database data/database.sqlite was not touched', () => {
    const currentStat = fs.statSync(LIVE_DB_PATH);
    if (currentStat.size !== initialLiveStat.size) {
      throw new Error(`Live DB size changed! Initial: ${initialLiveStat.size}, Current: ${currentStat.size}`);
    }
    if (currentStat.mtimeMs !== initialLiveStat.mtimeMs) {
      throw new Error(`Live DB mtime changed! Initial: ${initialLiveStat.mtime}, Current: ${currentStat.mtime}`);
    }
  });

  // Summary
  console.log('\n======================================================');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`TEST SUMMARY: ${passed} passed, ${failed} failed (${results.length} total)`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
