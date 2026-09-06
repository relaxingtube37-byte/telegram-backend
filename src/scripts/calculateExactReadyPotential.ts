import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'data', 'database.sqlite');
const db = new Database(DB_PATH, { readonly: true });

console.log('═════════════════════════════════════════════════════════════════════════');
console.log('🔬 EXACT MATHEMATICAL BREAKDOWN OF THE 57,977 MATCHES');
console.log('═════════════════════════════════════════════════════════════════════════\n');

const allEventsPath = path.resolve('data/bulk-player-history/indexes/all-events.json');
const allEventsData = JSON.parse(fs.readFileSync(allEventsPath, 'utf8')) as {
  events: Array<{
    rapid_event_id: number;
    player_name: string;
    tour: string;
    match_date: string;
    home_name: string;
    away_name: string;
    winner_code: number;
    score: string;
    tournament_name: string;
    surface: string;
    status: string;
    player_won: boolean;
  }>;
};

const allEventsMap = new Map<number, any>();
for (const ev of allEventsData.events) {
  allEventsMap.set(ev.rapid_event_id, ev);
}

const bundlesBaseDir = path.resolve('data/bulk-match-bundles/events');
const eventsIndexPath = path.resolve('data/bulk-match-bundles/indexes/events-index.json');
const eventsIndex = JSON.parse(fs.readFileSync(eventsIndexPath, 'utf8')) as {
  events: Array<{ rapid_event_id: number; match_date: string }>;
};

let countDoubles = 0;
let countSingles = 0;
let singlesCompletedMatches = 0;
let singlesGenuineRetirements = 0;
let singlesUnplayedOrCancelled = 0;
let singlesMissingScore = 0;

let singlesWithStatsOnDisk = 0;
let singlesWithPbpOnDisk = 0;
let singlesWithBothBundlesOnDisk = 0;

for (const item of eventsIndex.events) {
  const rid = item.rapid_event_id;
  const ev = allEventsMap.get(rid);

  const tName = ev?.tournament_name || '';
  const hName = ev?.home_name || '';
  const aName = ev?.away_name || '';
  const score = ev?.score || '';

  const isDoubles = tName.toLowerCase().includes('doubles') ||
                    hName.includes('/') ||
                    aName.includes('/');

  if (isDoubles) {
    countDoubles++;
    continue;
  }

  countSingles++;

  // Check bundles on disk
  const eventDir = path.join(bundlesBaseDir, String(rid));
  const hasStats = fs.existsSync(path.join(eventDir, 'statistics.json'));
  const hasPbp = fs.existsSync(path.join(eventDir, 'point_by_point.json')) || fs.existsSync(path.join(eventDir, 'point-by-point.json'));

  if (hasStats) singlesWithStatsOnDisk++;
  if (hasPbp) singlesWithPbpOnDisk++;
  if (hasStats && hasPbp) singlesWithBothBundlesOnDisk++;

  // Check score completeness
  const isRet = /RET|RETIRED|W\/O|WALKOVER|DEF|DEFAULT/i.test(score);
  const isCancelled = ev?.status === 'canceled' || ev?.status === 'postponed' || score === '?-?' || score === 'CANC.';

  if (isRet) {
    singlesGenuineRetirements++;
  } else if (isCancelled) {
    singlesUnplayedOrCancelled++;
  } else if (!score || score.trim() === '') {
    singlesMissingScore++;
  } else {
    singlesCompletedMatches++;
  }
}

console.log('TOTAL MATCHES IN DATASET: ' + eventsIndex.events.length.toLocaleString());
console.log('1. DOUBLES MATCHES (دونفره):       ' + countDoubles.toLocaleString() + ` (${((countDoubles / eventsIndex.events.length) * 100).toFixed(1)}%)`);
console.log('2. SINGLES MATCHES (انفرادی):     ' + countSingles.toLocaleString() + ` (${((countSingles / eventsIndex.events.length) * 100).toFixed(1)}%)`);

console.log('\n--- BREAKDOWN OF THE ' + countSingles.toLocaleString() + ' SINGLES MATCHES ---');
console.log('• Finished, Completed Matches:    ' + singlesCompletedMatches.toLocaleString() + ` (${((singlesCompletedMatches / countSingles) * 100).toFixed(1)}%)`);
console.log('• Genuine Retirements / Walkovers: ' + singlesGenuineRetirements.toLocaleString() + ` (${((singlesGenuineRetirements / countSingles) * 100).toFixed(1)}%)`);
console.log('• Cancelled / Unplayed / Postponed: ' + singlesUnplayedOrCancelled.toLocaleString());
console.log('• Missing Score in API:           ' + singlesMissingScore.toLocaleString());

console.log('\n--- TELEMETRY OF COMPLETED SINGLES MATCHES ON DISK ---');
console.log('• Singles with Statistics Bundle: ' + singlesWithStatsOnDisk.toLocaleString());
console.log('• Singles with PBP Bundle:        ' + singlesWithPbpOnDisk.toLocaleString());
console.log('• Singles with BOTH Stats & PBP:  ' + singlesWithBothBundlesOnDisk.toLocaleString());

// Check how many completed singles matches have both bundles
let fullyUsableSingles = 0;
for (const item of eventsIndex.events) {
  const rid = item.rapid_event_id;
  const ev = allEventsMap.get(rid);

  const tName = ev?.tournament_name || '';
  const hName = ev?.home_name || '';
  const aName = ev?.away_name || '';
  const score = ev?.score || '';

  const isDoubles = tName.toLowerCase().includes('doubles') || hName.includes('/') || aName.includes('/');
  if (isDoubles) continue;

  const isRet = /RET|RETIRED|W\/O|WALKOVER|DEF|DEFAULT/i.test(score);
  const isCancelled = ev?.status === 'canceled' || ev?.status === 'postponed' || score === '?-?' || score === 'CANC.';
  if (isRet || isCancelled || !score || score.trim() === '') continue;

  const eventDir = path.join(bundlesBaseDir, String(rid));
  const hasStats = fs.existsSync(path.join(eventDir, 'statistics.json'));
  const hasPbp = fs.existsSync(path.join(eventDir, 'point_by_point.json')) || fs.existsSync(path.join(eventDir, 'point-by-point.json'));

  if (hasStats && hasPbp) {
    fullyUsableSingles++;
  }
}

console.log('\n🎯 EXACT THEORETICAL CEILING FOR READY SINGLES:');
console.log(`• Fully Completed Singles with Both Stats & PBP: ${fullyUsableSingles.toLocaleString()} matches`);
console.log(`• Currently in READY:                           31,529 matches`);
console.log(`• Recoverable Completed Singles:               +${(fullyUsableSingles - 31529).toLocaleString()} matches`);

db.close();
