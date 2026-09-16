/**
 * ════════════════════════════════════════════════════════════════════════════
 * 🌐 MULTILINGUAL PROJECTION UTILITY
 * ════════════════════════════════════════════════════════════════════════════
 * Projects multilingual JSONB / SQLite objects into single-language representations
 * based on the client's requested ?lang= query parameter.
 *
 * Implements fallback to default_lang ('en') when the requested language is
 * missing or null.
 * ════════════════════════════════════════════════════════════════════════════
 */

export type SupportedLang = 'en' | 'fa' | 'tr' | 'pt' | 'ar';

export const SUPPORTED_LANGS: SupportedLang[] = ['en', 'fa', 'tr', 'pt', 'ar'];
export const DEFAULT_LANG: SupportedLang = 'en';

/**
 * Normalizes and validates requested language parameter from query string.
 * Falls back to 'en' if missing or unsupported.
 */
export function resolveRequestedLang(rawLang?: any): SupportedLang {
  if (!rawLang || typeof rawLang !== 'string') {
    return DEFAULT_LANG;
  }
  const normalized = rawLang.toLowerCase().trim() as SupportedLang;
  return SUPPORTED_LANGS.includes(normalized) ? normalized : DEFAULT_LANG;
}

/**
 * Resolves a field (which may be a multilingual object { en, fa, tr, pt, ar }
 * or a raw string/array) into a single language value.
 */
export function projectFieldToLanguage<T = any>(
  field: any,
  lang: SupportedLang,
  fallbackLang: SupportedLang = DEFAULT_LANG
): T {
  if (field == null) return field;

  // Handle potential JSON-stringified representations
  let target = field;
  if (typeof field === 'string') {
    const trimmed = field.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          target = parsed;
        }
      } catch {}
    }
  }

  // If it's a multilingual dictionary object
  if (target && typeof target === 'object' && !Array.isArray(target)) {
    // 1. Check if the object contains language keys
    const hasLangKeys = SUPPORTED_LANGS.some((l) => l in target);
    if (hasLangKeys) {
      const val = target[lang];
      if (val !== undefined && val !== null) {
        if (typeof val === 'string' && val.trim() !== '') return val as T;
        if (Array.isArray(val) && val.length > 0) return val as T;
        if (typeof val === 'object' && Object.keys(val).length > 0) return val as T;
      }

      // Fallback to default language
      const fallbackVal = target[fallbackLang];
      if (fallbackVal !== undefined && fallbackVal !== null) {
        if (typeof fallbackVal === 'string' && fallbackVal.trim() !== '') return fallbackVal as T;
        if (Array.isArray(fallbackVal) && fallbackVal.length > 0) return fallbackVal as T;
        if (typeof fallbackVal === 'object' && Object.keys(fallbackVal).length > 0) return fallbackVal as T;
      }

      // If still missing, check 'en' explicitly
      if (fallbackLang !== 'en' && target['en'] != null) {
        return target['en'] as T;
      }

      return null as any;
    }
  }

  return target as T;
}

/**
 * Projects all analytical fields in a prediction record into the requested language.
 */
export function projectPredictionToLanguage<T extends Record<string, any>>(
  pred: T,
  lang: SupportedLang,
  fallbackLang: SupportedLang = DEFAULT_LANG
): T {
  if (!pred) return pred;

  const clone = { ...pred } as any;

  clone.ai_summary = projectFieldToLanguage(pred.ai_summary, lang, fallbackLang);
  clone.key_factors = projectFieldToLanguage(pred.key_factors, lang, fallbackLang);
  clone.devils_advocate_risk = projectFieldToLanguage(pred.devils_advocate_risk, lang, fallbackLang);
  clone.best_bet_rationale = projectFieldToLanguage(pred.best_bet_rationale, lang, fallbackLang);
  clone.alt_bet_rationale = projectFieldToLanguage(pred.alt_bet_rationale, lang, fallbackLang);

  return clone;
}

/**
 * Projects editorial analysis fields into the requested language.
 */
export function projectEditorialToLanguage<T extends Record<string, any>>(
  editorial: T,
  lang: SupportedLang,
  fallbackLang: SupportedLang = DEFAULT_LANG
): T {
  if (!editorial) return editorial;

  const clone = { ...editorial } as any;

  if (editorial.headline) clone.headline = projectFieldToLanguage(editorial.headline, lang, fallbackLang);
  if (editorial.title) clone.title = projectFieldToLanguage(editorial.title, lang, fallbackLang);
  if (editorial.summary) clone.summary = projectFieldToLanguage(editorial.summary, lang, fallbackLang);
  if (editorial.short_summary) clone.short_summary = projectFieldToLanguage(editorial.short_summary, lang, fallbackLang);
  if (editorial.guest_safe_summary) clone.guest_safe_summary = projectFieldToLanguage(editorial.guest_safe_summary, lang, fallbackLang);
  if (editorial.tactical_analysis) clone.tactical_analysis = projectFieldToLanguage(editorial.tactical_analysis, lang, fallbackLang);
  if (editorial.surface_breakdown) clone.surface_breakdown = projectFieldToLanguage(editorial.surface_breakdown, lang, fallbackLang);
  if (editorial.h2h_breakdown) clone.h2h_breakdown = projectFieldToLanguage(editorial.h2h_breakdown, lang, fallbackLang);
  if (editorial.key_facts) clone.key_facts = projectFieldToLanguage(editorial.key_facts, lang, fallbackLang);
  if (editorial.data_bullets) clone.data_bullets = projectFieldToLanguage(editorial.data_bullets, lang, fallbackLang);

  return clone;
}
