import assert from 'assert';
import http from 'http';
import express from 'express';
import { UsersRepo } from './db/repositories/users.repo';
import { webappRoutes } from './routes/webapp.routes';
import { signTelegramInitData } from './utils/telegramAuth';
import { ENV } from './config/env';
import { computeIsVerified } from './utils/contentAccess';

async function runTest() {
  console.log('--- Telegram Mini App Unlock & Verification Test ---\n');

  const testBotToken = ENV.BOT_TOKEN || '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
  ENV.BOT_TOKEN = testBotToken;

  const testTgId = 778899112;
  const testUser = {
    id: testTgId,
    first_name: 'TelegramTester',
    username: 'tg_tester_bot',
  };

  // 1. Generate authentic signed Telegram initData
  const validInitData = signTelegramInitData(testUser, testBotToken);

  // 2. Setup Express test server
  const app = express();
  app.use(express.json());
  app.use('/api/webapp', webappRoutes);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 3. Test POST /api/webapp/auth with Telegram initData
    const authRes = await fetch(`${baseUrl}/api/webapp/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: validInitData }),
    });

    assert.strictEqual(authRes.status, 200, `Expected 200, got ${authRes.status}`);
    const authData = await authRes.json();
    assert.strictEqual(authData.success, true);
    assert.strictEqual(authData.verified, true, 'Telegram Mini App user must be verified');
    assert(authData.sessionToken, 'Expected sessionToken to be issued for Telegram user');
    assert.strictEqual(authData.user.is_verified, 1);
    assert.strictEqual(authData.user.telegram_id, testTgId);
    console.log('✅ POST /api/webapp/auth issued sessionToken and verified Telegram user');

    // 4. Verify user in SQLite
    const dbUser = UsersRepo.getByTelegramId(testTgId);
    assert(dbUser, 'User must exist in SQLite');
    assert.strictEqual(dbUser.is_verified, 1);
    assert.strictEqual(dbUser.auth_provider, 'telegram');
    assert.strictEqual(computeIsVerified('REGISTRATION_REQUIRED', dbUser), true);
    console.log('✅ User record in SQLite has is_verified=1 and computeIsVerified returns true');

    // 5. Test GET /api/webapp/predictions with sessionToken
    const predRes1 = await fetch(`${baseUrl}/api/webapp/predictions`, {
      headers: { Authorization: `Bearer ${authData.sessionToken}` },
    });
    const predData1 = await predRes1.json();
    assert.strictEqual(predData1.verified, true, 'Predictions verified flag must be true');
    if (predData1.predictions && predData1.predictions.length > 0) {
      const p = predData1.predictions[0];
      assert.strictEqual(p.content_locked, false, 'Prediction must NOT be locked for verified member');
    }
    console.log('✅ GET /api/webapp/predictions with sessionToken returned unredacted predictions');

    // 6. Test GET /api/webapp/predictions with x-telegram-init-data header
    const predRes2 = await fetch(`${baseUrl}/api/webapp/predictions`, {
      headers: { 'x-telegram-init-data': validInitData },
    });
    const predData2 = await predRes2.json();
    assert.strictEqual(predData2.verified, true, 'Predictions verified flag with initData must be true');
    console.log('✅ GET /api/webapp/predictions with x-telegram-init-data returned verified=true');

    // 7. Test POST /api/webapp/referral/complete
    const refRes = await fetch(`${baseUrl}/api/webapp/referral/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId: testTgId, siteId: 1 }),
    });
    const refData = await refRes.json();
    assert.strictEqual(refData.success, true);
    assert.strictEqual(refData.verified, true);
    console.log('✅ POST /api/webapp/referral/complete succeeded');
  } finally {
    server.close();
  }

  console.log('\n--- ALL TELEGRAM MINI APP TESTS PASSED ---\n');
}

runTest().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
