import assert from 'assert';
import http from 'http';
import express from 'express';
import { UsersRepo } from './db/repositories/users.repo';
import { webappRoutes } from './routes/webapp.routes';
import { signTelegramInitData } from './utils/telegramAuth';
import { ENV } from './config/env';
import { computeIsVerified } from './utils/contentAccess';

async function runTest() {
  console.log('--- Telegram Mini App Strict 2-Step & Returning Member Verification Test ---\n');

  const testBotToken = ENV.BOT_TOKEN || '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
  ENV.BOT_TOKEN = testBotToken;

  // Generate a random Telegram ID for a new user
  const newTgId = Math.floor(100000000 + Math.random() * 900000000);
  const newUser = {
    id: newTgId,
    first_name: 'BrandNewTgUser',
    username: 'new_tg_user_test',
  };

  const validInitData = signTelegramInitData(newUser, testBotToken);

  const app = express();
  app.use(express.json());
  app.use('/api/webapp', webappRoutes);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Step 1: User opens Telegram Mini App (initData sent to /auth)
    const authRes1 = await fetch(`${baseUrl}/api/webapp/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: validInitData }),
    });

    assert.strictEqual(authRes1.status, 200);
    const authData1 = await authRes1.json();
    assert.strictEqual(authData1.success, true);
    // MUST NOT be verified upon step 1 alone!
    assert.strictEqual(authData1.verified, false, 'New Telegram user MUST NOT be verified without Step 2 (partner site registration)');
    assert.strictEqual(authData1.user.is_verified, 0, 'is_verified must be 0');
    assert.strictEqual(authData1.user.verify_status, 'telegram_connected', 'verify_status must be telegram_connected');
    console.log('✅ Step 1: New Telegram user connects account -> strictly unverified (Step 2 required).');

    // 2. Predictions must be strictly locked & redacted for unverified Telegram user
    const predRes1 = await fetch(`${baseUrl}/api/webapp/predictions`, {
      headers: {
        'x-telegram-init-data': validInitData,
        Authorization: `Bearer ${authData1.sessionToken}`,
      },
    });
    const predData1 = await predRes1.json();
    assert.strictEqual(predData1.verified, false, 'Predictions must report verified=false');
    if (predData1.predictions && predData1.predictions.length > 0) {
      const p = predData1.predictions[0];
      assert.strictEqual(p.content_locked, true, 'Prediction must be locked before Step 2 registration');
      assert.strictEqual(p.probabilities, undefined, 'Probabilities must be redacted');
      assert.strictEqual(p.confidence, undefined, 'Confidence must be redacted');
    }
    console.log('✅ Predictions strictly locked and zero-leakage redacted for Step 1 user.');

    // 3. Step 2: User registers on 1WIN (partner site) via /referral/complete
    const refRes = await fetch(`${baseUrl}/api/webapp/referral/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId: newTgId, siteId: 1, sessionToken: authData1.sessionToken }),
    });
    const refData = await refRes.json();
    assert.strictEqual(refData.success, true);
    assert.strictEqual(refData.verified, true);
    console.log('✅ Step 2: User registers on partner site -> verified=true activated.');

    // 4. Returning user verification: next time they open the app with initData
    const authRes2 = await fetch(`${baseUrl}/api/webapp/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: validInitData }),
    });
    const authData2 = await authRes2.json();
    assert.strictEqual(authData2.verified, true, 'Returning member must enjoy 1-step direct login');
    assert.strictEqual(authData2.user.is_verified, 1);
    assert.strictEqual(authData2.user.verify_status, 'verified');
    console.log('✅ Returning Telegram user who completed Step 2 gets seamless 1-step verified access.');

    // 5. Predictions unlocked for returning verified user
    const predRes2 = await fetch(`${baseUrl}/api/webapp/predictions`, {
      headers: {
        'x-telegram-init-data': validInitData,
        Authorization: `Bearer ${authData2.sessionToken}`,
      },
    });
    const predData2 = await predRes2.json();
    assert.strictEqual(predData2.verified, true);
    if (predData2.predictions && predData2.predictions.length > 0) {
      const p = predData2.predictions[0];
      assert.strictEqual(p.content_locked, false, 'Prediction must be unlocked for verified user');
    }
    console.log('✅ Full intelligence predictions unlocked for verified user.');
  } finally {
    server.close();
  }

  console.log('\n--- ALL TELEGRAM MINI APP 2-STEP & RETURNING USER TESTS PASSED ---\n');
}

runTest().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
