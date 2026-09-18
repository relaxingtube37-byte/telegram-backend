const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_XP0RQcia4ZfN@ep-restless-water-b1h2k33z-pooler.c-5.eu-central-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

async function check() {
  const res = await pool.query(`
    SELECT fixture_id, home_name, away_name, tour, payload
    FROM match_pro_intelligence
    WHERE home_name ILIKE '%Basiletti%' OR away_name ILIKE '%Basiletti%' OR home_name ILIKE '%Barthel%' OR away_name ILIKE '%Barthel%'
  `);
  console.log('Basiletti pro_intel rows in Neon:', res.rows.length);
  for (const r of res.rows) {
    console.log(r.fixture_id, r.home_name, 'vs', r.away_name, 'tour:', r.tour);
    const p1 = r.payload?.player_one;
    const p2 = r.payload?.player_two;
    console.log('P1:', p1?.full_name, 'Hold:', p1?.radar_axes?.[0]?.display_string, 'Rating:', p1?.composites?.overall_rating);
    console.log('P2:', p2?.full_name, 'Hold:', p2?.radar_axes?.[0]?.display_string, 'Rating:', p2?.composites?.overall_rating);
  }

  // Also check predictions table
  const predRes = await pool.query(`
    SELECT id, fixture_id, home_name, away_name, gender, tournament_name
    FROM predictions
    WHERE home_name ILIKE '%Basiletti%' OR away_name ILIKE '%Basiletti%'
  `);
  console.log('Predictions for Basiletti:', predRes.rows);

  await pool.end();
}

check().catch(console.error);
