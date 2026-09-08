import { PredictionsRepo } from '../db/repositories/predictions.repo';
import { EditorialsRepo } from '../db/repositories/editorials.repo';
import type { Prediction } from '../types';

export interface SeoMetadata {
  title: string;
  description: string;
  canonicalUrl: string;
  ogTitle: string;
  ogDescription: string;
  ogUrl: string;
  ogType: string;
  ogImage: string;
  twitterCard: string;
  twitterTitle: string;
  twitterDescription: string;
  twitterImage: string;
  jsonLd: Record<string, any>;
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
   * Prefers stored editorial SEO (Phase D) when available.
   */
  generateMetadata: (prediction: Prediction, slug: string, baseUrl = 'https://ptin-ai.com'): SeoMetadata => {
    const home = prediction.home_name || 'Player 1';
    const away = prediction.away_name || 'Player 2';
    const matchTitle = `${home} vs ${away}`;
    const tournament = prediction.tournament_name || 'ATP/WTA Tour';
    const surface = prediction.surface || 'Hard';
    const winProb = prediction.win_probability || 60;
    const predictedWinner = prediction.predicted_winner || home;

    const editorial = prediction.fixture_id
      ? EditorialsRepo.getByFixtureId(prediction.fixture_id)
      : EditorialsRepo.getBySlug(slug);

    let title = `${matchTitle} Analysis & Match Preview | Ptin AI`;
    let description = prediction.ai_summary
      ? prediction.ai_summary.slice(0, 160).replace(/[\n\r]+/g, ' ').trim()
      : `Match analysis for ${matchTitle} at ${tournament}. Surface: ${surface}. Model lean: ${predictedWinner} (${winProb}%).`;

    if (editorial?.seo_title) title = editorial.seo_title;
    if (editorial?.seo_description) description = editorial.seo_description;
    else if (editorial?.guest_safe_summary) description = editorial.guest_safe_summary.slice(0, 160);
    else if (editorial?.short_summary) description = editorial.short_summary.slice(0, 160);

    const resolvedSlug = editorial?.slug || slug;
    const canonicalUrl = `${baseUrl}/match/${resolvedSlug}`;
    const defaultOgImage = `${baseUrl}/og-tennis-banner.jpg`;
    const headline = editorial?.headline || `${matchTitle} Match Analysis`;

    const jsonLd = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'SportsEvent',
          'name': matchTitle,
          'sport': 'Tennis',
          'startDate': prediction.match_date || new Date().toISOString(),
          'location': {
            '@type': 'Place',
            'name': tournament,
          },
          'competitor': [
            { '@type': 'Person', 'name': home },
            { '@type': 'Person', 'name': away },
          ],
        },
        {
          '@type': 'NewsArticle',
          'headline': headline,
          'description': description,
          'datePublished': editorial?.published_at || prediction.published_at || new Date().toISOString(),
          'mainEntityOfPage': canonicalUrl,
          'publisher': {
            '@type': 'Organization',
            'name': 'Ptin AI',
            'url': baseUrl,
          },
          'author': {
            '@type': 'Organization',
            'name': editorial?.author_name || 'Ptin AI Tennis Analytics Team',
          },
        },
      ],
    };

    return {
      title,
      description,
      canonicalUrl,
      ogTitle: title,
      ogDescription: description,
      ogUrl: canonicalUrl,
      ogType: 'article',
      ogImage: defaultOgImage,
      twitterCard: 'summary_large_image',
      twitterTitle: title,
      twitterDescription: description,
      twitterImage: defaultOgImage,
      jsonLd,
    };
  },

  /**
   * Renders the complete, self-contained raw HTML with route-specific head tags,
   * semantic pre-rendered match content, and client hydration data.
   */
  renderHtml: (prediction: Prediction, slug: string, baseUrl = 'https://ptin-ai.com'): string => {
    const meta = SeoRendererService.generateMetadata(prediction, slug, baseUrl);
    const home = prediction.home_name || 'Player 1';
    const away = prediction.away_name || 'Player 2';
    const tournament = prediction.tournament_name || 'ATP/WTA Tour';
    const round = prediction.round_name || '';
    const surface = prediction.surface || 'Hard';
    const winProb = prediction.win_probability || 60;
    const predictedWinner = prediction.predicted_winner || home;
    const editorial = prediction.fixture_id
      ? EditorialsRepo.getByFixtureId(prediction.fixture_id)
      : null;
    const h1 = editorial?.headline || `${home} vs ${away}`;
    const summary =
      editorial?.guest_safe_summary ||
      editorial?.short_summary ||
      editorial?.summary ||
      prediction.ai_summary ||
      'Match analysis and statistical preview available on Ptin AI.';

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <title>${escapeHtml(meta.title)}</title>
    <meta name="description" content="${escapeHtml(meta.description)}" />
    <link rel="canonical" href="${meta.canonicalUrl}" />

    <!-- Open Graph Tags -->
    <meta property="og:site_name" content="Ptin AI" />
    <meta property="og:type" content="${meta.ogType}" />
    <meta property="og:title" content="${escapeHtml(meta.ogTitle)}" />
    <meta property="og:description" content="${escapeHtml(meta.ogDescription)}" />
    <meta property="og:url" content="${meta.ogUrl}" />
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
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
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
        font-family: 'Outfit', sans-serif;
      }
      .prerender-container {
        max-width: 800px;
        margin: 2rem auto;
        padding: 1.5rem;
        background: var(--card-bg);
        border: 1px solid rgba(56, 189, 248, 0.2);
        border-radius: 16px;
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
        <h1 class="prerender-title">${escapeHtml(h1)}</h1>
        <div class="prerender-meta">🎾 Professional Tennis Match Analysis & Tactical Dossier</div>
        
        <div class="prerender-meter">
          <div class="prerender-meter-text">Likely winner (model): ${escapeHtml(predictedWinner)} (${winProb}%)</div>
        </div>

        <article class="prerender-summary">
          <h2>Tactical Dossier & Preview</h2>
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
  renderHomepageHtml: (baseUrl = 'https://ptin-ai.com'): string => {
    const title = 'Ptin AI — Pro Tennis Intelligence & Tactical Match Previews';
    const description =
      'Next-generation tennis AI analytics, predictive win probabilities, player conditioning breakdowns, and deep tactical match dossiers on Ptin AI.';
    const ogImage = `${baseUrl}/og-tennis-banner.jpg`;

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${baseUrl}/" />

    <!-- Open Graph Tags -->
    <meta property="og:site_name" content="Ptin AI" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${baseUrl}/" />
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
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
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
