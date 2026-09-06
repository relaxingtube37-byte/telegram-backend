import fs from 'fs';
import path from 'path';

const filePath = 'C:\\Users\\wm900_uqttgkv\\Downloads\\55555555tions_and_traces_2026-09-02.json';

console.log('═════════════════════════════════════════════════════════════════════════');
console.log('🔍 DEEP INSPECTION OF BACKTEST FILE');
console.log('File: ' + filePath);
console.log('═════════════════════════════════════════════════════════════════════════\n');

const stat = fs.statSync(filePath);
console.log(`File Size: ${(stat.size / 1024 / 1024).toFixed(2)} MB (${stat.size.toLocaleString()} bytes)`);

const raw = fs.readFileSync(filePath, 'utf8');
const data = JSON.parse(raw);

console.log('Data Type:', Array.isArray(data) ? `Array [${data.length} items]` : typeof data);

if (!Array.isArray(data)) {
  console.log('Top-level keys:', Object.keys(data));
} else {
  console.log('Sample item 0 root keys:', Object.keys(data[0] || {}));
}

// Check what items are inside
const items: any[] = Array.isArray(data) ? data : (data.predictions || data.results || data.matches || data.records || [data]);

console.log(`\nTotal Records Analyzed: ${items.length}`);

// Inspect first record structure
if (items.length > 0) {
  const sample = items[0];
  console.log('\n--- SAMPLE RECORD STRUCTURE (Record 1) ---');
  console.log('Keys:', Object.keys(sample));
  
  if (sample.fixture || sample.match) {
    console.log('Fixture/Match info:', sample.fixture || sample.match);
  }
  if (sample.prediction) {
    console.log('Prediction object keys:', Object.keys(sample.prediction));
    console.log('Prediction summary:', {
      winner: sample.prediction.predictedWinner || sample.prediction.winner,
      confidence: sample.prediction.confidence,
      probability: sample.prediction.probability,
      odds: sample.prediction.odds,
      valueBet: sample.prediction.isValueBet || sample.prediction.valueBet
    });
  }
  if (sample.agents) {
    console.log('Agents count:', Array.isArray(sample.agents) ? sample.agents.length : Object.keys(sample.agents));
  }
  if (sample.traces) {
    console.log('Traces count/keys:', Array.isArray(sample.traces) ? sample.traces.length : Object.keys(sample.traces));
  }
  if (sample.actualOutcome || sample.result || sample.settlement) {
    console.log('Settlement/Outcome:', sample.actualOutcome || sample.result || sample.settlement);
  }
}

// Calculate summary stats across all items
let wins = 0;
let losses = 0;
let pushes = 0;
let noBets = 0;
let totalBets = 0;
let totalStake = 0;
let netUnits = 0;
let brierSum = 0;
let logLossSum = 0;
let scoredMatches = 0;

const surfaces: Record<string, { total: number; wins: number; bets: number; net: number }> = {};
const tours: Record<string, { total: number; wins: number; bets: number; net: number }> = {};
const warningsCount: Record<string, number> = {};

for (const it of items) {
  const surf = (it.surface || it.fixture?.groundType || it.fixture?.surface || 'Unknown').toUpperCase();
  const tour = (it.tour || it.league?.name || 'Unknown').toUpperCase();

  if (!surfaces[surf]) surfaces[surf] = { total: 0, wins: 0, bets: 0, net: 0 };
  surfaces[surf].total++;

  if (!tours[tour]) tours[tour] = { total: 0, wins: 0, bets: 0, net: 0 };
  tours[tour].total++;

  // Check warnings / flags
  if (it.warnings && Array.isArray(it.warnings)) {
    for (const w of it.warnings) {
      warningsCount[w] = (warningsCount[w] || 0) + 1;
    }
  }
  if (it.dataWarnings && Array.isArray(it.dataWarnings)) {
    for (const w of it.dataWarnings) {
      warningsCount[w] = (warningsCount[w] || 0) + 1;
    }
  }

  // Outcome check
  const isWin = it.isWin ?? it.won ?? it.settlement?.isWin ?? (it.prediction?.predictedWinner === it.actualWinner);
  const isBet = it.isBet ?? it.placedBet ?? it.settlement?.placedBet ?? Boolean(it.bet);
  const odds = it.odds ?? it.betOdds ?? it.settlement?.odds ?? it.prediction?.odds ?? 0;
  const stake = it.stake ?? it.betStake ?? it.settlement?.stake ?? 1;

  if (isWin === true) wins++;
  else if (isWin === false) losses++;

  if (isBet) {
    totalBets++;
    totalStake += stake;
    if (isWin === true) {
      const pnl = stake * (odds - 1);
      netUnits += pnl;
      surfaces[surf].net += pnl;
    } else if (isWin === false) {
      netUnits -= stake;
      surfaces[surf].net -= stake;
    }
  }
}

console.log('\n--- AGGREGATE SUMMARY ---');
console.log(`• Total Matches in File: ${items.length}`);
console.log(`• Won Predictions: ${wins}`);
console.log(`• Lost Predictions: ${losses}`);
if (wins + losses > 0) {
  console.log(`• Accuracy: ${((wins / (wins + losses)) * 100).toFixed(2)}%`);
}
console.log(`• Total Bets Placed: ${totalBets}`);
console.log(`• Total Stake: ${totalStake.toFixed(2)}u`);
console.log(`• Net Profit/Loss: ${netUnits >= 0 ? '+' : ''}${netUnits.toFixed(2)}u`);
if (totalStake > 0) {
  console.log(`• ROI: ${((netUnits / totalStake) * 100).toFixed(2)}%`);
}

console.log('\n--- SURFACE BREAKDOWN ---');
console.table(surfaces);

if (Object.keys(warningsCount).length > 0) {
  console.log('\n--- TOP DATA WARNINGS / FLAGS ---');
  console.table(Object.entries(warningsCount).map(([k, v]) => ({ Warning: k, Count: v })));
}
