import { PredictionsRepo } from '../db/repositories/predictions.repo';
import { EditorialsRepo } from '../db/repositories/editorials.repo';
import type { Prediction } from '../types';
import {
  resolveRequestedLang,
  projectFieldToLanguage,
  type SupportedLang,
  SUPPORTED_LANGS,
  DEFAULT_LANG,
} from '../utils/multilingualProjection';

export interface SeoMetadata {
  title: string;
  description: string;
  canonicalUrl: string;
  ogTitle: string;
  ogDescription: string;
  ogUrl: string;
  ogType: string;
  ogImage: string;
  ogLocale: string;
  twitterCard: string;
  twitterTitle: string;
  twitterDescription: string;
  twitterImage: string;
  jsonLd: Record<string, any>;
  lang: SupportedLang;
  dir: 'rtl' | 'ltr';
  hreflangAlternates: Array<{ lang: string; href: string }>;
  h1: string;
}

const OG_LOCALES: Record<SupportedLang, string> = {
  en: 'en_US',
  fa: 'fa_IR',
  ar: 'ar_SA',
  tr: 'tr_TR',
  pt: 'pt_BR',
};

const TITLE_TIER1: Record<SupportedLang, (core: string, tourn: string) => string> = {
  en: (core, tourn) => `${core} Preview, H2H & Stats | ${tourn}`,
  fa: (core, tourn) => `پیش‌بازی و تحلیل ${core} | آمار و H2H | ${tourn}`,
  ar: (core, tourn) => `تحليل مباراة ${core} | الإحصائيات و H2H | ${tourn}`,
  tr: (core, tourn) => `${core} Maç Önü, H2H ve İstatistikler | ${tourn}`,
  pt: (core, tourn) => `Prévia ${core}, H2H e Estatísticas | ${tourn}`,
};

const TITLE_TIER2: Record<SupportedLang, (core: string, tourn: string) => string> = {
  en: (core, tourn) => `${core} Preview & Stats | ${tourn}`,
  fa: (core, tourn) => `پیش‌بازی و تحلیل ${core} | ${tourn}`,
  ar: (core, tourn) => `تحليل مباراة ${core} | ${tourn}`,
  tr: (core, tourn) => `${core} Maç Önü ve Analiz | ${tourn}`,
  pt: (core, tourn) => `Prévia e Análise ${core} | ${tourn}`,
};

const TITLE_TIER3: Record<SupportedLang, (core: string, tourn: string) => string> = {
  en: (core, tourn) => `${core} Preview | ${tourn}`,
  fa: (core, tourn) => `تحلیل ${core} | ${tourn}`,
  ar: (core, tourn) => `تحليل ${core} | ${tourn}`,
  tr: (core, tourn) => `${core} Analizi | ${tourn}`,
  pt: (core, tourn) => `Prévia ${core} | ${tourn}`,
};

const TITLE_MINIMAL: Record<SupportedLang, (core: string) => string> = {
  en: (core) => `${core} Preview`,
  fa: (core) => `تحلیل ${core}`,
  ar: (core) => `تحليل ${core}`,
  tr: (core) => `${core} Analizi`,
  pt: (core) => `Prévia ${core}`,
};

const H1_TEMPLATES: Record<SupportedLang, (core: string, tourn: string) => string> = {
  en: (core, tourn) => `${core}: Match Analysis — ${tourn}`,
  fa: (core, tourn) => `${core}: تحلیل تخصصی مسابقه — ${tourn}`,
  ar: (core, tourn) => `${core}: تحليل المباراة التكتيكي — ${tourn}`,
  tr: (core, tourn) => `${core}: Maç Analizi ve İstatistikler — ${tourn}`,
  pt: (core, tourn) => `${core}: Análise Tática da Partida — ${tourn}`,
};

/**
 * Clamps title to <= 60 characters WITHOUT EVER truncating player names.
 * Progressively simplifies auxiliary terms and drops tournament if needed.
 */
function clampTitlePreservingPlayers(
  lang: SupportedLang,
  home: string,
  away: string,
  tourn: string
): string {
  const matchCore = `${home} vs ${away}`;
  const cleanTourn = tourn.replace(/,?\s*(ATP|WTA|Grand Slam|Masters|Challenger|ITF).*/i, '').trim() || tourn;

  // Tier 1: Full title
  const t1 = TITLE_TIER1[lang](matchCore, cleanTourn);
  if (t1.length <= 60) return t1;

  // Tier 2: Shortened accessory keywords
  const t2 = TITLE_TIER2[lang](matchCore, cleanTourn);
  if (t2.length <= 60) return t2;

  // Tier 3: Core keyword with tournament
  const t3 = TITLE_TIER3[lang](matchCore, cleanTourn);
  if (t3.length <= 60) return t3;

  // Tier 4: Minimal title (drops tournament completely to preserve players)
  const t4 = TITLE_MINIMAL[lang](matchCore);
  if (t4.length <= 60) return t4;

  // Emergency fallback: matchCore itself (NEVER truncate player names)
  return matchCore;
}

function truncateDesc(str: string, maxLen = 160): string {
  const clean = str.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  const cut = clean.slice(0, maxLen - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 100 ? cut.slice(0, lastSpace) : cut) + '…';
}

function resolveLocalizedDescription(
  lang: SupportedLang,
  prediction: Prediction,
  tourn: string,
  home: string,
  away: string,
  surface: string,
  round: string
): string {
  // 1. Check if prediction.ai_summary has localized text for requested lang
  const aiSummaryLang = projectFieldToLanguage<string>(prediction.ai_summary, lang);
  if (aiSummaryLang && typeof aiSummaryLang === 'string' && aiSummaryLang.trim()) {
    const stripped = aiSummaryLang.replace(/^[🌐📊🎯⚠️🧠🏃📝\s]+/, '').trim();
    const firstPara = stripped.split(/\n\s*\n/)[0].trim();
    return truncateDesc(firstPara, 160);
  }

  // 2. High-CTR fallback templates per language
  switch (lang) {
    case 'fa':
      return truncateDesc(
        `پیش‌بازی و آمار H2H تقابل ${home} vs ${away} در ${tourn} (${round}). تحلیل تاکتیکی سطح ${surface}، فرم بازیکنان و پیش‌بینی هوش مصنوعی.`,
        160
      );
    case 'ar':
      return truncateDesc(
        `تحليل شامل وإحصائيات H2H لمباراة ${home} vs ${away} في ${tourn} (${round}). قراءة تكتيكية على أرضية ${surface} ونسب الفوز المعتمدة.`,
        160
      );
    case 'tr':
      return truncateDesc(
        `${tourn} (${round}) kapsamındaki ${home} vs ${away} maçı için H2H istatistikleri ve taktiksel analiz. ${surface} kort verileri ve yapay zeka tahminleri.`,
        160
      );
    case 'pt':
      return truncateDesc(
        `Prévia completa e estatísticas H2H para ${home} vs ${away} no ${tourn} (${round}). Dossiê tático na superfície ${surface} e projeções Ptin AI.`,
        160
      );
    case 'en':
    default:
      return truncateDesc(
        `Full match preview & head-to-head stats for ${home} vs ${away} at ${tourn} (${round}). Tactical breakdown on ${surface}, form, and statistics.`,
        160
      );
  }
}

function generateHreflangs(canonicalBase: string): Array<{ lang: string; href: string }> {
  return [
    { lang: 'x-default', href: canonicalBase },
    { lang: 'en', href: `${canonicalBase}?lang=en` },
    { lang: 'fa', href: `${canonicalBase}?lang=fa` },
    { lang: 'tr', href: `${canonicalBase}?lang=tr` },
    { lang: 'pt', href: `${canonicalBase}?lang=pt` },
    { lang: 'ar', href: `${canonicalBase}?lang=ar` },
  ];
}

export const SeoRendererService = {
  /**
   * Resolves a match prediction from fixture ID, primary ID, or slug string.
   */
  findMatch: (idOrSlug: string): { prediction: Prediction; slug: string } | null => {
    if (!idOrSlug) return null;
    const param = String(idOrSlug).trim();

    let prediction: Prediction | null = null;
    let resolvedSlug = '';

    // 1. Direct integer check (fixtureId or id)
    if (/^\d+$/.test(param)) {
      const num = parseInt(param, 10);
      prediction = PredictionsRepo.getByFixtureId(num) || PredictionsRepo.getById(num);
    }

    // 2. Slug check in Editorials table
    if (!prediction) {
      const editorial = EditorialsRepo.getBySlug(param);
      if (editorial && editorial.fixture_id) {
        prediction = PredictionsRepo.getByFixtureId(editorial.fixture_id);
        resolvedSlug = editorial.slug;
      }
    }

    // 3. Trailing ID in slug (e.g. carlos-alcaraz-vs-jannik-sinner-12345)
    if (!prediction) {
      const trailingMatch = param.match(/-(\d+)$/);
      if (trailingMatch) {
        const trailingId = parseInt(trailingMatch[1], 10);
        prediction = PredictionsRepo.getByFixtureId(trailingId) || PredictionsRepo.getById(trailingId);
      }
    }

    // 4. Fuzzy slug comparison over active & recent predictions
    if (!prediction) {
      const normalized = param.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const all = PredictionsRepo.getAll(100);
      for (const p of all) {
        const testSlug = `${p.home_name}-vs-${p.away_name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        if (normalized.includes(testSlug) || testSlug.includes(normalized)) {
          prediction = p;
          break;
        }
      }
    }

    if (!prediction) return null;

    if (!resolvedSlug) {
      const homeSlug = (prediction.home_name || 'player1').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const awaySlug = (prediction.away_name || 'player2').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const idPart = prediction.fixture_id || prediction.id;
      resolvedSlug = `${homeSlug}-vs-${awaySlug}-${idPart}`;
    }

    return { prediction, slug: resolvedSlug };
  },

  /**
   * Generates route-specific SEO meta tags and Schema.org JSON-LD.
   * Prefers stored editorial multilingual SEO bundle when available,
   * falling back cleanly to dynamic per-language generation preserving player names.
   */
  generateMetadata: (
    prediction: Prediction,
    slug: string,
    baseUrl = 'https://ptin-ai.com',
    requestedLang?: any
  ): SeoMetadata => {
    const lang = resolveRequestedLang(requestedLang);
    const dir: 'rtl' | 'ltr' = lang === 'fa' || lang === 'ar' ? 'rtl' : 'ltr';
    const ogLocale = OG_LOCALES[lang];
    const canonicalBase = `${baseUrl}/match/${slug}`;
    const localizedCanonicalUrl = lang === 'en' ? canonicalBase : `${canonicalBase}?lang=${lang}`;
    const defaultOgImage = `${baseUrl}/og-tennis-banner.jpg`;

    const home = prediction.home_name || 'Player 1';
    const away = prediction.away_name || 'Player 2';
    const matchTitle = `${home} vs ${away}`;
    const tournament = prediction.tournament_name || 'ATP/WTA Tour';
    const surface = prediction.surface || 'Hard';
    const round = prediction.round_name || '';

    const editorial = prediction.fixture_id
      ? EditorialsRepo.getByFixtureId(prediction.fixture_id)
      : EditorialsRepo.getBySlug(slug);

    let parsedSeoBundle: any = null;
    if (editorial?.seo_metadata_json) {
      try {
        parsedSeoBundle = JSON.parse(editorial.seo_metadata_json);
      } catch {}
    }

    // 1. Check if stored editorial has multilingual bundle
    if (parsedSeoBundle?.multilingual?.[lang]) {
      const lSeo = parsedSeoBundle.multilingual[lang];
      const cleanDesc = truncateDesc(lSeo.metaDescription, 160);
      return {
        title: lSeo.metaTitle,
        description: cleanDesc,
        canonicalUrl: localizedCanonicalUrl,
        ogTitle: lSeo.openGraph?.title || lSeo.metaTitle,
        ogDescription: cleanDesc,
        ogUrl: localizedCanonicalUrl,
        ogType: 'article',
        ogImage: defaultOgImage,
        ogLocale,
        twitterCard: 'summary_large_image',
        twitterTitle: lSeo.twitterCard?.title || lSeo.metaTitle,
        twitterDescription: cleanDesc,
        twitterImage: defaultOgImage,
        jsonLd: lSeo.schemaJsonLd,
        lang,
        dir,
        hreflangAlternates: parsedSeoBundle.hreflangAlternates || generateHreflangs(canonicalBase),
        h1: lSeo.h1Proposal || H1_TEMPLATES[lang](matchTitle, tournament),
      };
    }

    // 2. Dynamic Fallback Generation
    let title = clampTitlePreservingPlayers(lang, home, away, tournament);
    let description = resolveLocalizedDescription(
      lang,
      prediction,
      tournament,
      home,
      away,
      surface,
      round
    );

    // If English requested and editorial has custom overrides
    if (lang === 'en') {
      if (editorial?.seo_title) title = editorial.seo_title;
      if (editorial?.seo_description) description = editorial.seo_description;
      else if (editorial?.guest_safe_summary) description = editorial.guest_safe_summary.slice(0, 160);
      else if (editorial?.short_summary) description = editorial.short_summary.slice(0, 160);
    }

    const hreflangAlternates = generateHreflangs(canonicalBase);
    const h1 = editorial?.headline && lang === 'en' ? editorial.headline : H1_TEMPLATES[lang](matchTitle, tournament);

    const jsonLd = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'SportsEvent',
          '@id': `${localizedCanonicalUrl}#event`,
          inLanguage: lang,
          name: title,
          description,
          startDate: prediction.match_date || new Date().toISOString(),
          sport: 'Tennis',
          location: {
            '@type': 'Place',
            name: tournament,
          },
          competitor: [
            { '@type': 'Person', name: home },
            { '@type': 'Person', name: away },
          ],
        },
        {
          '@type': 'NewsArticle',
          '@id': `${localizedCanonicalUrl}#article`,
          inLanguage: lang,
          headline: h1,
          description,
          datePublished: editorial?.published_at || prediction.published_at || new Date().toISOString(),
          mainEntityOfPage: localizedCanonicalUrl,
          publisher: {
            '@type': 'Organization',
            name: 'Ptin AI',
            url: baseUrl,
          },
          author: {
            '@type': 'Organization',
            name: editorial?.author_name || 'Ptin AI Tennis Analytics Team',
          },
          workTranslation: hreflangAlternates
            .filter((alt) => alt.lang !== 'x-default' && alt.lang !== lang)
            .map((alt) => ({
              '@type': 'NewsArticle',
              inLanguage: alt.lang,
              url: alt.href,
            })),
        },
      ],
    };

    return {
      title,
      description,
      canonicalUrl: localizedCanonicalUrl,
      ogTitle: title,
      ogDescription: description,
      ogUrl: localizedCanonicalUrl,
      ogType: 'article',
      ogImage: defaultOgImage,
      ogLocale,
      twitterCard: 'summary_large_image',
      twitterTitle: title,
      twitterDescription: description,
      twitterImage: defaultOgImage,
      jsonLd,
      lang,
      dir,
      hreflangAlternates,
      h1,
    };
  },

  /**
   * Renders the complete, self-contained raw HTML with route-specific head tags,
   * semantic pre-rendered match content, and client hydration data.
   */
  renderHtml: (
    prediction: Prediction,
    slug: string,
    baseUrl = 'https://ptin-ai.com',
    requestedLang?: any
  ): string => {
    const meta = SeoRendererService.generateMetadata(prediction, slug, baseUrl, requestedLang);
    const home = prediction.home_name || 'Player 1';
    const away = prediction.away_name || 'Player 2';
    const tournament = prediction.tournament_name || 'ATP/WTA Tour';
    const round = prediction.round_name || '';
    const surface = prediction.surface || 'Hard';
    const winProb = prediction.win_probability || 60;
    const predictedWinner = prediction.predicted_winner || home;
    const summary = meta.description;

    const hreflangTags = meta.hreflangAlternates
      .map((alt) => `    <link rel="alternate" hreflang="${escapeHtml(alt.lang)}" href="${escapeHtml(alt.href)}" />`)
      .join('\n');

    let fontLinks = '';
    let fontCssRule = "font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;";
    if (meta.lang === 'fa') {
      fontLinks = `    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700;800&display=swap" rel="stylesheet">`;
      fontCssRule = "font-family: 'Vazirmatn', -apple-system, BlinkMacSystemFont, sans-serif;";
    } else if (meta.lang === 'ar') {
      fontLinks = `    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600;700;800&display=swap" rel="stylesheet">`;
      fontCssRule = "font-family: 'Noto Sans Arabic', -apple-system, BlinkMacSystemFont, sans-serif;";
    } else {
      fontLinks = `    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">`;
      fontCssRule = "font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;";
    }

    const uiTexts: Record<SupportedLang, { metaSubtitle: string; likelyWinner: (p: string, prob: number) => string; sectionHeading: string }> = {
      fa: {
        metaSubtitle: '🎾 تحلیل تخصصی و پرونده تاکتیکی مسابقه تنیس',
        likelyWinner: (p, prob) => `برنده محتمل (مدل هوش مصنوعی): ${escapeHtml(p)} (${prob}%)`,
        sectionHeading: 'پرونده تاکتیکی و پیش‌بازی مسابقه',
      },
      ar: {
        metaSubtitle: '🎾 تحليل احترافي للمباراة والملف التكتيكي للتنس',
        likelyWinner: (p, prob) => `الفائز المحتمل (النموذج التحليلي): ${escapeHtml(p)} (${prob}%)`,
        sectionHeading: 'الملف التكتيكي ومعاينة المباراة',
      },
      tr: {
        metaSubtitle: '🎾 Profesyonel Tenis Maç Analizi ve Taktik Dosyası',
        likelyWinner: (p, prob) => `Olası Galip (Model): ${escapeHtml(p)} (%${prob})`,
        sectionHeading: 'Taktik Dosyası ve Maç Önü',
      },
      pt: {
        metaSubtitle: '🎾 Análise Profissional de Tênis e Dossiê Tático',
        likelyWinner: (p, prob) => `Vencedor Provável (Modelo): ${escapeHtml(p)} (${prob}%)`,
        sectionHeading: 'Dossiê Tático e Prévia da Partida',
      },
      en: {
        metaSubtitle: '🎾 Professional Tennis Match Analysis & Tactical Dossier',
        likelyWinner: (p, prob) => `Likely winner (model): ${escapeHtml(p)} (${prob}%)`,
        sectionHeading: 'Tactical Dossier & Preview',
      },
    };

    const currentUi = uiTexts[meta.lang] || uiTexts.en;

    return `<!DOCTYPE html>
<html lang="${meta.lang}" dir="${meta.dir}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <title>${escapeHtml(meta.title)}</title>
    <meta name="description" content="${escapeHtml(meta.description)}" />
    <link rel="canonical" href="${meta.canonicalUrl}" />
${hreflangTags}

    <!-- Open Graph Tags -->
    <meta property="og:site_name" content="Ptin AI" />
    <meta property="og:type" content="${meta.ogType}" />
    <meta property="og:title" content="${escapeHtml(meta.ogTitle)}" />
    <meta property="og:description" content="${escapeHtml(meta.ogDescription)}" />
    <meta property="og:url" content="${meta.ogUrl}" />
    <meta property="og:locale" content="${meta.ogLocale}" />
    <meta property="og:image" content="${meta.ogImage}" />

    <!-- Twitter Card Tags -->
    <meta name="twitter:card" content="${meta.twitterCard}" />
    <meta name="twitter:site" content="@ptin_ai" />
    <meta name="twitter:title" content="${escapeHtml(meta.twitterTitle)}" />
    <meta name="twitter:description" content="${escapeHtml(meta.twitterDescription)}" />
    <meta name="twitter:image" content="${meta.twitterImage}" />

    <!-- Schema.org JSON-LD Structured Data -->
    <script type="application/ld+json">
${JSON.stringify(meta.jsonLd, null, 2)}
    </script>

    <script src="https://telegram.org/js/telegram-web-app.js"></script>
${fontLinks}
    <style>
      :root {
        --bg-dark: #0a0f1d;
        --card-bg: #121a2c;
        --accent-cyan: #38bdf8;
        --accent-green: #22c55e;
        --text-primary: #f8fafc;
        --text-secondary: #94a3b8;
      }
      body {
        margin: 0;
        padding: 0;
        background-color: var(--bg-dark);
        color: var(--text-primary);
        ${fontCssRule}
      }
      .prerender-container {
        max-width: 800px;
        margin: 2rem auto;
        padding: 1.5rem;
        background: var(--card-bg);
        border: 1px solid rgba(56, 189, 248, 0.2);
        border-radius: 16px;
        ${meta.dir === 'rtl' ? 'direction: rtl; text-align: right;' : ''}
      }
      .prerender-badge {
        display: inline-block;
        font-size: 0.75rem;
        font-weight: 700;
        color: var(--accent-cyan);
        background: rgba(56, 189, 248, 0.1);
        padding: 0.2rem 0.6rem;
        border-radius: 6px;
        margin-bottom: 0.8rem;
      }
      .prerender-title {
        font-size: 1.6rem;
        font-weight: 800;
        margin: 0 0 0.5rem 0;
      }
      .prerender-meta {
        font-size: 0.9rem;
        color: var(--text-secondary);
        margin-bottom: 1.2rem;
      }
      .prerender-meter {
        background: rgba(15, 23, 42, 0.8);
        border-radius: 10px;
        padding: 1rem;
        margin-bottom: 1.2rem;
        border: 1px solid rgba(255,255,255,0.06);
      }
      .prerender-meter-text {
        font-weight: 700;
        font-size: 0.95rem;
        color: var(--accent-green);
      }
      .prerender-summary {
        font-size: 0.9rem;
        line-height: 1.6;
        color: #cbd5e1;
      }
    </style>
  </head>
  <body>
    <div id="root">
      <main class="prerender-container">
        <div class="prerender-badge">${escapeHtml(tournament)} • ${escapeHtml(surface)} ${round ? '• ' + escapeHtml(round) : ''}</div>
        <h1 class="prerender-title">${escapeHtml(meta.h1)}</h1>
        <div class="prerender-meta">${currentUi.metaSubtitle}</div>
        
        <div class="prerender-meter">
          <div class="prerender-meter-text">${currentUi.likelyWinner(predictedWinner, winProb)}</div>
        </div>

        <article class="prerender-summary">
          <h2>${currentUi.sectionHeading}</h2>
          <p>${escapeHtml(summary)}</p>
        </article>
      </main>
    </div>

    <!-- Hydration State for Client Application -->
    <script>
      window.__INITIAL_PREDICTION__ = ${JSON.stringify(prediction)};
      window.__INITIAL_MATCH__ = ${JSON.stringify(prediction)};
    </script>
  </body>
</html>`;
  },

  /**
   * Renders generic homepage metadata for root requests without query parameters.
   */
  renderHomepageHtml: (baseUrl = 'https://ptin-ai.com', requestedLang?: any): string => {
    const lang = resolveRequestedLang(requestedLang);
    const dir: 'rtl' | 'ltr' = lang === 'fa' || lang === 'ar' ? 'rtl' : 'ltr';
    const ogLocale = OG_LOCALES[lang];
    const canonicalUrl = lang === 'en' ? `${baseUrl}/` : `${baseUrl}/?lang=${lang}`;

    const titles: Record<SupportedLang, string> = {
      en: 'Ptin AI — Pro Tennis Intelligence & Tactical Match Previews',
      fa: 'پتین AI — هوش مصنوعی تحلیلی و پیش‌بازی تخصصی مسابقات تنیس',
      ar: 'بتين AI — ذكاء اصطناعي لتحليل التنس ومعاينة المباريات التكتيكية',
      tr: 'Ptin AI — Profesyonel Tenis Analitiği ve Taktiksel Maç Önü',
      pt: 'Ptin AI — Inteligência Profissional de Tênis e Prévias Táticas',
    };

    const descriptions: Record<SupportedLang, string> = {
      en: 'Next-generation tennis AI analytics, predictive win probabilities, player conditioning breakdowns, and deep tactical match dossiers on Ptin AI.',
      fa: 'تحلیل نسل جدید تنیس با هوش مصنوعی، احتمال برد مسابقات، وضعیت بدنی بازیکنان و گزارش‌های عمیق تاکتیکی در پتین AI.',
      ar: 'تحليلات ذكاء اصطناعي متقدمة للتنس، نسب الفوز المتوقعة، تفاصيل اللياقة البدنية والملفات التكتيكية على بتين AI.',
      tr: 'Yeni nesil yapay zeka tenis analitiği, kazanma olasılıkları, oyuncu kondisyon verileri ve derin taktiksel maç dosyaları Ptin AI platformunda.',
      pt: 'Análises de tênis com IA de última geração, probabilidades de vitória, desgaste físico dos jogadores e dossiês táticos no Ptin AI.',
    };

    const title = titles[lang];
    const description = descriptions[lang];
    const ogImage = `${baseUrl}/og-tennis-banner.jpg`;

    let fontLinks = '';
    if (lang === 'fa') {
      fontLinks = `    <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700;800&display=swap" rel="stylesheet">`;
    } else if (lang === 'ar') {
      fontLinks = `    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600;700;800&display=swap" rel="stylesheet">`;
    } else {
      fontLinks = `    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">`;
    }

    return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonicalUrl}" />

    <!-- Open Graph Tags -->
    <meta property="og:site_name" content="Ptin AI" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonicalUrl}" />
    <meta property="og:locale" content="${ogLocale}" />
    <meta property="og:image" content="${ogImage}" />

    <!-- Twitter Card Tags -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:site" content="@ptin_ai" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${ogImage}" />

    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fontLinks}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;
  },
};

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
