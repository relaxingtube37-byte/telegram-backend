/**
 * Admin web route authorization security tests.
 * Uses dynamic imports so ADMIN_SECRET is set before env.ts loads.
 */
process.env.ADMIN_SECRET = 'secure-test-admin-secret-key-for-suite';
process.env.NODE_ENV = 'test';

const TEST_PORT = 3198;

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const WEB_ADMIN_ROUTES: Array<{ method: string; path: string; body?: unknown }> = [
  { method: 'GET', path: '/api/web/admin/dataset-stats' },
  { method: 'POST', path: '/api/web/admin/run-ingestion', body: {} },
  { method: 'GET', path: '/api/web/admin/ml-observability' },
  { method: 'POST', path: '/api/web/admin/ml-drift-job', body: {} },
  { method: 'POST', path: '/api/web/admin/ml-rollback', body: { version: 'v1.0.0' } },
  { method: 'GET', path: '/api/web/admin/precompute' },
  { method: 'POST', path: '/api/web/admin/precompute', body: {} },
  { method: 'POST', path: '/api/web/admin/retry-failed-analytics', body: {} },
];

const PUBLIC_WEB_ROUTES: Array<{ method: string; path: string }> = [
  { method: 'GET', path: '/api/web/landing' },
  { method: 'GET', path: '/api/web/pool/stats' },
  { method: 'GET', path: '/health' },
];

async function runTest(results: TestResult[], name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  ✅ ${name}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, error: message });
    console.error(`  ❌ ${name}: ${message}`);
  }
}

function assertNoSecretLeak(bodyText: string, configuredSecret: string, weakSecrets: readonly string[], context: string) {
  if (bodyText.includes(configuredSecret)) {
    throw new Error(`${context}: response exposed configured admin secret`);
  }
  for (const weak of weakSecrets) {
    if (bodyText.includes(weak)) {
      throw new Error(`${context}: response exposed known weak secret`);
    }
  }
}

async function request(
  baseUrl: string,
  method: string,
  path: string,
  options: { secret?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (options.secret !== undefined) {
    headers['x-admin-secret'] = options.secret;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

async function main() {
  const express = (await import('express')).default;
  const http = await import('http');
  const { corsMiddleware } = await import('./middlewares/cors');
  const { apiRouter } = await import('./routes');
  const { goRoutes } = await import('./routes/go.routes');
  const { initSchema } = await import('./db/schema');
  const { runMigrations } = await import('./db/migrations');
  const { ENV, KNOWN_WEAK_ADMIN_SECRETS } = await import('./config/env');

  const TEST_ADMIN_SECRET = ENV.ADMIN_SECRET;
  const results: TestResult[] = [];

  console.log('\n--- Admin Web Authorization Security Tests ---\n');

  initSchema();
  runMigrations();

  const app = express();
  app.use(corsMiddleware);
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use('/', goRoutes);
  app.use('/', apiRouter);

  const testServer = http.createServer(app);
  await new Promise<void>((resolve) => {
    testServer.listen(TEST_PORT, () => resolve());
  });

  const baseUrl = `http://127.0.0.1:${TEST_PORT}`;

  try {
    await runTest(results, 'Missing admin credential rejected', async () => {
      const res = await request(baseUrl, 'GET', '/api/web/admin/dataset-stats');
      const body = await res.text();
      if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
      assertNoSecretLeak(body, TEST_ADMIN_SECRET, KNOWN_WEAK_ADMIN_SECRETS, 'missing credential');
    });

    await runTest(results, 'Empty admin credential rejected', async () => {
      const res = await request(baseUrl, 'GET', '/api/web/admin/dataset-stats', { secret: '   ' });
      const body = await res.text();
      if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
      assertNoSecretLeak(body, TEST_ADMIN_SECRET, KNOWN_WEAK_ADMIN_SECRETS, 'empty credential');
    });

    await runTest(results, 'Invalid admin credential rejected', async () => {
      const res = await request(baseUrl, 'GET', '/api/web/admin/dataset-stats', {
        secret: 'definitely-not-the-real-secret',
      });
      const body = await res.text();
      if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
      assertNoSecretLeak(body, TEST_ADMIN_SECRET, KNOWN_WEAK_ADMIN_SECRETS, 'invalid credential');
    });

    for (const weakSecret of KNOWN_WEAK_ADMIN_SECRETS) {
      await runTest(results, `Known old fallback credential rejected (${weakSecret.slice(0, 8)}...)`, async () => {
        const res = await request(baseUrl, 'GET', '/api/web/admin/dataset-stats', { secret: weakSecret });
        const body = await res.text();
        if (res.status !== 401) throw new Error(`Expected 401 for weak secret, got ${res.status}`);
        assertNoSecretLeak(body, TEST_ADMIN_SECRET, KNOWN_WEAK_ADMIN_SECRETS, 'weak fallback credential');
      });
    }

    await runTest(results, 'Valid configured admin credential accepted', async () => {
      const res = await request(baseUrl, 'GET', '/api/web/admin/dataset-stats', {
        secret: TEST_ADMIN_SECRET,
      });
      const body = await res.text();
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${body}`);
      assertNoSecretLeak(body, TEST_ADMIN_SECRET, KNOWN_WEAK_ADMIN_SECRETS, 'authorized dataset-stats');
    });

    for (const route of WEB_ADMIN_ROUTES) {
      await runTest(results, `Protected: ${route.method} ${route.path} (no auth → 401)`, async () => {
        const res = await request(baseUrl, route.method, route.path, { body: route.body });
        const body = await res.text();
        if (res.status !== 401) {
          throw new Error(`Expected 401, got ${res.status}: ${body.slice(0, 120)}`);
        }
        assertNoSecretLeak(body, TEST_ADMIN_SECRET, KNOWN_WEAK_ADMIN_SECRETS, route.path);
      });
    }

    for (const route of PUBLIC_WEB_ROUTES) {
      await runTest(results, `Public route accessible: ${route.method} ${route.path}`, async () => {
        const res = await request(baseUrl, route.method, route.path);
        if (res.status === 401) {
          throw new Error('Public route unexpectedly returned 401');
        }
        if (res.status < 200 || res.status >= 500) {
          throw new Error(`Unexpected status ${res.status}`);
        }
      });
    }

    await runTest(results, 'Protected /api/admin/* routes continue to work', async () => {
      const unauthorized = await request(baseUrl, 'GET', '/api/admin/overview');
      if (unauthorized.status !== 401) {
        throw new Error('Expected unauthorized /api/admin/overview to return 401');
      }

      const authorized = await request(baseUrl, 'GET', '/api/admin/overview', {
        secret: TEST_ADMIN_SECRET,
      });
      const body = await authorized.text();
      if (authorized.status !== 200) {
        throw new Error(`Expected authorized /api/admin/overview to return 200, got ${authorized.status}`);
      }
      assertNoSecretLeak(body, TEST_ADMIN_SECRET, KNOWN_WEAK_ADMIN_SECRETS, '/api/admin/overview');
    });

    await runTest(results, 'Admin auth does not expose secret in error response', async () => {
      const res = await request(baseUrl, 'GET', '/api/web/admin/dataset-stats', {
        secret: 'wrong-secret-value',
      });
      const body = await res.text();
      const json = JSON.parse(body);
      if (json.error?.includes(TEST_ADMIN_SECRET)) {
        throw new Error('Error response leaked configured secret');
      }
      if (JSON.stringify(json).includes(TEST_ADMIN_SECRET)) {
        throw new Error('JSON body leaked configured secret');
      }
    });
  } finally {
    testServer.close();
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\nSecurity tests: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal security test error:', err);
  process.exit(1);
});
