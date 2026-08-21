import { ENV } from './config/env';
import { BackendTennisApi } from './dataPool/dataPool.tennisApi';
import { BackendDataPoolOrchestrator } from './dataPool/dataPool.orchestrator';
import { BackendDataPoolStore } from './dataPool/dataPool.store';
import express from 'express';
import { corsMiddleware } from './middlewares/cors';
import { apiRouter } from './routes';
import { goRoutes } from './routes/go.routes';
import { initSchema } from './db/schema';
import { runMigrations } from './db/migrations';
import http from 'http';

interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  durationMs: number;
  details?: any;
  error?: string;
}

const results: TestResult[] = [];

async function runTest(suite: string, name: string, fn: () => Promise<any>) {
  const start = Date.now();
  try {
    const details = await fn();
    const durationMs = Date.now() - start;
    results.push({ suite, name, passed: true, durationMs, details });
    console.log(`  ✅ [PASS] ${suite} -> ${name} (${durationMs}ms)`);
  } catch (err: any) {
    const durationMs = Date.now() - start;
    results.push({ suite, name, passed: false, durationMs, error: err?.message || String(err) });
    console.error(`  ❌ [FAIL] ${suite} -> ${name} (${durationMs}ms):`, err?.message || err);
  }
}

async function main() {
  console.log('\n======================================================');
  console.log('🎾 FULL BACKEND & DATA POOL DIAGNOSTIC & TEST SUITE');
  console.log('======================================================\n');
  console.log(`Environment: ${ENV.NODE_ENV}`);
  console.log(`RapidAPI Key: ${ENV.RAPIDAPI_KEY ? ENV.RAPIDAPI_KEY.slice(0, 8) + '...' : 'NONE'}`);
  console.log(`Database: ${ENV.DATABASE_FILE}\n`);

  // Initialize DB for testing
  initSchema();
  runMigrations();

  // ─────────────────────────────────────────────────────────────
  // SUITE 1: External API (RapidAPI Tennis) Direct Verification
  // ─────────────────────────────────────────────────────────────
  console.log('--- SUITE 1: RapidAPI Tennis Direct Fetching ---');
  
  await runTest('RapidAPI', 'GET /api/tennis/events/live', async () => {
    const data = await BackendTennisApi.getLiveEvents();
    if (!data) {
      throw new Error('RapidAPI returned null (check network, API key or quota)');
    }
    return {
      hasEvents: Array.isArray(data.events),
      eventCount: data.events ? data.events.length : 0,
      sample: data.events?.[0]?.homeTeam?.name + ' vs ' + data.events?.[0]?.awayTeam?.name,
    };
  });

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  await runTest('RapidAPI', `GET daily category events (${todayStr})`, async () => {
    const data = await BackendTennisApi.getDailyEvents(todayStr);
    if (!data) {
      throw new Error('RapidAPI returned null for daily events');
    }
    return {
      hasEvents: Array.isArray(data.events),
      eventCount: data.events ? data.events.length : 0,
      sample: data.events?.[0]?.homeTeam?.name + ' vs ' + data.events?.[0]?.awayTeam?.name,
    };
  });

  await runTest('RapidAPI', 'GET /api/tennis/rankings/atp', async () => {
    const data = await BackendTennisApi.getRankings('atp');
    return {
      hasRankings: !!data,
      keys: data ? Object.keys(data) : [],
    };
  });

  // ─────────────────────────────────────────────────────────────
  // SUITE 2: Data Pool Store & Orchestrator
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- SUITE 2: Backend DataPool Caching & Transformation ---');

  await runTest('DataPoolStore', 'Set, Get, TTL Expiry & Clear', async () => {
    BackendDataPoolStore.clear();
    BackendDataPoolStore.set('test_key', { foo: 'bar' }, 100); // 100ms TTL
    const val1 = BackendDataPoolStore.get<{ foo: string }>('test_key');
    if (!val1 || val1.foo !== 'bar') throw new Error('DataPoolStore get failed immediately after set');

    // Wait for expiration
    await new Promise((r) => setTimeout(r, 120));
    const val2 = BackendDataPoolStore.get('test_key');
    if (val2 !== null) throw new Error('DataPoolStore failed to expire key after TTL');

    BackendDataPoolStore.set('key_a', 1, 60000);
    BackendDataPoolStore.set('key_b', 2, 60000);
    const stats = BackendDataPoolStore.getStats();
    if (stats.entriesCount !== 2) throw new Error(`Expected 2 entries, got ${stats.entriesCount}`);
    
    BackendDataPoolStore.clear();
    return { status: 'Store functioning correctly', statsBeforeClear: stats };
  });

  await runTest('DataPoolOrchestrator', 'getLiveTournamentGroups (Transformation & Stats)', async () => {
    const groups = await BackendDataPoolOrchestrator.getLiveTournamentGroups();
    if (!Array.isArray(groups) || groups.length === 0) {
      throw new Error('Expected tournament groups array with at least 1 group');
    }

    const firstGroup = groups[0];
    if (!firstGroup.tournamentId || !firstGroup.name || !Array.isArray(firstGroup.matches)) {
      throw new Error('Group missing required properties');
    }

    const firstMatch = firstGroup.matches[0];
    if (!firstMatch || !firstMatch.player1 || !firstMatch.player2 || !firstMatch.stats) {
      throw new Error('Match missing required properties or calculated stats');
    }

    // Verify stats integrity
    const stats = firstMatch.stats;
    if (typeof stats.winProbability1 !== 'number' || typeof stats.winProbability2 !== 'number') {
      throw new Error('Match stats missing win probabilities');
    }
    if (stats.winProbability1 + stats.winProbability2 !== 100) {
      throw new Error(`Win probabilities do not sum to 100: ${stats.winProbability1} + ${stats.winProbability2}`);
    }

    return {
      groupCount: groups.length,
      sampleGroup: firstGroup.name,
      sampleMatch: `${firstMatch.player1} vs ${firstMatch.player2}`,
      statsSample: {
        winProb1: stats.winProbability1,
        winProb2: stats.winProbability2,
        aiVerdict: stats.aiVerdict?.slice(0, 60) + '...',
      },
    };
  });

  await runTest('DataPoolOrchestrator', `getDateTournamentGroups (${todayStr})`, async () => {
    const groups = await BackendDataPoolOrchestrator.getDateTournamentGroups(todayStr);
    if (!Array.isArray(groups) || groups.length === 0) {
      throw new Error('Expected array of tournament groups with at least 1 group');
    }
    return {
      groupCount: groups.length,
      sampleTournament: groups[0]?.name,
      matchCount: groups.reduce((acc, g) => acc + g.matches.length, 0),
    };
  });

  // ─────────────────────────────────────────────────────────────
  // SUITE 3: HTTP Server & All Endpoints Integration
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- SUITE 3: HTTP Server & Endpoints Integration ---');

  const app = express();
  app.use(corsMiddleware);
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use('/', goRoutes);
  app.use('/', apiRouter);

  const testServer = http.createServer(app);
  const TEST_PORT = 3199;
  
  await new Promise<void>((resolve) => {
    testServer.listen(TEST_PORT, () => {
      console.log(`  ℹ️ Test HTTP server running on port ${TEST_PORT}`);
      resolve();
    });
  });

  const baseUrl = `http://127.0.0.1:${TEST_PORT}`;
  const adminSecret = ENV.ADMIN_SECRET;

  try {
    // 1. Health
    await runTest('HTTP Endpoints', 'GET /health', async () => {
      const res = await fetch(`${baseUrl}/health`);
      if (res.status !== 200) throw new Error(`Status ${res.status}`);
      const json = await res.json();
      if (json.status !== 'ok') throw new Error('Invalid status field');
      return json;
    });

    // 2. Web Landing
    await runTest('HTTP Endpoints', 'GET /api/web/landing', async () => {
      const res = await fetch(`${baseUrl}/api/web/landing`);
      if (res.status !== 200) throw new Error(`Status ${res.status}`);
      const json = await res.json();
      if (!json.platform || !json.stats) throw new Error('Invalid landing data structure');
      return { platform: json.platform, stats: json.stats };
    });

    // 3. Web Live Tournaments
    await runTest('HTTP Endpoints', 'GET /api/web/tournaments/live', async () => {
      const res = await fetch(`${baseUrl}/api/web/tournaments/live`);
      if (res.status !== 200) throw new Error(`Status ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json)) throw new Error('Expected array of tournaments');
      return { count: json.length };
    });

    // 4. Web Today Tournaments
    await runTest('HTTP Endpoints', 'GET /api/web/tournaments/today', async () => {
      const res = await fetch(`${baseUrl}/api/web/tournaments/today`);
      if (res.status !== 200) throw new Error(`Status ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json)) throw new Error('Expected array of tournaments');
      return { count: json.length };
    });

    // 5. Web Date Tournaments
    await runTest('HTTP Endpoints', `GET /api/web/tournaments/date/${todayStr}`, async () => {
      const res = await fetch(`${baseUrl}/api/web/tournaments/date/${todayStr}`);
      if (res.status !== 200) throw new Error(`Status ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json)) throw new Error('Expected array of tournaments');
      return { count: json.length };
    });

    // 6. Web Pool Stats
    await runTest('HTTP Endpoints', 'GET /api/web/pool/stats', async () => {
      const res = await fetch(`${baseUrl}/api/web/pool/stats`);
      if (res.status !== 200) throw new Error(`Status ${res.status}`);
      const json = await res.json();
      return json;
    });

    // 7. Predictions Feed & Active & History
    await runTest('HTTP Endpoints', 'GET /api/predictions/feed', async () => {
      const res = await fetch(`${baseUrl}/api/predictions/feed`);
      if (res.status !== 200) throw new Error(`Status ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json.active) || !Array.isArray(json.history)) {
        throw new Error('Invalid predictions feed response');
      }
      return { activeCount: json.active.length, historyCount: json.history.length };
    });

    // 8. Telegram WebApp Routes Compatibility
    await runTest('HTTP WebApp Routes', 'GET /api/webapp/predictions', async () => {
      const res = await fetch(`${baseUrl}/api/webapp/predictions`);
      if (res.status !== 200) throw new Error(`Status ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json)) throw new Error('Expected array');
      return { count: json.length };
    });

    await runTest('HTTP WebApp Routes', 'GET /api/webapp/stats', async () => {
      const res = await fetch(`${baseUrl}/api/webapp/stats`);
      if (res.status !== 200) throw new Error(`Status ${res.status}`);
      const json = await res.json();
      if (json.totalPredictions === undefined || json.winRatePct === undefined) {
        throw new Error('Invalid stats format');
      }
      return json;
    });

    await runTest('HTTP WebApp Routes', 'GET /api/webapp/referrals', async () => {
      const res = await fetch(`${baseUrl}/api/webapp/referrals`);
      if (res.status !== 200) throw new Error(`Status ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json)) throw new Error('Expected array');
      return { count: json.length };
    });

    await runTest('HTTP WebApp Routes', 'GET /api/webapp/user/99887766?first_name=Ali&username=alibetter', async () => {
      const res = await fetch(`${baseUrl}/api/webapp/user/99887766?first_name=Ali&username=alibetter`);
      if (res.status !== 200) throw new Error(`Status ${res.status}`);
      const json = await res.json();
      if (json.verified === undefined || !json.access_mode) throw new Error('Invalid user payload');
      return json;
    });

    // 9. Admin Auth Protection Test
    await runTest('HTTP Admin Auth', 'GET /api/admin/overview (Unauthorized 401)', async () => {
      const res = await fetch(`${baseUrl}/api/admin/overview`);
      if (res.status !== 401) throw new Error(`Expected 401 Unauthorized, got ${res.status}`);
      return { status: 401, message: 'Correctly rejected unauthorized request' };
    });

    // 10. Admin Overview (Authorized)
    await runTest('HTTP Admin Endpoints', 'GET /api/admin/overview (Authorized)', async () => {
      const res = await fetch(`${baseUrl}/api/admin/overview?secret=${adminSecret}`, {
        headers: { 'x-admin-secret': adminSecret },
      });
      if (res.status !== 200) throw new Error(`Status ${res.status}`);
      const json = await res.json();
      if (!json.stats || !json.settings) throw new Error('Invalid admin overview structure');
      return { stats: json.stats, usersCount: json.users?.length };
    });

    // 11. Admin Prediction Publish & Result Update
    let testPredictionId = 0;
    await runTest('HTTP Admin Endpoints', 'POST /api/admin/predictions/publish', async () => {
      const payload = {
        fixture_id: 999002,
        tournament_name: 'Wimbledon Championships',
        round_name: 'Final',
        surface: 'Grass',
        match_date: todayStr,
        home_name: 'Carlos Alcaraz',
        away_name: 'Novak Djokovic',
        home_odds: '1.85',
        away_odds: '1.95',
        predicted_winner: 'Carlos Alcaraz',
        win_probability: 58,
        confidence: 'HIGH',
        predicted_score: '3-1',
        best_bet_selection: 'Carlos Alcaraz To Win',
        best_bet_market: 'Match Winner',
        best_bet_ev: '+4.2%',
        best_bet_rationale: 'Dominant return depth and baseline agility on grass.',
        post_to_channel: false, // Don't trigger Telegram bot during automated test
        status: 'UPCOMING',
      };

      const res = await fetch(`${baseUrl}/api/admin/predictions/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': adminSecret,
        },
        body: JSON.stringify(payload),
      });

      if (res.status !== 200) {
        const text = await res.text();
        throw new Error(`Status ${res.status}: ${text}`);
      }

      const json = await res.json();
      if (!json.success || !json.predictionId) throw new Error('Failed to create prediction');
      testPredictionId = json.predictionId;
      return json;
    });

    // 12. Update Prediction Result
    await runTest('HTTP Admin Endpoints', `PUT /api/admin/predictions/${testPredictionId}/result`, async () => {
      const res = await fetch(`${baseUrl}/api/admin/predictions/${testPredictionId}/result`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': adminSecret,
        },
        body: JSON.stringify({ status: 'WON', result_score: '6-4, 4-6, 6-3, 6-3' }),
      });

      if (res.status !== 200) throw new Error(`Status ${res.status}`);
      const json = await res.json();
      if (!json.success || json.status !== 'WON') throw new Error('Failed to update result');
      return json;
    });

    // 13. Admin Referrals / Sites Management
    let siteId = 0;
    await runTest('HTTP Admin Endpoints', 'POST /api/admin/sites & GET /api/admin/sites', async () => {
      const createRes = await fetch(`${baseUrl}/api/admin/sites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': adminSecret,
        },
        body: JSON.stringify({
          name: '1xBet Test Partner',
          base_url: 'https://refpa.top/L?tag=d_12345&site=1',
          postback_key: 'test1xbetkey',
          verify_mode: 'POSTBACK',
          is_active: 1,
        }),
      });

      if (createRes.status !== 200) {
        const errText = await createRes.text();
        throw new Error(`Create site failed ${createRes.status}: ${errText}`);
      }
      const createJson = await createRes.json();
      siteId = createJson.id;

      const listRes = await fetch(`${baseUrl}/api/admin/sites`, {
        headers: { 'x-admin-secret': adminSecret },
      });
      const listJson = await listRes.json();
      const found = listJson.some((s: any) => s.id === siteId);
      if (!found) throw new Error('Created site not found in list');

      return { siteId, sitesCount: listJson.length };
    });

    // 14. Postback Webhook Simulation
    await runTest('HTTP Postback Webhook', 'POST /api/postback/test1xbetkey', async () => {
      const res = await fetch(`${baseUrl}/api/postback/test1xbetkey?subid=99887766&status=deposit&amount=50`, {
        method: 'POST',
      });
      if (res.status !== 200) {
        const text = await res.text();
        throw new Error(`Status ${res.status}: ${text}`);
      }
      const json = await res.json();
      if (!json.success) throw new Error('Postback failed to process');
      return json;
    });

    // Verify user is now verified in DB
    await runTest('DB State Verification', 'Check user verification after postback', async () => {
      const res = await fetch(`${baseUrl}/api/telegram/user/99887766`);
      const json = await res.json();
      if (!json.isVerified) throw new Error('User was not marked verified after postback');
      return { verified: json.isVerified, user: json.user };
    });

    // 15. Go Redirect Route
    await runTest('HTTP Go Redirect', `GET /go/${siteId}/99887766 & /${siteId}/99887766`, async () => {
      const res1 = await fetch(`${baseUrl}/go/${siteId}/99887766`, {
        redirect: 'manual',
      });
      if (res1.status !== 302) {
        throw new Error(`Expected redirect status 302, got ${res1.status}`);
      }
      const location1 = res1.headers.get('location');

      const res2 = await fetch(`${baseUrl}/${siteId}/99887766`, {
        redirect: 'manual',
      });
      if (res2.status !== 302) {
        throw new Error(`Expected redirect status 302, got ${res2.status}`);
      }

      return { status: res1.status, redirectLocation: location1 };
    });

  } finally {
    testServer.close();
  }

  // ─────────────────────────────────────────────────────────────
  // SUMMARY REPORT
  // ─────────────────────────────────────────────────────────────
  console.log('\n======================================================');
  console.log('📊 TEST EXECUTION SUMMARY');
  console.log('======================================================');
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  console.log(`Total Tests: ${results.length} | Passed: ${passedCount} | Failed: ${failedCount}\n`);

  if (failedCount > 0) {
    console.log('❌ Failed Tests:');
    results.filter((r) => !r.passed).forEach((r) => {
      console.log(`  - [${r.suite}] ${r.name}: ${r.error}`);
    });
  } else {
    console.log('🎉 ALL INTEGRATION & DATA POOL TESTS PASSED 100% SUCCESSFULLY!');
  }
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
