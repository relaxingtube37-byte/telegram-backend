import assert from 'assert';
import http from 'http';
import express from 'express';
import {
  generateNumericIdForGoogleUser,
  verifyGoogleIdToken,
} from './utils/googleAuth';
import { UsersRepo } from './db/repositories/users.repo';
import { webappRoutes } from './routes/webapp.routes';

async function runTest() {
  console.log('--- Google Auth & User Integration Test ---\n');

  // 2. Test deterministic ID generator
  const email1 = 'player.one@gmail.com';
  const id1 = generateNumericIdForGoogleUser(email1);
  const id1Repeat = generateNumericIdForGoogleUser(email1);
  assert.strictEqual(id1, id1Repeat, 'ID generation must be deterministic');
  assert(id1 >= 8_000_000_000_000_000, 'ID must be in synthetic range >= 8 quadrillion');
  assert(Number.isSafeInteger(id1), 'ID must be a safe JS integer');
  console.log(`✅ Deterministic synthetic ID verified: ${id1}`);

  // 3. Test Google token verification with mock token
  const mockToken = 'mock_google_123456789_testplayer';
  const verification = await verifyGoogleIdToken(mockToken);
  assert(verification.valid && verification.user, 'Mock verification must succeed');
  assert.strictEqual(verification.user.email, 'testplayer@gmail.com');
  console.log(`✅ Mock Google token verification passed for ${verification.user.email}`);

  // 4. Test UsersRepo.upsertFromGoogle
  const syntheticId = generateNumericIdForGoogleUser(verification.user.email);
  const user = UsersRepo.upsertFromGoogle({
    googleId: verification.user.googleId,
    email: verification.user.email,
    name: 'Test Player',
    picture: 'https://lh3.googleusercontent.com/photo.jpg',
    syntheticId,
  });

  assert(user, 'User record must be returned');
  assert.strictEqual(user.auth_provider, 'google');
  assert.strictEqual(user.email, 'testplayer@gmail.com');
  assert.strictEqual(user.first_name, 'Test Player');
  console.log(`✅ UsersRepo.upsertFromGoogle created user ID=${user.id}, telegram_id=${user.telegram_id}`);

  // 5. Test idempotent update
  const updatedUser = UsersRepo.upsertFromGoogle({
    googleId: verification.user.googleId,
    email: verification.user.email,
    name: 'Test Player Updated',
    syntheticId,
  });
  assert.strictEqual(updatedUser.id, user.id, 'Must not duplicate existing user');
  assert.strictEqual(updatedUser.first_name, 'Test Player Updated');
  console.log('✅ UsersRepo idempotent update verified');

  // 6. Test HTTP endpoint POST /api/webapp/auth/google
  const app = express();
  app.use(express.json());
  app.use('/api/webapp', webappRoutes);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${baseUrl}/api/webapp/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idToken: 'mock_google_998877665_alireza',
      }),
    });

    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    const json = await res.json();
    assert(json.success, 'Expected success = true');
    assert(json.sessionToken, 'Expected sessionToken');
    assert.strictEqual(json.user.auth_provider, 'google');
    assert.strictEqual(json.user.email, 'alireza@gmail.com');
    console.log(`✅ HTTP POST /api/webapp/auth/google returned valid session for ${json.user.email}`);

    // 7. Verify user can be marked verified (e.g. postback)
    UsersRepo.setVerified(json.user.telegram_id, undefined, 'postback');
    const checkedUser = UsersRepo.getByTelegramId(json.user.telegram_id);
    assert.strictEqual(checkedUser.is_verified, 1, 'Google user must be verifiable via setVerified');
    console.log('✅ Google user verified via postback workflow');
  } finally {
    server.close();
  }

  console.log('\n--- ALL GOOGLE AUTH TESTS PASSED ---\n');
}

runTest().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
