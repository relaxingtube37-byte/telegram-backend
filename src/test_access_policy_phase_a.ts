/**
 * Phase A access-policy tests:
 * 1) Guest (no session) → deep fields null/absent
 * 2) Verified member session → full fields
 * 3) Admin access_mode change affects API without redeploy
 *
 * Run: npx tsx src/test_access_policy_phase_a.ts
 */
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || 'integration-test-admin-secret-key';

async function main() {
  const express = (await import('express')).default;
  const { apiRouter } = await import('./routes');
  const { UsersRepo } = await import('./db/repositories/users.repo');
  const { PredictionsRepo } = await import('./db/repositories/predictions.repo');
  const { createWebSessionToken } = await import('./utils/telegramAuth');
  const { ENV } = await import('./config/env');
  const {
    DEFAULT_ACCESS_MODE,
    saveAccessMode,
    saveAccessPolicyLayers,
    loadAccessPolicy,
  } = await import('./access-policy');

  function sessionSecret(): string {
    return (ENV.BOT_TOKEN || '') + ':' + (ENV.ADMIN_SECRET || 'ptin_web_secret_salt_2026');
  }

  // Ensure deterministic policy baseline (live settings write)
  saveAccessMode('REGISTRATION_REQUIRED');
  saveAccessPolicyLayers({
    guest_can_see_summary: true,
    guest_stats_level: 'none',
    guest_can_see_ai_full: false,
  });

  const fixtureId = 88001122;
  PredictionsRepo.create({
    fixture_id: fixtureId,
    tournament_name: 'ATP Test Open',
    round_name: 'R32',
    surface: 'Hard',
    match_date: '2026-09-08T12:00:00.000Z',
    home_name: 'Test Player A',
    away_name: 'Test Player B',
    home_odds: '1.55',
    away_odds: '2.40',
    predicted_winner: 'Test Player A',
    win_probability: 64,
    confidence: 'MEDIUM',
    predicted_score: '2:0',
    ai_summary:
      'Line one teaser. Line two teaser. Then a long dossier body that guests must not receive in full when ai_full is off and stats are none.',
    key_factors: ['Factor deep 1', 'Factor deep 2'],
    devils_advocate_risk: 'Hidden upset risk for guests',
    best_bet_market: 'Match Winner',
    best_bet_selection: 'Test Player A',
    status: 'UPCOMING',
    published_at: new Date().toISOString(),
  } as any);

  const verifiedTelegramId = 900100200;
  UsersRepo.upsertFromBot(verifiedTelegramId, { first_name: 'Verified', username: 'verified_member' });
  UsersRepo.setVerified(verifiedTelegramId, undefined, 'manual_admin');

  const memberToken = createWebSessionToken(
    {
      webId: 'web_phase_a_test',
      telegramId: verifiedTelegramId,
      createdAt: Date.now(),
    },
    sessionSecret()
  );

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

  const log = (title: string, body: unknown) => {
    const line = `\n=== ${title} ===\n${typeof body === 'string' ? body : JSON.stringify(body, null, 2)}`;
    console.log(line);
  };

  // --- Test 1: Guest deep-analytics ---
  const guestDeepRes = await fetch(
    `${base}/api/web/matches/deep-analytics?p1=Test%20Player%20A&p2=Test%20Player%20B&surface=Hard`
  );
  const guestDeep = await guestDeepRes.json();
  log('TEST1 guest deep-analytics (no session)', {
    status: guestDeepRes.status,
    verified: guestDeep.verified,
    content_locked: guestDeep.content_locked,
    guest_stats_level: guestDeep.guest_stats_level,
    p1RollingForm: guestDeep.data?.p1RollingForm,
    p1SurfaceMastery: guestDeep.data?.p1SurfaceMastery,
    explanationCards: guestDeep.data?.explanationCards,
  });

  if (guestDeep.verified !== false) throw new Error('Guest should not be verified');
  if (guestDeep.content_locked !== true) throw new Error('Guest deep-analytics should be locked');
  if (guestDeep.data?.p1SurfaceMastery != null) throw new Error('Guest must not see surface mastery');
  if (guestDeep.data?.explanationCards != null) throw new Error('Guest must not see explanation cards');
  if (guestDeep.data?.p1RollingForm != null && guestDeep.guest_stats_level === 'none') {
    throw new Error('Guest stats level none must null rolling form');
  }

  const guestMatchesRes = await fetch(`${base}/api/web/matches?limit=20`);
  const guestMatches = await guestMatchesRes.json();
  const guestRow = (guestMatches.matches || []).find((m: any) => m.fixture_id === fixtureId);
  log('TEST1b guest /api/web/matches row', {
    found: !!guestRow,
    predicted_winner: guestRow?.predicted_winner,
    home_odds: guestRow?.home_odds,
    win_probability: guestRow?.win_probability,
    key_factors: guestRow?.key_factors ?? null,
    ai_summary_len: guestRow?.ai_summary ? String(guestRow.ai_summary).length : 0,
    content_locked: guestRow?.content_locked,
  });
  if (!guestRow) throw new Error('Guest matches missing seeded fixture');
  if (guestRow.key_factors != null) throw new Error('Guest must not receive key_factors');
  if (guestRow.predicted_winner !== 'Test Player A') throw new Error('Teaser winner must stay public');

  // --- Test 2: Member session ---
  const memberDeepRes = await fetch(
    `${base}/api/web/matches/deep-analytics?p1=Test%20Player%20A&p2=Test%20Player%20B&surface=Hard`,
    { headers: { Authorization: `Bearer ${memberToken}`, 'x-ptin-session': memberToken } }
  );
  const memberDeep = await memberDeepRes.json();
  log('TEST2 member deep-analytics (verified session)', {
    status: memberDeepRes.status,
    verified: memberDeep.verified,
    content_locked: memberDeep.content_locked,
    hasForm: !!memberDeep.data?.p1RollingForm,
    hasSurface: !!memberDeep.data?.p1SurfaceMastery,
    cards: Array.isArray(memberDeep.data?.explanationCards)
      ? memberDeep.data.explanationCards.length
      : null,
  });
  if (memberDeep.verified !== true) throw new Error('Member must be verified');
  if (memberDeep.content_locked !== false) throw new Error('Member deep-analytics must be unlocked');
  if (!memberDeep.data?.p1RollingForm) throw new Error('Member must receive rolling form');

  const memberMatchesRes = await fetch(`${base}/api/web/matches?limit=20`, {
    headers: { Authorization: `Bearer ${memberToken}` },
  });
  const memberMatches = await memberMatchesRes.json();
  const memberRow = (memberMatches.matches || []).find((m: any) => m.fixture_id === fixtureId);
  log('TEST2b member /api/web/matches row', {
    content_locked: memberRow?.content_locked,
    key_factors: memberRow?.key_factors,
    ai_summary_len: memberRow?.ai_summary ? String(memberRow.ai_summary).length : 0,
  });
  if (memberRow?.content_locked !== false) throw new Error('Member match row must be unlocked');
  if (!memberRow?.key_factors || memberRow.key_factors.length < 1) {
    throw new Error('Member must receive key_factors');
  }

  // --- Test 3: access_mode change without redeploy (live SettingsRepo read) ---
  const before = loadAccessPolicy();
  log('TEST3 before access_mode', before);

  const modeFromAdminPath = saveAccessMode('FREE');
  log('TEST3 admin-equivalent saveAccessMode(FREE)', { access_mode: modeFromAdminPath });

  let httpAdminOk = false;
  try {
    const modeRes = await fetch(`${base}/api/admin/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': adminSecret,
      },
      body: JSON.stringify({ key: 'access_mode', value: 'FREE' }),
    });
    const modeBody = await modeRes.json();
    httpAdminOk = modeRes.status === 200 && !!modeBody.success;
    log('TEST3 admin HTTP set access_mode=FREE', { http: modeRes.status, body: modeBody });
  } catch (e: any) {
    log('TEST3 admin HTTP skipped/failed', e?.message || String(e));
  }

  const guestAfterFree = await fetch(
    `${base}/api/web/matches/deep-analytics?p1=Test%20Player%20A&p2=Test%20Player%20B&surface=Hard`
  ).then((r) => r.json());
  log('TEST3 guest deep-analytics after FREE', {
    verified: guestAfterFree.verified,
    content_locked: guestAfterFree.content_locked,
    hasForm: !!guestAfterFree.data?.p1RollingForm,
    httpAdminOk,
  });
  if (guestAfterFree.verified !== true) throw new Error('FREE mode must treat guest as verified');
  if (guestAfterFree.content_locked !== false) throw new Error('FREE mode must unlock deep analytics');

  saveAccessMode(DEFAULT_ACCESS_MODE);

  const afterRestore = await fetch(
    `${base}/api/web/matches/deep-analytics?p1=Test%20Player%20A&p2=Test%20Player%20B&surface=Hard`
  ).then((r) => r.json());
  log('TEST3 guest after restore REGISTRATION_REQUIRED', {
    verified: afterRestore.verified,
    content_locked: afterRestore.content_locked,
    access_mode: afterRestore.access_mode,
  });
  if (afterRestore.verified !== false || afterRestore.content_locked !== true) {
    throw new Error('Restored REGISTRATION_REQUIRED must lock guests again');
  }

  console.log('\n✅ Phase A access-policy tests PASSED\n');
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

main().catch((err) => {
  console.error('❌ Phase A tests failed:', err);
  process.exit(1);
});
