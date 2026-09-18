const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_XP0RQcia4ZfN@ep-restless-water-b1h2k33z-pooler.c-5.eu-central-1.aws.neon.tech/neondb?sslmode=require',
});

async function main() {
  try {
    const colsRes = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'predictions'");
    console.log('Current predictions columns in Neon:', colsRes.rows.map(r => r.column_name));

    console.log('Adding gender and tour_category columns to predictions...');
    await pool.query("ALTER TABLE predictions ADD COLUMN IF NOT EXISTS gender TEXT;");
    await pool.query("ALTER TABLE predictions ADD COLUMN IF NOT EXISTS tour_category TEXT;");
    console.log('Columns added successfully.');

    const matchCheck = await pool.query("SELECT id, fixture_id, home_name, away_name, tournament_name, surface, gender, tour_category FROM predictions WHERE fixture_id = 17066578 OR home_name LIKE '%Basiletti%' OR away_name LIKE '%Basiletti%'");
    console.log('Basiletti match in Neon predictions:', matchCheck.rows);

    const intelCheck = await pool.query("SELECT fixture_id, home_name, away_name, tour, surface, updated_at FROM match_pro_intelligence WHERE fixture_id = 17066578");
    console.log('Basiletti match_pro_intelligence in Neon:', intelCheck.rows);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

main();
