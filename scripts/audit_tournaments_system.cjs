const Database = require('better-sqlite3');
const http = require('http');

const db = new Database('./data/database.sqlite');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}: ${data.substring(0, 100)}`));
        }
      });
    }).on('error', reject);
  });
}

async function runAudit() {
  console.log('=====================================================');
  console.log('🏆 TOURNAMENTS SECTION COMPREHENSIVE DATA AUDIT');
  console.log('=====================================================\n');

  let passed = 0;
  let total = 0;

  function assert(name, condition, details = '') {
    total++;
    if (condition) {
      console.log(`✅ [PASS ${total}] ${name}`);
      passed++;
    } else {
      console.error(`❌ [FAIL ${total}] ${name}: ${details}`);
    }
  }

  // 1. Audit SQLite Historical Database
  const totalMatches = db.prepare('SELECT count(1) as c FROM historical_matches').get().c;
  assert('SQLite database has rich match archive', totalMatches > 50000, `Found ${totalMatches} matches`);

  const distinctTourneys = db.prepare('SELECT count(DISTINCT tourney_name) as c FROM historical_matches WHERE tourney_name IS NOT NULL').get().c;
  assert('SQLite has rich distinct tournament coverage', distinctTourneys > 100, `Found ${distinctTourneys} tournaments`);

  // 2. Audit API Catalog Endpoint
  console.log('\n--- Auditing /api/web/tournaments/catalog ---');
  const catalog = await fetchJson('http://localhost:8080/api/web/tournaments/catalog');
  assert('Catalog returns non-empty array', Array.isArray(catalog) && catalog.length > 50, `Length: ${catalog.length}`);

  const grandSlams = catalog.filter(t => t.category === 'Grand Slam');
  assert('Catalog contains all 4 Grand Slams', grandSlams.length >= 4, `Found: ${grandSlams.map(g => g.name).join(', ')}`);

  const masters = catalog.filter(t => t.category === 'ATP Masters 1000');
  assert('Catalog contains all 9 ATP Masters 1000', masters.length >= 9, `Found ${masters.length} Masters 1000 events`);

  const atpFinals = catalog.find(t => t.name === 'ATP Finals');
  assert('Catalog contains ATP Finals', !!atpFinals, `ATP Finals found: ${!!atpFinals}`);

  const davisCup = catalog.find(t => t.name.includes('Davis Cup'));
  assert('Catalog consolidates Davis Cup into clean flagship tournament', !!davisCup && davisCup.category === 'Davis Cup', `Davis Cup: ${davisCup?.name} (${davisCup?.category})`);

  // Check no undefined or NaN properties in catalog
  let hasCorruptCatalog = false;
  for (const t of catalog) {
    if (!t.name || !t.category || !t.surface || typeof t.cpr !== 'number' || isNaN(t.cpr) || typeof t.points !== 'number') {
      hasCorruptCatalog = true;
      console.error('Corrupt tournament catalog item:', t);
      break;
    }
  }
  assert('All tournament catalog items have valid properties (name, category, surface, CPR, points)', !hasCorruptCatalog);

  // 3. Audit Individual Tournament History Endpoints
  console.log('\n--- Auditing Tournament History Endpoints ---');
  const testTournaments = [
    'Wimbledon',
    'US Open',
    'Roland Garros',
    'Australian Open',
    'ATP Finals',
    'Indian Wells Masters',
    'Miami Masters',
    'Monte Carlo Masters',
    'Madrid Masters',
    'Rome Masters',
    'Cincinnati Masters',
    'Canada Masters',
    'Shanghai Masters',
    'Paris Masters',
    'Davis Cup (World Team Championship)'
  ];

  for (const tourneyName of testTournaments) {
    const encoded = encodeURIComponent(tourneyName);
    const history = await fetchJson(`http://localhost:8080/api/web/tournaments/${encoded}/history`);

    assert(`History API for "${tourneyName}" returns valid object`, history && history.tournamentName === tourneyName, `Name: ${history?.tournamentName}`);
    assert(`"${tourneyName}" has available edition years`, Array.isArray(history.availableYears) && history.availableYears.length > 0, `Years: ${history.availableYears?.slice(0, 5).join(', ')}`);
    assert(`"${tourneyName}" has historical Roll of Honor finals`, Array.isArray(history.rollOfHonor) && history.rollOfHonor.length > 0, `Finals count: ${history.rollOfHonor?.length}`);

    // If bracket exists for target year, check structure
    if (history.bracket && history.bracket.length > 0) {
      assert(`"${tourneyName}" has structured bracketByRound`, !!history.bracketByRound && typeof history.bracketByRound === 'object');
    }
  }

  console.log('\n=====================================================');
  console.log(`🏁 AUDIT COMPLETE: ${passed} / ${total} CHECKS PASSED (${Math.round((passed / total) * 100)}%)`);
  console.log('=====================================================');
}

runAudit().catch(err => {
  console.error('Audit failed with error:', err);
  process.exit(1);
});
