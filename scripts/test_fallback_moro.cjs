const { Pool } = require('pg');

async function translateWithFallback(text, targetLang) {
  if (!text || text.trim() === '') return '';
  
  // 1. Try Google Translate
  try {
    const googleUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t`;
    const res = await fetch(googleUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
      body: new URLSearchParams({ q: text }).toString(),
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const full = data[0].map(c => (c && c[0]) || '').join('').trim();
        if (full) return full;
      }
    }
  } catch {}

  // 2. Fallback to MyMemory
  try {
    const paragraphs = text.split(/\n\s*\n|\r\n\s*\r\n/);
    const translatedParas = [];
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      const chunks = trimmed.match(/.{1,450}(\s|$)/g) || [trimmed];
      const translatedChunks = [];
      for (const chunk of chunks) {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk.trim())}&langpair=en|${targetLang}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (res.ok) {
          const json = await res.json();
          if (json?.responseData?.translatedText) {
            translatedChunks.push(json.responseData.translatedText);
            continue;
          }
        }
        translatedChunks.push(chunk);
      }
      translatedParas.push(translatedChunks.join(' '));
    }
    if (translatedParas.length > 0) {
      return translatedParas.join('\n\n');
    }
  } catch {}

  return text;
}

async function main() {
  const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_XP0RQcia4ZfN@ep-restless-water-b1h2k33z-pooler.c-5.eu-central-1.aws.neon.tech/neondb?sslmode=require',
    ssl: { rejectUnauthorized: false }
  });
  const client = await pool.connect();

  const r = (await client.query('SELECT id, home_name, away_name, ai_summary, best_bet_rationale, alt_bet_rationale, devils_advocate_risk, key_factors FROM predictions WHERE id = 594375')).rows[0];

  const enSummary = r.ai_summary?.en || '';
  const faSummary = await translateWithFallback(enSummary, 'fa');
  console.log('FA Summary length:', faSummary.length);
  console.log('FA Snippet:', faSummary.slice(0, 150));

  const targetLangs = ['fa', 'ar', 'tr', 'pt'];
  const bundleSummary = { en: enSummary };
  const bundleRisk = { en: r.devils_advocate_risk?.en || '' };
  const bundleBest = { en: r.best_bet_rationale?.en || '' };
  const bundleAlt = { en: r.alt_bet_rationale?.en || '' };
  const bundleFactors = { en: Array.isArray(r.key_factors) ? r.key_factors : [] };

  for (const lang of targetLangs) {
    bundleSummary[lang] = await translateWithFallback(enSummary, lang);
    if (bundleRisk.en) bundleRisk[lang] = await translateWithFallback(bundleRisk.en, lang);
    if (bundleBest.en) bundleBest[lang] = await translateWithFallback(bundleBest.en, lang);
    if (bundleAlt.en) bundleAlt[lang] = await translateWithFallback(bundleAlt.en, lang);
    if (bundleFactors.en.length > 0) {
      bundleFactors[lang] = await Promise.all(bundleFactors.en.map(f => translateWithFallback(f, lang)));
    }
  }

  const updateRes = await client.query(`
    UPDATE predictions SET
      ai_summary = CAST($1 AS jsonb),
      best_bet_rationale = CAST($2 AS jsonb),
      alt_bet_rationale = CAST($3 AS jsonb),
      devils_advocate_risk = CAST($4 AS jsonb),
      key_factors = CAST($5 AS jsonb)
    WHERE id = $6
  `, [
    JSON.stringify(bundleSummary),
    JSON.stringify(bundleBest),
    JSON.stringify(bundleAlt),
    JSON.stringify(bundleRisk),
    JSON.stringify(bundleFactors),
    r.id
  ]);

  console.log('Update rowCount:', updateRes.rowCount);

  // Check it back
  const check = (await client.query('SELECT id, ai_summary->>\'fa\' as fa FROM predictions WHERE id = $1', [r.id])).rows[0];
  console.log('Neon FA after update:', check.fa.slice(0, 120));

  client.release();
  await pool.end();
}

main().catch(console.error);
