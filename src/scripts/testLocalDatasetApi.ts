/**
 * Quick smoke test for local dataset API endpoints used by State Football.
 * Run: npx tsx src/scripts/testLocalDatasetApi.ts
 */

const BASE = process.env.API_BASE || 'http://localhost:8080/api/web';

interface TestCase {
  name: string;
  url: string;
  assert: (data: Record<string, unknown>) => string | null;
}

const tests: TestCase[] = [
  {
    name: 'Djokovic analysis-bundle',
    url: `${BASE}/players/Novak%20Djokovic/analysis-bundle?before=2026-08-31&years=3&recentLimit=3`,
    assert: (d) => {
      if ((d.totalLocalMatches as number) < 100) return `expected 100+ matches, got ${d.totalLocalMatches}`;
      if (!d.rankAtDate) return 'missing rankAtDate';
      const recent = d.recentMatches as unknown[];
      if (!recent?.length) return 'no recent matches';
      return null;
    },
  },
  {
    name: 'Navone vs Djokovic H2H',
    url: `${BASE}/h2h-history?p1=Mariano%20Navone&p2=Novak%20Djokovic&beforeDate=2026-08-31`,
    assert: (d) => {
      if ((d.totalMatches as number) !== 1) return `expected 1 H2H match, got ${d.totalMatches}`;
      const m = (d.matches as Array<{ score?: string }>)?.[0];
      if (!m?.score?.includes('7-6')) return `unexpected score: ${m?.score}`;
      return null;
    },
  },
  {
    name: 'Yeonwoo Ku surface-stats',
    url: `${BASE}/players/Yeonwoo%20Ku/surface-stats?before=2026-08-31&years=3`,
    assert: (d) => {
      if ((d.totalMatches as number) < 1) return 'Ku should have matches in DB';
      return null;
    },
  },
  {
    name: 'Yunchaokete Bu analysis-bundle',
    url: `${BASE}/players/Yunchaokete%20Bu/analysis-bundle?before=2026-08-31&years=3`,
    assert: (d) => {
      if ((d.totalLocalMatches as number) < 1) return 'Bu should have matches in DB';
      if (!d.rankAtDate) return 'missing rankAtDate for Bu';
      return null;
    },
  },
];

async function main() {
  console.log(`Testing local dataset API at ${BASE}\n`);
  let passed = 0;
  let failed = 0;

  for (const t of tests) {
    try {
      const res = await fetch(t.url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        console.log(`❌ ${t.name}: HTTP ${res.status}`);
        failed++;
        continue;
      }
      const data = (await res.json()) as Record<string, unknown>;
      const err = t.assert(data);
      if (err) {
        console.log(`❌ ${t.name}: ${err}`);
        failed++;
      } else {
        console.log(`✅ ${t.name}`);
        passed++;
      }
    } catch (e) {
      console.log(`❌ ${t.name}: ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
