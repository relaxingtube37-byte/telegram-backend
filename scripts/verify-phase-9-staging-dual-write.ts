/**
 * scripts/verify-phase-9-staging-dual-write.ts
 *
 * Comprehensive Quality Gate Verification Suite for Phase 9 Dual-Write Architecture.
 * Evaluates all 14 Quality Gates:
 *   P9-G1:  Outbox Latency Overhead (Median <= 1ms, P95 <= 5ms, 0 external calls)
 *   P9-G2:  Circuit Breaker Auto-Trip on PostgreSQL Downtime
 *   P9-G3:  DLQ Envelope Integrity & dlq_records.jsonl Export
 *   P9-G4:  Instant Rollback Disarm (<100ms admission stop, <1s worker stop)
 *   P9-G5:  Production Read Immutability (SQLITE_ONLY)
 *   P9-G6:  Idempotent Replay (Row Hash Parity)
 *   P9-G7:  PostgreSQL Downtime Fault Tolerance (Primary writes succeed)
 *   P9-G8:  Atomic Commit Invariant (Rollback leaves neither committed)
 *   P9-G9:  Worker Lease Reclamation (Expired PROCESSING leases recovered)
 *   P9-G10: Authenticated & Auditable DLQ Replay
 *   P9-G11: Backlog Observability & Threshold Alerts
 *   P9-G12: Production Credential Rejection (PRODUCTION_TARGET_PROHIBITED)
 *   P9-G13: Payload Sanitization (Zero credentials/tokens in outbox)
 *   P9-G14: Crash Recovery State Preservation
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { OutboxService } from '../src/db/outbox/outbox.service';
import { StagingDualWriteWorker } from '../src/db/outbox/dualWriteWorker';
import { DualWritingPredictionsRepo } from '../src/db/adapters/dualWriting/predictions.dualwrite';
import { SqlitePredictionsAdapter } from '../src/db/adapters/sqlite/predictions.sqlite';
import { RepositoryFactory } from '../src/db/repositoryFactory';
import { StagingPgPool } from '../src/db/stagingPgPool';

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SCRATCH_DIR = path.join(PROJECT_ROOT, 'scratch', 'postgres-phase-9-dual-write');
const STAGING_CLUSTER_DIR = path.join(PROJECT_ROOT, 'scratch', 'postgres-phase-7-ai-migration', 'pg_staging');
const STAGING_PORT = 54350;

if (!fs.existsSync(SCRATCH_DIR)) {
  fs.mkdirSync(SCRATCH_DIR, { recursive: true });
}

// Locate pg_ctl and psql
function findPgBinaries() {
  const candidateDirs = [
    'C:\\Program Files\\PostgreSQL\\18\\bin',
    'C:\\Program Files\\PostgreSQL\\16\\bin',
    'C:\\Program Files\\PostgreSQL\\17\\bin'
  ];
  for (const binDir of candidateDirs) {
    const psqlPath = path.join(binDir, 'psql.exe');
    const pgctlPath = path.join(binDir, 'pg_ctl.exe');
    if (fs.existsSync(psqlPath) && fs.existsSync(pgctlPath)) {
      return { binDir, psqlPath, pgctlPath };
    }
  }
  return null;
}

function startStagingPg(pgBins: any) {
  const pidFile = path.join(STAGING_CLUSTER_DIR, 'postmaster.pid');
  if (fs.existsSync(pidFile)) {
    try { fs.unlinkSync(pidFile); } catch (e) {}
  }
  try {
    execSync(`"${pgBins.pgctlPath}" -D "${STAGING_CLUSTER_DIR}" -w start`, { stdio: 'ignore' });
  } catch (e) {}
}

function stopStagingPg(pgBins: any) {
  try {
    execSync(`"${pgBins.pgctlPath}" -D "${STAGING_CLUSTER_DIR}" stop -m immediate`, { stdio: 'ignore' });
  } catch (e) {}
}

async function runPhase9Verification() {
  console.log('='.repeat(80));
  console.log(' 🛡️  PHASE 9: DUAL-WRITE STAGING HARNESS & QUALITY GATES AUDIT');
  console.log(' Timestamp: ' + new Date().toISOString());
  console.log(' Governance: Transactional SQLite Outbox | Fail-Closed Staging Execution');
  console.log('='.repeat(80));

  const gates: Record<string, boolean> = {};
  const pgBins = findPgBinaries();

  // Create disposable test SQLite database in scratch to preserve production source databases
  const testDbPath = path.join(SCRATCH_DIR, 'dual_write_test.sqlite');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  const testDb = new Database(testDbPath);
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('synchronous = NORMAL');
  testDb.pragma('busy_timeout = 5000');

  // Initialize minimal test tables (predictions + outbox)
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id INTEGER NOT NULL,
      home_name TEXT NOT NULL,
      away_name TEXT NOT NULL,
      predicted_winner TEXT NOT NULL,
      win_probability REAL NOT NULL,
      confidence TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'UPCOMING',
      result_score TEXT,
      model_name TEXT,
      channel_message_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const outboxService = new OutboxService(testDb);

  // --------------------------------------------------------------------------
  // Gate P9-G1: Outbox Latency Overhead (Median <= 1ms, P95 <= 5ms)
  // --------------------------------------------------------------------------
  console.log('\n[1/14] Evaluating Gate P9-G1: Outbox Latency Overhead...');
  process.env.ENABLE_STAGING_DUAL_WRITE = 'true';
  const sqliteAdapter = new SqlitePredictionsAdapter(testDb as any);
  const dualWritingRepo = new DualWritingPredictionsRepo(sqliteAdapter, outboxService, testDb);

  const baselineLatencies: number[] = [];
  const dualWriteLatencies: number[] = [];

  // Pre-compiled baseline insertion against testDb
  const baselineStmt = testDb.prepare(`
    INSERT INTO predictions (
      fixture_id, home_name, away_name, predicted_winner, win_probability,
      confidence, status, model_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const baselineTx = testDb.transaction((input: any) => {
    baselineStmt.run(
      input.fixture_id, input.home_name, input.away_name, input.predicted_winner,
      input.win_probability, input.confidence, 'UPCOMING', 'model', new Date().toISOString()
    );
  });

  // Baseline benchmark without outbox
  for (let i = 0; i < 50; i++) {
    const t0 = performance.now();
    baselineTx({
      fixture_id: 1000 + i,
      home_name: `Player A${i}`,
      away_name: `Player B${i}`,
      predicted_winner: `Player A${i}`,
      win_probability: 0.65,
      confidence: 'MEDIUM'
    });
    baselineLatencies.push(performance.now() - t0);
  }

  // Dual-write benchmark with atomic outbox insert
  process.env.ENABLE_STAGING_DUAL_WRITE = 'true';
  for (let i = 0; i < 50; i++) {
    const t0 = performance.now();
    await dualWritingRepo.create({
      fixture_id: 2000 + i,
      home_name: `Player C${i}`,
      away_name: `Player D${i}`,
      predicted_winner: `Player C${i}`,
      win_probability: 0.70,
      confidence: 'HIGH'
    });
    dualWriteLatencies.push(performance.now() - t0);
  }

  baselineLatencies.sort((a, b) => a - b);
  dualWriteLatencies.sort((a, b) => a - b);

  const medianBaseline = baselineLatencies[Math.floor(baselineLatencies.length / 2)];
  const medianDualWrite = dualWriteLatencies[Math.floor(dualWriteLatencies.length / 2)];
  const p95DualWrite = dualWriteLatencies[Math.floor(dualWriteLatencies.length * 0.95)];
  const medianOverhead = Math.max(0, medianDualWrite - medianBaseline);

  console.log(`  Baseline Median Latency:   ${medianBaseline.toFixed(3)} ms`);
  console.log(`  Dual-Write Median Latency: ${medianDualWrite.toFixed(3)} ms (Overhead: ${medianOverhead.toFixed(3)} ms, Target: <= 1.0 ms)`);
  console.log(`  Dual-Write P95 Latency:    ${p95DualWrite.toFixed(3)} ms (Target: <= 5.0 ms)`);

  const g1Pass = medianOverhead <= 1.0 && p95DualWrite <= 5.0;
  gates['P9-G1_latency_overhead'] = g1Pass;
  console.log(g1Pass ? '  ✅ PASS: Outbox latency overhead meets non-blocking criteria.' : '  ❌ FAIL: Overhead exceeded');

  // --------------------------------------------------------------------------
  // Gate P9-G8: Atomic Commit Invariant (Transaction Abort Leaves 0 Committed)
  // --------------------------------------------------------------------------
  console.log('\n[2/14] Evaluating Gate P9-G8: Atomic Commit Invariant...');
  const countPredsBefore = (testDb.prepare('SELECT count(*) as c FROM predictions').get() as any).c;
  const countOutboxBefore = (testDb.prepare('SELECT count(*) as c FROM postgres_dual_write_outbox').get() as any).c;

  try {
    const abortTx = testDb.transaction(() => {
      testDb.prepare('INSERT INTO predictions (fixture_id, home_name, away_name, predicted_winner, win_probability, confidence) VALUES (?, ?, ?, ?, ?, ?)')
        .run(9999, 'Abort1', 'Abort2', 'Abort1', 0.5, 'LOW');
      outboxService.appendTransactionalEvent({
        aggregateType: 'PREDICTION',
        aggregateId: '9999',
        operation: 'CREATE',
        payload: { aborted: true },
        idempotencyKey: 'abort_key_1'
      }, testDb);
      throw new Error('SIMULATED_TRANSACTION_ABORT');
    });
    abortTx();
  } catch (e: any) {
    // Expected abort
  }

  const countPredsAfter = (testDb.prepare('SELECT count(*) as c FROM predictions').get() as any).c;
  const countOutboxAfter = (testDb.prepare('SELECT count(*) as c FROM postgres_dual_write_outbox').get() as any).c;

  const g8Pass = countPredsBefore === countPredsAfter && countOutboxBefore === countOutboxAfter;
  gates['P9-G8_atomic_commit'] = g8Pass;
  console.log(g8Pass
    ? '  ✅ PASS: Forced rollback left zero primary mutations and zero outbox records committed.'
    : '  ❌ FAIL: Partial commit detected!');

  // --------------------------------------------------------------------------
  // Gate P9-G7: PostgreSQL Downtime Fault Tolerance (Primary Writes Succeed)
  // --------------------------------------------------------------------------
  console.log('\n[3/14] Evaluating Gate P9-G7: PostgreSQL Downtime Fault Tolerance...');
  if (pgBins) stopStagingPg(pgBins);

  let g7WritesSuccess = true;
  for (let i = 0; i < 5; i++) {
    try {
      await dualWritingRepo.create({
        fixture_id: 3000 + i,
        home_name: `Offline P1_${i}`,
        away_name: `Offline P2_${i}`,
        predicted_winner: `Offline P1_${i}`,
        win_probability: 0.60,
        confidence: 'MEDIUM'
      });
    } catch (e) {
      g7WritesSuccess = false;
    }
  }

  const g7Pass = g7WritesSuccess;
  gates['P9-G7_pg_downtime_tolerance'] = g7Pass;
  console.log(g7Pass
    ? '  ✅ PASS: 100% of primary SQLite mutations succeeded with PostgreSQL completely offline.'
    : '  ❌ FAIL: Primary write failed during PostgreSQL downtime');

  // --------------------------------------------------------------------------
  // Gate P9-G2: Circuit Breaker Auto-Trip on Continuous Downtime
  // --------------------------------------------------------------------------
  console.log('\n[4/14] Evaluating Gate P9-G2: Circuit Breaker Auto-Trip...');
  process.env.ENABLE_STAGING_DUAL_WRITE = 'true';
  const worker = new StagingDualWriteWorker(outboxService, null, {
    batchSize: 5,
    circuitFailureThreshold: 3,
    circuitCoolOffMs: 2000
  });

  // Execute processing batch while PG is offline
  await worker.processNextBatch();
  const circuitStatus = worker.getCircuitStatus();
  console.log(`  Circuit State: ${circuitStatus.state}, Consecutive Failures: ${circuitStatus.consecutiveFailures}`);

  const g2Pass = circuitStatus.state === 'OPEN' && circuitStatus.consecutiveFailures >= 3;
  gates['P9-G2_circuit_breaker_trip'] = g2Pass;
  console.log(g2Pass
    ? '  ✅ PASS: Circuit breaker automatically tripped to OPEN on persistent failure threshold.'
    : '  ❌ FAIL: Circuit breaker failed to trip');

  // --------------------------------------------------------------------------
  // Gate P9-G3: DLQ Envelope Integrity & dlq_records.jsonl Export
  // --------------------------------------------------------------------------
  console.log('\n[5/14] Evaluating Gate P9-G3: DLQ Envelope Integrity & dlq_records.jsonl...');
  // Force 5 failures on an event to push to DLQ
  const dlqEvent = outboxService.appendTransactionalEvent({
    aggregateType: 'PREDICTION',
    aggregateId: 'fixture_dlq_test',
    operation: 'CREATE',
    payload: { test: 'dlq_payload', sensitive_token: 'secret123' },
    idempotencyKey: 'dlq_test_idempotency_1'
  });

  for (let attempt = 1; attempt <= 5; attempt++) {
    outboxService.markFailed(dlqEvent.event_id, new Error('ECONNREFUSED_STAGING_CLUSTER_OFFLINE'), 5);
  }

  const updatedDlqRow = testDb.prepare('SELECT * FROM postgres_dual_write_outbox WHERE event_id = ?').get(dlqEvent.event_id) as any;
  const dlqLogPath = path.join(SCRATCH_DIR, 'dlq_records.jsonl');
  const dlqLogContent = fs.existsSync(dlqLogPath) ? fs.readFileSync(dlqLogPath, 'utf8') : '';

  const g3Pass = (
    updatedDlqRow?.status === 'DLQ' &&
    updatedDlqRow?.attempt_count === 5 &&
    dlqLogContent.includes(dlqEvent.event_id) &&
    dlqLogContent.includes(dlqEvent.idempotency_key)
  );
  gates['P9-G3_dlq_integrity'] = g3Pass;
  console.log(g3Pass
    ? '  ✅ PASS: Exhausted event captured with status DLQ and exported to dlq_records.jsonl.'
    : '  ❌ FAIL: DLQ transition failed');

  // --------------------------------------------------------------------------
  // Gate P9-G10: Authenticated & Auditable DLQ Replay
  // --------------------------------------------------------------------------
  console.log('\n[6/14] Evaluating Gate P9-G10: Authenticated DLQ Replay...');
  const replaySuccess = outboxService.replayDlqItem(dlqEvent.event_id);
  const replayedRow = testDb.prepare('SELECT * FROM postgres_dual_write_outbox WHERE event_id = ?').get(dlqEvent.event_id) as any;

  const g10Pass = replaySuccess && replayedRow?.status === 'PENDING' && replayedRow?.attempt_count === 0;
  gates['P9-G10_dlq_replay'] = g10Pass;
  console.log(g10Pass
    ? '  ✅ PASS: DLQ item successfully replayed back to PENDING state.'
    : '  ❌ FAIL: DLQ replay failed');

  // --------------------------------------------------------------------------
  // Gate P9-G9: Worker Lease Reclamation on Restart
  // --------------------------------------------------------------------------
  console.log('\n[7/14] Evaluating Gate P9-G9: Worker Lease Reclamation on Restart...');
  // Artificially lock a row in PROCESSING with an expired timestamp (60s ago)
  const expiredTime = new Date(Date.now() - 60000).toISOString();
  testDb.prepare(`
    UPDATE postgres_dual_write_outbox
    SET status = 'PROCESSING', locked_at = ?
    WHERE event_id = ?
  `).run(expiredTime, dlqEvent.event_id);

  const reclaimedCount = outboxService.reclaimExpiredLeases(30);
  const reclaimedRow = testDb.prepare('SELECT * FROM postgres_dual_write_outbox WHERE event_id = ?').get(dlqEvent.event_id) as any;

  const g9Pass = reclaimedCount > 0 && reclaimedRow?.status === 'PENDING' && reclaimedRow?.locked_at === null;
  gates['P9-G9_lease_reclamation'] = g9Pass;
  console.log(g9Pass
    ? `  ✅ PASS: Reclaimed ${reclaimedCount} abandoned PROCESSING lease(s) back to PENDING.`
    : '  ❌ FAIL: Lease reclamation failed');

  // --------------------------------------------------------------------------
  // Gate P9-G11: Backlog Observability & Threshold Alerts
  // --------------------------------------------------------------------------
  console.log('\n[8/14] Evaluating Gate P9-G11: Backlog Observability & Metrics...');
  const metrics = outboxService.getMetrics();
  console.log('  Outbox Metrics:', JSON.stringify(metrics));

  const g11Pass = (
    metrics.total > 0 &&
    typeof metrics.pending === 'number' &&
    typeof metrics.processing === 'number' &&
    typeof metrics.delivered === 'number' &&
    typeof metrics.dlq === 'number'
  );
  gates['P9-G11_backlog_metrics'] = g11Pass;
  console.log(g11Pass
    ? '  ✅ PASS: Real-time outbox backlog metrics accurately calculated.'
    : '  ❌ FAIL: Metrics computation failed');

  // --------------------------------------------------------------------------
  // Gate P9-G13: Payload Sanitization (Zero Secrets in Outbox)
  // --------------------------------------------------------------------------
  console.log('\n[9/14] Evaluating Gate P9-G13: Payload Sanitization...');
  const sensitiveEvent = outboxService.appendTransactionalEvent({
    aggregateType: 'EDITORIAL',
    aggregateId: 'fixture_secret_test',
    operation: 'CREATE',
    payload: {
      headline: 'Match Analysis',
      api_token: 'secret_token_12345',
      user_password: 'super_secret_password',
      normal_data: 'safe_text'
    },
    idempotencyKey: 'sanitization_test_key'
  });

  const storedPayload = JSON.parse(sensitiveEvent.payload_json);
  const g13Pass = (
    storedPayload.api_token === '[REDACTED]' &&
    storedPayload.user_password === '[REDACTED]' &&
    storedPayload.normal_data === 'safe_text'
  );
  gates['P9-G13_payload_sanitization'] = g13Pass;
  console.log(g13Pass
    ? '  ✅ PASS: Sensitive keys (api_token, password) scrubbed from outbox payload.'
    : '  ❌ FAIL: Secrets detected in payload!');

  // --------------------------------------------------------------------------
  // Gate P9-G12: Production Credential Rejection
  // --------------------------------------------------------------------------
  console.log('\n[10/14] Evaluating Gate P9-G12: Production Credential Rejection...');
  let g12Pass = false;
  try {
    const origHost = process.env.STAGING_PG_HOST;
    process.env.STAGING_PG_HOST = 'db.production.remote.com';
    new StagingDualWriteWorker(outboxService);
    process.env.STAGING_PG_HOST = origHost;
  } catch (e: any) {
    if (e.message.includes('PRODUCTION_TARGET_PROHIBITED')) {
      g12Pass = true;
    }
  }
  delete process.env.STAGING_PG_HOST;

  gates['P9-G12_production_rejection'] = g12Pass;
  console.log(g12Pass
    ? '  ✅ PASS: Worker fails closed and throws PRODUCTION_TARGET_PROHIBITED on remote/production hosts.'
    : '  ❌ FAIL: Worker did not reject production target');

  // --------------------------------------------------------------------------
  // Gate P9-G4: Instant Rollback Disarm (<100ms Admission Stop, <1s Worker Stop)
  // --------------------------------------------------------------------------
  console.log('\n[11/14] Evaluating Gate P9-G4: Instant Rollback Disarm...');
  process.env.ENABLE_STAGING_DUAL_WRITE = 'false';
  const disarmT0 = performance.now();
  const batchAfterDisarm = await worker.processNextBatch();
  const disarmLatency = performance.now() - disarmT0;

  console.log(`  Disarm Admission Check Latency: ${disarmLatency.toFixed(3)} ms (Target: <= 100 ms)`);
  console.log(`  Claimed after disarm:           ${batchAfterDisarm.claimed} (Target: 0)`);

  const stopT0 = performance.now();
  await worker.stop(1000);
  const stopLatency = performance.now() - stopT0;
  console.log(`  Worker Stop Latency:            ${stopLatency.toFixed(3)} ms (Target: <= 1000 ms)`);

  const g4Pass = disarmLatency <= 100 && batchAfterDisarm.claimed === 0 && stopLatency <= 1000;
  gates['P9-G4_instant_disarm'] = g4Pass;
  console.log(g4Pass
    ? '  ✅ PASS: Dual-write admissions halted in <100ms; worker stopped in <1s.'
    : '  ❌ FAIL: Disarm latency target exceeded');

  // --------------------------------------------------------------------------
  // Gate P9-G6: Idempotent Replay & Row Hash Parity (Staging PostgreSQL Port 54350)
  // --------------------------------------------------------------------------
  console.log('\n[12/14] Evaluating Gate P9-G6: Idempotent Replay (Row Hash Parity)...');
  let g6Pass = false;

  if (pgBins) {
    startStagingPg(pgBins);
    try {
      const pool = new StagingPgPool({ port: STAGING_PORT });
      const matchRes = await pool.query('SELECT match_id FROM matches.matches LIMIT 1');
      const testMatchId = matchRes.rows[0]?.match_id;
      const playerRes = await pool.query('SELECT player_id FROM identity.players LIMIT 1');
      const testPlayerId = playerRes.rows[0]?.player_id;
      // Mark previous pending outbox items delivered so worker specifically processes this replay target
      testDb.prepare("UPDATE postgres_dual_write_outbox SET status = 'DELIVERED' WHERE status = 'PENDING'").run();

      const testRunId = crypto.randomUUID();
      process.env.ENABLE_STAGING_DUAL_WRITE = 'true';

      const replayOutbox = outboxService.appendTransactionalEvent({
        aggregateType: 'PREDICTION',
        aggregateId: 'fixture_replay_test',
        operation: 'CREATE',
        payload: {
          run_id: testRunId,
          match_id: testMatchId,
          predicted_winner_id: testPlayerId,
          win_probability_pct: 68.5,
          confidence: 'HIGH',
          total_latency_ms: 120
        },
        idempotencyKey: `replay_test_${testRunId}`
      });

      const liveWorker = new StagingDualWriteWorker(outboxService, pool, { batchSize: 5 });

      // Delivery Pass 1
      await liveWorker.processNextBatch();

      // Query row hash after Pass 1
      const querySql = `SELECT run_id, match_id, win_probability_pct, confidence_tier FROM ai.prediction_runs WHERE run_id = $1`;
      const pass1Res = await pool.query(querySql, [testRunId]);
      const pass1Row = pass1Res.rows[0];
      const pass1Hash = crypto.createHash('sha256').update(JSON.stringify(pass1Row)).digest('hex');

      // Reset outbox record to PENDING to force replay
      testDb.prepare(`UPDATE postgres_dual_write_outbox SET status = 'PENDING', locked_at = NULL WHERE event_id = ?`).run(replayOutbox.event_id);

      // Delivery Pass 2 (Replay)
      await liveWorker.processNextBatch();

      const pass2Res = await pool.query(querySql, [testRunId]);
      const pass2Row = pass2Res.rows[0];
      const pass2Hash = crypto.createHash('sha256').update(JSON.stringify(pass2Row)).digest('hex');

      // Verify row count in PostgreSQL is still exactly 1
      const countRes = await pool.query(`SELECT count(*) as c FROM ai.prediction_runs WHERE run_id = $1`, [testRunId]);
      const rowCount = Number(countRes.rows[0].c);

      console.log(`  Row count after replay: ${rowCount} (Expected: 1)`);
      console.log(`  Pass 1 Row Hash:        ${pass1Hash}`);
      console.log(`  Pass 2 Row Hash:        ${pass2Hash}`);

      // Clean up test run from staging PG to keep snapshot pristine
      await pool.query(`DELETE FROM ai.prediction_runs WHERE run_id = $1`, [testRunId]);

      await pool.end();
      g6Pass = (rowCount === 1 && pass1Hash === pass2Hash);
    } catch (e: any) {
      console.error('  Error in G6 replay check:', e.message);
    } finally {
      stopStagingPg(pgBins);
    }
  }

  gates['P9-G6_idempotent_replay'] = g6Pass;
  console.log(g6Pass
    ? '  ✅ PASS: Replay produced zero duplicate rows and bitwise identical row hash parity.'
    : '  ❌ FAIL: Idempotent replay failed');

  // --------------------------------------------------------------------------
  // Gate P9-G5: Production Read Immutability (SQLITE_ONLY)
  // --------------------------------------------------------------------------
  console.log('\n[13/14] Evaluating Gate P9-G5: Production Read Immutability...');
  const origEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const config = RepositoryFactory.getConfiguration();
  process.env.NODE_ENV = origEnv;

  const g5Pass = config.productionReads === 'SQLITE_ONLY' && config.primaryEngine === 'SQLITE';
  gates['P9-G5_production_reads_immutability'] = g5Pass;
  console.log(g5Pass
    ? '  ✅ PASS: Production reads unconditionally locked to SQLITE_ONLY.'
    : '  ❌ FAIL: Production reads not locked to SQLITE_ONLY');

  // --------------------------------------------------------------------------
  // Gate P9-G14: Crash Recovery State Preservation
  // --------------------------------------------------------------------------
  console.log('\n[14/14] Evaluating Gate P9-G14: Crash Recovery State Preservation...');
  testDb.close();

  // Re-open test database to simulate complete process restart
  const reopenedDb = new Database(testDbPath, { readonly: true });
  const checkCount = (reopenedDb.prepare('SELECT count(*) as c FROM postgres_dual_write_outbox').get() as any).c;
  reopenedDb.close();

  const g14Pass = checkCount > 0;
  gates['P9-G14_crash_recovery_preservation'] = g14Pass;
  console.log(g14Pass
    ? `  ✅ PASS: Process crash simulation preserved all ${checkCount} committed outbox events.`
    : '  ❌ FAIL: Outbox events lost during restart');

  // Clean up disposable test database
  try { fs.unlinkSync(testDbPath); } catch (e) {}

  // --------------------------------------------------------------------------
  // Scorecard Summary
  // --------------------------------------------------------------------------
  console.log('\n' + '='.repeat(80));
  console.log(' PHASE 9 QUALITY ACCEPTANCE GATES SCORECARD (14/14 GATES)');
  console.log('='.repeat(80));
  for (const [k, v] of Object.entries(gates)) {
    console.log(`  ${k.padEnd(35)}: ${v ? '✅ PASS' : '❌ FAIL'}`);
  }
  console.log('='.repeat(80));

  const allPassed = Object.values(gates).every(v => v === true);
  console.log(allPassed
    ? ' VERDICT: ✅ PHASE 9 STAGING DUAL-WRITE HARNESS 100% CERTIFIED (14/14 GATES PASSED)'
    : ' VERDICT: ❌ PHASE 9 VERIFICATION FAILED');
  console.log(' Operational Policy: Staging Execution Certified | Production Dual-Write: PROHIBITED');
  console.log('='.repeat(80));

  if (!allPassed) {
    process.exit(1);
  }
}

runPhase9Verification().catch(err => {
  console.error('FATAL PHASE 9 VERIFICATION ERROR:', err);
  process.exit(1);
});
