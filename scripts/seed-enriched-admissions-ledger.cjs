/**
 * Script: seed-enriched-admissions-ledger.cjs
 * Role: Extract the exact 7,356 Markov DTMC enriched match IDs from Desktop
 *       and seed the immutable auxiliary ledger table in Backend database.sqlite.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

async function runSeed() {
  console.log('='.repeat(78));
  console.log(' SEEDING ENRICHED ADMISSIONS LEDGER TABLE');
  console.log(' Timestamp: ' + new Date().toISOString());
  console.log('='.repeat(78));

  const desktopDbPath = path.resolve('G:/state football/data/tennis_gold.sqlite');
  const backendDbPath = path.resolve('G:/telegram-backend/data/database.sqlite');

  const desktopDb = new Database(desktopDbPath, { readonly: true });
  const backendDb = new Database(backendDbPath);

  // 1. Create auxiliary ledger table in Backend
  backendDb.exec(`
    CREATE TABLE IF NOT EXISTS gold_matches_enriched_admissions (
      rapid_event_id INTEGER PRIMARY KEY,
      enrichment_type TEXT NOT NULL,
      original_status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  console.log('  Table gold_matches_enriched_admissions confirmed/created.');

  // 2. Identify the 7,356 enriched matches
  const desktopReadyIds = new Set(
    desktopDb.prepare("SELECT rapid_event_id FROM gold_matches_validated WHERE final_status = 'READY'").all().map(r => r.rapid_event_id)
  );
  console.log(`  Desktop READY total: ${desktopReadyIds.size}`);

  const backendRows = backendDb.prepare("SELECT rapid_event_id, final_status FROM gold_matches_validated").all();
  const candidatesToSeed = [];

  for (const r of backendRows) {
    if (desktopReadyIds.has(r.rapid_event_id) && r.final_status !== 'READY') {
      candidatesToSeed.push({
        rapid_event_id: r.rapid_event_id,
        enrichment_type: 'DTMC_MARKOV_SYNTHETIC_ODDS',
        original_status: r.final_status,
        created_at: new Date().toISOString()
      });
    }
  }

  console.log(`  Identified candidates for enriched admissions: ${candidatesToSeed.length}`);
  if (candidatesToSeed.length !== 7356) {
    throw new Error(`Expected exactly 7,356 candidates to seed, but found ${candidatesToSeed.length}. Aborting.`);
  }

  // 3. Insert in atomic transaction
  const insertStmt = backendDb.prepare(`
    INSERT OR REPLACE INTO gold_matches_enriched_admissions (rapid_event_id, enrichment_type, original_status, created_at)
    VALUES (?, ?, ?, ?)
  `);

  const seedTransaction = backendDb.transaction((rows) => {
    let count = 0;
    for (const r of rows) {
      insertStmt.run(r.rapid_event_id, r.enrichment_type, r.original_status, r.created_at);
      count++;
    }
    return count;
  });

  const inserted = seedTransaction(candidatesToSeed);
  console.log(`  Successfully inserted/seeded ${inserted} records in gold_matches_enriched_admissions.`);

  // 4. Verification
  const totalSeeded = backendDb.prepare('SELECT COUNT(*) as c FROM gold_matches_enriched_admissions').get().c;
  console.log(`  Total verified rows in gold_matches_enriched_admissions: ${totalSeeded}`);

  desktopDb.close();
  backendDb.close();

  if (totalSeeded !== 7356) {
    throw new Error(`Integrity verification failed! Expected 7356 rows, got ${totalSeeded}`);
  }

  console.log('='.repeat(78));
  console.log(' SEEDING COMPLETE: 7,356 ENRICHED MATCHES RECORDED IN LEDGER');
  console.log('='.repeat(78));
}

runSeed().catch(err => {
  console.error('❌ SEEDING FATAL ERROR:', err.message);
  process.exit(1);
});
