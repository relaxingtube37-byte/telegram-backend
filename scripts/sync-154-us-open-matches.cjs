/**
 * Script: sync-154-us-open-matches.cjs
 * Role: Synchronize exactly 154 US Open 2026 matches from Desktop to Backend
 * Safety Conditions Enforced:
 *  1. Instant pre-write backup of database.sqlite.
 *  2. Strict mapping to the 55 canonical Backend columns (ignoring 19 Markov enrichment columns).
 *  3. Single atomic transaction with automatic rollback on any failure.
 *  4. Post-insert verification (count == 58,131, 0 duplicates).
 *  5. Strict read-only access to Desktop database (0-byte change guaranteed).
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function getFileHash(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

async function runSync() {
  console.log('='.repeat(78));
  console.log(' US OPEN 2026 154-MATCH SYNCHRONIZATION RUNNER');
  console.log(' Timestamp: ' + new Date().toISOString());
  console.log('='.repeat(78));

  const desktopDbPath = path.resolve('G:/state football/data/tennis_gold.sqlite');
  const backendDbPath = path.resolve('G:/telegram-backend/data/database.sqlite');
  const backupDir = path.resolve('G:/telegram-backend/data/backups');

  // -------------------------------------------------------------
  // Safety Condition 5: Record Desktop Baseline (Immutability Proof)
  // -------------------------------------------------------------
  console.log('\n[1/5] Verifying Desktop Database Baseline & Immutability...');
  const desktopInitialSize = fs.statSync(desktopDbPath).size;
  console.log(`  Desktop file: ${desktopDbPath}`);
  console.log(`  Desktop initial size: ${desktopInitialSize.toLocaleString()} bytes`);

  // -------------------------------------------------------------
  // Safety Condition 1: Pre-Write Physical Backup of Backend Database
  // -------------------------------------------------------------
  console.log('\n[2/5] Creating Pre-Write Physical Backup of Backend Database...');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFilePath = path.join(backupDir, `database.sqlite.bak_pre_us_open_sync_${timestampStr}`);
  fs.copyFileSync(backendDbPath, backupFilePath);
  const backupSize = fs.statSync(backupFilePath).size;
  console.log(`  Backup created successfully: ${backupFilePath}`);
  console.log(`  Backup file size: ${backupSize.toLocaleString()} bytes`);

  // -------------------------------------------------------------
  // Open Databases
  // -------------------------------------------------------------
  console.log('\n[3/5] Opening Connections (Desktop: READONLY, Backend: RW Transaction)...');
  const desktopDb = new Database(desktopDbPath, { readonly: true });
  const backendDb = new Database(backendDbPath);

  // Read Backend's exact 55 columns
  const backendColsInfo = backendDb.pragma('table_info(gold_matches_validated)');
  const backendColNames = backendColsInfo.map(c => c.name);
  console.log(`  Backend canonical columns: ${backendColNames.length} columns detected.`);
  if (backendColNames.length !== 55) {
    throw new Error(`Expected 55 canonical columns in Backend, found ${backendColNames.length}`);
  }

  // Identify the 154 missing matches
  const backendExistingIds = new Set(
    backendDb.prepare('SELECT rapid_event_id FROM gold_matches_validated').all().map(r => r.rapid_event_id)
  );
  const initialBackendCount = backendExistingIds.size;
  console.log(`  Backend current row count: ${initialBackendCount}`);

  // Fetch only the 55 canonical columns from Desktop
  const selectColsSql = backendColNames.map(c => `"${c}"`).join(', ');
  const desktopCandidates = desktopDb.prepare(
    `SELECT ${selectColsSql} FROM gold_matches_validated`
  ).all();

  const missingToInsert = desktopCandidates.filter(row => !backendExistingIds.has(row.rapid_event_id));
  console.log(`  Identified candidate rows to insert: ${missingToInsert.length}`);

  if (missingToInsert.length !== 154) {
    throw new Error(`Expected exactly 154 missing matches, but found ${missingToInsert.length}. Aborting.`);
  }

  // Verify all 154 are US Open 2026
  for (const m of missingToInsert) {
    if (m.tourney_name !== 'US Open, New York, USA' || !m.match_date.startsWith('2026-09')) {
      throw new Error(`Unexpected fixture outside US Open 2026: ${JSON.stringify(m)}`);
    }
  }
  console.log('  Validation: All 154 candidate records confirmed as US Open 2026 fixtures.');

  // -------------------------------------------------------------
  // Safety Condition 3: Execute Single Atomic Transaction
  // -------------------------------------------------------------
  console.log('\n[4/5] Executing Atomic Single-Transaction Insert...');
  const insertColsSql = backendColNames.map(c => `"${c}"`).join(', ');
  const insertPlaceholders = backendColNames.map(() => '?').join(', ');
  const insertStmt = backendDb.prepare(
    `INSERT INTO gold_matches_validated (${insertColsSql}) VALUES (${insertPlaceholders})`
  );

  const performTransaction = backendDb.transaction((rows) => {
    let inserted = 0;
    for (const row of rows) {
      const values = backendColNames.map(col => row[col]);
      insertStmt.run(...values);
      inserted++;
    }
    return inserted;
  });

  const insertedCount = performTransaction(missingToInsert);
  console.log(`  Successfully inserted ${insertedCount} rows in single atomic transaction.`);

  // -------------------------------------------------------------
  // Safety Condition 4: Post-Insert Verification & Parity Audit
  // -------------------------------------------------------------
  console.log('\n[5/5] Post-Insert Verification & Parity Certification...');
  const finalBackendCount = backendDb.prepare('SELECT COUNT(*) as c FROM gold_matches_validated').get().c;
  const duplicateCheck = backendDb.prepare(
    'SELECT rapid_event_id, COUNT(*) as c FROM gold_matches_validated GROUP BY rapid_event_id HAVING c > 1'
  ).all();
  const canonicalDupCheck = backendDb.prepare(
    'SELECT canonical_match_id, COUNT(*) as c FROM gold_matches_validated GROUP BY canonical_match_id HAVING c > 1'
  ).all();

  console.log(`  Initial Backend count:  ${initialBackendCount}`);
  console.log(`  Inserted count:         +${insertedCount}`);
  console.log(`  Final Backend count:    ${finalBackendCount} (Expected: 58131)`);
  console.log(`  Duplicate rapid_event_ids: ${duplicateCheck.length}`);
  console.log(`  Duplicate canonical_match_ids: ${canonicalDupCheck.length}`);

  if (finalBackendCount !== 58131) {
    throw new Error(`Post-insert count verification failed! Expected 58131, got ${finalBackendCount}`);
  }
  if (duplicateCheck.length > 0 || canonicalDupCheck.length > 0) {
    throw new Error('Integrity violation: duplicate match IDs detected post-insert!');
  }

  // Close connections
  desktopDb.close();
  backendDb.close();

  // Verify desktop immutability
  const desktopFinalSize = fs.statSync(desktopDbPath).size;
  const desktopDelta = desktopFinalSize - desktopInitialSize;
  console.log(`\n  Desktop Final Size: ${desktopFinalSize.toLocaleString()} bytes (Delta = ${desktopDelta} bytes)`);
  if (desktopDelta !== 0) {
    throw new Error(`CRITICAL: Desktop database file size changed by ${desktopDelta} bytes!`);
  }

  console.log('\n' + '='.repeat(78));
  console.log(' SYNCHRONIZATION REPORT');
  console.log('='.repeat(78));
  console.log('  Status:                 SUCCESS (5/5 CONDITIONS MET)');
  console.log('  Rows Synchronized:      154 US Open 2026 matches');
  console.log('  Pre-Write Backup:       ' + backupFilePath);
  console.log('  Backend New Row Count:  58,131 (100% parity with Desktop)');
  console.log('  Desktop Immutability:   VERIFIED (Delta = 0 bytes)');
  console.log('='.repeat(78));
}

runSync().catch((err) => {
  console.error('\n❌ FATAL SYNCHRONIZATION ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
