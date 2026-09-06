import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { GoldDailyUpdateService, type DailyGoldMatchInput } from '../services/goldDailyUpdate.service';
import { initGoldSchema } from '../db/goldSchema';

const DB_PATH = path.resolve('data/database.sqlite');
const db = new Database(DB_PATH);
initGoldSchema(db);

console.log('═════════════════════════════════════════════════════════════════════════');
console.log('🔄 DAILY INCREMENTAL GOLD DATASET UPDATE');
console.log('═════════════════════════════════════════════════════════════════════════\n');

const updater = new GoldDailyUpdateService(db);
const lastRun = updater.getLastSuccessfulRun();

console.log(`Last successful run: ${lastRun ? `${lastRun.run_id} (${lastRun.finished_at})` : 'None (initial state)'}`);

// Check for any pending newly downloaded bundles in data/bulk-match-bundles/events
const bundlesBaseDir = path.resolve('data/bulk-match-bundles/events');
if (!fs.existsSync(bundlesBaseDir)) {
  console.log('No bulk-match-bundles directory found. Nothing to update.');
  process.exit(0);
}

const eventDirs = fs.readdirSync(bundlesBaseDir);
const pendingMatches: DailyGoldMatchInput[] = [];

// Find events not yet in gold_matches_validated
const checkExistsStmt = db.prepare('SELECT rapid_event_id FROM gold_matches_validated WHERE rapid_event_id = ?');

for (const dirName of eventDirs) {
  const rid = Number(dirName);
  if (isNaN(rid) || rid <= 0) continue;

  const row = checkExistsStmt.get(rid);
  if (!row) {
    // Read manifest
    const manifestPath = path.join(bundlesBaseDir, dirName, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        pendingMatches.push({
          rapid_event_id: rid,
          match_date: manifest.match_date || new Date().toISOString().slice(0, 10),
          start_utc: manifest.start_utc || null,
          tour: manifest.tour || 'ATP',
          tourney_name: manifest.tourney_name || 'Tour Tournament',
          surface_raw: manifest.surface || 'Hard',
          winner_name: manifest.winner_name || 'Unknown',
          loser_name: manifest.loser_name || 'Unknown',
          score: manifest.score || '',
          has_stats_bundle: manifest.statistics_status === 'ok',
          has_pbp_bundle: manifest.pbp_status === 'ok',
        });
      } catch {}
    }
  }
}

console.log(`Discovered ${pendingMatches.length} newly completed/unprocessed events.`);

if (pendingMatches.length === 0) {
  console.log('✅ Gold dataset is already 100% up to date. Idempotent check complete.');
  db.close();
  process.exit(0);
}

console.log(`Processing incremental batch of ${pendingMatches.length} matches...`);
const res = updater.processDailyBatch(pendingMatches);

console.log(`\nDaily update result: ${res.status}`);
console.log(`• Processed: ${res.matchesProcessed}`);
console.log(`• Inserted:  ${res.matchesInserted}`);
console.log(`• Updated:   ${res.matchesUpdated}`);
console.log(`• READY:     ${res.readyCount}`);
console.log(`• Excluded:  ${res.excludedCount}`);
console.log(`• Affected Players Updated in 3Y History: ${res.affectedPlayersCount}`);

db.close();
console.log('\nDaily incremental update completed successfully.');
