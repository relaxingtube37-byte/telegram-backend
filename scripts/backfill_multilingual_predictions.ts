import { db } from '../src/db/connection';
import { NeonSyncService } from '../src/services/neon-sync.service';

const DELIMITER = ' ||| ';

async function translateBatch(texts: string[], targetLang: string): Promise<string[]> {
  if (!texts || texts.length === 0) return [];
  const joined = texts.join(DELIMITER);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t&q=${encodeURIComponent(joined)}`;
  
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return texts;
    const data = await res.json();
    if (Array.isArray(data) && Array.isArray(data[0])) {
      const fullTranslated = data[0].map((chunk: any) => (chunk && chunk[0]) || '').join('');
      // Split back by delimiter (flexible with spaces or variations)
      const parts = fullTranslated.split(/\s*\|\|\|\s*/);
      if (parts.length === texts.length) {
        return parts.map(p => p.trim());
      }
    }
  } catch (err: any) {
    // Graceful fallback
  }

  // Fallback: return original texts if split mismatch or network error
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
  console.log('🚀 Starting Ultra-Fast Multilingual Backfill for existing predictions...');
  
  const preds = db.prepare('SELECT * FROM predictions').all() as any[];
  console.log(`Total predictions in SQLite: ${preds.length}`);
  
  const targetLangs = ['fa', 'ar', 'tr', 'pt'] as const;
  let updatedCount = 0;

  for (let i = 0; i < preds.length; i++) {
    const p = preds[i];
    
    // Check if already has full multilingual bundle
    let existingSummary: any = p.ai_summary;
    if (typeof existingSummary === 'string' && existingSummary.startsWith('{')) {
      try { existingSummary = JSON.parse(existingSummary); } catch {}
    }
    if (existingSummary && typeof existingSummary === 'object' && existingSummary.fa && existingSummary.ar && existingSummary.tr && existingSummary.pt) {
      continue;
    }

    const enSummary = extractEnText(p.ai_summary);
    const enBest = extractEnText(p.best_bet_rationale);
    const enAlt = extractEnText(p.alt_bet_rationale);
    const enRisk = extractEnText(p.devils_advocate_risk);
    const enFactors = extractEnArray(p.key_factors);

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

    // Parallel fetch for all 4 target languages
    await Promise.all(
      targetLangs.map(async (lang) => {
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
      })
    );

    db.prepare(`
      UPDATE predictions SET
        ai_summary = ?,
        best_bet_rationale = ?,
        alt_bet_rationale = ?,
        devils_advocate_risk = ?,
        key_factors = ?
      WHERE fixture_id = ?
    `).run(
      JSON.stringify(bundleSummary),
      JSON.stringify(bundleBest),
      JSON.stringify(bundleAlt),
      JSON.stringify(bundleRisk),
      JSON.stringify(bundleFactors),
      p.fixture_id
    );

    updatedCount++;
    if (updatedCount % 10 === 0 || updatedCount === 1 || i === preds.length - 1) {
      console.log(`[${i + 1}/${preds.length}] ✓ Progress: ${updatedCount} matches updated in SQLite.`);
    }

    // Small courteous pause between matches
    await new Promise(r => setTimeout(r, 120));
  }

  console.log(`\n🎉 Backfill complete! Updated ${updatedCount} predictions in SQLite.`);

  console.log('☁️ Pushing all updated predictions to Neon Cloud PostgreSQL...');
  await NeonSyncService.pushToNeon();
  console.log('✅ Neon Cloud sync completed successfully!');

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error during backfill:', err);
  process.exit(1);
});
