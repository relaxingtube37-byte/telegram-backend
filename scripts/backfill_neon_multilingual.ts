import { Pool } from 'pg';
import { db } from '../src/db/connection';
import { ENV } from '../src/config/env';

const DELIMITER = ' ||| ';

async function translateBatch(texts: string[], targetLang: string): Promise<string[]> {
  if (!texts || texts.length === 0) return [];
  const joined = texts.join(DELIMITER);
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
    if (!res.ok) return texts;
    const data = await res.json();
    if (Array.isArray(data) && Array.isArray(data[0])) {
      const fullTranslated = data[0].map((chunk: any) => (chunk && chunk[0]) || '').join('');
      const parts = fullTranslated.split(/\s*\|\|\|\s*/);
      if (parts.length === texts.length) {
        return parts.map(p => p.trim());
      }
    }
  } catch (err: any) {
    // Graceful fallback
  }

  return texts;
}

function extractEnText(val: any): string {
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

function extractEnArray(val: any): string[] {
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
  const neonUrl = ENV.NEON_DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (!neonUrl) {
    console.error('Missing NEON_DATABASE_URL');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: neonUrl,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });

  console.log('🚀 Connecting to Neon PostgreSQL...');
  const client = await pool.connect();

  try {
    const res = await client.query(`
      SELECT id, fixture_id, home_name, away_name, ai_summary, best_bet_rationale, alt_bet_rationale, devils_advocate_risk, key_factors
      FROM predictions
      WHERE NOT (ai_summary ? 'fa') OR NOT (ai_summary ? 'ar') OR NOT (ai_summary ? 'tr') OR NOT (ai_summary ? 'pt')
      ORDER BY id DESC
    `);

    console.log(`Found ${res.rows.length} predictions in Neon missing full multilingual bundles.`);
    const targetLangs = ['fa', 'ar', 'tr', 'pt'] as const;
    let updatedCount = 0;

    for (let i = 0; i < res.rows.length; i++) {
      const p = res.rows[i];
      const enSummary = extractEnText(p.ai_summary);
      const enBest = extractEnText(p.best_bet_rationale);
      const enAlt = extractEnText(p.alt_bet_rationale);
      const enRisk = extractEnText(p.devils_advocate_risk);
      const enFactors = extractEnArray(p.key_factors);

      if (!enSummary && enFactors.length === 0) continue;

      const bundleSummary: Record<string, string> = { en: enSummary };
      const bundleBest: Record<string, string> = { en: enBest };
      const bundleAlt: Record<string, string> = { en: enAlt };
      const bundleRisk: Record<string, string> = { en: enRisk };
      const bundleFactors: Record<string, string[]> = { en: enFactors };

      const textsToTranslate: string[] = [
        enSummary || 'N/A',
        enBest || 'N/A',
        enAlt || 'N/A',
        enRisk || 'N/A',
        ...(enFactors.length > 0 ? enFactors : ['N/A'])
      ];

      for (const lang of targetLangs) {
        const translatedList = await translateBatch(textsToTranslate, lang);
        if (translatedList && translatedList.length >= 4) {
          if (enSummary && translatedList[0] !== 'N/A') bundleSummary[lang] = translatedList[0];
          if (enBest && translatedList[1] !== 'N/A') bundleBest[lang] = translatedList[1];
          if (enAlt && translatedList[2] !== 'N/A') bundleAlt[lang] = translatedList[2];
          if (enRisk && translatedList[3] !== 'N/A') bundleRisk[lang] = translatedList[3];
          if (enFactors.length > 0) {
            const factorParts = translatedList.slice(4).filter(f => f && f !== 'N/A');
            bundleFactors[lang] = factorParts.length > 0 ? factorParts : enFactors;
          }
        }
        await new Promise(r => setTimeout(r, 120));
      }

      // Update Neon PostgreSQL
      const upRes = await client.query(`
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
        p.id
      ]);

      if (upRes.rowCount === 0) {
        console.warn(`⚠️ Warning: row id ${p.id} was not updated (rowCount=0)`);
      }

      // Also update local SQLite if present
      try {
        db.prepare(`
          UPDATE predictions SET
            ai_summary = ?,
            best_bet_rationale = ?,
            alt_bet_rationale = ?,
            devils_advocate_risk = ?,
            key_factors = ?
          WHERE fixture_id = ? OR id = ?
        `).run(
          JSON.stringify(bundleSummary),
          JSON.stringify(bundleBest),
          JSON.stringify(bundleAlt),
          JSON.stringify(bundleRisk),
          JSON.stringify(bundleFactors),
          p.fixture_id,
          p.id
        );
      } catch {}

      updatedCount++;
      if (updatedCount % 5 === 0 || updatedCount === 1 || i === res.rows.length - 1) {
        console.log(`[${i + 1}/${res.rows.length}] ✓ Translated & updated match: ${p.home_name} vs ${p.away_name}`);
      }

      await new Promise(r => setTimeout(r, 100));
    }

    console.log(`\n🎉 Successfully translated ${updatedCount} predictions in Neon PostgreSQL!`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error during Neon translation:', err);
  process.exit(1);
});
