import path from 'path';
import fs from 'fs';
import http from 'http';
import express from 'express';
import Database from 'better-sqlite3';
import { initCanonicalLinkerSchema, configureLinkerConnection } from '../schema';
import { getLinkerDryRunDb, closeLinkerDryRunDb } from '../linkerDb';
import { ReviewQueueService } from '../reviewQueueService';
import { linkerAdminRoutes } from '../../routes/linkerAdmin.routes';
import { ENV } from '../../config/env';

const TEST_SECRET = ENV.ADMIN_SECRET || 'ptin-local-dev-admin-key';

const TEST_DB_PATH = path.resolve('data/test_linker_admin_api.sqlite');
const LIVE_DB_PATH = path.resolve('data/database.sqlite');
const DRYRUN_DB_PATH = path.resolve('data/database.linker_dryrun.sqlite');

interface TestAssertionResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestAssertionResult[] = [];

async function assertTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    results.push({ name, passed: false, error: err.message });
    console.error(`  ❌ ${name}: ${err.message}`);
  }
}

async function request(
  baseUrl: string,
  method: string,
  urlPath: string,
  options: {
    secret?: string;
    authHeader?: string;
    body?: any;
  } = {}
) {
  const headers: Record<string, string> = {};
  if (options.secret !== undefined) {
    headers['x-admin-secret'] = options.secret;
  }
  if (options.authHeader !== undefined) {
    headers['Authorization'] = options.authHeader;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return { status: res.status, headers: res.headers, text, json };
}

function setupTestDatabase(dbPath: string): Database.Database {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbPath + suffix;
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch {}
    }
  }

  const db = new Database(dbPath);
  initCanonicalLinkerSchema(db);

  // 1. Seed players
  db.exec(`
    INSERT INTO canonical_players (canonical_player_id, full_name_standard, last_name, gender) VALUES
    ('cp_carlos_alcaraz', 'Carlos Alcaraz', 'Alcaraz', 'M'),
    ('cp_jannik_sinner', 'Jannik Sinner', 'Sinner', 'M'),
    ('cp_daniil_medvedev', 'Daniil Medvedev', 'Medvedev', 'M'),
    ('cp_alexander_zverev', 'Alexander Zverev', 'Zverev', 'M');

    INSERT INTO canonical_tournaments (canonical_tourney_id, name_standard, tour, tour_level, default_surface) VALUES
    ('ct_us_open', 'US Open', 'ATP', 'GRAND_SLAM', 'HARD'),
    ('ct_roland_garros', 'Roland Garros', 'ATP', 'GRAND_SLAM', 'CLAY');
  `);

  // 2. Seed a Canonical Match with multiple linked sources for split testing
  db.exec(`
    INSERT INTO canonical_matches (
      canonical_match_id, match_date, tour, canonical_tourney_id, surface, round_name,
      player_low_id, player_high_id, match_status, winner_canonical_id, canonical_score,
      source_mask, evidence_count, version
    ) VALUES (
      'cm_2024-09-08_usopen_alcaraz_sinner', '2024-09-08', 'ATP', 'ct_us_open', 'HARD', 'F',
      'cp_carlos_alcaraz', 'cp_jannik_sinner', 'FINISHED', 'cp_carlos_alcaraz', '6-2 3-6 6-4',
      3, 2, 1
    );

    INSERT INTO raw_source_evidence (evidence_id, source_name, source_match_id, raw_payload_json, payload_sha256) VALUES
    (101, 'sackmann', 'sackmann_usopen_f', '{"date":"2024-09-08","tour":"ATP","tournament":"US Open","player1":"Carlos Alcaraz","player2":"Jannik Sinner","score":"6-2 3-6 6-4","winnerName":"Carlos Alcaraz"}', 'hash_sackmann_101'),
    (102, 'pbp', 'pbp_usopen_f', '{"date":"2024-09-08","tour":"ATP","tournament":"US Open","player1":"Carlos Alcaraz","player2":"Jannik Sinner","score":"6-2 3-6 6-4","winnerName":"Carlos Alcaraz"}', 'hash_pbp_102');

    INSERT INTO match_source_links (
      canonical_match_id, source_name, source_match_id, evidence_id, confidence_score, scorer_version, rule_version, link_status
    ) VALUES
    ('cm_2024-09-08_usopen_alcaraz_sinner', 'sackmann', 'sackmann_usopen_f', 101, 100.0, 'v2.1.0', 'v2.1.0', 'AUTO_LINKED'),
    ('cm_2024-09-08_usopen_alcaraz_sinner', 'pbp', 'pbp_usopen_f', 102, 95.0, 'v2.1.0', 'v2.1.0', 'AUTO_LINKED');

    INSERT INTO canonical_match_provenance (
      canonical_match_id, field_name, source_name, source_match_id, evidence_id, raw_value, value_hash, priority_weight, confidence, rule_version
    ) VALUES
    ('cm_2024-09-08_usopen_alcaraz_sinner', 'canonical_score', 'sackmann', 'sackmann_usopen_f', 101, '6-2 3-6 6-4', 'hash_sc_101', 50, 1.0, 'v2.1.0'),
    ('cm_2024-09-08_usopen_alcaraz_sinner', 'canonical_score', 'pbp', 'pbp_usopen_f', 102, '6-2 3-6 6-4', 'hash_sc_102', 40, 1.0, 'v2.1.0');
  `);

  // 3. Seed pending review queue items
  db.exec(`
    -- Evidence for review queue items
    INSERT INTO raw_source_evidence (evidence_id, source_name, source_match_id, raw_payload_json, payload_sha256) VALUES
    (201, 'pbp', 'pbp_rg_sf_pending', '{"date":"2024-06-07","tour":"ATP","tournament":"Roland Garros","player1":"Carlos Alcaraz","player2":"Jannik Sinner","score":"2-6 6-3 3-6 6-4 6-3","winnerName":"Carlos Alcaraz"}', 'hash_evidence_201'),
    (202, 'flashscore', 'flashscore_rg_sf_reject', '{"date":"2024-06-07","tour":"ATP","tournament":"Roland Garros","player1":"Alexander Zverev","player2":"Daniil Medvedev","score":"6-3 7-6 6-2","winnerName":"Alexander Zverev"}', 'hash_evidence_202');

    -- Canonical match candidate for item 1
    INSERT INTO canonical_matches (
      canonical_match_id, match_date, tour, canonical_tourney_id, surface, round_name,
      player_low_id, player_high_id, match_status, winner_canonical_id, canonical_score,
      source_mask, evidence_count, version
    ) VALUES (
      'cm_2024-06-07_rg_alcaraz_sinner', '2024-06-07', 'ATP', 'ct_roland_garros', 'CLAY', 'SF',
      'cp_carlos_alcaraz', 'cp_jannik_sinner', 'FINISHED', 'cp_carlos_alcaraz', '2-6 6-3 3-6 6-4 6-3',
      1, 1, 1
    );

    -- Review item 1: Pending candidate match for approve test
    INSERT INTO match_review_queue (
      review_id, candidate_canonical_id, incoming_source, incoming_source_id, incoming_evidence_id,
      confidence_score, scorer_version, rule_version, evidence_hash,
      veto_triggers_json, divergent_fields_json, review_status, lock_version
    ) VALUES (
      1, 'cm_2024-06-07_rg_alcaraz_sinner', 'pbp', 'pbp_rg_sf_pending', 201,
      82.5, 'v2.1.0', 'v2.1.0', 'hash_evidence_201',
      '["VETO_UNCLEAR_TOURNAMENT"]', '{"tournament":{"incoming":"Roland Garros","candidate":"French Open"}}', 'PENDING', 1
    );

    -- Review item 2: Pending candidate match for reject test
    INSERT INTO match_review_queue (
      review_id, candidate_canonical_id, incoming_source, incoming_source_id, incoming_evidence_id,
      confidence_score, scorer_version, rule_version, evidence_hash,
      veto_triggers_json, divergent_fields_json, review_status, lock_version
    ) VALUES (
      2, 'cm_2024-06-07_rg_alcaraz_sinner', 'flashscore', 'flashscore_rg_sf_reject', 202,
      71.0, 'v2.1.0', 'v2.1.0', 'hash_evidence_202',
      '["VETO_SCORE_INVERTED"]', '{"winner":{"incoming":"Alexander Zverev","candidate":"Carlos Alcaraz"}}', 'PENDING', 1
    );
  `);

  return db;
}

async function runTestSuite() {
  console.log('\n======================================================');
  console.log('   LINKER ADMIN REVIEW QUEUE INTEGRATION TEST SUITE   ');
  console.log('======================================================\n');

  // Safety Check: Baseline live DB verification
  const liveStatsBefore = fs.statSync(LIVE_DB_PATH);
  console.log(`[Safety Guard] Production DB baseline check:`);
  console.log(`  Path: ${LIVE_DB_PATH}`);
  console.log(`  Size: ${liveStatsBefore.size} bytes`);
  console.log(`  Last modified: ${liveStatsBefore.mtime.toISOString()}\n`);

  // Setup isolated test database
  const testDb = setupTestDatabase(TEST_DB_PATH);
  const testService = new ReviewQueueService(testDb);

  // Setup express server binding controller to the test database
  const app = express();
  app.use(express.json());

  // Mount admin routes with dependency-injected testDb
  app.get('/api/admin/linker/review-queue', (req, res) => {
    const status = req.query.status as any;
    const source = req.query.source as string | undefined;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;
    res.json({ success: true, data: testService.listItems({ status, source, limit, offset }) });
  });

  app.get('/api/admin/linker/review-queue/:reviewId', (req, res) => {
    try {
      const reviewId = parseInt(String(req.params.reviewId), 10);
      res.json({ success: true, data: testService.getItemById(reviewId) });
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/admin/linker/review-queue/:reviewId/approve', (req, res) => {
    try {
      const reviewId = parseInt(String(req.params.reviewId), 10);
      const expectedLockVersion = req.body.expected_lock_version ?? req.body.lock_version;
      if (expectedLockVersion === undefined) {
        return res.status(400).json({ success: false, error: 'expected_lock_version is required' });
      }
      const result = testService.approve(reviewId, {
        expectedLockVersion,
        targetCanonicalId: req.body.target_canonical_id,
        actor: req.body.actor,
        reason: req.body.reason,
      });
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/admin/linker/review-queue/:reviewId/reject', (req, res) => {
    try {
      const reviewId = parseInt(String(req.params.reviewId), 10);
      const expectedLockVersion = req.body.expected_lock_version ?? req.body.lock_version;
      if (expectedLockVersion === undefined) {
        return res.status(400).json({ success: false, error: 'expected_lock_version is required' });
      }
      const result = testService.reject(reviewId, {
        expectedLockVersion,
        actor: req.body.actor,
        reason: req.body.reason,
      });
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/admin/linker/matches/:canonicalMatchId/split', (req, res) => {
    try {
      const canonicalMatchId = String(req.params.canonicalMatchId);
      const sourceToDetach = req.body.source_to_detach || req.body.sourceToDetach;
      const reason = req.body.reason;
      const expectedVersion = req.body.expected_version ?? req.body.version;

      if (!sourceToDetach || !reason) {
        return res.status(400).json({ success: false, error: 'source_to_detach and reason are required' });
      }

      const result = testService.split(canonicalMatchId, {
        sourceToDetach,
        reason,
        expectedVersion,
        actor: req.body.actor,
      });
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/admin/linker/audit-logs', (req, res) => {
    const reviewId = req.query.review_id ? parseInt(String(req.query.review_id), 10) : undefined;
    const action = req.query.action as string | undefined;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;
    res.json({ success: true, data: testService.getAuditLogs({ reviewId, action, limit, offset }) });
  });

  // Also mount the real linkerAdminRoutes under an Express router to test auth middleware
  const authProtectedApp = express();
  authProtectedApp.use(express.json());
  authProtectedApp.use('/api/admin/linker', linkerAdminRoutes);

  // Start test servers
  const server = http.createServer(app);
  const authServer = http.createServer(authProtectedApp);

  const port = 3456;
  const authPort = 3457;

  await new Promise<void>((resolve) => server.listen(port, resolve));
  await new Promise<void>((resolve) => authServer.listen(authPort, resolve));

  const baseUrl = `http://127.0.0.1:${port}`;
  const authBaseUrl = `http://127.0.0.1:${authPort}`;

  try {
    // ------------------------------------------------------------------------
    // 1. Connection Safety & Hard Guards
    // ------------------------------------------------------------------------
    console.log('[Phase 1: Connection Security & Guard Verification]');

    await assertTest('getLinkerDryRunDb throws security violation if pointed to live DB', () => {
      let threw = false;
      try {
        getLinkerDryRunDb(LIVE_DB_PATH);
      } catch (err: any) {
        threw = true;
        if (!err.message.includes('SECURITY VIOLATION')) {
          throw new Error(`Unexpected error message: ${err.message}`);
        }
      }
      if (!threw) throw new Error('Failed to throw error on live production DB path!');
    });

    await assertTest('getLinkerDryRunDb throws safety violation if pointed to legacy dry-run copy', () => {
      let threw = false;
      try {
        getLinkerDryRunDb(path.resolve('data/database.dryrun.sqlite'));
      } catch (err: any) {
        threw = true;
        if (!err.message.includes('SAFETY VIOLATION')) {
          throw new Error(`Unexpected error message: ${err.message}`);
        }
      }
      if (!threw) throw new Error('Failed to throw error on legacy dryrun DB path!');
    });

    // ------------------------------------------------------------------------
    // 2. Authentication & Authorization Guard Tests
    // ------------------------------------------------------------------------
    console.log('\n[Phase 2: Authentication & Authorization]');

    await assertTest('Unauthenticated request to /api/admin/linker/review-queue returns 401', async () => {
      const res = await request(authBaseUrl, 'GET', '/api/admin/linker/review-queue');
      if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
      if (!res.text.includes('Unauthorized')) throw new Error('Response body missing Unauthorized notice');
    });

    await assertTest('Request with invalid secret returns 401', async () => {
      const res = await request(authBaseUrl, 'GET', '/api/admin/linker/review-queue', {
        secret: 'invalid_forged_secret_value',
      });
      if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
    });

    await assertTest('Request with valid x-admin-secret header is accepted', async () => {
      const res = await request(authBaseUrl, 'GET', '/api/admin/linker/review-queue', {
        secret: TEST_SECRET,
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status} (${res.text})`);
    });

    await assertTest('Request with valid Bearer token in Authorization header is accepted', async () => {
      const res = await request(authBaseUrl, 'GET', '/api/admin/linker/review-queue', {
        authHeader: `Bearer ${TEST_SECRET}`,
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status} (${res.text})`);
    });

    // ------------------------------------------------------------------------
    // 3. Review Queue Query Operations
    // ------------------------------------------------------------------------
    console.log('\n[Phase 3: Review Queue Listing & Detail Operations]');

    await assertTest('List review queue items returns structured JSON with items and pagination', async () => {
      const res = await request(baseUrl, 'GET', '/api/admin/linker/review-queue');
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (!res.json?.success) throw new Error('Expected success=true');

      const data = res.json.data;
      if (!Array.isArray(data.items)) throw new Error('Expected items array');
      if (data.total !== 2) throw new Error(`Expected total=2, got ${data.total}`);

      const item1 = data.items.find((i: any) => i.review_id === 1);
      if (!item1) throw new Error('Review item #1 not found in list');

      // Verify parsed JSON fields
      if (!Array.isArray(item1.veto_triggers) || !item1.veto_triggers.includes('VETO_UNCLEAR_TOURNAMENT')) {
        throw new Error(`Expected veto_triggers to contain VETO_UNCLEAR_TOURNAMENT, got ${JSON.stringify(item1.veto_triggers)}`);
      }
      if (!item1.divergent_fields || typeof item1.divergent_fields !== 'object') {
        throw new Error('Expected divergent_fields object');
      }
      if (!item1.candidate_match || item1.candidate_match.canonical_match_id !== 'cm_2024-06-07_rg_alcaraz_sinner') {
        throw new Error(`Expected candidate match details attached, got ${JSON.stringify(item1.candidate_match)}`);
      }
    });

    await assertTest('Get single review item by ID returns full context', async () => {
      const res = await request(baseUrl, 'GET', '/api/admin/linker/review-queue/1');
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (res.json?.data?.review_id !== 1) throw new Error('Expected item 1');
      if (res.json?.data?.lock_version !== 1) throw new Error('Expected lock_version=1');
    });

    await assertTest('Get non-existent review item returns 404', async () => {
      const res = await request(baseUrl, 'GET', '/api/admin/linker/review-queue/99999');
      if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
    });

    // ------------------------------------------------------------------------
    // 4. Approve Action & Concurrency
    // ------------------------------------------------------------------------
    console.log('\n[Phase 4: Approve Action & Optimistic Concurrency]');

    await assertTest('Approve requires expected_lock_version (fails with 400)', async () => {
      const res = await request(baseUrl, 'POST', '/api/admin/linker/review-queue/1/approve', {
        body: { actor: 'admin_test' },
      });
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    });

    await assertTest('Approve with stale lock_version triggers 409 Conflict', async () => {
      const res = await request(baseUrl, 'POST', '/api/admin/linker/review-queue/1/approve', {
        body: { expected_lock_version: 99, actor: 'admin_test' },
      });
      if (res.status !== 409) throw new Error(`Expected 409, got ${res.status}`);
      if (!res.text.includes('Lock version conflict')) {
        throw new Error(`Expected Lock version conflict error, got ${res.text}`);
      }
    });

    await assertTest('Approve successfully links candidate, bumps lock_version, and records audit', async () => {
      const res = await request(baseUrl, 'POST', '/api/admin/linker/review-queue/1/approve', {
        body: {
          expected_lock_version: 1,
          actor: 'curator_alice',
          reason: 'Tournament name variation verified as Roland Garros',
        },
      });

      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status} (${res.text})`);
      if (res.json?.data?.status !== 'APPROVED') throw new Error('Expected status APPROVED');
      if (res.json?.data?.lockVersion !== 2) throw new Error('Expected lockVersion bumped to 2');

      // Verify database state
      const queueRow = testDb.prepare('SELECT * FROM match_review_queue WHERE review_id = 1').get() as any;
      if (queueRow.review_status !== 'APPROVED') throw new Error('DB status not APPROVED');
      if (queueRow.lock_version !== 2) throw new Error('DB lock_version not 2');
      if (queueRow.resolved_by !== 'curator_alice') throw new Error('DB resolved_by not curator_alice');

      // Verify link inserted with MANUAL_APPROVED
      const linkRow = testDb.prepare('SELECT * FROM match_source_links WHERE canonical_match_id = ? AND source_name = ?')
        .get('cm_2024-06-07_rg_alcaraz_sinner', 'pbp') as any;
      if (!linkRow) throw new Error('Source link not inserted');
      if (linkRow.link_status !== 'MANUAL_APPROVED') throw new Error(`Expected MANUAL_APPROVED, got ${linkRow.link_status}`);

      // Verify canonical match updated
      const matchRow = testDb.prepare('SELECT * FROM canonical_matches WHERE canonical_match_id = ?')
        .get('cm_2024-06-07_rg_alcaraz_sinner') as any;
      // bitmask 1 (sackmann) | 2 (pbp) = 3
      if (matchRow.source_mask !== 3) throw new Error(`Expected source_mask 3, got ${matchRow.source_mask}`);
      if (matchRow.evidence_count !== 2) throw new Error(`Expected evidence_count 2, got ${matchRow.evidence_count}`);

      // Verify field provenance recorded
      const provRow = testDb.prepare('SELECT * FROM canonical_match_provenance WHERE canonical_match_id = ? AND source_name = ?')
        .get('cm_2024-06-07_rg_alcaraz_sinner', 'pbp') as any;
      if (!provRow) throw new Error('Field provenance not recorded');

      // Verify audit log record using parameterized query
      const auditRow = testDb.prepare('SELECT * FROM match_review_audit_log WHERE review_id = ? AND action = ?').get(1, 'APPROVE') as any;
      if (!auditRow) throw new Error('Audit log entry not written');
      if (auditRow.actor !== 'curator_alice') throw new Error(`Audit actor mismatch: ${auditRow.actor}`);
      if (!auditRow.reason.includes('Roland Garros')) throw new Error('Audit reason mismatch');
    });

    await assertTest('Re-approving already approved item is idempotent (returns 200 with idempotent=true)', async () => {
      const res = await request(baseUrl, 'POST', '/api/admin/linker/review-queue/1/approve', {
        body: { expected_lock_version: 2, actor: 'curator_alice' },
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (!res.json?.data?.idempotent) throw new Error('Expected idempotent: true');
      if (res.json?.data?.status !== 'APPROVED') throw new Error('Expected status APPROVED');
    });

    // ------------------------------------------------------------------------
    // 5. Reject Action & Entity Separation
    // ------------------------------------------------------------------------
    console.log('\n[Phase 5: Reject Action & Entity Separation]');

    await assertTest('Reject with stale lock_version triggers 409 Conflict', async () => {
      const res = await request(baseUrl, 'POST', '/api/admin/linker/review-queue/2/reject', {
        body: { expected_lock_version: 99, actor: 'curator_bob' },
      });
      if (res.status !== 409) throw new Error(`Expected 409, got ${res.status}`);
    });

    await assertTest('Reject creates independent canonical match entity and writes REJECT audit', async () => {
      const res = await request(baseUrl, 'POST', '/api/admin/linker/review-queue/2/reject', {
        body: {
          expected_lock_version: 1,
          actor: 'curator_bob',
          reason: 'Match is Zverev vs Medvedev, completely different match from candidate Alcaraz vs Sinner',
        },
      });

      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status} (${res.text})`);
      if (res.json?.data?.status !== 'REJECTED') throw new Error('Expected status REJECTED');

      const separatedId = res.json?.data?.separatedCanonicalId;
      if (!separatedId || !separatedId.startsWith('cm_')) {
        throw new Error(`Expected separated canonical ID, got ${separatedId}`);
      }

      // Verify separated entity exists in canonical_matches
      const separatedMatch = testDb.prepare('SELECT * FROM canonical_matches WHERE canonical_match_id = ?').get(separatedId) as any;
      if (!separatedMatch) throw new Error('Separated match not found in canonical_matches');
      if (separatedMatch.winner_canonical_id !== 'cp_alexander_zverev') {
        throw new Error(`Expected winner cp_alexander_zverev, got ${separatedMatch.winner_canonical_id}`);
      }

      // Verify audit log record using parameterized query
      const auditRow = testDb.prepare('SELECT * FROM match_review_audit_log WHERE review_id = ? AND action = ?').get(2, 'REJECT') as any;
      if (!auditRow) throw new Error('Audit log for REJECT not found');
      if (auditRow.actor !== 'curator_bob') throw new Error('Audit actor mismatch');
    });

    await assertTest('Re-rejecting already rejected item is idempotent (returns 200 with idempotent=true)', async () => {
      const res = await request(baseUrl, 'POST', '/api/admin/linker/review-queue/2/reject', {
        body: { expected_lock_version: 2, actor: 'curator_bob' },
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (!res.json?.data?.idempotent) throw new Error('Expected idempotent: true');
    });

    // ------------------------------------------------------------------------
    // 6. Split Action
    // ------------------------------------------------------------------------
    console.log('\n[Phase 6: Split Action for Mistakenly Merged Matches]');

    await assertTest('Split requires source_to_detach and reason (fails with 400)', async () => {
      const res = await request(baseUrl, 'POST', '/api/admin/linker/matches/cm_2024-09-08_usopen_alcaraz_sinner/split', {
        body: {},
      });
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    });

    await assertTest('Split with stale expected_version triggers 409 Conflict', async () => {
      const res = await request(baseUrl, 'POST', '/api/admin/linker/matches/cm_2024-09-08_usopen_alcaraz_sinner/split', {
        body: {
          source_to_detach: 'pbp',
          reason: 'PBP was erroneously attached',
          expected_version: 99,
        },
      });
      if (res.status !== 409) throw new Error(`Expected 409, got ${res.status}`);
    });

    await assertTest('Split successfully detaches source into new canonical match', async () => {
      const res = await request(baseUrl, 'POST', '/api/admin/linker/matches/cm_2024-09-08_usopen_alcaraz_sinner/split', {
        body: {
          source_to_detach: 'pbp',
          reason: 'PBP had score desynchronization',
          expected_version: 1,
          actor: 'curator_senior',
        },
      });

      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status} (${res.text})`);
      if (res.json?.data?.action !== 'SPLIT') throw new Error('Expected action SPLIT');

      const newId = res.json?.data?.separatedCanonicalMatchId;
      if (!newId) throw new Error('Expected separated canonical ID');

      // Verify original canonical match decremented
      const orig = testDb.prepare('SELECT * FROM canonical_matches WHERE canonical_match_id = ?')
        .get('cm_2024-09-08_usopen_alcaraz_sinner') as any;
      // 3 & ~2 = 1 (pbp removed)
      if (orig.source_mask !== 1) throw new Error(`Expected original source_mask 1, got ${orig.source_mask}`);
      if (orig.evidence_count !== 1) throw new Error(`Expected original evidence_count 1, got ${orig.evidence_count}`);
      if (orig.version !== 2) throw new Error(`Expected version bumped to 2, got ${orig.version}`);

      // Verify link removed from original
      const oldLink = testDb.prepare('SELECT * FROM match_source_links WHERE canonical_match_id = ? AND source_name = ?')
        .get('cm_2024-09-08_usopen_alcaraz_sinner', 'pbp') as any;
      if (oldLink) throw new Error('Old link should have been deleted from original canonical match');

      // Verify new canonical match created
      const newMatch = testDb.prepare('SELECT * FROM canonical_matches WHERE canonical_match_id = ?').get(newId) as any;
      if (!newMatch) throw new Error('New separated match not found');

      // Verify new link points to separated match
      const newLink = testDb.prepare('SELECT * FROM match_source_links WHERE canonical_match_id = ? AND source_name = ?')
        .get(newId, 'pbp') as any;
      if (!newLink) throw new Error('Link for pbp not found under new canonical match');

      // Verify audit log for SPLIT
      const auditRow = testDb.prepare('SELECT * FROM match_review_audit_log WHERE action = ?').get('SPLIT') as any;
      if (!auditRow) throw new Error('Audit log for SPLIT not found');
      if (auditRow.actor !== 'curator_senior') throw new Error('Audit actor mismatch');
    });

    // ------------------------------------------------------------------------
    // 7. Audit Log Retrieval
    // ------------------------------------------------------------------------
    console.log('\n[Phase 7: Audit Log Query API]');

    await assertTest('Query audit logs returns logged actions with parsed payloads', async () => {
      const res = await request(baseUrl, 'GET', '/api/admin/linker/audit-logs');
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (!res.json?.data?.items || res.json.data.items.length < 3) {
        throw new Error(`Expected at least 3 audit log items, got ${res.json?.data?.items?.length}`);
      }

      const splitLog = res.json.data.items.find((i: any) => i.action === 'SPLIT');
      if (!splitLog || splitLog.actor !== 'curator_senior') {
        throw new Error('SPLIT audit log entry mismatch');
      }
    });

    // ------------------------------------------------------------------------
    // 8. Read Compatibility with Real Dry-Run DB (data/database.linker_dryrun.sqlite)
    // ------------------------------------------------------------------------
    console.log('\n[Phase 8: Compatibility Verification Against Dry-Run Database]');

    await assertTest('LinkerAdminController successfully lists the pending items from database.linker_dryrun.sqlite', async () => {
      const dryrunDb = getLinkerDryRunDb();
      const dryrunService = new ReviewQueueService(dryrunDb);
      const list = dryrunService.listItems({ limit: 10 });

      if (list.total < 150) {
        throw new Error(`Expected at least 150 pending items from database.linker_dryrun.sqlite, got ${list.total}`);
      }
      if (list.items.length !== 10) {
        throw new Error(`Expected 10 items in page, got ${list.items.length}`);
      }

      // Check item structure
      const sample = list.items[0];
      if (!sample.review_id || !sample.incoming_source) {
        throw new Error('Malformed item in real dryrun database');
      }
    });

    // ------------------------------------------------------------------------
    // 9. Absolute Safety Check: Verify Production DB Intact
    // ------------------------------------------------------------------------
    console.log('\n[Phase 9: Production DB Zero-Touch Proof]');

    await assertTest('Production database data/database.sqlite has NOT been modified', () => {
      const liveStatsAfter = fs.statSync(LIVE_DB_PATH);
      if (liveStatsAfter.size !== liveStatsBefore.size) {
        throw new Error(`PRODUCTION DB MUTATED! Size changed from ${liveStatsBefore.size} to ${liveStatsAfter.size}`);
      }
      if (liveStatsAfter.mtime.getTime() !== liveStatsBefore.mtime.getTime()) {
        throw new Error(`PRODUCTION DB MUTATED! Timestamp changed from ${liveStatsBefore.mtime} to ${liveStatsAfter.mtime}`);
      }
      console.log(`  Size verified: ${liveStatsAfter.size} bytes (unchanged)`);
      console.log(`  MTime verified: ${liveStatsAfter.mtime.toISOString()} (unchanged)`);
    });

  } finally {
    // Teardown
    testDb.close();
    closeLinkerDryRunDb();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => authServer.close(() => resolve()));

    // Clean test db
    for (const suffix of ['', '-wal', '-shm']) {
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
