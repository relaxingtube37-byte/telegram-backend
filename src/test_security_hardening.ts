/**
 * Dedicated Automated Test Suite for Security Hardening:
 * - Issue #3: Rate Limiting & Cloudflare IP key extraction
 * - Issue #4: Strict CORS Whitelist & Unauthorized Origin Rejection
 * - Issue #5: Secret Hardening & Production Startup Guards
 */
import express from 'express';
import http from 'http';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { getClientIpKey } from './middlewares/rateLimiter';
import { corsMiddleware } from './middlewares/cors';
import { isAdminSecretUsable, KNOWN_WEAK_ADMIN_SECRETS, validateSecurityEnvironment } from './config/env';

interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

async function runTest(suite: string, name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push({ suite, name, passed: true });
    console.log(`  ✅ [PASS] ${suite} -> ${name}`);
  } catch (err: any) {
    results.push({ suite, name, passed: false, error: err?.message || String(err) });
    console.error(`  ❌ [FAIL] ${suite} -> ${name}:`, err?.message || err);
  }
}

async function main() {
  console.log('\n======================================================');
  console.log('🛡️ SECURITY HARDENING SUITE (ISSUES #3, #4, #5)');
  console.log('======================================================\n');

  // --- SUITE 1: Secret Hardening & Weak Key Guards (Issue #5) ---
  console.log('--- SUITE 1: Weak Key & Production Secret Guards ---');

  runTest('Secret Hardening', 'Reject known weak admin secrets', () => {
    for (const weak of KNOWN_WEAK_ADMIN_SECRETS) {
      assert(!isAdminSecretUsable(weak), `Expected weak secret "${weak}" to be rejected`);
    }
    assert(!isAdminSecretUsable(''), 'Empty secret should be rejected');
    assert(!isAdminSecretUsable('   '), 'Whitespace secret should be rejected');
    assert(!isAdminSecretUsable('short123'), 'Short secret (<12 chars) should be rejected');
  });

  runTest('Secret Hardening', 'Accept strong admin secret', () => {
    assert(isAdminSecretUsable('my-ultra-secure-admin-secret-key-32chars!'), 'Strong key should be accepted');
  });

  runTest('Secret Hardening', 'validateSecurityEnvironment runs safely', () => {
    // Should run without throwing uncaught exceptions
    validateSecurityEnvironment();
  });

  // --- SUITE 2: CORS Whitelist Hardening (Issue #4) ---
  console.log('\n--- SUITE 2: Strict CORS Whitelist & Origin Rejection ---');

  const corsApp = express();
  corsApp.use(corsMiddleware);
  corsApp.get('/test-cors', (req, res) => res.json({ ok: true }));

  const corsServer = http.createServer(corsApp);
  await new Promise<void>((resolve) => corsServer.listen(0, '127.0.0.1', () => resolve()));
  const corsAddress = corsServer.address() as any;
  const corsBaseUrl = `http://127.0.0.1:${corsAddress.port}`;

  try {
    await runTest('CORS Whitelist', 'Permit requests with no Origin (curl / native webview)', async () => {
      const res = await fetch(`${corsBaseUrl}/test-cors`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const data = await res.json();
      assert(data.ok === true, 'Data should be ok');
    });

    await runTest('CORS Whitelist', 'Permit ptin-ai.com production domain', async () => {
      const res = await fetch(`${corsBaseUrl}/test-cors`, {
        headers: { Origin: 'https://ptin-ai.com' },
      });
      assert(res.headers.get('access-control-allow-origin') === 'https://ptin-ai.com', 'Expected ptin-ai.com to be allowed');
    });

    await runTest('CORS Whitelist', 'Permit subdomains of ptin-ai.com', async () => {
      const res = await fetch(`${corsBaseUrl}/test-cors`, {
        headers: { Origin: 'https://app.ptin-ai.com' },
      });
      assert(res.headers.get('access-control-allow-origin') === 'https://app.ptin-ai.com', 'Expected app.ptin-ai.com to be allowed');
    });

    await runTest('CORS Whitelist', 'Permit Vercel deployment domains (*.vercel.app)', async () => {
      const res = await fetch(`${corsBaseUrl}/test-cors`, {
        headers: { Origin: 'https://telegram-webapp-preview.vercel.app' },
      });
      assert(res.headers.get('access-control-allow-origin') === 'https://telegram-webapp-preview.vercel.app', 'Expected vercel domain to be allowed');
    });

    await runTest('CORS Whitelist', 'Permit official Telegram WebApp domains', async () => {
      const res = await fetch(`${corsBaseUrl}/test-cors`, {
        headers: { Origin: 'https://web.telegram.org' },
      });
      assert(res.headers.get('access-control-allow-origin') === 'https://web.telegram.org', 'Expected web.telegram.org to be allowed');
    });

    await runTest('CORS Whitelist', 'Permit localhost development origins', async () => {
      const res = await fetch(`${corsBaseUrl}/test-cors`, {
        headers: { Origin: 'http://localhost:5173' },
      });
      assert(res.headers.get('access-control-allow-origin') === 'http://localhost:5173', 'Expected localhost:5173 to be allowed');
    });

    await runTest('CORS Whitelist', 'REJECT untrusted / malicious cross-origin domains', async () => {
      const res = await fetch(`${corsBaseUrl}/test-cors`, {
        headers: { Origin: 'https://evil-attacker-site.com' },
      });
      const allowOrigin = res.headers.get('access-control-allow-origin');
      assert(!allowOrigin || allowOrigin === 'null', `Expected untrusted origin to be denied, but got ${allowOrigin}`);
    });
  } finally {
    corsServer.close();
  }

  // --- SUITE 3: Rate Limiting & Cloudflare Key Extraction (Issue #3) ---
  console.log('\n--- SUITE 3: Rate Limiting & Cloudflare IP Extraction ---');

  runTest('Rate Limiting', 'Extract Cloudflare cf-connecting-ip accurately', () => {
    const mockReq = {
      headers: { 'cf-connecting-ip': '198.51.100.42' },
      ip: '127.0.0.1',
    } as any;
    const key = getClientIpKey(mockReq);
    assert(key === ipKeyGenerator('198.51.100.42'), `Expected normalized IP for 198.51.100.42, got ${key}`);
  });

  const rateLimitApp = express();
  rateLimitApp.set('trust proxy', 1);

  // Micro rate limiter: max 3 requests in 5 seconds
  const testLimiter = rateLimit({
    windowMs: 5000,
    limit: 3,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: getClientIpKey,
    message: { error: 'Rate limit exceeded for test' },
  });

  rateLimitApp.use('/limited', testLimiter, (req, res) => res.json({ success: true }));

  const rateLimitServer = http.createServer(rateLimitApp);
  await new Promise<void>((resolve) => rateLimitServer.listen(0, '127.0.0.1', () => resolve()));
  const rlAddress = rateLimitServer.address() as any;
  const rlBaseUrl = `http://127.0.0.1:${rlAddress.port}`;

  try {
    await runTest('Rate Limiting', 'Enforce 429 Too Many Requests when threshold exceeded', async () => {
      // 1st request
      const r1 = await fetch(`${rlBaseUrl}/limited`, { headers: { 'cf-connecting-ip': '203.0.113.10' } });
      assert(r1.status === 200, `Request 1 should be 200, got ${r1.status}`);

      // 2nd request
      const r2 = await fetch(`${rlBaseUrl}/limited`, { headers: { 'cf-connecting-ip': '203.0.113.10' } });
      assert(r2.status === 200, `Request 2 should be 200, got ${r2.status}`);

      // 3rd request
      const r3 = await fetch(`${rlBaseUrl}/limited`, { headers: { 'cf-connecting-ip': '203.0.113.10' } });
      assert(r3.status === 200, `Request 3 should be 200, got ${r3.status}`);

      // 4th request -> must trigger 429 Too Many Requests
      const r4 = await fetch(`${rlBaseUrl}/limited`, { headers: { 'cf-connecting-ip': '203.0.113.10' } });
      assert(r4.status === 429, `Request 4 must be 429 Too Many Requests, got ${r4.status}`);
      const body4 = await r4.json();
      assert(body4.error === 'Rate limit exceeded for test', 'Expected custom rate limit error payload');

      // A different IP should NOT be blocked
      const rOther = await fetch(`${rlBaseUrl}/limited`, { headers: { 'cf-connecting-ip': '203.0.113.99' } });
      assert(rOther.status === 200, `Different IP request should be 200, got ${rOther.status}`);
    });
  } finally {
    rateLimitServer.close();
  }

  // --- FINAL SUMMARY ---
  console.log('\n======================================================');
  console.log('📊 SECURITY TEST SUMMARY');
  console.log('======================================================');
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  console.log(`Total Tests: ${results.length} | Passed: ${passedCount} | Failed: ${failedCount}\n`);

  if (failedCount > 0) {
    console.error('❌ Some security tests failed!');
    process.exit(1);
  } else {
    console.log('🎉 ALL SECURITY HARDENING TESTS PASSED 100% SUCCESSFULLY!\n');
  }
}

main().catch((err) => {
  console.error('Fatal error running security suite:', err);
  process.exit(1);
});
