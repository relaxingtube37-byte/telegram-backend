const { Pool } = require('pg');
require('dotenv').config();

const neonUrl = process.env.NEON_DATABASE_URL || 'postgresql://neondb_owner:npg_XP0RQcia4ZfN@ep-restless-water-b1h2k33z-pooler.c-5.eu-central-1.aws.neon.tech/neondb?sslmode=require';

async function main() {
  const pool = new Pool({
    connectionString: neonUrl,
    ssl: { rejectUnauthorized: false }
  });
  const client = await pool.connect();
  const res = await client.query(`
    SELECT 
      count(*) as total,
      count(*) FILTER (WHERE ai_summary ? 'fa') as has_fa,
      count(*) FILTER (WHERE ai_summary ? 'ar') as has_ar,
      count(*) FILTER (WHERE ai_summary ? 'tr') as has_tr,
      count(*) FILTER (WHERE ai_summary ? 'pt') as has_pt,
      count(*) FILTER (WHERE NOT (ai_summary ? 'fa')) as missing_fa
    FROM predictions
  `);
  console.log('Neon Multilingual Status:', res.rows[0]);

  const sample = await client.query(`
    SELECT id, home_name, away_name, ai_summary->>'fa' as fa_summary, ai_summary->>'en' as en_summary
    FROM predictions ORDER BY id DESC LIMIT 1
  `);
  console.log('Latest Row:', sample.rows[0].home_name, 'vs', sample.rows[0].away_name);
  console.log('FA Summary snippet:', (sample.rows[0].fa_summary || '').slice(0, 120));

  client.release();
  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
