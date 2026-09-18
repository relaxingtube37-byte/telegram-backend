import { Logger } from '../utils/logger';

const DELIMITER = ' ||| ';
const TARGET_LANGS = ['fa', 'ar', 'tr', 'pt'] as const;

export async function translateBatch(texts: string[], targetLang: string): Promise<string[]> {
  if (!texts || texts.length === 0) return [];
  const joined = texts.join(DELIMITER);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
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
        return parts.map((p: string) => p.trim());
      }
    }
  } catch {
    // Graceful fallback
  }

  return texts;
}

function parseFieldToObject(val: any): { isMulti: boolean; enText: string; obj: Record<string, any> } {
  if (!val) return { isMulti: false, enText: '', obj: {} };

  let target = val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        target = JSON.parse(trimmed);
      } catch {
        return { isMulti: false, enText: trimmed, obj: { en: trimmed } };
      }
    } else {
      return { isMulti: false, enText: trimmed, obj: { en: trimmed } };
    }
  }

  if (target && typeof target === 'object' && !Array.isArray(target)) {
    const hasFa = 'fa' in target && Boolean(target.fa);
    const hasAr = 'ar' in target && Boolean(target.ar);
    const enText = target.en || Object.values(target)[0] || '';
    return {
      isMulti: hasFa && hasAr,
      enText: typeof enText === 'string' ? enText : JSON.stringify(enText),
      obj: { ...target },
    };
  }

  return { isMulti: false, enText: '', obj: {} };
}

function parseArrayFieldToObject(val: any): { isMulti: boolean; enArray: string[]; obj: Record<string, string[]> } {
  if (!val) return { isMulti: false, enArray: [], obj: {} };

  let target = val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        target = JSON.parse(trimmed);
      } catch {
        target = [trimmed];
      }
    } else if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        target = JSON.parse(trimmed);
      } catch {
        target = [trimmed];
      }
    } else {
      target = [trimmed];
    }
  }

  if (Array.isArray(target)) {
    const enArr = target.map(String);
    return { isMulti: false, enArray: enArr, obj: { en: enArr } };
  }

  if (target && typeof target === 'object') {
    const hasFa = 'fa' in target && Array.isArray(target.fa) && target.fa.length > 0;
    const hasAr = 'ar' in target && Array.isArray(target.ar) && target.ar.length > 0;
    const enArr = Array.isArray(target.en) ? target.en.map(String) : (Object.values(target)[0] as string[]) || [];
    return {
      isMulti: hasFa && hasAr,
      enArray: Array.isArray(enArr) ? enArr : [String(enArr)],
      obj: { ...target },
    };
  }

  return { isMulti: false, enArray: [], obj: {} };
}

/**
 * Ensures a prediction object has full multilingual bundles ({ en, fa, ar, tr, pt })
 * for all analytical fields before saving to SQLite and PostgreSQL.
 */
export async function autoEnrichPredictionMultilingual(pred: any): Promise<void> {
  if (!pred) return;

  const summary = parseFieldToObject(pred.ai_summary);
  const factors = parseArrayFieldToObject(pred.key_factors);
  const risk = parseFieldToObject(pred.devils_advocate_risk);
  const bestRationale = parseFieldToObject(pred.best_bet_rationale);
  const altRationale = parseFieldToObject(pred.alt_bet_rationale);

  // If already multilingual in fa and ar, no translation needed
  if (summary.isMulti && factors.isMulti) {
    return;
  }

  const enSummary = summary.enText;
  const enFactors = factors.enArray;
  const enRisk = risk.enText;
  const enBest = bestRationale.enText;
  const enAlt = altRationale.enText;

  if (!enSummary && enFactors.length === 0) return;

  const bundleSummary: Record<string, string> = { en: enSummary, ...summary.obj };
  const bundleFactors: Record<string, string[]> = { en: enFactors, ...factors.obj };
  const bundleRisk: Record<string, string> = { en: enRisk, ...risk.obj };
  const bundleBest: Record<string, string> = { en: enBest, ...bestRationale.obj };
  const bundleAlt: Record<string, string> = { en: enAlt, ...altRationale.obj };

  const textsToTranslate: string[] = [
    enSummary || 'N/A',
    enBest || 'N/A',
    enAlt || 'N/A',
    enRisk || 'N/A',
    ...(enFactors.length > 0 ? enFactors : ['N/A']),
  ];

  try {
    await Promise.all(
      TARGET_LANGS.map(async (lang) => {
        // Only translate languages that are missing
        if (bundleSummary[lang] && bundleFactors[lang]) return;

        const translatedList = await translateBatch(textsToTranslate, lang);
        if (translatedList && translatedList.length >= 4) {
          if (enSummary && translatedList[0] !== 'N/A') bundleSummary[lang] = translatedList[0];
          if (enBest && translatedList[1] !== 'N/A') bundleBest[lang] = translatedList[1];
          if (enAlt && translatedList[2] !== 'N/A') bundleAlt[lang] = translatedList[2];
          if (enRisk && translatedList[3] !== 'N/A') bundleRisk[lang] = translatedList[3];
          if (enFactors.length > 0) {
            const factorParts = translatedList.slice(4).filter((f) => f && f !== 'N/A');
            bundleFactors[lang] = factorParts.length > 0 ? factorParts : enFactors;
          }
        }
      })
    );

    pred.ai_summary = bundleSummary;
    pred.key_factors = bundleFactors;
    pred.devils_advocate_risk = bundleRisk;
    pred.best_bet_rationale = bundleBest;
    pred.alt_bet_rationale = bundleAlt;
  } catch (err: any) {
    Logger.warn?.(`[MultilingualEnricher] Auto-enrich failed: ${err.message}`);
  }
}
