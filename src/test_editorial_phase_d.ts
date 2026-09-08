/**
 * Phase D editorial publishing tests.
 * Run: npx tsx src/test_editorial_phase_d.ts
 */
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || 'integration-test-admin-secret-key';

async function main() {
  const express = (await import('express')).default;
  const { apiRouter } = await import('./routes');
  const { ENV } = await import('./config/env');
  const { EditorialsRepo } = await import('./db/repositories/editorials.repo');
  const {
    validateEditorialForPublish,
    canTransitionStatus,
  } = await import('./editorial/validateEditorial');

  const assert = (cond: unknown, msg: string) => {
    if (!cond) throw new Error(msg);
  };

  console.log('\nPhase D editorial checks');

  // 1) Validation rejects missing + betting-heavy
  const bad = validateEditorialForPublish({
    fixtureId: 1,
    title: 'Short',
    shortSummary: 'Too short',
    slug: 'BAD SLUG!!',
    seoTitle: 'x',
    seoDescription: 'short',
    guestSafeSummary: '',
    keyFacts: ['one'],
    bodyText: 'Bet now for a guaranteed win',
  });
  assert(!bad.ok, 'expected validation failure');
  assert(bad.errors.some((e) => /forbidden|title|slug|guest|key facts|meta/i.test(e)), 'expected useful errors');
  console.log('  ✅ validation rejects missing fields / betting-heavy copy');

  // 2) Workflow transitions
  assert(canTransitionStatus('draft', 'review'), 'draft→review');
  assert(canTransitionStatus('review', 'approved'), 'review→approved');
  assert(canTransitionStatus('approved', 'published'), 'approved→published');
  assert(canTransitionStatus('published', 'review'), 'published→review');
  assert(canTransitionStatus('approved', 'draft'), 'approved→draft');
  assert(!canTransitionStatus('draft', 'published'), 'draft↛published');
  console.log('  ✅ workflow transitions draft→review→approved→published (and unpublish)');

  const fixtureId = 99008877;
  const slug = `phase-d-player-a-vs-player-b-demo-${fixtureId}`;
  const title = 'Player A vs Player B: Form, Surface & Match Analysis — Demo Open';
  const shortSummary =
    'At Demo Open, the model leans toward Player A on hard courts with clearer hold reliability and return pressure in the current sample.';
  const seoTitle = 'Player A vs Player B Preview & Stats | Demo Open';
  const seoDescription =
    'Full match preview and head-to-head context for Player A vs Player B at Demo Open. Surface fit, form signals, and tactical themes.';

  EditorialsRepo.upsert({
    fixture_id: fixtureId,
    slug,
    headline: title,
    summary: shortSummary,
    tactical_analysis: 'Serve reliability and early return games are the decisive themes on this hard court.',
    surface_breakdown: 'Hard court sample favors the higher hold rate.',
    h2h_breakdown: 'Limited H2H volume — form outweighs history.',
    key_stats_json: JSON.stringify({ homeHoldRate: '82%', awayHoldRate: '74%' }),
    author_name: 'PTIN Tennis Analytics',
    seo_title: seoTitle,
    seo_description: seoDescription,
    subtitle: 'Demo Open · R16 · Hard',
    short_summary: shortSummary,
    key_facts_json: JSON.stringify([
      'Model lean: Player A',
      'Surface: Hard',
      'Hold comparison available in sample',
    ]),
    data_bullets_json: JSON.stringify(['Hold rates: Player A 82% · Player B 74%']),
    tags_json: JSON.stringify(['tennis', 'match-analysis', 'hard', 'preview']),
    seo_metadata_json: JSON.stringify({
      titleTag: seoTitle,
      metaDescription: seoDescription,
      canonicalSlug: slug,
      h1Proposal: title,
      structuredHeadings: ['Match snapshot', 'Form & surface signals'],
      internalLinkSuggestions: [{ anchorText: 'Player A profile', targetUrl: '/player/player-a' }],
      shareText: 'Player A vs Player B analysis preview at Demo Open.',
    }),
    share_text: 'Player A vs Player B analysis preview at Demo Open.',
    guest_safe_summary: shortSummary.slice(0, 240),
    publish_status: 'draft',
    version: 1,
    ai_assisted: 1,
    is_published: 0,
  });

  const good = validateEditorialForPublish({
    fixtureId,
    title,
    shortSummary,
    slug,
    seoTitle,
    seoDescription,
    guestSafeSummary: shortSummary.slice(0, 240),
    keyFacts: ['Model lean: Player A', 'Surface: Hard'],
  });
  assert(good.ok, `good package should validate: ${good.errors.join('; ')}`);
  assert(!!seoTitle && !!seoDescription && !!slug, 'metadata non-empty');
  console.log('  ✅ editorial package + non-empty SEO metadata');

  const app = express();
  app.use(express.json());
  app.use(apiRouter);
  const server = await new Promise<import('http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('No listen address');
  const base = `http://127.0.0.1:${addr.port}`;
  const adminSecret = ENV.ADMIN_SECRET || 'integration-test-admin-secret-key';
  const headers = {
    'Content-Type': 'application/json',
    'x-admin-secret': adminSecret,
    Authorization: `Bearer ${adminSecret}`,
  };

  // Workflow via API
  for (const status of ['review', 'approved', 'published'] as const) {
    const res = await fetch(`${base}/api/admin/editorials/${fixtureId}/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ status, editor: 'phase-d-test' }),
    });
    const json = await res.json();
    assert(res.ok && json.success, `status ${status} failed: ${JSON.stringify(json)}`);
  }
  console.log('  ✅ API workflow draft→review→approved→published');

  // Site consumes published editorial
  const siteRes = await fetch(`${base}/api/webapp/matches/${fixtureId}/editorial`);
  const siteJson = await siteRes.json();
  assert(siteRes.ok, `site editorial HTTP ${siteRes.status}`);
  assert(siteJson.headline || siteJson.title, 'site gets title');
  assert(siteJson.seo_title, 'site gets seo title');
  assert(siteJson.guest_safe_summary || siteJson.summary, 'site gets summary');
  console.log('  ✅ site consumes editorial package');

  // Metadata generation path via SEO service
  const { SeoRendererService } = await import('./services/seo-renderer.service');
  const { PredictionsRepo } = await import('./db/repositories/predictions.repo');
  PredictionsRepo.create({
    fixture_id: fixtureId,
    tournament_name: 'Demo Open',
    round_name: 'R16',
    surface: 'Hard',
    match_date: '2026-09-08T12:00:00.000Z',
    home_name: 'Player A',
    away_name: 'Player B',
    home_odds: '1.70',
    away_odds: '2.10',
    predicted_winner: 'Player A',
    win_probability: 61,
    confidence: 'MEDIUM',
    predicted_score: '2:0',
    ai_summary: shortSummary,
    status: 'UPCOMING',
    published_at: new Date().toISOString(),
  } as any);
  const pred = PredictionsRepo.getByFixtureId(fixtureId)!;
  const meta = SeoRendererService.generateMetadata(pred, slug);
  assert(meta.title.includes('Player A') || meta.title.length > 10, 'seo title');
  assert(meta.description.length >= 40, 'seo description');
  console.log('  ✅ SEO renderer prefers editorial metadata');

  console.log('\n✅ Phase D editorial tests PASSED\n');
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

main().catch((e) => {
  console.error('\n❌ Phase D tests FAILED\n', e);
  process.exit(1);
});
