const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

async function extract() {
  const dbPath = path.join(__dirname, '..', 'data', 'database.sqlite');
  const db = new Database(dbPath);

  // 1. Fetch Today's Pool
  let todayPool = [];
  try {
    const res = await fetch('http://localhost:8080/api/web/tournaments/today');
    todayPool = await res.json();
  } catch (e) {
    console.error('Failed to fetch today pool:', e.message);
  }

  // 2. Fetch Catalog
  let catalog = [];
  try {
    const res = await fetch('http://localhost:8080/api/web/tournaments/catalog');
    catalog = await res.json();
  } catch (e) {
    console.error('Failed to fetch catalog:', e.message);
  }

  // Filter Pool for ATP & WTA
  const activeAtpWtaPool = (todayPool || []).filter(t => {
    const cat = (t.category || '').toUpperCase();
    return cat.includes('ATP') || cat.includes('WTA') || cat.includes('GRAND SLAM');
  }).map(t => ({
    tournamentId: t.tournamentId,
    name: t.name,
    category: t.category,
    surface: t.surface,
    country: t.country,
    totalMatches: t.matches ? t.matches.length : 0,
    matches: (t.matches || []).map(m => ({
      id: m.id,
      player1: m.player1,
      player2: m.player2,
      country1: m.country1,
      country2: m.country2,
      rank1: m.rank1,
      rank2: m.rank2,
      status: m.statusText || (m.isLive ? 'LIVE' : 'SCHEDULED'),
      time: m.time,
      aiVerdict: m.stats?.aiVerdict
    }))
  }));

  // Filter Catalog for ATP & WTA
  const atpWtaCatalog = (catalog || []).filter(t => {
    const cat = (t.category || '').toUpperCase();
    const tt = (t.tourType || '').toUpperCase();
    return (cat.includes('ATP') || cat.includes('WTA') || cat.includes('GRAND SLAM') || tt === 'ATP' || tt === 'WTA' || tt === 'COMBINED') && !cat.includes('CHALLENGER');
  });

  // Query Database Historical Tournaments (ATP / WTA / Grand Slam)
  const dbTournaments = db.prepare(`
    SELECT 
      tourney_name as name,
      surface,
      tourney_level as level,
      COUNT(*) as totalArchivedMatches,
      MIN(match_date) as firstRecordedDate,
      MAX(match_date) as lastRecordedDate
    FROM historical_matches
    WHERE tourney_name NOT LIKE '%Challenger%'
      AND tourney_name NOT LIKE '%ITF%'
      AND tourney_name NOT LIKE '%UTR%'
      AND tourney_name NOT LIKE '%Exhibition%'
    GROUP BY tourney_name
    ORDER BY totalArchivedMatches DESC
  `).all();

  console.log(JSON.stringify({
    activePoolCount: activeAtpWtaPool.length,
    activePoolTournaments: activeAtpWtaPool.map(t => ({ name: t.name, category: t.category, matches: t.totalMatches })),
    catalogCount: atpWtaCatalog.length,
    dbTournamentsCount: dbTournaments.length
  }, null, 2));
}

extract();
