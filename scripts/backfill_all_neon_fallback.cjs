const { Pool } = require('pg');

async function translateWithFallback(text, targetLang) {
  if (!text || typeof text !== 'string' || text.trim() === '') return '';
  
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
      signal: AbortSignal.timeout(5000),
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
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
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

function extractEn(val) {
  if (!val) return '';
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const obj = JSON.parse(trimmed);
        return obj.en || obj.fa || Object.values(obj)[0] || '';
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (typeof val === 'object') {
    return val.en || Object.values(val)[0] || '';
  }
  return '';
}

function extractEnArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const obj = JSON.parse(trimmed);
        const arr = obj.en || Object.values(obj)[0];
        return Array.isArray(arr) ? arr.map(String) : [String(arr)];
      } catch {
        return [trimmed];
      }
    }
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const arr = JSON.parse(trimmed);
        return Array.isArray(arr) ? arr.map(String) : [];
      } catch {
        return [trimmed];
      }
    }
    return [trimmed];
  }
  if (typeof val === 'object') {
    const arr = val.en || Object.values(val)[0];
    return Array.isArray(arr) ? arr.map(String) : [];
  }
  return [];
}

async function main() {
  const neonUrl = process.env.NEON_DATABASE_URL || 'postgresql://neondb_owner:npg_XP0RQcia4ZfN@ep-restless-water-b1h2k33z-pooler.c-5.eu-central-1.aws.neon.tech/neondb?sslmode=require';
  const pool = new Pool({
    connectionString: neonUrl,
    ssl: { rejectUnauthorized: false }
  });
  const client = await pool.connect();

  const missing = (await client.query(`
    SELECT id, fixture_id, home_name, away_name, ai_summary, best_bet_rationale, alt_bet_rationale, devils_advocate_risk, key_factors
    FROM predictions
    WHERE NOT (ai_summary ? 'fa') OR ai_summary->>'fa' = ''
    ORDER BY id DESC
  `)).rows;

  console.log(`Found ${missing.length} predictions missing 'fa' in Neon.`);

  const targetLangs = ['fa', 'ar', 'tr', 'pt'];
  let count = 0;

  for (const r of missing) {
    const enSummary = extractEn(r.ai_summary);
    const enBest = extractEn(r.best_bet_rationale);
    const enAlt = extractEn(r.alt_bet_rationale);
    const enRisk = extractEn(r.devils_advocate_risk);
    const enFactors = extractEnArray(r.key_factors);

    if (!enSummary && enFactors.length === 0) continue;

    const bundleSummary = { en: enSummary };
    const bundleBest = { en: enBest };
    const bundleAlt = { en: enAlt };
    const bundleRisk = { en: enRisk };
    const bundleFactors = { en: enFactors };

    for (const lang of targetLangs) {
      if (enSummary) bundleSummary[lang] = await translateWithFallback(enSummary, lang);
      if (enBest) bundleBest[lang] = await translateWithFallback(enBest, lang);
      if (enAlt) bundleAlt[lang] = await translateWithFallback(enAlt, lang);
      if (enRisk) bundleRisk[lang] = await translateWithFallback(enRisk, lang);
      if (enFactors.length > 0) {
        bundleFactors[lang] = await Promise.all(enFactors.map(f => translateWithFallback(f, lang)));
      }
    }

    await client.query(`
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

    count++;
    console.log(`[${count}/${missing.length}] ✓ Updated: ${r.home_name} vs ${r.away_name}`);
  }

  console.log(`Finished updating ${count} predictions.`);
  client.release();
  await pool.end();
}

main().catch(console.error);
