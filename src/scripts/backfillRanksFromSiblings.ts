import { TrackedPlayerRepo } from '../db/repositories/trackedPlayer.repo';
import { mergeApiMetadataOntoCsvRows } from '../services/historicalMatchMerge.service';
import { fillMissingRanksForPlayer } from '../services/incrementalApiEnrichment.service';

async function main(): Promise<void> {
  const since = process.argv[2] || '2024-01-01';
  const wtaOnly = process.argv.includes('--wta');
  const atpOnly = process.argv.includes('--atp');
  const apiFill = process.argv.includes('--api');
  const tour = wtaOnly ? 'WTA' : atpOnly ? 'ATP' : undefined;

  const players = TrackedPlayerRepo.list({ activeOnly: true, limit: 500 }).filter(
    (p) => !tour || p.tour === tour,
  );

  let merged = 0;
  let apiFilled = 0;

  for (const p of players) {
    merged += mergeApiMetadataOntoCsvRows(p.id, since);
    if (apiFill) {
      const result = await fillMissingRanksForPlayer(
        p.id,
        p.rapid_player_id,
        p.full_name,
        since,
        { maxPages: p.tour === 'WTA' ? 15 : 8, maxDetailFallbacks: 5 },
      );
      if (result.rankFilled > 0) {
        console.log(`[${p.tour}] ${p.full_name}: +${result.rankFilled} ranks (${result.rankGapsAfter} left)`);
        apiFilled += result.rankFilled;
      }
    }
  }

  console.log(`\nMerged from sibling rows: ${merged}`);
  if (apiFill) console.log(`API ranks filled: ${apiFilled}`);
  console.log(`Players processed: ${players.length} since ${since}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
