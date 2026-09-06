import { db } from '../db/connection';
import { initSchema } from '../db/schema';
import { purgeLegacyHistoricalPool } from '../services/localPoolMaintenance.service';
import { reindexAllTrackedPlayersFromHistorical } from '../services/playerArchive.service';
import { PlayerMatchIndexRepo } from '../db/repositories/playerMatchIndex.repo';

initSchema();

console.log('Purging legacy pool rows...');
const purged = purgeLegacyHistoricalPool();
console.log(purged);

console.log('Reindexing tracked players (2021+)...');
const reindex = reindexAllTrackedPlayersFromHistorical('2021-01-01');
console.log(reindex);

console.log('Pruning API-only duplicate index rows...');
const pruned = PlayerMatchIndexRepo.pruneApiOnlyRows();
console.log({ prunedApiOnlyRows: pruned });

const sinner = db.prepare(`SELECT id FROM tracked_players WHERE full_name LIKE '%Sinner%' LIMIT 1`).get() as { id: number };
const after = db.prepare(`
  SELECT COUNT(*) total,
    SUM(CASE WHEN h.w_serve_won_pct > 0 OR h.l_serve_won_pct > 0 THEN 1 ELSE 0 END) serve,
    SUM(CASE WHEN h.w_odds_match > 0 OR h.l_odds_match > 0 THEN 1 ELSE 0 END) odds
  FROM player_match_index pmi
  JOIN historical_matches h ON h.id = pmi.historical_match_id
  WHERE pmi.tracked_player_id = ? AND pmi.match_date >= '2021-01-01'
`).get(sinner.id);
console.log('Sinner after cleanup:', after);
