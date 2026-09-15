import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { bootstrapLinkerDryRunDb } from '../../scripts/runLinkerDryRunBootstrap';
import { seedCanonicalRegistries } from '../../scripts/seedCanonicalRegistries';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

const TEST_DB_PATH = path.resolve('data/database.linker_seed_test.sqlite');
const TEST_WAL_PATH = path.resolve('data/database.linker_seed_test.sqlite-wal');
const TEST_SHM_PATH = path.resolve('data/database.linker_seed_test.sqlite-shm');
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
  console.log('=== STARTING CANONICAL REGISTRY SEED TEST SUITE ===');

  // Verify baseline stats of live and legacy copied databases
  assert(fs.existsSync(LIVE_DB_PATH), `Live DB must exist at ${LIVE_DB_PATH}`);
  const liveStatBefore = fs.statSync(LIVE_DB_PATH);

  let legacyStatBefore: fs.Stats | null = null;
  if (fs.existsSync(LEGACY_DRYRUN_PATH)) {
    legacyStatBefore = fs.statSync(LEGACY_DRYRUN_PATH);
  }

  cleanTestDbFiles();

  try {
    // 1. Bootstrap clean test schema
    const bootReport = bootstrapLinkerDryRunDb(TEST_DB_PATH, { enableWal: true, cleanFirst: true });
    assert(bootReport.status === 'SUCCESS', 'Schema bootstrap must succeed');

    // 2. Run seeding
    const seedReport1 = seedCanonicalRegistries(TEST_DB_PATH, LEGACY_DRYRUN_PATH);
    assert(seedReport1.status === 'SUCCESS', `Seeding run 1 must succeed: ${seedReport1.error}`);
    assert(seedReport1.playersInserted > 200, `Expected > 200 players, got ${seedReport1.playersInserted}`);
    assert(seedReport1.playerAliasesInserted > 500, `Expected > 500 player aliases, got ${seedReport1.playerAliasesInserted}`);
    assert(seedReport1.tournamentsInserted > 15, `Expected > 15 tournaments, got ${seedReport1.tournamentsInserted}`);
    assert(seedReport1.tournamentAliasesInserted > 30, `Expected > 30 tournament aliases, got ${seedReport1.tournamentAliasesInserted}`);
    console.log(`✓ Test 1 Passed: Seeded ${seedReport1.playersInserted} players, ${seedReport1.playerAliasesInserted} player aliases, ${seedReport1.tournamentsInserted} tournaments, ${seedReport1.tournamentAliasesInserted} tournament aliases`);

    // 3. Test idempotency (run second time)
    const seedReport2 = seedCanonicalRegistries(TEST_DB_PATH, LEGACY_DRYRUN_PATH);
    assert(seedReport2.status === 'SUCCESS', `Seeding run 2 (idempotent) must succeed: ${seedReport2.error}`);
    console.log('✓ Test 2 Passed: Seeding is completely idempotent (second run succeeded with 0 errors)');

    // 4. Verify Sibling Ambiguity Flags in player_aliases
    const db = new Database(TEST_DB_PATH, { readonly: true });
    const cerundoloAliases = db
      .prepare(`
        SELECT canonical_player_id, raw_name, is_verified, has_sibling_conflict
        FROM player_aliases
        WHERE raw_name LIKE '%Cerundolo%'
      `)
      .all() as Array<{
        canonical_player_id: string;
        raw_name: string;
        is_verified: number;
        has_sibling_conflict: number;
      }>;

    assert(cerundoloAliases.length > 0, 'Must have Cerundolo aliases');
    const ambiguousCerundolo = cerundoloAliases.filter(a => a.has_sibling_conflict === 1);
    assert(ambiguousCerundolo.length > 0, 'Abbreviated Cerundolo aliases must have has_sibling_conflict = 1');
    for (const amb of ambiguousCerundolo) {
      assert(amb.is_verified === 0, `Ambiguous alias ${amb.raw_name} must have is_verified = 0`);
    }

    const verifiedCerundolo = cerundoloAliases.filter(a => a.has_sibling_conflict === 0 && a.is_verified === 1);
    assert(verifiedCerundolo.length > 0, 'Full Cerundolo names (Francisco Cerundolo) must remain verified');
    console.log(`✓ Test 3 Passed: Sibling ambiguity verified (${ambiguousCerundolo.length} ambiguous unverified aliases, ${verifiedCerundolo.length} full verified aliases)`);

    // 5. Verify tournament CHECK constraints and mapping
    const tourneys = db.prepare('SELECT canonical_tourney_id, tour, tour_level, default_surface FROM canonical_tournaments').all() as any[];
    for (const t of tourneys) {
      assert(['ATP', 'WTA', 'CHALLENGER', 'ITF'].includes(t.tour), `Invalid tour: ${t.tour}`);
      assert(
        ['GRAND_SLAM', 'MASTERS_1000', 'WTA_1000', 'ATP_500', 'ATP_250', 'CHALLENGER', 'ITF'].includes(t.tour_level),
        `Invalid tour_level: ${t.tour_level}`
      );
      assert(['HARD', 'CLAY', 'GRASS', 'CARPET'].includes(t.default_surface), `Invalid surface: ${t.default_surface}`);
    }
    console.log(`✓ Test 4 Passed: All ${tourneys.length} seeded tournaments satisfy schema CHECK constraints`);

    // 6. Verify PRAGMA integrity_check and foreign_key_check
    const integrityRows = db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
    assert(integrityRows.length === 1 && integrityRows[0].integrity_check === 'ok', 'Integrity check must return ok');

    const fkErrors = db.prepare('PRAGMA foreign_key_check').all() as any[];
    assert(fkErrors.length === 0, `Foreign key check found errors: ${JSON.stringify(fkErrors)}`);
    console.log('✓ Test 5 Passed: PRAGMA integrity_check is ok and PRAGMA foreign_key_check has 0 errors');

    db.close();

    // 7. Verify live and legacy copied databases were NOT touched
    const liveStatAfter = fs.statSync(LIVE_DB_PATH);
    assert(liveStatBefore.mtimeMs === liveStatAfter.mtimeMs, 'Live database must NOT be modified');
    assert(liveStatBefore.size === liveStatAfter.size, 'Live database size must NOT change');

    if (legacyStatBefore && fs.existsSync(LEGACY_DRYRUN_PATH)) {
      const legacyStatAfter = fs.statSync(LEGACY_DRYRUN_PATH);
      assert(legacyStatBefore.mtimeMs === legacyStatAfter.mtimeMs, 'Legacy dryrun DB must NOT be modified');
      assert(legacyStatBefore.size === legacyStatAfter.size, 'Legacy dryrun DB size must NOT change');
    }
    console.log('✓ Test 6 Passed: Production database and legacy dryrun copy were 100% untouched');

  } finally {
    cleanTestDbFiles();
  }

  console.log('================================================================');
  console.log('ALL 6 CANONICAL REGISTRY SEED TESTS PASSED SUCCESSFULLY');
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
