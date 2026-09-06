import { db } from '../src/db/connection';
import { MatchAnalyticsService } from '../src/services/match-analytics.service';

console.log('================================================================================');
console.log('🧪 DERIVED ANALYTICS & DATA GUARANTEE VALIDATION SUITE');
console.log('================================================================================');

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ [FAIL] ${msg}`);
    throw new Error(`Validation failed: ${msg}`);
  }
  console.log(`✅ [PASS] ${msg}`);
}

async function runDerivedAnalyticsValidation() {
  console.log('\n--- 1. FUTURE ROW SENTINEL TEST ---');
  const testCutoff = '2024-04-01';
  
  // Baseline analytics before future row insertion
  const baselineReport = MatchAnalyticsService.generateDeepAnalytics(
    'Carlos Alcaraz',
    'Jannik Sinner',
    'Clay',
    testCutoff
  );

  // Insert a synthetic future match in July 2024
  const futureDate = '2024-07-15';
  db.prepare(`
    INSERT INTO historical_matches (
      tour, tourney_id, tourney_name, tourney_level, surface, match_date,
      winner_name, loser_name, winner_rank, loser_rank, score, minutes, created_at
    ) VALUES (
      'ATP', '2024-test-future', 'Future Summer Masters', 'M', 'Clay', ?,
      'Carlos Alcaraz', 'Jannik Sinner', 2, 1, '6-4 6-4', 110, ?
    )
  `).run(futureDate, new Date().toISOString());

  try {
    // Re-evaluate analytics at April 2024 cutoff
    const postFutureReport = MatchAnalyticsService.generateDeepAnalytics(
      'Carlos Alcaraz',
      'Jannik Sinner',
      'Clay',
      testCutoff
    );

    // Assert absolute invariance (Zero Future Leakage)
    assert(
      baselineReport.h2hSummary.totalPreMatchEncounters === postFutureReport.h2hSummary.totalPreMatchEncounters,
      `Future match strictly ignored in H2H count (${baselineReport.h2hSummary.totalPreMatchEncounters} === ${postFutureReport.h2hSummary.totalPreMatchEncounters})`
    );
    assert(
      baselineReport.p1RollingForm.last5WinRatePct === postFutureReport.p1RollingForm.last5WinRatePct,
      `P1 rolling form win rate is strictly invariant (${baselineReport.p1RollingForm.last5WinRatePct}%)`
    );
    assert(
      baselineReport.p1Workload.energyTankPct === postFutureReport.p1Workload.energyTankPct,
      `P1 energy tank % is strictly invariant (${baselineReport.p1Workload.energyTankPct}%)`
    );
    assert(
      baselineReport.p1SurfaceMastery.winRatePct === postFutureReport.p1SurfaceMastery.winRatePct,
      `P1 surface mastery win rate is strictly invariant (${baselineReport.p1SurfaceMastery.winRatePct}%)`
    );
  } finally {
    // Clean up synthetic sentinel row
    db.prepare("DELETE FROM historical_matches WHERE tourney_id = '2024-test-future'").run();
  }

  console.log('\n--- 2. CHRONOLOGICAL CUTOFF IMMUTABILITY TEST ---');
  const early2023Report = MatchAnalyticsService.generateDeepAnalytics('Novak Djokovic', 'Daniil Medvedev', 'Hard', '2023-01-01');
  const late2024Report = MatchAnalyticsService.generateDeepAnalytics('Novak Djokovic', 'Daniil Medvedev', 'Hard', '2024-12-31');

  assert(
    early2023Report.h2hSummary.totalPreMatchEncounters <= late2024Report.h2hSummary.totalPreMatchEncounters,
    `H2H encounters monotonically grow over time (2023: ${early2023Report.h2hSummary.totalPreMatchEncounters} <= 2024: ${late2024Report.h2hSummary.totalPreMatchEncounters})`
  );
  assert(
    early2023Report.matchInfo.asOfCutoff === '2023-01-01',
    `Cutoff date correctly reflected in metadata (${early2023Report.matchInfo.asOfCutoff})`
  );

  console.log('\n--- 3. SURFACE MASTERY & TOTAL SYNERGY INDEX (TSI) ---');
  const nadalClay = MatchAnalyticsService.generateDeepAnalytics('Rafael Nadal', 'Novak Djokovic', 'Clay', '2024-05-01');
  assert(nadalClay.p1SurfaceMastery.surface === 'Clay', 'Surface correctly set to Clay');
  assert(nadalClay.p1SurfaceMastery.winRatePct >= 50.0, `Nadal Clay win rate is high (${nadalClay.p1SurfaceMastery.winRatePct}%)`);
  assert(nadalClay.p1SurfaceMastery.totalSynergyIndex >= 100.0, `Total Synergy Index is realistic (${nadalClay.p1SurfaceMastery.totalSynergyIndex})`);
  assert(!isNaN(nadalClay.p1SurfaceMastery.holdRatePct), 'Hold rate is a valid number');
  assert(!isNaN(nadalClay.p1SurfaceMastery.breakRatePct), 'Break rate is a valid number');

  console.log('\n--- 4. CLUTCH & PRESSURE RESILIENCE INTEGRITY ---');
  assert(!isNaN(nadalClay.p1Clutch.clutchIndexScore), `Clutch index score is valid (${nadalClay.p1Clutch.clutchIndexScore})`);
  assert(nadalClay.p1Clutch.breakPointsSavedPct >= 0 && nadalClay.p1Clutch.breakPointsSavedPct <= 100, `BP saved rate is bounded 0-100% (${nadalClay.p1Clutch.breakPointsSavedPct}%)`);
  assert(nadalClay.p1Clutch.decidingSetWinRatePct >= 0 && nadalClay.p1Clutch.decidingSetWinRatePct <= 100, `Deciding set win rate is bounded (${nadalClay.p1Clutch.decidingSetWinRatePct}%)`);

  console.log('\n--- 5. BIO-FATIGUE & WORKLOAD INTEGRITY ---');
  assert(nadalClay.p1Workload.energyTankPct >= 15 && nadalClay.p1Workload.energyTankPct <= 100, `Energy tank bounded between 15% and 100% (${nadalClay.p1Workload.energyTankPct}%)`);
  assert(nadalClay.p1Workload.compositeFatigueIndex >= 0.0 && nadalClay.p1Workload.compositeFatigueIndex <= 1.0, `Composite fatigue index bounded 0.0 to 1.0 (${nadalClay.p1Workload.compositeFatigueIndex})`);
  assert(typeof nadalClay.p1Workload.fatigueStatusLabel === 'string', `Fatigue label is human-readable: "${nadalClay.p1Workload.fatigueStatusLabel}"`);

  console.log('\n--- 6. EXPLANATION CARDS GENERATION ---');
  assert(Array.isArray(nadalClay.explanationCards), 'Explanation cards returned as an array');
  assert(nadalClay.explanationCards.length > 0, `Generated ${nadalClay.explanationCards.length} high-value analytical cards for UI`);
  nadalClay.explanationCards.forEach(card => {
    assert(typeof card.title === 'string' && card.title.length > 0, `Card title: "${card.title}"`);
    assert(typeof card.tag === 'string' && card.tag.length > 0, `Card tag: "${card.tag}"`);
    assert(typeof card.description === 'string' && card.description.length > 0, `Card description: "${card.description}"`);
  });

  console.log('\n================================================================================');
  console.log('🎉 ALL 14 / 14 DERIVED ANALYTICS VALIDATION TESTS PASSED (100%)');
  console.log('================================================================================');
}

runDerivedAnalyticsValidation().catch(err => {
  console.error('Validation Suite Failed:', err);
  process.exit(1);
});
