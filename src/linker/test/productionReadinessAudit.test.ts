import path from 'path';
import fs from 'fs';
import { runProductionReadinessAudit } from '../productionReadinessAudit';

const LIVE_DB_PATH = path.resolve('data/database.sqlite');
const LEGACY_DRYRUN_PATH = path.resolve('data/database.dryrun.sqlite');

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
  console.log('   PHASE 4 PRODUCTION READINESS TEST SUITE            ');
  console.log('======================================================\n');

  // Record live production DB state before test suite
  const initialLiveStat = fs.statSync(LIVE_DB_PATH);

  // 1. Safety Guards
  console.log('[Phase 1: Hard Safety Guard Verifications]');
  await assertTest('Auditor throws security violation if target is live production database', () => {
    try {
      runProductionReadinessAudit({ targetDbPath: LIVE_DB_PATH });
      throw new Error('Expected auditor to throw on live DB target');
    } catch (err: any) {
      if (!err.message.includes('SECURITY VIOLATION')) {
        throw new Error(`Unexpected error message: ${err.message}`);
      }
    }
  });

  await assertTest('Auditor throws safety violation if target is legacy dry-run copy', () => {
    try {
      runProductionReadinessAudit({ targetDbPath: LEGACY_DRYRUN_PATH });
      throw new Error('Expected auditor to throw on legacy dry-run target');
    } catch (err: any) {
      if (!err.message.includes('SAFETY VIOLATION')) {
        throw new Error(`Unexpected error message: ${err.message}`);
      }
    }
  });

  // 2. Full Audit Execution
  console.log('\n[Phase 2: Comprehensive Audit Execution]');
  let report: any;
  await assertTest('Production readiness audit executes and returns overallStatus === PASS', () => {
    report = runProductionReadinessAudit();
    if (report.overallStatus !== 'PASS') {
      throw new Error(`Expected overallStatus PASS, got ${report.overallStatus}. Failures: ${report.remainingBlockers.join(', ')}`);
    }
  });

  await assertTest('All 12 checklist verification gates pass', () => {
    if (report.passedCount < 12 || report.failedCount > 0) {
      throw new Error(`Checklist gates incomplete: ${report.passedCount} passed, ${report.failedCount} failed`);
    }
  });

  await assertTest('Zero false-positive merges detected across multi-source matches', () => {
    if (report.findings.falsePositiveMerges !== 0) {
      throw new Error(`False-positive merges detected: ${report.findings.falsePositiveMerges}`);
    }
  });

  await assertTest('Rollback drill and optimistic concurrency control verified', () => {
    if (!report.findings.rollbackDrillPassed) {
      throw new Error('Rollback drill failed');
    }
    if (!report.findings.concurrencyControlPassed) {
      throw new Error('Concurrency control drill failed');
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
