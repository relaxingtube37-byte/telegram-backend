/**
 * Tests unified player archive: CSV link + API bundles + player_match_index.
 * Usage: tsx src/scripts/testPlayerArchiveUnification.ts
 */
import { TrackedPlayerRepo } from '../db/repositories/trackedPlayer.repo';
import { PlayerMatchIndexRepo } from '../db/repositories/playerMatchIndex.repo';
import { getPlayerArchive, getPlayerMatchBundle, syncPlayerArchiveUnified } from '../services/playerArchive.service';
import { registerPlayer } from '../services/playerSync.service';
import { ENV } from '../config/env';

async function main() {
  if (!ENV.RAPIDAPI_KEY) {
    console.error('RAPIDAPI_KEY required for live API bundle test');
    process.exit(1);
  }

  const { player } = await registerPlayer({
    rapidPlayerId: 206570,
    tour: 'ATP',
    addedBy: 'test_script',
  });

  console.log('Tracked player:', player.full_name, '#', player.id);

  const sync = await syncPlayerArchiveUnified(player.id, {
    sinceDate: '2025-01-01',
    maxPages: 1,
    maxBundleFetches: 3,
    linkCsv: true,
    fetchBundles: true,
  });

  console.log('\n=== SYNC RESULT ===');
  console.log(JSON.stringify(sync, null, 2));

  const archive = getPlayerArchive(player.id);
  console.log('\n=== ARCHIVE SUMMARY ===');
  console.log(JSON.stringify(archive?.summary, null, 2));
  console.log('Sample matches:', archive?.matches.slice(0, 5));

  const fullMatch = archive?.matches.find((m) => m.completeness === 'full');
  if (fullMatch) {
    const bundle = getPlayerMatchBundle(player.id, fullMatch.id);
    const statsBytes = JSON.stringify(bundle?.api?.statistics || {}).length;
    const pbpBytes = JSON.stringify(bundle?.api?.pointByPoint || {}).length;
    console.log('\n=== FULL BUNDLE SAMPLE ===', fullMatch.opponent, fullMatch.matchDate);
    console.log('CSV row:', Boolean(bundle?.historical));
    console.log('API statistics bytes:', statsBytes);
    console.log('API PBP bytes:', pbpBytes);
  } else {
    console.warn('\nNo full bundle match yet (may need more API quota or pages)');
  }

  const idxSummary = PlayerMatchIndexRepo.summaryForPlayer(player.id);
  if (idxSummary.total === 0) {
    console.error('FAIL: player_match_index is empty');
    process.exit(1);
  }

  console.log('\n✅ PASS: player_match_index has', idxSummary.total, 'matches');
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
