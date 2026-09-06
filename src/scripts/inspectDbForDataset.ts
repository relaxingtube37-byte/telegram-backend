import { db } from '../db/connection';
import { initSchema } from '../db/schema';

initSchema();

const total = db.prepare('SELECT COUNT(*) as c FROM historical_matches').get() as { c: number };
const top100Both = db.prepare(`
  SELECT COUNT(*) as c FROM historical_matches
  WHERE winner_rank BETWEEN 1 AND 150 AND loser_rank BETWEEN 1 AND 150
`).get() as { c: number };
const withServe = db.prepare(`
  SELECT COUNT(*) as c FROM historical_matches WHERE w_svpt IS NOT NULL AND w_svpt > 0
`).get() as { c: number };
const years = db.prepare(`
  SELECT substr(match_date, 1, 4) as y, COUNT(*) as c
  FROM historical_matches
  GROUP BY y
  ORDER BY y DESC
  LIMIT 12
`).all();

console.log(JSON.stringify({ total: total.c, top100Both: top100Both.c, withServe: withServe.c, years }, null, 2));
