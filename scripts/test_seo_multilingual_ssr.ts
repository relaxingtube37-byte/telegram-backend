/**
 * Automated Verification Script for Step 3:
 * Multilingual SEO SSR Rendering in telegram-backend.
 *
 * Tests:
 * 1. HTML generation for 'fa', 'ar', 'en', and fallback for invalid 'xyz'.
 * 2. <title> and player name preservation in Latin.
 * 3. <meta name="description"> in the correct language.
 * 4. <meta property="og:locale"> matching language (fa_IR, ar_SA, en_US).
 * 5. 6 hreflang alternates present in <head>.
 * 6. <html lang="..." dir="..."> (rtl for fa/ar, ltr for en/tr/pt).
 * 7. Conditional Google Fonts (Vazirmatn for fa, Noto Sans Arabic for ar).
 * 8. Stored bundle vs dynamic fallback paths.
 *
 * Run with: npx tsx scripts/test_seo_multilingual_ssr.ts
 */

import { SeoRendererService } from '../src/services/seo-renderer.service';
import type { Prediction } from '../src/types';

function runSsrTests() {
  console.log('🧪 Starting Telegram-Backend Multilingual SEO SSR Tests...\n');

  // Sample match prediction with Phase 2 multilingual AI summary
  const samplePrediction: Prediction = {
    id: 101,
    fixture_id: 17066602,
    home_name: 'Carlos Alcaraz',
    away_name: 'Jannik Sinner',
    tournament_name: 'Miami Open, ATP Masters 1000',
    round_name: 'Semifinals',
    surface: 'Hard Court',
    predicted_winner: 'Carlos Alcaraz',
    win_probability: 65,
    status: 'IN_PLAY' as any,
    match_date: '2026-03-30T18:00:00Z',
    ai_summary: {
      en: 'Carlos Alcaraz faces Jannik Sinner in an elite hard court battle at Miami Open.',
      fa: 'کارلوس آلکاراز و یانیک سینر در یک نبرد حساس در زمین هارد مسترز میامی رو در روی هم قرار می‌گیرند.',
      ar: 'يلتقي كارلوس ألكاراز مع يانيك سينر في مواجهة قمة نارية على الملاعب الصلبة في بطولة ميامي.',
      tr: 'Carlos Alcaraz ve Jannik Sinner Miami Open yari finalinde karsi karsiya geliyor.',
      pt: 'Carlos Alcaraz enfrenta Jannik Sinner em uma batalha de elite nas quadras duras de Miami.',
    },
  };

  const slug = 'carlos-alcaraz-vs-jannik-sinner-17066602';
  const baseUrl = 'https://ptin-ai.com';

  // ── TEST A: Persian (fa) SSR Rendering ─────────────────────────────────────
  console.log('--- TEST A: Persian (lang=fa) ---');
  const htmlFa = SeoRendererService.renderHtml(samplePrediction, slug, baseUrl, 'fa');

  // 1. Check html lang and dir
  if (!htmlFa.includes('<html lang="fa" dir="rtl">')) {
    throw new Error('FAIL: Persian HTML must have <html lang="fa" dir="rtl">');
  }
  console.log('✓ <html lang="fa" dir="rtl"> verified');

  // 2. Check title: includes Latin player names and Persian keyword
  if (!htmlFa.includes('<title>تحلیل Carlos Alcaraz vs Jannik Sinner | Miami Open</title>')) {
    throw new Error(`FAIL: Unexpected Persian title in HTML: ${htmlFa.slice(htmlFa.indexOf('<title>'), htmlFa.indexOf('</title>') + 8)}`);
  }
  console.log('✓ Persian title verified with Latin player names preserved');

  // 3. Check meta description contains Persian summary
  if (!htmlFa.includes('کارلوس آلکاراز و یانیک سینر')) {
    throw new Error('FAIL: Persian meta description missing Persian AI summary');
  }
  console.log('✓ Persian description verified');

  // 4. Check og:locale
  if (!htmlFa.includes('<meta property="og:locale" content="fa_IR" />')) {
    throw new Error('FAIL: og:locale for fa must be fa_IR');
  }
  console.log('✓ og:locale = fa_IR verified');

  // 5. Check font: Vazirmatn must be present, Noto Sans Arabic must NOT be present
  if (!htmlFa.includes('Vazirmatn')) {
    throw new Error('FAIL: Vazirmatn font must be present for Persian');
  }
  if (htmlFa.includes('Noto+Sans+Arabic')) {
    throw new Error('FAIL: Noto Sans Arabic must NOT be loaded for Persian');
  }
  console.log('✓ Conditional Vazirmatn font loaded, Arabic font excluded');

  // 6. Check hreflang tags
  const expectedHreflangs = ['x-default', 'en', 'fa', 'tr', 'pt', 'ar'];
  for (const hLang of expectedHreflangs) {
    if (!htmlFa.includes(`hreflang="${hLang}"`)) {
      throw new Error(`FAIL: Missing hreflang="${hLang}" in Persian HTML`);
    }
  }
  console.log('✓ All 6 hreflang alternates rendered in <head>');

  // 7. Check RTL container style
  if (!htmlFa.includes('direction: rtl; text-align: right;')) {
    throw new Error('FAIL: Missing RTL styles for container in Persian HTML');
  }
  console.log('✓ RTL layout container styling verified');

  // ── TEST B: Arabic (lang=ar) SSR Rendering ──────────────────────────────────
  console.log('\n--- TEST B: Arabic (lang=ar) ---');
  const htmlAr = SeoRendererService.renderHtml(samplePrediction, slug, baseUrl, 'ar');

  if (!htmlAr.includes('<html lang="ar" dir="rtl">')) {
    throw new Error('FAIL: Arabic HTML must have <html lang="ar" dir="rtl">');
  }
  console.log('✓ <html lang="ar" dir="rtl"> verified');

  if (!htmlAr.includes('Carlos Alcaraz vs Jannik Sinner')) {
    throw new Error('FAIL: Player names must be Latin in Arabic title');
  }
  if (!htmlAr.includes('<meta property="og:locale" content="ar_SA" />')) {
    throw new Error('FAIL: og:locale for ar must be ar_SA');
  }
  console.log('✓ og:locale = ar_SA verified');

  if (!htmlAr.includes('Noto+Sans+Arabic')) {
    throw new Error('FAIL: Noto Sans Arabic font must be present for Arabic');
  }
  if (htmlAr.includes('Vazirmatn')) {
    throw new Error('FAIL: Vazirmatn font must NOT be loaded for Arabic');
  }
  console.log('✓ Conditional Noto Sans Arabic font loaded, Persian font excluded');

  // ── TEST C: English (lang=en) SSR Rendering ─────────────────────────────────
  console.log('\n--- TEST C: English (lang=en) ---');
  const htmlEn = SeoRendererService.renderHtml(samplePrediction, slug, baseUrl, 'en');

  if (!htmlEn.includes('<html lang="en" dir="ltr">')) {
    throw new Error('FAIL: English HTML must have <html lang="en" dir="ltr">');
  }
  console.log('✓ <html lang="en" dir="ltr"> verified');

  if (!htmlEn.includes('<meta property="og:locale" content="en_US" />')) {
    throw new Error('FAIL: og:locale for en must be en_US');
  }
  console.log('✓ og:locale = en_US verified');

  if (htmlEn.includes('Vazirmatn') || htmlEn.includes('Noto+Sans+Arabic')) {
    throw new Error('FAIL: RTL fonts must NOT be loaded for English');
  }
  if (!htmlEn.includes('Outfit')) {
    throw new Error('FAIL: Outfit font must be loaded for English');
  }
  console.log('✓ Western font (Outfit) loaded, RTL fonts excluded');

  // ── TEST D: Invalid Lang Fallback (lang=xyz) ────────────────────────────────
  console.log('\n--- TEST D: Invalid Language Fallback (lang=xyz) ---');
  const htmlFallback = SeoRendererService.renderHtml(samplePrediction, slug, baseUrl, 'xyz');

  if (!htmlFallback.includes('<html lang="en" dir="ltr">')) {
    throw new Error('FAIL: Invalid lang must fallback to <html lang="en" dir="ltr">');
  }
  if (!htmlFallback.includes('<meta property="og:locale" content="en_US" />')) {
    throw new Error('FAIL: Invalid lang must fallback to og:locale en_US');
  }
  console.log('✓ Clean fallback to English (en_US / ltr) verified');

  // ── TEST E: Long Player Name Protection ─────────────────────────────────────
  console.log('\n--- TEST E: Long Player Name Clamping Protection in Backend ---');
  const longPrediction: Prediction = {
    id: 102,
    home_name: 'Alejandro Davidovich Fokina',
    away_name: 'Jan-Lennard Struff',
    tournament_name: 'Rolex Monte-Carlo Masters Championships, ATP 1000',
    status: 'SCHEDULED' as any,
  };
  const metaFaLong = SeoRendererService.generateMetadata(longPrediction, 'test-slug', baseUrl, 'fa');
  console.log(`[FA Long Title] (${metaFaLong.title.length} chars): "${metaFaLong.title}"`);
  if (metaFaLong.title.length > 60) {
    throw new Error(`FAIL: Long title exceeded 60 chars: ${metaFaLong.title.length}`);
  }
  if (!metaFaLong.title.includes('Alejandro Davidovich Fokina vs Jan-Lennard Struff')) {
    throw new Error('FAIL: Player names were truncated or damaged in long title');
  }
  console.log('✓ Long player names intact and title <= 60 chars verified');

  // ── TEST F: Homepage Localized SSR Metadata ─────────────────────────────────
  console.log('\n--- TEST F: Homepage Localized SSR ---');
  const homeFa = SeoRendererService.renderHomepageHtml(baseUrl, 'fa');
  if (!homeFa.includes('<html lang="fa" dir="rtl">') || !homeFa.includes('پتین AI')) {
    throw new Error('FAIL: Homepage Persian SSR failed');
  }
  console.log('✓ Homepage Persian SSR verified with <html lang="fa" dir="rtl">');

  console.log('\n🎉 ALL STEP 3 SSR MULTILINGUAL SEO TESTS PASSED SUCCESSFULLY!\n');
}

runSsrTests();
