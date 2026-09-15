import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { initCanonicalLinkerSchema } from '../schema';
import { validatePhaseGate } from '../phaseGateValidator';

const TEST_DB_PATH = path.resolve('data/test_phase_gate_validator.sqlite');
const LIVE_DB_PATH = path.resolve('data/database.sqlite');
const DRYRUN_DB_PATH = path.resolve('data/database.linker_dryrun.sqlite');

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

function setupCleanTestDb(dbPath: string): Database.Database {
  for (const suffix of ['', '-wal', '-shm', '.bak_pre_sample', '.snap_p0']) {
    const p = dbPath + suffix;
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch {}
    }
  }

  const db = new Database(dbPath);
  initCanonicalLinkerSchema(db);

  // Seed baseline valid data
  db.exec(`
    INSERT INTO canonical_players (canonical_player_id, full_name_standard, last_name, gender) VALUES
    ('cp_carlos_alcaraz', 'Carlos Alcaraz', 'Alcaraz', 'M'),
    ('cp_jannik_sinner', 'Jannik Sinner', 'Sinner', 'M');

    INSERT INTO canonical_tournaments (canonical_tourney_id, name_standard, tour, tour_level, default_surface) VALUES
    ('ct_us_open', 'US Open', 'ATP', 'GRAND_SLAM', 'HARD');

    INSERT INTO raw_source_evidence (evidence_id, source_name, source_match_id, raw_payload_json, payload_sha256) VALUES
    (1, 'sackmann', 's_1', '{"date":"2024-09-08","tour":"ATP","player1":"Carlos Alcaraz","player2":"Jannik Sinner","score":"6-3 6-4"}', 'hash_1'),
    (2, 'pbp', 'p_1', '{"date":"2024-09-08","tour":"ATP","player1":"Carlos Alcaraz","player2":"Jannik Sinner","score":"6-3 6-4"}', 'hash_2'),
    (3, 'sackmann', 's_3', '{"date":"2024-09-07","tour":"ATP","player1":"Carlos Alcaraz","player2":"Jannik Sinner"}', 'hash_3'),
    (4, 'sackmann', 's_4', '{"date":"2024-09-06","tour":"ATP","player1":"Carlos Alcaraz","player2":"Jannik Sinner"}', 'hash_4'),
    (5, 'sackmann', 's_5', '{"date":"2024-09-05","tour":"ATP","player1":"Carlos Alcaraz","player2":"Jannik Sinner"}', 'hash_5'),
    (6, 'sackmann', 's_6', '{"date":"2024-09-04","tour":"ATP","player1":"Carlos Alcaraz","player2":"Jannik Sinner"}', 'hash_6'),
    (7, 'sackmann', 's_7', '{"date":"2024-09-03","tour":"ATP","player1":"Carlos Alcaraz","player2":"Jannik Sinner"}', 'hash_7'),
    (8, 'sackmann', 's_8', '{"date":"2024-09-02","tour":"ATP","player1":"Carlos Alcaraz","player2":"Jannik Sinner"}', 'hash_8'),
    (9, 'sackmann', 's_9', '{"date":"2024-09-01","tour":"ATP","player1":"Carlos Alcaraz","player2":"Jannik Sinner"}', 'hash_9'),
    (10, 'sackmann', 's_10', '{"date":"2024-08-31","tour":"ATP","player1":"Carlos Alcaraz","player2":"Jannik Sinner"}', 'hash_10');

    INSERT INTO canonical_matches (
      canonical_match_id, match_date, tour, canonical_tourney_id, surface, round_name,
      player_low_id, player_high_id, match_status, winner_canonical_id, canonical_score,
      source_mask, evidence_count, version
    ) VALUES (
      'cm_2024-09-08_usopen_alcaraz_sinner', '2024-09-08', 'ATP', 'ct_us_open', 'HARD', 'F',
      'cp_carlos_alcaraz', 'cp_jannik_sinner', 'FINISHED', 'cp_carlos_alcaraz', '6-3 6-4',
      3, 2, 1
    );

    INSERT INTO match_source_links (
      canonical_match_id, source_name, source_match_id, evidence_id, confidence_score, scorer_version, rule_version, link_status
    ) VALUES
    ('cm_2024-09-08_usopen_alcaraz_sinner', 'sackmann', 's_1', 1, 100.0, 'v2.1.0', 'v2.1.0', 'AUTO_LINKED'),
    ('cm_2024-09-08_usopen_alcaraz_sinner', 'pbp', 'p_1', 2, 95.0, 'v2.1.0', 'v2.1.0', 'AUTO_LINKED');

    INSERT INTO match_review_queue (
      review_id, candidate_canonical_id, incoming_source, incoming_source_id, incoming_evidence_id,
      confidence_score, scorer_version, rule_version, evidence_hash,
      veto_triggers_json, divergent_fields_json, review_status, lock_version
    ) VALUES (
      1, 'cm_2024-09-08_usopen_alcaraz_sinner', 'pbp', 'p_1', 2,
      85.0, 'v2.1.0', 'v2.1.0', 'hash_2',
      '["VETO_UNCLEAR_TOURNAMENT"]', '{}', 'APPROVED', 2
    );

    INSERT INTO match_review_audit_log (
      log_id, review_id, action, previous_state_json, new_state_json, actor, reason, logged_at
    ) VALUES (
      1, 1, 'APPROVE', '{"status":"PENDING"}', '{"status":"APPROVED"}', 'admin', 'Approved in test', CURRENT_TIMESTAMP
    );
  `);

  db.close();

  // Create valid snapshot file
  fs.copyFileSync(dbPath, `${dbPath}.snap_p0`);

  return new Database(dbPath);
}

async function runTestSuite() {
  console.log('\n======================================================');
  console.log('   PHASE GATE VALIDATOR TEST SUITE                    ');
  console.log('======================================================\n');

  const liveStatsBefore = fs.statSync(LIVE_DB_PATH);

  try {
    // -------------------------------------------------------------------------
    // 1. Safety Guard Tests
    // -------------------------------------------------------------------------
    console.log('[Phase 1: Hard Safety Guard Verifications]');

    await assertTest('Validator throws security violation if directed at live DB', () => {
      let threw = false;
      try {
        validatePhaseGate({ customDbPath: LIVE_DB_PATH });
      } catch (err: any) {
        threw = true;
        if (!err.message.includes('SECURITY VIOLATION')) throw err;
      }
      if (!threw) throw new Error('Failed to block live production database path!');
    });

    await assertTest('Validator throws safety violation if directed at legacy dry-run copy', () => {
      let threw = false;
      try {
        validatePhaseGate({ customDbPath: path.resolve('data/database.dryrun.sqlite') });
      } catch (err: any) {
        threw = true;
        if (!err.message.includes('SAFETY VIOLATION')) throw err;
      }
      if (!threw) throw new Error('Failed to block legacy dry-run copy DB path!');
    });

    // -------------------------------------------------------------------------
    // 2. Clean Database Verification (PASS)
    // -------------------------------------------------------------------------
    console.log('\n[Phase 2: Clean Database PASS Verification]');

    const cleanDb = setupCleanTestDb(TEST_DB_PATH);
    cleanDb.close();

    let cleanVerdict: any = null;
    await assertTest('Validator returns overallStatus = PASS on clean database with valid snapshot', () => {
      cleanVerdict = validatePhaseGate({ customDbPath: TEST_DB_PATH });
      if (cleanVerdict.overallStatus !== 'PASS') {
        throw new Error(`Expected PASS, got ${cleanVerdict.overallStatus}. Checks: ${JSON.stringify(cleanVerdict.checks)}`);
      }
      if (cleanVerdict.failedCount !== 0) {
        throw new Error(`Expected 0 failed checks, got ${cleanVerdict.failedCount}`);
      }
    });

    // -------------------------------------------------------------------------
    // 3. Hard Failure on False-Positive Merge (FAIL)
    // -------------------------------------------------------------------------
    console.log('\n[Phase 3: False-Positive Merge Detection (FAIL)]');

    const fpDb = new Database(TEST_DB_PATH);
    // Inject a false-positive merge: evidence 3 has matchDate 2024-09-25 (17 days away from 2024-09-08)
    fpDb.exec(`
      INSERT INTO raw_source_evidence (evidence_id, source_name, source_match_id, raw_payload_json, payload_sha256) VALUES
      (999, 'flashscore', 'f_fp_1', '{"date":"2024-09-25","tour":"ATP","player1":"Carlos Alcaraz","player2":"Jannik Sinner"}', 'hash_fp');

      INSERT INTO match_source_links (
        canonical_match_id, source_name, source_match_id, evidence_id, confidence_score, scorer_version, rule_version, link_status
      ) VALUES
      ('cm_2024-09-08_usopen_alcaraz_sinner', 'flashscore', 'f_fp_1', 999, 90.0, 'v2.1.0', 'v2.1.0', 'AUTO_LINKED');

      UPDATE canonical_matches SET evidence_count = 3 WHERE canonical_match_id = 'cm_2024-09-08_usopen_alcaraz_sinner';
    `);
    fpDb.close();

    await assertTest('Validator detects false-positive merge and returns overallStatus = FAIL', () => {
      const fpVerdict = validatePhaseGate({ customDbPath: TEST_DB_PATH });
      const fpCheck = fpVerdict.checks.find((c: any) => c.checkId === 'CHK_3_FALSE_POSITIVES');
      if (!fpCheck || fpCheck.status !== 'FAIL') {
        throw new Error(`Expected CHK_3_FALSE_POSITIVES to FAIL, got ${fpCheck?.status}`);
      }
      if (fpVerdict.overallStatus !== 'FAIL') {
        throw new Error(`Expected overall FAIL, got ${fpVerdict.overallStatus}`);
      }
    });

    // -------------------------------------------------------------------------
    // 4. Hard Failure on Foreign Key Violation (FAIL)
    // -------------------------------------------------------------------------
    console.log('\n[Phase 4: Foreign Key Violation Detection (FAIL)]');

    // Clean and reset test DB
    const fkDb = setupCleanTestDb(TEST_DB_PATH);
    // Temporarily turn off foreign keys to inject an invalid orphaned foreign key row
    fkDb.pragma('foreign_keys = OFF');
    fkDb.exec(`
      INSERT INTO match_source_links (
        canonical_match_id, source_name, source_match_id, evidence_id, confidence_score, scorer_version, rule_version, link_status
      ) VALUES
      ('cm_non_existent_match_id_orphan', 'pbp', 'orphan_1', 1, 90.0, 'v2.1.0', 'v2.1.0', 'AUTO_LINKED');
    `);
    fkDb.close();

    await assertTest('Validator detects foreign key violation and returns overallStatus = FAIL', () => {
      const fkVerdict = validatePhaseGate({ customDbPath: TEST_DB_PATH });
      const fkCheck = fkVerdict.checks.find((c: any) => c.checkId === 'CHK_2_FOREIGN_KEYS');
      if (!fkCheck || fkCheck.status !== 'FAIL') {
        throw new Error(`Expected CHK_2_FOREIGN_KEYS to FAIL, got ${fkCheck?.status}`);
      }
      if (fkVerdict.overallStatus !== 'FAIL') {
        throw new Error(`Expected overall FAIL, got ${fkVerdict.overallStatus}`);
      }
    });

    // -------------------------------------------------------------------------
    // 5. Hard Failure on Audit Inconsistency (FAIL)
    // -------------------------------------------------------------------------
    console.log('\n[Phase 5: Audit Log Inconsistency Detection (FAIL)]');

    const auditDb = setupCleanTestDb(TEST_DB_PATH);
    // Mark a queue item as REJECTED without an audit row
    auditDb.exec(`
      INSERT INTO match_review_queue (
        review_id, candidate_canonical_id, incoming_source, incoming_source_id, incoming_evidence_id,
        confidence_score, scorer_version, rule_version, evidence_hash,
        veto_triggers_json, divergent_fields_json, review_status, lock_version
      ) VALUES (
        99, 'cm_2024-09-08_usopen_alcaraz_sinner', 'pbp', 'p_untracked', 2,
        80.0, 'v2.1.0', 'v2.1.0', 'hash_99',
        '[]', '{}', 'REJECTED', 2
      );
    `);
    auditDb.close();

    await assertTest('Validator detects missing audit log entry and fails CHK_7_AUDIT_LOG_CONSISTENCY', () => {
      const auditVerdict = validatePhaseGate({ customDbPath: TEST_DB_PATH });
      const auditCheck = auditVerdict.checks.find((c: any) => c.checkId === 'CHK_7_AUDIT_LOG_CONSISTENCY');
      if (!auditCheck || auditCheck.status !== 'FAIL') {
        throw new Error(`Expected CHK_7_AUDIT_LOG_CONSISTENCY to FAIL, got ${auditCheck?.status}`);
      }
      if (auditVerdict.overallStatus !== 'FAIL') {
        throw new Error(`Expected overall FAIL, got ${auditVerdict.overallStatus}`);
      }
    });

    // -------------------------------------------------------------------------
    // 6. Soft Warning on Review Queue Rate (WARNING)
    // -------------------------------------------------------------------------
    console.log('\n[Phase 6: Soft Threshold Warning (WARNING)]');

    const warnDb = setupCleanTestDb(TEST_DB_PATH);
    warnDb.close();

    await assertTest('Validator sets WARNING when review queue exceeds soft threshold but below hard limit', () => {
      // With 1 review item out of 10 evidence rows (10%), setting soft limit to 5% and hard limit to 20% yields WARNING
      const warnVerdict = validatePhaseGate({
        customDbPath: TEST_DB_PATH,
        maxQueueRateSoftPct: 5.0,
        maxQueueRateHardPct: 20.0,
      });
      const queueCheck = warnVerdict.checks.find((c: any) => c.checkId === 'CHK_5_REVIEW_QUEUE_RATE');
      if (!queueCheck || queueCheck.status !== 'WARNING') {
        throw new Error(`Expected CHK_5_REVIEW_QUEUE_RATE to be WARNING, got ${queueCheck?.status}`);
      }
      if (warnVerdict.overallStatus !== 'WARNING') {
        throw new Error(`Expected overall WARNING, got ${warnVerdict.overallStatus}`);
      }
    });

    // -------------------------------------------------------------------------
    // 7. Live Dry-Run DB Audit
    // -------------------------------------------------------------------------
    console.log('\n[Phase 7: Real Dry-Run DB Audit (data/database.linker_dryrun.sqlite)]');

    await assertTest('Validator passes on data/database.linker_dryrun.sqlite', () => {
      const liveVerdict = validatePhaseGate({ customDbPath: DRYRUN_DB_PATH });
      if (liveVerdict.overallStatus === 'FAIL') {
        throw new Error(`Real dry-run DB failed phase gate: ${JSON.stringify(liveVerdict.checks.filter((c: any) => c.status === 'FAIL'))}`);
      }
      console.log(`    Dry-run DB Status: ${liveVerdict.overallStatus} (${liveVerdict.passedCount} checks passed)`);
    });

    // -------------------------------------------------------------------------
    // 8. Production Database Zero-Touch Verification
    // -------------------------------------------------------------------------
    console.log('\n[Phase 8: Production Database Zero-Touch Verification]');

    await assertTest('Production database data/database.sqlite has NOT been modified', () => {
      const liveStatsAfter = fs.statSync(LIVE_DB_PATH);
      if (liveStatsAfter.size !== liveStatsBefore.size) {
        throw new Error(`PRODUCTION DB MUTATED! Size changed from ${liveStatsBefore.size} to ${liveStatsAfter.size}`);
      }
      if (liveStatsAfter.mtime.getTime() !== liveStatsBefore.mtime.getTime()) {
        throw new Error(`PRODUCTION DB MUTATED! Timestamp changed from ${liveStatsBefore.mtime} to ${liveStatsAfter.mtime}`);
      }
    });

  } finally {
    // Teardown test files
    for (const suffix of ['', '-wal', '-shm', '.bak_pre_sample', '.snap_p0']) {
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
