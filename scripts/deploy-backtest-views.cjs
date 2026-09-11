/**
 * Script: deploy-backtest-views.cjs
 * Role: Deploy the differentiated backtest views architecture in database.sqlite
 *       under an atomic transaction with physical pre-write backup.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

async function deployViews() {
  console.log('='.repeat(78));
  console.log(' DEPLOYING DIFFERENTIATED BACKTEST VIEWS ARCHITECTURE');
  console.log(' Timestamp: ' + new Date().toISOString());
  console.log('='.repeat(78));

  const backendDbPath = path.resolve('G:/telegram-backend/data/database.sqlite');
  const backupDir = path.resolve('G:/telegram-backend/data/backups');

  // 1. Create Physical Backup
  console.log('\n[1/4] Creating Pre-Deployment Physical Backup...');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFilePath = path.join(backupDir, `database.sqlite.bak_pre_views_deploy_${timestampStr}`);
  fs.copyFileSync(backendDbPath, backupFilePath);
  console.log(`  Backup created: ${backupFilePath}`);

  // 2. Open DB and check prerequisites
  console.log('\n[2/4] Checking Prerequisites...');
  const db = new Database(backendDbPath);

  const enrichedAdmissionsCount = db.prepare(
    "SELECT COUNT(*) as c FROM sqlite_master WHERE type = 'table' AND name = 'gold_matches_enriched_admissions'"
  ).get().c;
  if (enrichedAdmissionsCount === 0) {
    throw new Error('Table gold_matches_enriched_admissions does not exist! Run seed script first.');
  }

  const admissionsRows = db.prepare('SELECT COUNT(*) as c FROM gold_matches_enriched_admissions').get().c;
  console.log(`  gold_matches_enriched_admissions contains ${admissionsRows} records.`);
  if (admissionsRows !== 7356) {
    throw new Error(`Expected 7356 records in gold_matches_enriched_admissions, got ${admissionsRows}`);
  }

  // 3. Deploy Views in Single Transaction
  console.log('\n[3/4] Deploying Views in Atomic Transaction...');
  const deployTx = db.transaction(() => {
    // 3.1. Strict Raw View
    db.exec(`
      DROP VIEW IF EXISTS gold_matches_ready_raw_view;
      CREATE VIEW gold_matches_ready_raw_view AS
        SELECT *
        FROM gold_matches_validated
        WHERE final_status = 'READY';
    `);

    // 3.2. Enriched View (Raw + Enriched Admissions)
    db.exec(`
      DROP VIEW IF EXISTS gold_matches_ready_enriched_view;
      CREATE VIEW gold_matches_ready_enriched_view AS
        SELECT *
        FROM gold_matches_validated
        WHERE final_status = 'READY'
           OR rapid_event_id IN (SELECT rapid_event_id FROM gold_matches_enriched_admissions);
    `);

    // 3.3. Legacy Facade View (points to raw view)
    db.exec(`
      DROP VIEW IF EXISTS gold_matches_ready_view;
      CREATE VIEW gold_matches_ready_view AS
        SELECT *
        FROM gold_matches_ready_raw_view;
    `);
  });

  deployTx();
  console.log('  Views deployed successfully.');

  // 4. Verification
  console.log('\n[4/4] Immediate Row Count Verification...');
  const rawCount = db.prepare('SELECT COUNT(*) as c FROM gold_matches_ready_raw_view').get().c;
  const enrichedCount = db.prepare('SELECT COUNT(*) as c FROM gold_matches_ready_enriched_view').get().c;
  const legacyCount = db.prepare('SELECT COUNT(*) as c FROM gold_matches_ready_view').get().c;
  const baseTableCount = db.prepare('SELECT COUNT(*) as c FROM gold_matches_validated').get().c;

  console.log(`  gold_matches_validated (Base Table):   ${baseTableCount} (Expected: 58131)`);
  console.log(`  gold_matches_ready_raw_view:           ${rawCount} (Expected: 38720)`);
  console.log(`  gold_matches_ready_enriched_view:      ${enrichedCount} (Expected: 46076)`);
  console.log(`  gold_matches_ready_view (Facade):      ${legacyCount} (Expected: 38720)`);

  db.close();

  if (baseTableCount !== 58131) throw new Error(`Base table count altered! Got ${baseTableCount}`);
  if (rawCount !== 38720) throw new Error(`Raw view count mismatch! Got ${rawCount}`);
  if (enrichedCount !== 46076) throw new Error(`Enriched view count mismatch! Got ${enrichedCount}`);
  if (legacyCount !== 38720) throw new Error(`Legacy facade count mismatch! Got ${legacyCount}`);

  console.log('\n' + '='.repeat(78));
  console.log(' VIEW DEPLOYMENT CERTIFIED (ALL COUNTS MATCH 100%)');
  console.log('='.repeat(78));
}

deployViews().catch(err => {
  console.error('❌ VIEW DEPLOYMENT FATAL ERROR:', err.message);
  process.exit(1);
});
