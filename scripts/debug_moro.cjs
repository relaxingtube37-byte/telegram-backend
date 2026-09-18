const { Pool } = require('pg');

const DELIMITER = ' ||| ';

async function translateBatch(texts, targetLang) {
  if (!texts || texts.length === 0) return [];
  const joined = texts.join(DELIMITER);
  console.log(`Translating ${texts.length} items, joined length: ${joined.length}`);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t`;
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      body: new URLSearchParams({ q: joined }).toString(),
      signal: AbortSignal.timeout(10000),
    });
    console.log('Google HTTP status:', res.status);
    if (!res.ok) return texts;
    const data = await res.json();
    if (Array.isArray(data) && Array.isArray(data[0])) {
      const fullTranslated = data[0].map(chunk => (chunk && chunk[0]) || '').join('');
      const parts = fullTranslated.split(/\s*\|\|\|\s*/);
      console.log('Split parts length:', parts.length, 'expected:', texts.length);
      if (parts.length === texts.length) {
        return parts.map(p => p.trim());
      }
    }
  } catch (err) {
    console.error('Fetch error:', err.message);
  }

  return texts;
}

async function main() {
  const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_XP0RQcia4ZfN@ep-restless-water-b1h2k33z-pooler.c-5.eu-central-1.aws.neon.tech/neondb?sslmode=require',
    ssl: { rejectUnauthorized: false }
  });
  const client = await pool.connect();
  const r = (await client.query('SELECT id, ai_summary, best_bet_rationale, alt_bet_rationale, devils_advocate_risk, key_factors FROM predictions WHERE id = 594375')).rows[0];

  const enSummary = r.ai_summary?.en || '';
  const enBest = r.best_bet_rationale?.en || '';
  const enAlt = r.alt_bet_rationale?.en || '';
  const enRisk = r.devils_advocate_risk?.en || '';
  const enFactors = Array.isArray(r.key_factors) ? r.key_factors : [];

  const textsToTranslate = [
    enSummary || 'N/A',
    enBest || 'N/A',
    enAlt || 'N/A',
    enRisk || 'N/A',
    ...(enFactors.length > 0 ? enFactors : ['N/A'])
  ];

  console.log('textsToTranslate items count:', textsToTranslate.length);
  const faList = await translateBatch(textsToTranslate, 'fa');
  console.log('faList length:', faList.length);
  console.log('First translated item snippet:', faList[0].slice(0, 100));

  client.release();
  await pool.end();
}

main().catch(console.error);
