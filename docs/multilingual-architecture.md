# Multilingual System Architecture (Ptin AI Tennis Analytics)

This document provides a comprehensive technical reference for the 3-phase multilingual ecosystem spanning `telegram-webapp`, `telegram-backend`, and `state football`.

---

## 1. High-Level Architecture Diagram

```mermaid
flowchart TD
    subgraph SF["State Football (Generation Hub)"]
        A[Match Dossier Engine] --> B[multilingualTranslator.ts]
        B -->|translateAnalysisBundle| C["5-Language Content (en, fa, ar, tr, pt)"]
        C --> D[aiSeoEngine.ts]
        D -->|generateMatchSeo| E[MultilingualSeoBundle]
        E --> F[buildEditorialPackage.ts]
    end

    subgraph DB["Database Layer"]
        G[("Neon PostgreSQL (Cloud)")]
        H[("SQLite (Local Cache)")]
        F -->|JSONB fields| G
        F -->|JSON string fields| H
        G <-->|neon-sync.service.ts| H
    end

    subgraph BE["Telegram Backend (API & SSR)"]
        H --> I[multilingualProjection.ts]
        I -->|projectPredictionToLanguage| J["API Endpoints (?lang=fa|ar|tr|pt|en)"]
        H --> K[seo-renderer.service.ts]
        K -->|SSR HTML with hreflang & fonts| L["Match SSR Routes (/match/:slug?lang=...)"]
    end

    subgraph FE["Telegram WebApp (Frontend)"]
        M[LanguageContext & useTranslation]
        M -->|localStorage 'user_language'| N[Dynamic dir='rtl|ltr' & lang]
        M -->|Lazy font injection| O[Vazirmatn / Noto Sans Arabic]
        M -->|Fetch with ?lang=| J
        J --> P[Localized Match View & AI Dossier]
    end
```

---

## 2. Phase Breakdown

### Phase 1: Zero-Dependency UI Translation (`telegram-webapp`)
- **Dictionary Schema**: Located in `src/i18n/translations.ts`. Strict TypeScript typing (`TranslationSchema`) based on English keys.
- **Supported Languages**:
  - `en` (authoritative, LTR)
  - `fa` (Persian, RTL)
  - `ar` (Arabic, RTL)
  - `tr` (Turkish, LTR)
  - `pt` (Brazilian Portuguese, LTR)
- **Language Switcher**: Zero-dependency React Context (`LanguageProvider`) persisting choice in `localStorage['user_language']`.
- **Dynamic Direction & Fonts**:
  - Sets `<html lang="xx" dir="rtl|ltr">`.
  - Dynamically loads `Vazirmatn` font for `fa` and `Noto Sans Arabic` for `ar` via Google Fonts. No RTL fonts are loaded for Western visitors.

### Phase 2: Dynamic Multilingual AI Analysis (`state football` + `telegram-backend`)
- **Database Schema**:
  - Neon PostgreSQL: `ai_summary`, `key_factors`, `devils_advocate_risk`, `best_bet_rationale`, `alt_bet_rationale` converted to native `JSONB` (`{"en": "...", "fa": "...", ...}`).
  - SQLite: Stored as `TEXT` with strict `JSON.parse` on read and `JSON.stringify` on write in `predictions.repo.ts`.
- **Translation Pipeline**:
  - In `state football/src/domain/analysis/multilingualTranslator.ts`: `translateAnalysisBundle` takes English analytical copy and generates 4 target languages (`fa`, `tr`, `pt`, `ar`) in a single prompt call with a 35s timeout abort signal.
  - Tactical glossary context guarantees consistency between UI terms and AI copy.
- **Backend API Projection**:
  - `telegram-backend/src/utils/multilingualProjection.ts`:
    - `resolveRequestedLang(req.query.lang)` validates against `['en', 'fa', 'tr', 'pt', 'ar']` (fallback `'en'`).
    - `projectFieldToLanguage` extracts the requested language string or falls back to `en`.
    - Returns `{ lang, default_lang: 'en' }` in JSON payloads.

### Phase 3: Multilingual SEO & SSR Rendering (`state football` + `telegram-backend`)
- **Player Name Integrity Rule**:
  - Latin player names (`${home} vs ${away}`) are **100% preserved in Latin script** across all 5 languages.
  - Localization is applied exclusively to editorial and search intent keywords (`پیش‌بازی و تحلیل`, `آمار و H2H`, `تحليل مباراة`, etc.).
- **Progressive Title Clamping (<= 60 chars)**:
  - Five tiered fallbacks ensure titles never exceed 60 characters without ever truncating player surnames:
    - Tier 1: Full title with tournament and H2H/Stats keywords.
    - Tier 2: Shortened keywords with tournament.
    - Tier 3: Core keyword with tournament.
    - Tier 4: Minimal localized keyword (e.g. `تحلیل ${core}`, `${core} Preview`) dropping tournament.
    - Tier 5: Pure `matchCore` as emergency fallback.
- **Hreflang Network & Metadata**:
  - Generates 6 alternates: `x-default`, `en`, `fa`, `tr`, `pt`, `ar` with `?lang=` URLs.
  - OpenGraph locales: `en_US`, `fa_IR`, `ar_SA`, `tr_TR`, `pt_BR`.
  - Schema.org JSON-LD graph contains `SportsEvent` with `inLanguage` and `NewsArticle` with `workTranslation`.
- **Server-Side Rendering (SSR)**:
  - `telegram-backend/src/services/seo-renderer.service.ts`:
    - Renders `<html lang="xx" dir="rtl|ltr">`.
    - Injects conditional Google Fonts (`Vazirmatn` for `fa`, `Noto Sans Arabic` for `ar`, `Outfit` for others).
    - Renders all 6 `hreflang` `<link>` tags in `<head>`.
    - Localizes prerendered card UI texts and AI summaries.

---

## 3. How to Add a New Language in the Future

1. **Add Language Code**:
   - Add the code (e.g., `es` or `de`) to `SupportedLang` union in:
     - `telegram-webapp/src/i18n/translations.ts`
     - `telegram-backend/src/utils/multilingualProjection.ts`
     - `state football/src/domain/seo/aiSeoEngine.ts`
2. **Translate UI Dictionary**:
   - Add the language dictionary to `translations.ts` in `telegram-webapp`.
3. **Add Tactical Glossary Terms**:
   - Add terms to `TACTICAL_GLOSSARY_PROMPT_CONTEXT` in `multilingualTranslator.ts`.
4. **Configure Title Templates & OpenGraph**:
   - In `aiSeoEngine.ts` and `seo-renderer.service.ts`, add entries to `TITLE_TIER1`, `TITLE_TIER2`, `TITLE_TIER3`, `TITLE_MINIMAL`, `H1_TEMPLATES`, and `OG_LOCALES`.
5. **Update Font Loading (if non-Latin)**:
   - If the new language requires a dedicated font, add conditional font loading in `LanguageContext.tsx` and `seo-renderer.service.ts`.

---

## 4. Verification Test Commands

- **Backend SSR Multilingual Test**:
  ```bash
  cd g:\telegram-backend
  npx tsx scripts/test_seo_multilingual_ssr.ts
  ```
- **Full End-to-End Pipeline Test**:
  ```bash
  cd g:\telegram-backend
  npx tsx scripts/test_e2e_multilingual.ts
  ```
- **State Football SEO Engine Test**:
  ```bash
  cd "g:\state football"
  npx tsx scripts/testMultilingualSeo.ts
  ```
- **TypeScript Verification**:
  ```bash
  cd g:\telegram-backend && npm run build
  cd g:\telegram-webapp && npm run build
  cd "g:\state football" && npx tsc --noEmit
  ```
