const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_XP0RQcia4ZfN@ep-restless-water-b1h2k33z-pooler.c-5.eu-central-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const res = await pool.query(`
    SELECT id, home_name, away_name, (ai_summary ? 'fa') as has_fa, ai_summary->>'fa' as fa_summary, ai_summary->>'en' as en_summary
    FROM predictions
    WHERE home_name ILIKE '%Moro%' OR home_name ILIKE '%Shelton%' OR home_name ILIKE '%Burel%'
  `);
  for (const r of res.rows) {
    console.log(r.home_name, 'vs', r.away_name, 'has_fa:', r.has_fa, 'FA text:', (r.fa_summary || 'EMPTY').slice(0, 80));
  }
  await pool.end();
}

main().catch(console.error);
