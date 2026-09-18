const { Pool } = require('pg');
const Database = require('better-sqlite3');
const path = require('path');

const neonUrl = process.env.NEON_DATABASE_URL || 'postgresql://neondb_owner:npg_XP0RQcia4ZfN@ep-restless-water-b1h2k33z-pooler.c-5.eu-central-1.aws.neon.tech/neondb?sslmode=require';

async function purgeFakeRecords() {
  const pool = new Pool({ connectionString: neonUrl, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  console.log('🚀 Checking for fake pro-intelligence records in Neon...');
  
  // Find fake records where hold rate is 0.805 for both players or DR is 1.00 for both
  const fakeNeon = await client.query(`
    SELECT fixture_id, home_name, away_name
    FROM match_pro_intelligence
    WHERE (
      (payload->'player_one'->'radar_axes'->0->>'raw_value')::numeric = 0.805 AND
      (payload->'player_two'->'radar_axes'->0->>'raw_value')::numeric = 0.805
    ) OR (
      payload->>'version' = 'baseline-fallback'
    )
  `);

  console.log(`Found ${fakeNeon.rows.length} fake pro-intelligence records in Neon.`);
  for (const r of fakeNeon.rows) {
    console.log(`- Deleting fake record #${r.fixture_id}: ${r.home_name} vs ${r.away_name}`);
  }

  if (fakeNeon.rows.length > 0) {
    const ids = fakeNeon.rows.map(r => r.fixture_id);
    const delRes = await client.query(`
      DELETE FROM match_pro_intelligence
      WHERE fixture_id = ANY($1)
    `, [ids]);
    console.log(`✓ Deleted ${delRes.rowCount} fake records from Neon.`);
  }

  // Also clean SQLite
  try {
    const dbPath = path.join(__dirname, '../data/database.sqlite');
    const db = new Database(dbPath);
    const sqliteRows = db.prepare('SELECT fixture_id, payload FROM match_pro_intelligence').all();
    let sqliteDelCount = 0;
    for (const r of sqliteRows) {
      try {
        const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
        const p1Hold = p?.player_one?.radar_axes?.[0]?.raw_value;
        const p2Hold = p?.player_two?.radar_axes?.[0]?.raw_value;
        if ((p1Hold === 0.805 && p2Hold === 0.805) || p?.version === 'baseline-fallback') {
          db.prepare('DELETE FROM match_pro_intelligence WHERE fixture_id = ?').run(r.fixture_id);
          sqliteDelCount++;
        }
      } catch {}
    }
    console.log(`✓ Deleted ${sqliteDelCount} fake records from local SQLite.`);
  } catch (err) {
    console.warn('SQLite delete warning:', err.message);
  }

  client.release();
  await pool.end();
}

purgeFakeRecords().catch(console.error);
