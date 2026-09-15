import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import {
  bootstrapLinkerDryRunDb,
  EXPECTED_V2_TABLES,
  EXPECTED_V2_TRIGGERS
} from '../../scripts/runLinkerDryRunBootstrap';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

const TEST_DB_PATH = path.resolve('data/database.linker_dryrun_test.sqlite');
const TEST_WAL_PATH = path.resolve('data/database.linker_dryrun_test.sqlite-wal');
const TEST_SHM_PATH = path.resolve('data/database.linker_dryrun_test.sqlite-shm');
const LIVE_DB_PATH = path.resolve('data/database.sqlite');
const LEGACY_DRYRUN_PATH = path.resolve('data/database.dryrun.sqlite');

function cleanTestDbFiles() {
  for (const f of [TEST_DB_PATH, TEST_WAL_PATH, TEST_SHM_PATH]) {
    if (fs.existsSync(f)) {
      try {
        fs.unlinkSync(f);
      } catch {
        // ignore
      }
    }
  }
}

function runTests() {
  console.log('=== STARTING LINKER DRY-RUN BOOTSTRAP TEST SUITE ===');

  // Record baseline stats of live and legacy copied databases
  assert(fs.existsSync(LIVE_DB_PATH), `Live DB must exist at ${LIVE_DB_PATH}`);
  const liveStatBefore = fs.statSync(LIVE_DB_PATH);

  let legacyStatBefore: fs.Stats | null = null;
  if (fs.existsSync(LEGACY_DRYRUN_PATH)) {
    legacyStatBefore = fs.statSync(LEGACY_DRYRUN_PATH);
  }

  // Ensure clean test state
  cleanTestDbFiles();

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Initializes cleanly from scratch
    // -------------------------------------------------------------------------
    const report1 = bootstrapLinkerDryRunDb(TEST_DB_PATH, { enableWal: true, cleanFirst: true });
    assert(report1.status === 'SUCCESS', 'Bootstrap from scratch should report SUCCESS');
    assert(fs.existsSync(TEST_DB_PATH), 'Test DB file must exist on disk');
    console.log('✓ Test 1 Passed: Linker dry-run DB initializes cleanly from scratch');

    // -------------------------------------------------------------------------
    // TEST 2: Idempotent re-initialization
    // -------------------------------------------------------------------------
    const report2 = bootstrapLinkerDryRunDb(TEST_DB_PATH, { enableWal: true, cleanFirst: false });
    assert(report2.status === 'SUCCESS', 'Second bootstrap run should report SUCCESS without error');
    console.log('✓ Test 2 Passed: Schema bootstrap is idempotent (runs twice with zero errors)');

    // -------------------------------------------------------------------------
    // TEST 3: All 10 v2 linker tables exist with zero missing
    // -------------------------------------------------------------------------
    assert(report1.missingV2Tables.length === 0, `Missing tables: ${report1.missingV2Tables.join(', ')}`);
    assert(report1.tablesFound.length === 10, `Expected exactly 10 tables, found ${report1.tablesFound.length}`);
    for (const expectedTable of EXPECTED_V2_TABLES) {
      assert(report1.tablesFound.includes(expectedTable), `Table ${expectedTable} must be in sqlite_master`);
    }
    console.log(`✓ Test 3 Passed: All 10 v2 linker tables exist (${EXPECTED_V2_TABLES.join(', ')})`);

    // -------------------------------------------------------------------------
    // TEST 4: No legacy tables are required or present
    // -------------------------------------------------------------------------
    assert(!report1.hasLegacyTables, 'No legacy tables should be present');
    const legacyNames = ['historical_matches', 'tracked_players', 'player_match_index', 'predictions', 'users', 'referral_sites'];
    for (const leg of legacyNames) {
      assert(!report1.tablesFound.includes(leg), `Legacy table ${leg} must NOT be created`);
    }
    console.log('✓ Test 4 Passed: Dedicated database is completely independent of legacy tables');

    // -------------------------------------------------------------------------
    // TEST 5: All 3 v2 triggers exist
    // -------------------------------------------------------------------------
    for (const trg of EXPECTED_V2_TRIGGERS) {
      assert(report1.triggersFound.includes(trg), `Trigger ${trg} must exist`);
    }
    console.log(`✓ Test 5 Passed: All 3 updated_at triggers created (${EXPECTED_V2_TRIGGERS.join(', ')})`);

    // -------------------------------------------------------------------------
    // TEST 6: Foreign key enforcement is active and working
    // -------------------------------------------------------------------------
    const db = new Database(TEST_DB_PATH);
    db.pragma('foreign_keys = ON');

    let fkFailed = false;
    try {
      db.prepare(`
        INSERT INTO player_aliases (canonical_player_id, source_name, raw_name, normalized_token)
        VALUES ('non_existent_player', 'sackmann', 'Ghost Player', 'ghost player')
      `).run();
    } catch (err: any) {
      fkFailed = true;
      assert(err.message.includes('FOREIGN KEY'), `Expected FK error message, got: ${err.message}`);
    }
    assert(fkFailed, 'Inserting alias for non-existent player must fail FK constraint');

    // Insert valid player and valid alias
    db.prepare(`
      INSERT INTO canonical_players (canonical_player_id, full_name_standard, first_name, last_name, gender)
      VALUES ('cp_test_player', 'Test Player', 'Test', 'Player', 'M')
    `).run();

    const insertAlias = db.prepare(`
      INSERT INTO player_aliases (canonical_player_id, source_name, raw_name, normalized_token)
      VALUES ('cp_test_player', 'sackmann', 'Test Player', 'test player')
    `).run();
    assert(insertAlias.changes === 1, 'Valid alias insertion must succeed');

    // Verify cascade delete
    db.prepare(`DELETE FROM canonical_players WHERE canonical_player_id = 'cp_test_player'`).run();
    const aliasCount = db.prepare(`SELECT count(*) as c FROM player_aliases WHERE canonical_player_id = 'cp_test_player'`).get() as { c: number };
    assert(aliasCount.c === 0, 'Cascading delete must remove child aliases on player deletion');
    console.log('✓ Test 6 Passed: Foreign keys are strictly enforced and cascading deletes work');

    // -------------------------------------------------------------------------
    // TEST 7: Symmetric constraint check on canonical_matches
    // -------------------------------------------------------------------------
    db.prepare(`
      INSERT INTO canonical_players (canonical_player_id, full_name_standard, first_name, last_name, gender)
      VALUES 
        ('cp_player_a', 'Player A', 'Player', 'A', 'M'),
        ('cp_player_b', 'Player B', 'Player', 'B', 'M')
    `).run();

    db.prepare(`
      INSERT INTO canonical_tournaments (canonical_tourney_id, name_standard, tour, tour_level, default_surface)
      VALUES ('tourney_wimbledon', 'Wimbledon', 'ATP', 'GRAND_SLAM', 'GRASS')
    `).run();

    let checkFailed = false;
    try {
      // Violates CHECK (player_low_id < player_high_id)
      db.prepare(`
        INSERT INTO canonical_matches (
          canonical_match_id, match_date, tour, canonical_tourney_id, surface, round_name,
          player_low_id, player_high_id, match_status
        ) VALUES (
          'cm_invalid', '2026-07-01', 'ATP', 'tourney_wimbledon', 'GRASS', 'F',
          'cp_player_b', 'cp_player_a', 'FINISHED'
        )
      `).run();
    } catch (err: any) {
      checkFailed = true;
      assert(err.message.includes('CHECK'), `Expected CHECK constraint failure, got: ${err.message}`);
    }
    assert(checkFailed, 'Inserting inverted symmetric pair must fail CHECK constraint');
    console.log('✓ Test 7 Passed: Symmetric player pair CHECK constraint (player_low_id < player_high_id) enforced');

    // -------------------------------------------------------------------------
    // TEST 8: PRAGMA integrity_check and PRAGMA foreign_key_check are clean
    // -------------------------------------------------------------------------
    const integrityRows = db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
    assert(integrityRows.length === 1 && integrityRows[0].integrity_check === 'ok', 'Integrity check must return ok');

    const fkErrors = db.prepare('PRAGMA foreign_key_check').all() as any[];
    assert(fkErrors.length === 0, 'Foreign key check must return 0 errors');
    console.log('✓ Test 8 Passed: PRAGMA integrity_check is ok and PRAGMA foreign_key_check has 0 errors');

    db.close();

    // -------------------------------------------------------------------------
    // TEST 9: Production and legacy databases were completely untouched
    // -------------------------------------------------------------------------
    const liveStatAfter = fs.statSync(LIVE_DB_PATH);
    assert(liveStatBefore.mtimeMs === liveStatAfter.mtimeMs, 'Live database must NOT be modified');
    assert(liveStatBefore.size === liveStatAfter.size, 'Live database size must NOT change');

    if (legacyStatBefore && fs.existsSync(LEGACY_DRYRUN_PATH)) {
      const legacyStatAfter = fs.statSync(LEGACY_DRYRUN_PATH);
      assert(legacyStatBefore.mtimeMs === legacyStatAfter.mtimeMs, 'Legacy dryrun DB must NOT be modified');
      assert(legacyStatBefore.size === legacyStatAfter.size, 'Legacy dryrun DB size must NOT change');
    }
    console.log('✓ Test 9 Passed: Live production database and legacy dryrun copy were 100% untouched');

  } finally {
    // Clean up sidecar files and test DB
    cleanTestDbFiles();
  }

  console.log('================================================================');
  console.log('ALL 9 LINKER DRY-RUN BOOTSTRAP TESTS PASSED SUCCESSFULLY');
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
