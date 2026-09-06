const Database = require('better-sqlite3');
const path = require('path');

async function verifyRealData() {
  const db = new Database(path.join(__dirname, '..', 'data', 'database.sqlite'));

  console.log('=== 🔍 VERIFYING REAL DATA & REAL TOURNAMENT MATCH CALCULATIONS ===\n');

  const rows = db.prepare(`
    SELECT fixture_id, tournament_name, home_name, away_name, surface, status, computed_at,
           markov_odds_json, energy_json, surface_kpis_json, tactical_json, synergy_json
    FROM match_analytics
    ORDER BY id DESC
  `).all();

  console.log('Total Precomputed Records in SQLite:', rows.length);

  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const r = rows[i];
    const markov = JSON.parse(r.markov_odds_json || '{}');
    const energy = JSON.parse(r.energy_json || '{}');
    const surfaceKpis = JSON.parse(r.surface_kpis_json || '{}');
    const tactical = JSON.parse(r.tactical_json || '{}');
    const synergy = JSON.parse(r.synergy_json || '{}');

    console.log('\n------------------------------------------------------------');
    console.log(`🎾 Match #${i + 1}: ${r.home_name} vs ${r.away_name}`);
    console.log(`🏆 Tournament: ${r.tournament_name} | Surface: ${r.surface} | Fixture ID: ${r.fixture_id}`);
    console.log(`⚡ Markov Match Win Probs: ${r.home_name} (${(markov.matchWinProbHome * 100).toFixed(1)}%) vs ${r.away_name} (${(markov.matchWinProbAway * 100).toFixed(1)}%)`);
    console.log(`💰 Fair Synthetic Odds (1/P): ${r.home_name} @ ${markov.fairOddsHome} | ${r.away_name} @ ${markov.fairOddsAway}`);
    console.log(`📊 Expected Total Games Line: ${markov.expectedTotalGames} games`);
    console.log(`🎯 Set Scores Distribution: 2-0: ${(markov.setScores?.twoZeroHome * 100).toFixed(1)}% | 2-1: ${(markov.setScores?.twoOneHome * 100).toFixed(1)}% | 0-2: ${(markov.setScores?.zeroTwoAway * 100).toFixed(1)}% | 1-2: ${(markov.setScores?.oneTwoAway * 100).toFixed(1)}%`);
    console.log(`🎾 CPI (Court Pace Index): ${surfaceKpis.cpi} | Surface ELO: ${r.home_name} (${surfaceKpis.homeSurfaceElo}) vs ${r.away_name} (${surfaceKpis.awaySurfaceElo})`);
    console.log(`🔋 Battery Tank: ${r.home_name} (${energy.home?.energyTankLabel}) vs ${r.away_name} (${energy.away?.energyTankLabel})`);
    console.log(`🤝 TSI (Total Synergy Index): ${r.home_name} (${synergy.homeSynergy?.totalSynergyIndex}% - ${synergy.homeSynergy?.label}) vs ${r.away_name} (${synergy.awaySynergy?.totalSynergyIndex}% - ${synergy.awaySynergy?.label})`);
    console.log(`🧠 Tactical Breakdown: ${tactical.handedness?.advantageSummary}`);
    console.log(`📅 Precomputed & Saved at: ${r.computed_at}`);
  }
}

verifyRealData();
