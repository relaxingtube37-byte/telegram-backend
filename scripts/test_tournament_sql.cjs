const Database = require('better-sqlite3');
const db = new Database('./data/database.sqlite');

function getPattern(rawName) {
  const low = rawName.toLowerCase().trim();
  if (low.includes('atp finals') || low === 'finals' || low.includes('tour finals')) {
    return { sql: "(tourney_name LIKE '%Tour Finals%' OR tourney_name LIKE '%ATP Finals%')", params: [] };
  }
  if (low.includes('davis cup') || low.startsWith('davis')) {
    return { sql: "tourney_name LIKE 'Davis Cup%'", params: [] };
  }
  if (low.includes('us open')) {
    return { sql: "(tourney_name LIKE '%US Open%' OR tourney_name LIKE '%Us Open%')", params: [] };
  }
  return { sql: "tourney_name LIKE ?", params: [`%${rawName}%`] };
}

const names = [
  'ATP Finals',
  'Davis Cup (World Team Championship)',
  'US Open',
  'Wimbledon',
  'Miami Masters',
  'Winston-Salem',
  'Indian Wells Masters',
  'Monte Carlo Masters',
  'Madrid Masters',
  'Rome Masters',
  'Cincinnati Masters',
  'Canada Masters',
  'Shanghai Masters',
  'Paris Masters',
  'Roland Garros',
  'Australian Open'
];

for (const name of names) {
  const { sql, params } = getPattern(name);
  const count = db.prepare('SELECT count(1) as c FROM historical_matches WHERE ' + sql).get(...params).c;
  console.log(name.padEnd(38), '->', count, 'matches');
}
