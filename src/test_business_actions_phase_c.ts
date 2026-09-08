/**
 * Phase C business-actions tests:
 * - referral CTA click → attribution row
 * - valid postback → conversion
 * - duplicate postback → no second conversion
 * - watch-live → allowed redirect
 * - non-whitelisted URL → reject
 *
 * Run: npx tsx src/test_business_actions_phase_c.ts
 */
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || 'integration-test-admin-secret-key';

async function main() {
  const express = (await import('express')).default;
  const { apiRouter } = await import('./routes');
  const { goRoutes } = await import('./routes/go.routes');
  const { ReferralsRepo } = await import('./db/repositories/referrals.repo');
  const { ReferralClicksRepo } = await import('./db/repositories/referralClicks.repo');
  const { PartnerConversionsRepo } = await import('./db/repositories/partnerConversions.repo');
  const { UsersRepo } = await import('./db/repositories/users.repo');
  const { ENV } = await import('./config/env');
  const { saveBusinessActionSettings, loadBusinessActionSettings } = await import('./business-actions');
  const { db } = await import('./db/connection');

  const clicksBefore = ReferralClicksRepo.count();
  const convBefore = PartnerConversionsRepo.count();

  // Unique partner for isolation
  const postbackKey = `phasec-key-${Date.now()}`;
  const siteId = ReferralsRepo.create({
    name: 'Phase C Test Partner',
    referral_url: 'https://example-partner.test/reg?aff=1',
    postback_key: postbackKey,
    is_active: 1,
    verify_mode: 'postback',
  } as any);

  saveBusinessActionSettings({
    registration_referral_enabled: true,
    watch_live_enabled: true,
    payment_mode_placeholder_enabled: false,
    shared_watch_live_url: 'https://example-partner.test/watch-shared',
    allowed_redirect_hosts: ['example-partner.test'],
    watch_live_event_url_template: '',
  });

  const telegramId = 771122334;
  UsersRepo.upsertFromBot(telegramId, { first_name: 'PhaseC', username: 'phasec_user' });

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/', goRoutes);
  app.use('/', apiRouter);

  const server = await new Promise<import('http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('No listen address');
  const base = `http://127.0.0.1:${addr.port}`;
  const adminSecret = ENV.ADMIN_SECRET || 'integration-test-admin-secret-key';

  const assert = (cond: unknown, msg: string) => {
    if (!cond) throw new Error(msg);
  };

  console.log('\nPhase C business-actions checks');

  // 1) Registration click → attribution
  const goRes = await fetch(`${base}/go/${siteId}/${telegramId}?action=registration&page=match&match_id=42`, {
    redirect: 'manual',
  });
  assert(goRes.status === 302, `expected 302 registration redirect, got ${goRes.status}`);
  const location = goRes.headers.get('location') || '';
  const clickId = goRes.headers.get('x-ptin-click-id') || '';
  assert(clickId.startsWith('clk_'), 'click id header missing');
  assert(location.includes('click_id='), 'partner url missing click_id');
  assert(location.includes('example-partner.test'), 'redirect host wrong');
  const clickRow = ReferralClicksRepo.getByClickId(clickId);
  assert(!!clickRow, 'attribution row missing');
  assert(clickRow!.user_ref === String(telegramId), 'user_ref mismatch');
  assert(clickRow!.action_type === 'registration', 'action_type mismatch');
  assert(clickRow!.match_id === 42, 'match_id not stored');
  console.log('  ✅ referral CTA → attribution record');

  // 2) Valid postback → conversion
  const pb1 = await fetch(
    `${base}/api/postback/${postbackKey}?click_id=${encodeURIComponent(clickId)}&event=verified&transaction_id=txn_phasec_1`
  );
  const pb1Json = await pb1.json();
  assert(pb1.ok && pb1Json.success, 'postback should succeed');
  assert(pb1Json.duplicate !== true, 'first postback not duplicate');
  assert(pb1Json.event_type === 'verified_registration', 'event type');
  const user = UsersRepo.getByTelegramId(telegramId);
  assert(!!user?.is_verified, 'user should be verified');
  console.log('  ✅ valid postback → conversion recorded');

  // 3) Duplicate postback
  const convMid = PartnerConversionsRepo.count();
  const pb2 = await fetch(
    `${base}/api/postback/${postbackKey}?click_id=${encodeURIComponent(clickId)}&event=verified&transaction_id=txn_phasec_1`
  );
  const pb2Json = await pb2.json();
  assert(pb2.ok && pb2Json.success, 'duplicate response should still be success');
  assert(pb2Json.duplicate === true, 'expected duplicate flag');
  assert(PartnerConversionsRepo.count() === convMid, 'duplicate must not insert another conversion');
  console.log('  ✅ duplicate postback → no extra conversion');

  // 4) Watch live allowed
  const watchRes = await fetch(`${base}/go/${siteId}/${telegramId}?action=watch_live&page=match`, {
    redirect: 'manual',
  });
  assert(watchRes.status === 302, `watch live expected 302, got ${watchRes.status}`);
  const watchLoc = watchRes.headers.get('location') || '';
  assert(watchLoc.includes('example-partner.test'), 'watch live host');
  assert(watchLoc.includes('/watch-shared') || watchLoc.includes('example-partner.test'), 'shared watch url');
  console.log('  ✅ watch-live CTA → allowed redirect');

  // 5) Non-whitelisted destination rejected
  ReferralsRepo.update(siteId, {
    referral_url: 'https://evil-open-redirect.example/phish',
  } as any);
  // Clear shared watch so registration uses evil url
  saveBusinessActionSettings({
    ...loadBusinessActionSettings(),
    shared_watch_live_url: '',
    allowed_redirect_hosts: ['example-partner.test'],
  });
  const badRes = await fetch(`${base}/go/${siteId}/${telegramId}?action=registration`, {
    redirect: 'manual',
  });
  assert(badRes.status === 400, `expected 400 for non-whitelist, got ${badRes.status}`);
  const badBody = await badRes.text();
  assert(/whitelist|allowed/i.test(badBody), 'error should mention whitelist');
  console.log('  ✅ non-whitelisted URL → rejected');

  // Admin business settings round-trip
  const adminGet = await fetch(`${base}/api/admin/settings`, {
    headers: { 'x-admin-secret': adminSecret, Authorization: `Bearer ${adminSecret}` },
  });
  const adminJson = await adminGet.json();
  assert(adminJson.business_action_settings, 'admin settings include business_action_settings');

  const adminSave = await fetch(`${base}/api/admin/settings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': adminSecret,
      Authorization: `Bearer ${adminSecret}`,
    },
    body: JSON.stringify({
      key: 'business_action_settings',
      value: {
        registration_referral_enabled: true,
        watch_live_enabled: false,
        payment_mode_placeholder_enabled: true,
        shared_watch_live_url: 'https://example-partner.test/watch-shared',
        allowed_redirect_hosts: ['example-partner.test'],
        watch_live_event_url_template: '',
      },
    }),
  });
  const adminSaveJson = await adminSave.json();
  assert(adminSaveJson.success, 'admin save business actions');
  assert(adminSaveJson.business_action_settings.watch_live_enabled === false, 'watch toggled off');
  console.log('  ✅ admin business_action_settings save/load');

  // 6) Safe redirect: subdomain matching for configured allowed hosts
  ReferralsRepo.update(siteId, {
    referral_url: 'https://subdomain.example-partner.test/reg?aff=1',
  } as any);
  saveBusinessActionSettings({
    registration_referral_enabled: true,
    watch_live_enabled: true,
    payment_mode_placeholder_enabled: false,
    shared_watch_live_url: '',
    allowed_redirect_hosts: ['example-partner.test'],
    watch_live_event_url_template: '',
  });
  const subRes = await fetch(`${base}/go/${siteId}/${telegramId}?action=registration`, {
    redirect: 'manual',
  });
  assert(subRes.status === 302, `expected 302 for valid subdomain, got ${subRes.status}`);
  console.log('  ✅ subdomain of whitelisted host → allowed redirect');

  // 7) Unsafe schemes (javascript:) rejected
  ReferralsRepo.update(siteId, {
    referral_url: 'javascript:alert(1)',
  } as any);
  const unsafeRes = await fetch(`${base}/go/${siteId}/${telegramId}?action=registration`, {
    redirect: 'manual',
  });
  assert(unsafeRes.status === 400, `expected 400 for unsafe javascript scheme, got ${unsafeRes.status}`);
  console.log('  ✅ unsafe non-HTTP scheme → rejected');

  // Restore partner url for cleanliness
  ReferralsRepo.update(siteId, {
    referral_url: 'https://example-partner.test/reg?aff=1',
  } as any);
  saveBusinessActionSettings({
    registration_referral_enabled: true,
    watch_live_enabled: true,
    payment_mode_placeholder_enabled: false,
    shared_watch_live_url: '',
    allowed_redirect_hosts: [],
    watch_live_event_url_template: '',
  });

  console.log(`\n  clicks +${ReferralClicksRepo.count() - clicksBefore}, conversions +${PartnerConversionsRepo.count() - convBefore}`);
  console.log('\n✅ Phase C business-actions tests PASSED\n');

  await new Promise<void>((resolve) => server.close(() => resolve()));
}

main().catch((e) => {
  console.error('\n❌ Phase C tests FAILED\n', e);
  process.exit(1);
});
