import { Router, Request, Response, NextFunction } from 'express';
import { SeoRendererService } from '../services/seo-renderer.service';

const router = Router();

// Handle /match/:idOrSlug
router.get('/match/:idOrSlug', (req: Request, res: Response) => {
  try {
    const idOrSlug = String(req.params.idOrSlug);
    const matchData = SeoRendererService.findMatch(idOrSlug);

    if (!matchData) {
      return res.status(404).send(`<!DOCTYPE html><html><head><title>Match Not Found | Ptin AI</title></head><body><h1>Match Not Found</h1><p><a href="/">Return to Matches</a></p></body></html>`);
    }

    const host = req.get('host') || 'ptin-ai.com';
    const proto = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const baseUrl = `${proto}://${host}`;

    const html = SeoRendererService.renderHtml(matchData.prediction, matchData.slug, baseUrl);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).send(html);
  } catch (err: any) {
    return res.status(500).send(`Internal error rendering match page`);
  }
});

// Handle /match?match=...
router.get('/match', (req: Request, res: Response, next: NextFunction) => {
  const matchParam = String(req.query.match || '').trim();
  if (!matchParam) return next();

  const matchData = SeoRendererService.findMatch(matchParam);
  if (!matchData) {
    return res.status(404).send(`<!DOCTYPE html><html><head><title>Match Not Found | Ptin AI</title></head><body><h1>Match Not Found</h1></body></html>`);
  }

  const host = req.get('host') || 'ptin-ai.com';
  const proto = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const baseUrl = `${proto}://${host}`;

  const html = SeoRendererService.renderHtml(matchData.prediction, matchData.slug, baseUrl);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
  return res.status(200).send(html);
});

// Handle /seo/match?match=...
router.get('/seo/match', (req: Request, res: Response) => {
  const matchParam = String(req.query.match || req.query.slug || '').trim();
  if (!matchParam) {
    return res.status(400).json({ error: 'Missing match or slug parameter' });
  }

  const matchData = SeoRendererService.findMatch(matchParam);
  if (!matchData) {
    return res.status(404).json({ error: 'Match not found' });
  }

  const host = req.get('host') || 'ptin-ai.com';
  const proto = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const baseUrl = `${proto}://${host}`;

  const html = SeoRendererService.renderHtml(matchData.prediction, matchData.slug, baseUrl);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
});

// Intercept root GET /?match=... for search engines and social bots, or serve generic homepage
router.get('/', (req: Request, res: Response, next: NextFunction) => {
  const matchParam = String(req.query.match || '').trim();
  const host = req.get('host') || 'ptin-ai.com';
  const proto = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const baseUrl = `${proto}://${host}`;

  if (matchParam) {
    const matchData = SeoRendererService.findMatch(matchParam);
    if (matchData) {
      const html = SeoRendererService.renderHtml(matchData.prediction, matchData.slug, baseUrl);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
      return res.status(200).send(html);
    }
  }

  // If client accepts HTML, serve generic homepage metadata
  if (req.accepts('html')) {
    const html = SeoRendererService.renderHomepageHtml(baseUrl);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).send(html);
  }

  return next();
});

export const seoRoutes = router;
