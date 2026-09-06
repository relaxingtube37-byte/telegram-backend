const Database = require('better-sqlite3');
const db = new Database('./data/database.sqlite');

const LAMBDA = 0.12;
const ALPHA = 0.25;

function parseToEpochMs(rawDateOrTimestamp) {
  if (!rawDateOrTimestamp) return Date.now();
  if (typeof rawDateOrTimestamp === 'number') {
    return rawDateOrTimestamp > 1e11 ? rawDateOrTimestamp : rawDateOrTimestamp * 1000;
  }
  if (typeof rawDateOrTimestamp === 'string') {
    const trimmed = rawDateOrTimestamp.trim();
    if (/^\d{10,13}$/.test(trimmed)) {
      const num = Number(trimmed);
      return num > 1e11 ? num : num * 1000;
    }
    const ms = new Date(trimmed).getTime();
    if (!isNaN(ms)) return ms;
  }
  return Date.now();
}

function calculateEnergyTank(fatigue) {
  if (!fatigue || fatigue.daysSinceLastMatch >= 14) {
    const basePct = 96;
    return {
      levelPct: basePct,
      status: 'Full',
      restStr: fatigue ? (fatigue.daysSinceLastMatch > 21 ? 'Well Rested (>3w)' : `${Math.round(fatigue.daysSinceLastMatch)}d break`) : 'Well Rested',
    };
  }

  const restHours = fatigue.restHoursSinceLastMatch !== undefined
    ? fatigue.restHoursSinceLastMatch
    : (fatigue.daysSinceLastMatch * 24);
  const days = restHours / 24;
  const lastDur = fatigue.lastMatchDurationMinutes || 105;
  const wfl = fatigue.tournamentFatigueLoad || 0;

  // 1. Single Match Strain
  const durHours = lastDur / 60;
  const matchStrain = Math.pow(Math.max(durHours, 0.5), 1.3) * 16.0;

  // 2. Continuous Exponential Saturation
  const recoveryFraction = Math.min(1.0, 1.0 - Math.exp(-0.040 * restHours));
  const unrecoveredMatchStrain = matchStrain * (1.0 - recoveryFraction);

  // 3. Cumulative Tournament Fatigue (WFL) Drain
  const cumulativeWflDrain = Math.min(22, wfl * 0.18) * (1.0 - recoveryFraction * 0.70);

  // 4. Acute Short-Rest Deficit (<24h penalty)
  const acuteRestDeficit = restHours < 24 ? Math.pow((24 - restHours) / 24, 1.2) * 14.0 : 0;

  // 5. Base Depletion for Recent Match (<48h)
  const baselineDepletion = restHours < 48 ? Math.max(0, 10 * (1 - restHours / 48)) : 0;

  const rawLevel = 100 - unrecoveredMatchStrain - cumulativeWflDrain - acuteRestDeficit - baselineDepletion;
  const levelPct = Math.max(25, Math.min(100, Math.round(rawLevel)));

  let status = 'Full';
  if (levelPct >= 85) status = 'Full';
  else if (levelPct >= 70) status = 'Good';
  else if (levelPct >= 50) status = 'Moderate';
  else status = 'Fatigued';

  return { levelPct, status };
}

function calculateWeightedFatigueLoad(lastMatches, refDate) {
  const refTimeMs = parseToEpochMs(refDate || '2026-08-27');
  let wfl = 0;
  let totalGames = 0;
  let totalCourtTimeMinutes = 0;
  let lastMatchDurationMinutes = 0;

  const priorMatches = (lastMatches || [])
    .filter(m => m.date)
    .sort((a, b) => parseToEpochMs(b.date) - parseToEpochMs(a.date));

  if (priorMatches.length === 0) {
    return {
      daysSinceLastMatch: 999,
      restHoursSinceLastMatch: 999 * 24,
      energyTankPct: 98,
      energyTankLabel: 'Full (98%)',
    };
  }

  const mostRecent = priorMatches[0];
  const mostRecentMs = parseToEpochMs(mostRecent.date);
  const rawDiffHours = Math.max(0.5, (refTimeMs - mostRecentMs) / (1000 * 60 * 60));
  const restHoursSinceLastMatch = rawDiffHours;
  const daysSinceLastMatch = restHoursSinceLastMatch / 24;

  lastMatchDurationMinutes = mostRecent.durationMinutes || 105;

  priorMatches.forEach((m) => {
    const matchMs = parseToEpochMs(m.date);
    const hoursAgo = Math.max(0, (refTimeMs - matchMs) / (1000 * 60 * 60));
    const daysAgo = hoursAgo / 24;

    let mGames = 22;
    const dur = m.durationMinutes || 105;
    totalGames += mGames;
    totalCourtTimeMinutes += dur;

    const weight = Math.exp(-LAMBDA * daysAgo);
    wfl += (mGames * 1.0 + (dur / 60) * 8.0) * weight;
  });

  const energy = calculateEnergyTank({
    tournamentFatigueLoad: wfl,
    lastMatchDurationMinutes,
    daysSinceLastMatch,
    restHoursSinceLastMatch,
  });

  return {
    daysSinceLastMatch: Math.round(daysSinceLastMatch * 10) / 10,
    restHoursSinceLastMatch: Math.round(restHoursSinceLastMatch * 10) / 10,
    energyTankPct: energy.levelPct,
    energyTankLabel: `${energy.status} (${energy.levelPct}%)`,
  };
}

function queryPlayerRecentMatches(playerName, limit = 10) {
  if (!playerName) return [];
  const rows = db.prepare(`
    SELECT match_date, tourney_name, surface, round_name, winner_name, loser_name, score, minutes
    FROM historical_matches
    WHERE winner_name LIKE ? OR loser_name LIKE ?
    ORDER BY match_date DESC
    LIMIT ?
  `).all(`%${playerName}%`, `%${playerName}%`, limit);

  return rows.map(r => ({
    date: r.match_date,
    durationMinutes: r.minutes || 105,
    winnerHome: r.winner_name.toLowerCase().includes(playerName.toLowerCase()),
    surface: r.surface,
    tournament: r.tourney_name,
  }));
}

// Test scenarios
console.log('=== Testing Realistic Player Stamina from DB ===');
const testCases = [
  { name: 'Novak Djokovic', refDate: '2026-05-26' }, // 1 day after 293-minute 5-setter
  { name: 'Novak Djokovic', refDate: '2026-05-27' }, // 2 days after
  { name: 'Novak Djokovic', refDate: '2026-06-15' }, // 3 weeks rest
  { name: 'Alexander Zverev', refDate: '2026-05-26' }, // 1 day after 256-minute 5-setter
  { name: 'Carlos Alcaraz', refDate: '2026-04-14' }, // Next day after match
  { name: 'Jannik Sinner', refDate: '2026-05-26' }, // 1 day after 216-minute match
];

for (const tc of testCases) {
  const matches = queryPlayerRecentMatches(tc.name);
  const fatigue = calculateWeightedFatigueLoad(matches, tc.refDate);
  console.log(`${tc.name.padEnd(20)} on ${tc.refDate} -> Rest: ${fatigue.daysSinceLastMatch}d (${fatigue.restHoursSinceLastMatch}h) | Energy: ${fatigue.energyTankLabel}`);
}
