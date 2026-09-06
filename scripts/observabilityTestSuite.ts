import { initSchema } from '../src/db/schema';
import { db } from '../src/db/connection';
import { ObservabilityService, MlErrorCodes } from '../src/services/observability.service';

console.log('================================================================================');
console.log('🧪 ML HARDENING & OBSERVABILITY REGRESSION TEST SUITE');
console.log('================================================================================');

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ [FAIL] ${msg}`);
    throw new Error(`Test failed: ${msg}`);
  }
  console.log(`✅ [PASS] ${msg}`);
}

async function runHardeningTestSuite() {
  console.log('\n--- 1. SCHEMA & BASELINE REGISTRATION ---');
  initSchema();
  db.prepare('DELETE FROM ml_incidents WHERE incident_code LIKE ?').run('INC-%');

  const model = ObservabilityService.ensureBaselineModelRegistered();
  assert(model.version === 'v1.2.0-2024H2', `Model version registered: ${model.version}`);
  assert(model.baselineAuc === 0.6838, `Baseline AUC registered: ${model.baselineAuc}`);
  assert(model.baselineEce === 0.0055, `Baseline ECE registered: ${model.baselineEce}`);

  console.log('\n--- 2. PRODUCTION GATING RULES & CHANNEL ROUTING ---');
  const futureMatchDate = new Date(Date.now() + 4 * 3600 * 1000).toISOString();
  
  // Clean High Confidence Match
  const v1 = ObservabilityService.evaluateGatingRules(futureMatchDate, 72, 90, 12, false);
  assert(v1.passed === true, 'High confidence clean match passes all gating rules');
  assert(v1.riskBucket === 'LOW_RISK_STABLE', `Risk bucket is LOW_RISK_STABLE: ${v1.riskBucket}`);
  assert(v1.websiteAllowed === true, 'Website display allowed');
  assert(v1.telegramAllowed === true, 'Telegram broadcasting allowed for high confidence');

  // Close Matchup (50-50)
  const v2 = ObservabilityService.evaluateGatingRules(futureMatchDate, 51, 85, 8, false);
  assert(v2.riskBucket === 'MEDIUM_RISK_MONITOR', `Close 51% matchup is MEDIUM_RISK_MONITOR: ${v2.riskBucket}`);
  assert(v2.websiteAllowed === true, 'Website displays close matchup with caution label');
  assert(v2.telegramAllowed === false, 'Telegram broadcast filtered for 50-50 matchup');

  // Cutoff Violation (Past match date)
  const pastMatchDate = new Date(Date.now() - 3600 * 1000).toISOString();
  const v3 = ObservabilityService.evaluateGatingRules(pastMatchDate, 65, 85, 10, false);
  assert(v3.riskBucket === 'HIGH_RISK_BLOCK', `Past match is HIGH_RISK_BLOCK: ${v3.riskBucket}`);
  assert(v3.failedGates.includes(MlErrorCodes.GATING_CUTOFF_VIOLATION), 'G1 cutoff violation flagged');
  assert(v3.websiteAllowed === false, 'Website forecast suppressed for past match');

  // Edge Case: Invalid Probability Payload (NaN or out of bounds)
  const vInvalid = ObservabilityService.evaluateGatingRules(futureMatchDate, 120, 85, 10, false);
  assert(vInvalid.failedGates.includes(MlErrorCodes.INVALID_PROBABILITY_PAYLOAD), 'Out-of-bounds probability flagged');

  console.log('\n--- 3. POPULATION STABILITY INDEX (PSI) & DISTRIBUTION DRIFT ---');
  const baseline = [10, 20, 30, 25, 15];
  const identical = [10, 20, 30, 25, 15];
  const psiZero = ObservabilityService.calculateDistributionPsi(identical, baseline);
  assert(psiZero === 0.0, `Identical distributions yield PSI = 0.0: ${psiZero}`);

  const shifted = [30, 25, 15, 10, 5];
  const psiShifted = ObservabilityService.calculateDistributionPsi(shifted, baseline);
  assert(psiShifted >= 0.10, `Shifted distribution detects drift with PSI >= 0.10: ${psiShifted}`);

  console.log('\n--- 4. EDGE CASE HARDENING: DRIFT MONITORING JOB & DEDUPLICATION ---');
  const snapshot1 = await ObservabilityService.runDriftMonitoringJob();
  assert(snapshot1.modelVersion === 'v1.2.0-2024H2', `Snapshot captured model version: ${snapshot1.modelVersion}`);
  assert(snapshot1.predictionCount >= 1, `Prediction count safely handled (>= 1): ${snapshot1.predictionCount}`);

  // Edge Case: Rapid duplicate snapshot insertion within 30s is debounced
  const snapshotCountBefore = (db.prepare('SELECT COUNT(*) as cnt FROM ml_monitoring_snapshots').get() as any).cnt;
  ObservabilityService.recordMonitoringSnapshot(snapshot1);
  const snapshotCountAfter = (db.prepare('SELECT COUNT(*) as cnt FROM ml_monitoring_snapshots').get() as any).cnt;
  assert(snapshotCountBefore === snapshotCountAfter, 'Rapid duplicate snapshot within 30s is safely debounced');

  console.log('\n--- 5. EDGE CASE HARDENING: INCIDENT WORKFLOW & DEDUPLICATION ---');
  const inc1 = ObservabilityService.createIncident({
    incidentCode: 'INC-HARDEN-001',
    severity: 'WATCH',
    reason: 'Test synthetic drift alert',
    affectedChannelsJson: ['TELEGRAM_CHANNEL'],
    actionTaken: 'Set Telegram to high-confidence only',
  });
  assert(inc1.incidentCode === 'INC-HARDEN-001', `Incident created: ${inc1.incidentCode}`);

  // Duplicate incident creation with same code does not create a duplicate row
  const inc2 = ObservabilityService.createIncident({
    incidentCode: 'INC-HARDEN-001',
    severity: 'WATCH',
    reason: 'Test synthetic drift alert repeat',
    affectedChannelsJson: ['TELEGRAM_CHANNEL'],
    actionTaken: 'No-op duplicate',
  });
  assert(inc2.id === inc1.id, 'Duplicate active incident returns existing record without duplicate insertion');

  // Incident resolution workflow
  const resolved = ObservabilityService.resolveIncident('INC-HARDEN-001', 'Operator verified healthy');
  assert(resolved === true, 'Incident resolved successfully');

  console.log('\n--- 6. EDGE CASE HARDENING: ROLLBACK INTEGRATION & INVALID TARGET ---');
  // Edge Case: Rollback to non-existent target version fails safely without corrupting active model
  const badRollback = ObservabilityService.triggerRollback('v9.9.9-nonexistent', 'Invalid version test');
  assert(badRollback.success === false, 'Rollback to non-existent target version fails safely');
  assert(badRollback.errorCode === MlErrorCodes.ROLLBACK_TARGET_NOT_FOUND, 'Target version not found error returned');
  assert(badRollback.activeVersion === 'v1.2.0-2024H2', 'Active version unchanged after failed rollback');

  // Valid Rollback
  const goodRollback = ObservabilityService.triggerRollback('v1.2.0-2024H2', 'Valid rollback execution');
  assert(goodRollback.success === true, 'Valid rollback executed successfully');
  assert(goodRollback.activeVersion === 'v1.2.0-2024H2', 'Production version active');

  console.log('\n================================================================================');
  console.log('🎉 ALL 15 / 15 HARDENING & OBSERVABILITY TESTS PASSED (100%)');
  console.log('================================================================================');
}

runHardeningTestSuite().catch(err => {
  console.error('Hardening Test Suite Failed:', err);
  process.exit(1);
});
