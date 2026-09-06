import { getPlayerAnalysisBundle } from '../services/localPlayerAnalysis.service';

const samplePlayers = [
  'Jannik Sinner',
  'Carlos Alcaraz',
  'Novak Djokovic',
  'Aryna Sabalenka',
  'Iga Swiatek',
];

const testDates = [
  { label: 'Current Live/Near-Live', date: '2026-08-31' },
  { label: 'End of 2024 Season', date: '2024-12-31' },
  { label: 'End of 2023 Season', date: '2023-12-31' },
  { label: 'End of 2022 Season', date: '2022-12-31' },
];

console.log('================================================================');
console.log('🎾 HISTORICAL RANK TRUTHFULNESS VERIFICATION AUDIT');
console.log('================================================================');

for (const player of samplePlayers) {
  console.log(`\nPlayer: ${player}`);
  for (const { label, date } of testDates) {
    try {
      const bundle = getPlayerAnalysisBundle({
        playerName: player,
        beforeDate: date,
        yearsBack: 1,
        recentLimit: 5,
      });
      console.log(`  [${label} (${date})] -> Point-in-time rank: ${bundle.rankAtDate != null ? '#' + bundle.rankAtDate : 'N/A'}`);
    } catch (e: any) {
      console.log(`  [${label} (${date})] -> Error: ${e.message}`);
    }
  }
}
console.log('\n================================================================\n');
