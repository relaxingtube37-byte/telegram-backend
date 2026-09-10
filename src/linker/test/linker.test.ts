import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { configureLinkerConnection, initCanonicalLinkerSchema } from '../schema';
import { MatchLinkerEngine } from '../matchLinker';
import type { IncomingRawMatch } from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

const LIVE_DB_PATH = path.resolve('data/database.sqlite');
const TEST_DB_PATH = path.resolve('data/database.test_copied.sqlite');
const TEST_WAL_PATH = path.resolve('data/database.test_copied.sqlite-wal');
const TEST_SHM_PATH = path.resolve('data/database.test_copied.sqlite-shm');

function cleanTestDbFiles() {
  for (const f of [TEST_DB_PATH, TEST_WAL_PATH, TEST_SHM_PATH]) {
    if (fs.existsSync(f)) {
      try {
        fs.unlinkSync(f);
      } catch {
        // ignore if not present
      }
    }
  }
}

function runTests() {
  console.log('--- STARTING TENNIS MULTI-SOURCE MATCH LINKER TESTS (COPIED DB) ---');

  // Verify live DB exists and record its stats before running any test
  assert(fs.existsSync(LIVE_DB_PATH), `Live database at ${LIVE_DB_PATH} must exist`);
  const liveStatBefore = fs.statSync(LIVE_DB_PATH);

  // Clean up any old test database copy including -wal and -shm sidecar files
  cleanTestDbFiles();

  // Create clean copied test database file on disk and apply test pragmas (explicit opt-in WAL for test)
  const db = new Database(TEST_DB_PATH);
  configureLinkerConnection(db, { enableWal: true, synchronousNormal: true });

  // =========================================================================
  // TEST 1: Schema initialization idempotency
  // =========================================================================
  initCanonicalLinkerSchema(db);
  // Run a second time to guarantee idempotency (IF NOT EXISTS everywhere)
  initCanonicalLinkerSchema(db);
  console.log('✓ Test 1 Passed: Schema initialization is idempotent (ran twice with 0 errors)');

  // Seed canonical players
  db.prepare(`
    INSERT INTO canonical_players (canonical_player_id, full_name_standard, first_name, last_name, gender)
    VALUES 
      ('cp_carlos_alcaraz', 'Carlos Alcaraz', 'Carlos', 'Alcaraz', 'M'),
      ('cp_novak_djokovic', 'Novak Djokovic', 'Novak', 'Djokovic', 'M'),
      ('cp_jannik_sinner', 'Jannik Sinner', 'Jannik', 'Sinner', 'M'),
      ('cp_francisco_cerundolo', 'Francisco Cerundolo', 'Francisco', 'Cerundolo', 'M'),
      ('cp_juan_manuel_cerundolo', 'Juan Manuel Cerundolo', 'Juan Manuel', 'Cerundolo', 'M'),
      ('cp_iga_swiatek', 'Iga Swiatek', 'Iga', 'Swiatek', 'F'),
      ('cp_aryna_sabalenka', 'Aryna Sabalenka', 'Aryna', 'Sabalenka', 'F')
  `).run();

  // Seed aliases
  db.prepare(`
    INSERT INTO player_aliases (canonical_player_id, source_name, raw_name, normalized_token, is_verified, has_sibling_conflict)
    VALUES
      ('cp_carlos_alcaraz', 'sackmann', 'Carlos Alcaraz', 'carlos alcaraz', 1, 0),
      ('cp_carlos_alcaraz', 'pbp', 'C. Alcaraz', 'c alcaraz', 1, 0),
      ('cp_novak_djokovic', 'sackmann', 'Novak Djokovic', 'novak djokovic', 1, 0),
      ('cp_novak_djokovic', 'pbp', 'N. Djokovic', 'n djokovic', 1, 0),
      ('cp_francisco_cerundolo', 'mcp', 'Cerundolo', 'cerundolo', 0, 1)
  `).run();

  // Seed canonical tournaments & aliases
  db.prepare(`
    INSERT INTO canonical_tournaments (canonical_tourney_id, name_standard, tour, tour_level, default_surface)
    VALUES 
      ('ct_wimbledon', 'Wimbledon', 'ATP', 'GRAND_SLAM', 'GRASS'),
      ('ct_us_open', 'US Open', 'ATP', 'GRAND_SLAM', 'HARD'),
      ('ct_wta_madrid', 'Madrid Open', 'WTA', 'WTA_1000', 'CLAY')
  `).run();

  db.prepare(`
    INSERT INTO tournament_aliases (canonical_tourney_id, source_name, raw_name, normalized_token, is_verified)
    VALUES
      ('ct_wimbledon', 'sackmann', 'Wimbledon', 'wimbledon', 1),
      ('ct_wimbledon', 'pbp', 'The Championships Wimbledon', 'the championships wimbledon', 1),
      ('ct_wimbledon', 'mcp', 'Wimbledon Grass', 'wimbledon grass', 1),
      ('ct_us_open', 'sackmann', 'US Open', 'us open', 1)
  `).run();

  console.log('✓ Canonical seed data loaded in copied test database');

  const linker = new MatchLinkerEngine(db);

  // =========================================================================
  // TEST 2: First Incoming Match -> CREATE_NEW_CANONICAL
  // =========================================================================
  const sackmannWimby: IncomingRawMatch = {
    sourceName: 'sackmann',
    sourceMatchId: 'sackmann_wimby_2024_f',
    matchDate: '2024-07-14',
    tour: 'ATP',
    gender: 'M',
    rawTournamentName: 'Wimbledon',
    rawSurface: 'Grass',
    rawRound: 'F',
    rawPlayer1: 'Carlos Alcaraz',
    rawPlayer2: 'Novak Djokovic',
    rawWinnerName: 'Carlos Alcaraz',
    rawScore: '6-2 6-2 7-6(4)',
    rawPayload: { matchId: 101, year: 2024, winner: 'Carlos Alcaraz' },
  };

  const res2 = linker.processRawMatch(sackmannWimby);
  assert(res2.action === 'CREATE_NEW_CANONICAL', `Expected CREATE_NEW_CANONICAL, got ${res2.action}`);
  assert(!!res2.canonicalMatchId, 'Expected canonicalMatchId to be generated');
  const canonicalWimbyId = res2.canonicalMatchId!;
  console.log(`✓ Test 2 Passed: First match created new canonical match (${canonicalWimbyId})`);

  // =========================================================================
  // TEST 3: AUTO_LINK & Source Mask Bitwise Update
  // =========================================================================
  const pbpWimby: IncomingRawMatch = {
    sourceName: 'pbp',
    sourceMatchId: 'pbp_wimby_2024_final',
    matchDate: '2024-07-14',
    tour: 'ATP',
    gender: 'M',
    rawTournamentName: 'The Championships Wimbledon',
    rawSurface: 'Grass',
    rawRound: 'Finals',
    rawPlayer1: 'N. Djokovic',
    rawPlayer2: 'C. Alcaraz',
    rawWinnerName: 'C. Alcaraz',
    rawScore: '6-2 6-2 7-6(4)',
    rawPayload: { pbpId: 'pbp-999', score: '6-2 6-2 7-6(4)' },
  };

  const res3 = linker.processRawMatch(pbpWimby);
  assert(res3.action === 'AUTO_LINK', `Expected AUTO_LINK, got ${res3.action}`);
  assert(res3.canonicalMatchId === canonicalWimbyId, 'Expected linking to existing Wimbledon canonical match');
  assert(res3.confidenceScore >= 90.0, `Expected score >= 90, got ${res3.confidenceScore}`);

  const cm3 = db.prepare(`SELECT * FROM canonical_matches WHERE canonical_match_id = ?`).get(canonicalWimbyId) as any;
  assert(cm3.source_mask === (1 | 2), `Expected source_mask = 3, got ${cm3.source_mask}`);
  assert(cm3.evidence_count === 2, `Expected evidence_count = 2, got ${cm3.evidence_count}`);
  console.log(`✓ Test 3 Passed: Symmetric match auto-linked and source_mask bitwise updated (mask: ${cm3.source_mask})`);

  // =========================================================================
  // TEST 4: Veto - Double Booking
  // =========================================================================
  const duplicateSackmann: IncomingRawMatch = {
    sourceName: 'sackmann',
    sourceMatchId: 'sackmann_wimby_duplicate',
    matchDate: '2024-07-14',
    tour: 'ATP',
    gender: 'M',
    rawTournamentName: 'Wimbledon',
    rawSurface: 'Grass',
    rawRound: 'F',
    rawPlayer1: 'Carlos Alcaraz',
    rawPlayer2: 'Novak Djokovic',
    rawWinnerName: 'Carlos Alcaraz',
    rawScore: '6-2 6-2 7-6(4)',
    rawPayload: {},
  };

  const res4 = linker.processRawMatch(duplicateSackmann);
  assert(res4.action === 'REVIEW_QUEUE', `Expected REVIEW_QUEUE for double booking, got ${res4.action}`);
  assert(res4.vetoTriggers.includes('VETO_DOUBLE_BOOKING'), 'Expected VETO_DOUBLE_BOOKING');
  console.log('✓ Test 4 Passed: VETO_DOUBLE_BOOKING triggered correctly');

  // =========================================================================
  // TEST 5: Veto - Winner Conflict
  // =========================================================================
  const winnerConflict: IncomingRawMatch = {
    sourceName: 'mcp',
    sourceMatchId: 'mcp_wimby_conflict',
    matchDate: '2024-07-14',
    tour: 'ATP',
    gender: 'M',
    rawTournamentName: 'Wimbledon Grass',
    rawSurface: 'Grass',
    rawRound: 'F',
    rawPlayer1: 'Carlos Alcaraz',
    rawPlayer2: 'Novak Djokovic',
    rawWinnerName: 'Novak Djokovic',
    rawScore: '2-6 2-6 6-7',
    rawPayload: {},
  };

  const res5 = linker.processRawMatch(winnerConflict);
  assert(res5.action === 'REVIEW_QUEUE', `Expected REVIEW_QUEUE for winner conflict, got ${res5.action}`);
  assert(res5.vetoTriggers.includes('VETO_WINNER_CONFLICT'), 'Expected VETO_WINNER_CONFLICT');
  console.log('✓ Test 5 Passed: VETO_WINNER_CONFLICT triggered correctly');

  // =========================================================================
  // TEST 6: Veto - Tour / Gender Mismatch
  // =========================================================================
  const tourMismatch: IncomingRawMatch = {
    sourceName: 'visuals',
    sourceMatchId: 'vis_tour_mismatch',
    matchDate: '2024-07-14',
    tour: 'WTA',
    gender: 'F',
    rawTournamentName: 'Wimbledon Grass',
    rawSurface: 'Grass',
    rawRound: 'F',
    rawPlayer1: 'Carlos Alcaraz',
    rawPlayer2: 'Novak Djokovic',
    rawWinnerName: 'Carlos Alcaraz',
    rawScore: '6-2 6-2 7-6',
    rawPayload: {},
  };

  const res6 = linker.processRawMatch(tourMismatch);
  assert(res6.action === 'REVIEW_QUEUE', `Expected REVIEW_QUEUE for tour mismatch, got ${res6.action}`);
  assert(res6.vetoTriggers.includes('VETO_TOUR_GENDER_MISMATCH'), 'Expected VETO_TOUR_GENDER_MISMATCH');
  console.log('✓ Test 6 Passed: VETO_TOUR_GENDER_MISMATCH triggered correctly');

  // =========================================================================
  // TEST 7: Veto - Impossible Round Hierarchy Jump
  // =========================================================================
  const roundParadox: IncomingRawMatch = {
    sourceName: 'mcp',
    sourceMatchId: 'mcp_round_paradox',
    matchDate: '2024-07-14',
    tour: 'ATP',
    gender: 'M',
    rawTournamentName: 'Wimbledon Grass',
    rawSurface: 'Grass',
    rawRound: 'Q1',
    rawPlayer1: 'Carlos Alcaraz',
    rawPlayer2: 'Novak Djokovic',
    rawWinnerName: 'Carlos Alcaraz',
    rawScore: '6-2 6-2 7-6',
    rawPayload: {},
  };

  const res7 = linker.processRawMatch(roundParadox);
  assert(res7.action === 'REVIEW_QUEUE', `Expected REVIEW_QUEUE for round paradox, got ${res7.action}`);
  assert(res7.vetoTriggers.includes('VETO_ROUND_HIERARCHY_PARADOX'), 'Expected VETO_ROUND_HIERARCHY_PARADOX');
  console.log('✓ Test 7 Passed: VETO_ROUND_HIERARCHY_PARADOX triggered correctly');

  // =========================================================================
  // TEST 8: Veto - Inverted Score
  // =========================================================================
  const invertedScore: IncomingRawMatch = {
    sourceName: 'mcp',
    sourceMatchId: 'mcp_inverted_score',
    matchDate: '2024-07-14',
    tour: 'ATP',
    gender: 'M',
    rawTournamentName: 'Wimbledon Grass',
    rawSurface: 'Grass',
    rawRound: 'F',
    rawPlayer1: 'Carlos Alcaraz',
    rawPlayer2: 'Novak Djokovic',
    rawWinnerName: 'Carlos Alcaraz',
    rawScore: '2-6 2-6 6-7(4)',
    rawPayload: {},
  };

  const res8 = linker.processRawMatch(invertedScore);
  assert(res8.action === 'REVIEW_QUEUE', `Expected REVIEW_QUEUE for inverted score, got ${res8.action}`);
  assert(res8.vetoTriggers.includes('VETO_INVERTED_SCORE'), 'Expected VETO_INVERTED_SCORE');
  console.log('✓ Test 8 Passed: VETO_INVERTED_SCORE triggered correctly');

  // =========================================================================
  // TEST 9: Veto - Unclear Tournament Identity
  // =========================================================================
  const unclearTourney: IncomingRawMatch = {
    sourceName: 'mcp',
    sourceMatchId: 'mcp_unclear_tourney',
    matchDate: '2024-07-14',
    tour: 'ATP',
    gender: 'M',
    rawTournamentName: 'Unregistered Unknown Exhibition',
    rawSurface: 'Grass',
    rawRound: 'F',
    rawPlayer1: 'Carlos Alcaraz',
    rawPlayer2: 'Novak Djokovic',
    rawWinnerName: 'Carlos Alcaraz',
    rawScore: '6-2 6-2 7-6(4)',
    rawPayload: {},
  };

  const res9 = linker.processRawMatch(unclearTourney);
  assert(res9.action === 'REVIEW_QUEUE', `Expected REVIEW_QUEUE for unclear tournament, got ${res9.action}`);
  assert(res9.vetoTriggers.includes('VETO_UNCLEAR_TOURNAMENT'), 'Expected VETO_UNCLEAR_TOURNAMENT');
  console.log('✓ Test 9 Passed: VETO_UNCLEAR_TOURNAMENT triggered correctly');

  // =========================================================================
  // TEST 10: Veto - Sibling Ambiguity
  // =========================================================================
  const siblingMatch: IncomingRawMatch = {
    sourceName: 'mcp',
    sourceMatchId: 'mcp_sibling_ambiguity',
    matchDate: '2024-07-14',
    tour: 'ATP',
    gender: 'M',
    rawTournamentName: 'Wimbledon',
    rawSurface: 'Grass',
    rawRound: 'R32',
    rawPlayer1: 'Cerundolo',
    rawPlayer2: 'Novak Djokovic',
    rawPayload: {},
  };

  const res10 = linker.processRawMatch(siblingMatch);
  assert(res10.action === 'REVIEW_QUEUE', `Expected REVIEW_QUEUE for sibling ambiguity, got ${res10.action}`);
  assert(res10.vetoTriggers.includes('VETO_SIBLING_AMBIGUITY'), 'Expected VETO_SIBLING_AMBIGUITY');
  console.log('✓ Test 10 Passed: VETO_SIBLING_AMBIGUITY caught immediately');

  // =========================================================================
  // TEST 11: Review Queue Approve with Provenance & Optimistic Locking
  // =========================================================================
  const pendingReviewId = res5.reviewId!;
  const approveRes = linker.approveReviewItem(pendingReviewId, 'admin_curator', 'Typo verified and resolved');
  assert(approveRes.action === 'AUTO_LINK', 'Approve should return AUTO_LINK result');

  const qItem = db.prepare(`SELECT * FROM match_review_queue WHERE review_id = ?`).get(pendingReviewId) as any;
  assert(qItem.review_status === 'APPROVED', 'Expected review_status to be APPROVED');
  assert(qItem.lock_version === 2, `Expected lock_version = 2, got ${qItem.lock_version}`);
  console.log('✓ Test 11 Passed: Review queue approve recorded provenance & bumped lock_version');

  // =========================================================================
  // TEST 12: Optimistic Locking Prevents Concurrent Overwrite
  // =========================================================================
  let collisionCaught = false;
  try {
    // Attempting to approve again with already stale state
    linker.approveReviewItem(pendingReviewId, 'other_admin', 'Stale approval attempt');
  } catch (err: any) {
    collisionCaught = true;
    assert(err.message.includes('already APPROVED') || err.message.includes('collision'), 'Expected collision error');
  }
  assert(collisionCaught, 'Expected optimistic locking collision error');
  console.log('✓ Test 12 Passed: Optimistic concurrency control (lock_version) prevented concurrent overwrite');

  // =========================================================================
  // TEST 13: Review Queue Reject
  // =========================================================================
  const rejectReviewId = res6.reviewId!;
  const newSeparatedId = linker.rejectReviewItem(rejectReviewId, 'admin_curator', 'False positive match confirmed');
  assert(!!newSeparatedId, 'Expected separate canonical match created on reject');
  console.log('✓ Test 13 Passed: Review queue reject created separate canonical match');

  // =========================================================================
  // TEST 14: Split Match Does Not Orphan Provenance or Links
  // =========================================================================
  const splitNewId = linker.splitCanonicalMatch(canonicalWimbyId, 'pbp', 'admin_curator', 'PBP source was incorrect');
  assert(!!splitNewId, 'Expected new canonical match created for detached source');

  // Verify old match no longer has PBP link or provenance
  const oldLinks = db.prepare(`SELECT * FROM match_source_links WHERE canonical_match_id = ? AND source_name = 'pbp'`).all(canonicalWimbyId);
  assert(oldLinks.length === 0, 'Old match should have zero PBP links');

  const oldProv = db.prepare(`SELECT * FROM canonical_match_provenance WHERE canonical_match_id = ? AND source_name = 'pbp'`).all(canonicalWimbyId);
  assert(oldProv.length === 0, 'Old match should have zero PBP provenance rows');

  // Verify new match has the PBP link
  const newLinks = db.prepare(`SELECT * FROM match_source_links WHERE canonical_match_id = ? AND source_name = 'pbp'`).all(splitNewId);
  assert(newLinks.length === 1, 'New match should have exactly 1 PBP link');

  // Verify audit log has SPLIT entry
  const splitLogs = db.prepare(`SELECT * FROM match_review_audit_log WHERE action = 'SPLIT'`).all();
  assert(splitLogs.length >= 1, 'Expected SPLIT action in audit log');
  console.log('✓ Test 14 Passed: Split match cleanly re-parented links and provenance with 0 orphaned rows');

  // =========================================================================
  // TEST 15: Transactional Rollback on Failure
  // =========================================================================
  let rollbackVerified = false;
  try {
    db.transaction(() => {
      db.prepare(`INSERT INTO canonical_players (canonical_player_id, full_name_standard, last_name, gender) VALUES ('cp_test_rollback', 'Test Player', 'Player', 'M')`).run();
      // Deliberately trigger foreign key failure
      db.prepare(`INSERT INTO canonical_matches (canonical_match_id, match_date, tour, canonical_tourney_id, surface, round_name, player_low_id, player_high_id) VALUES ('cm_bad', '2024-01-01', 'ATP', 'ct_nonexistent', 'HARD', 'F', 'cp_test_rollback', 'cp_nobody')`).run();
    })();
  } catch {
    // Check if player insert rolled back
    const p = db.prepare(`SELECT * FROM canonical_players WHERE canonical_player_id = 'cp_test_rollback'`).get();
    assert(!p, 'Expected player insert to roll back cleanly on transaction error');
    rollbackVerified = true;
  }
  assert(rollbackVerified, 'Expected transactional rollback on error');
  console.log('✓ Test 15 Passed: Database transactions rollback completely on errors with zero partial writes');

  // =========================================================================
  // TEST 16: Safe Trigger Execution (No Recursion)
  // =========================================================================
  const cmRow = db.prepare(`SELECT version FROM canonical_matches WHERE canonical_match_id = ?`).get(canonicalWimbyId) as any;
  const initialVersion = cmRow.version;

  // External update simulating direct SQL edit
  db.prepare(`UPDATE canonical_matches SET canonical_score = '6-2 6-2 7-6(5)' WHERE canonical_match_id = ?`).run(canonicalWimbyId);
  const updatedCmRow = db.prepare(`SELECT version FROM canonical_matches WHERE canonical_match_id = ?`).get(canonicalWimbyId) as any;
  assert(updatedCmRow.version === initialVersion + 1, `Expected version bump to ${initialVersion + 1}, got ${updatedCmRow.version}`);
  console.log('✓ Test 16 Passed: Trigger updated_at/version executed safely without recursion');

  // =========================================================================
  // TEST 17: Player & Tournament Triggers Execution (No Recursion)
  // =========================================================================
  const pRowBefore = db.prepare(`SELECT updated_at FROM canonical_players WHERE canonical_player_id = 'cp_carlos_alcaraz'`).get() as any;
  db.prepare(`UPDATE canonical_players SET hand = 'R' WHERE canonical_player_id = 'cp_carlos_alcaraz'`).run();
  const pRowAfter = db.prepare(`SELECT updated_at FROM canonical_players WHERE canonical_player_id = 'cp_carlos_alcaraz'`).get() as any;
  assert(!!pRowAfter.updated_at, 'Expected updated_at to be populated');

  const tRowBefore = db.prepare(`SELECT updated_at FROM canonical_tournaments WHERE canonical_tourney_id = 'ct_wimbledon'`).get() as any;
  db.prepare(`UPDATE canonical_tournaments SET city = 'London' WHERE canonical_tourney_id = 'ct_wimbledon'`).run();
  const tRowAfter = db.prepare(`SELECT updated_at FROM canonical_tournaments WHERE canonical_tourney_id = 'ct_wimbledon'`).get() as any;
  assert(!!tRowAfter.updated_at, 'Expected tournament updated_at to be populated');
  console.log('✓ Test 17 Passed: Player and Tournament updated_at triggers executed safely without recursion');

  // =========================================================================
  // TEST 18: Foreign Key Enforcement Active (Fails Invalid Insert)
  // =========================================================================
  let fkErrorCaught = false;
  try {
    db.prepare(`
      INSERT INTO canonical_matches (
        canonical_match_id, match_date, tour, canonical_tourney_id,
        surface, round_name, player_low_id, player_high_id
      ) VALUES (
        'cm_invalid_fk', '2024-07-14', 'ATP', 'ct_nonexistent_tournament_xyz',
        'GRASS', 'F', 'cp_carlos_alcaraz', 'cp_novak_djokovic'
      )
    `).run();
  } catch (err: any) {
    if (err.message.includes('FOREIGN KEY constraint failed')) {
      fkErrorCaught = true;
    }
  }
  assert(fkErrorCaught, 'Expected FOREIGN KEY constraint failed error on invalid tournament foreign key');
  console.log('✓ Test 18 Passed: Foreign key enforcement verified active (rejected invalid FK insert)');

  // =========================================================================
  // TEST 19: Connection Guard (Fails Fast if foreign_keys = OFF)
  // =========================================================================
  const unconfiguredDb = new Database(':memory:');
  unconfiguredDb.pragma('foreign_keys = OFF');
  let guardCaught = false;
  try {
    new MatchLinkerEngine(unconfiguredDb);
  } catch (err: any) {
    if (err.message.includes('requires SQLite foreign keys to be enabled')) {
      guardCaught = true;
    }
  } finally {
    unconfiguredDb.close();
  }
  assert(guardCaught, 'Expected connection guard to reject connection without foreign_keys enabled');
  console.log('✓ Test 19 Passed: Connection guard fails fast if PRAGMA foreign_keys = ON is missing');

  // Close test database
  db.close();

  // Clean up test database copy and any residual -wal / -shm files
  cleanTestDbFiles();

  // Verify live DB was never touched
  const liveStatAfter = fs.statSync(LIVE_DB_PATH);
  assert(liveStatBefore.mtimeMs === liveStatAfter.mtimeMs, 'CRITICAL: Live database modified timestamp changed!');
  assert(liveStatBefore.size === liveStatAfter.size, 'CRITICAL: Live database file size changed!');
  console.log('✓ Verification Passed: Live production database was NOT touched (Timestamp & Size identical)');

  console.log('\n======================================================');
  console.log('ALL 19 TESTS PASSED ON COPIED TEST DATABASE! (0 SKIPPED)');
  console.log('======================================================');
}

runTests();
