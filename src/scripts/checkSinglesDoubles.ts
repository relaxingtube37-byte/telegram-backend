import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'data', 'database.sqlite');
const db = new Database(DB_PATH, { readonly: true });

console.log('--- CLASSIFYING ALL 57,977 MATCHES: SINGLES VS DOUBLES VS COMPLETE ---');

const allGold = db.prepare(`
  SELECT rapid_event_id, tourney_name, winner_name, loser_name, score, final_status, source_presence
  FROM gold_matches_validated
`).all() as any[];

let countDoubles = 0;
let countSingles = 0;
let countSinglesReady = 0;
let countSinglesExcluded = 0;

for (const g of allGold) {
  const isDoubles = (g.tourney_name && g.tourney_name.toLowerCase().includes('doubles')) ||
                    (g.winner_name && g.winner_name.includes('/')) ||
                    (g.loser_name && g.loser_name.includes('/'));

  if (isDoubles) {
    countDoubles++;
  } else {
    countSingles++;
    if (g.final_status === 'READY') {
      countSinglesReady++;
    } else {
      countSinglesExcluded++;
    }
  }
}

console.log('Total matches in gold_matches_validated:', allGold.length);
console.log('• Total DOUBLES matches:', countDoubles.toLocaleString(), `(${((countDoubles/allGold.length)*100).toFixed(1)}%)`);
console.log('• Total SINGLES matches:', countSingles.toLocaleString(), `(${((countSingles/allGold.length)*100).toFixed(1)}%)`);
console.log('  - Singles already READY:', countSinglesReady.toLocaleString(), `(${((countSinglesReady/countSingles)*100).toFixed(1)}%)`);
console.log('  - Singles currently excluded:', countSinglesExcluded.toLocaleString());

db.close();
