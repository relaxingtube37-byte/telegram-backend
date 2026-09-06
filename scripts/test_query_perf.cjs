const Database = require('better-sqlite3');
const db = new Database('./data/database.sqlite');
console.log('Indices:', db.prepare("PRAGMA index_list('historical_matches')").all());

console.time('Test query');
const rows = db.prepare("SELECT match_date, minutes FROM historical_matches WHERE winner_name LIKE '%Novak Djokovic%' OR loser_name LIKE '%Novak Djokovic%' ORDER BY match_date DESC LIMIT 10").all();
console.timeEnd('Test query');
console.log('Returned rows:', rows.length);
