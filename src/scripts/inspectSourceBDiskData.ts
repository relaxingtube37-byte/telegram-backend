import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'data', 'database.sqlite');
const db = new Database(DB_PATH, { readonly: true });

console.log('--- INSPECTING STANDALONE SOURCE B MATCHES ON DISK ---');

const sampleB = db.prepare(`
  SELECT rapid_event_id, score, winner_name, loser_name, is_retirement_or_wo, final_status
  FROM gold_matches_validated
  WHERE source_presence = 'SOURCE_B_ONLY'
  LIMIT 5
`).all() as any[];

for (const s of sampleB) {
  console.log('\nDatabase row for rapid_event_id ' + s.rapid_event_id + ':');
  console.log(s);

  const manifestPath = path.resolve(`data/bulk-match-bundles/events/${s.rapid_event_id}/manifest.json`);
  if (fs.existsSync(manifestPath)) {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    console.log('On-disk manifest.json:');
    console.log({
      match_date: m.match_date,
      tour: m.tour,
      tourney: m.tourney_name || m.tournament_name,
      winner: m.winner_name,
      loser: m.loser_name,
      score: m.score,
      surface: m.surface,
      stats_status: m.statistics_status,
      pbp_status: m.pbp_status
    });
  } else {
    console.log('Manifest does not exist on disk.');
  }
}

db.close();
