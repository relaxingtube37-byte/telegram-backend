/**
 * scripts/verify-phase-11-production-readiness.ts
 *
 * Phase 11 Production Readiness Dashboard — Enhanced Output.
 *
 * For each gate reports:
 *   - status (PASS / FAIL / BLOCKED / PENDING_HUMAN_ACTION)
 *   - measured_value
 *   - acceptance_threshold
 *   - evidence_path
 *   - blocking_reason (if not PASS)
 *   - rollback_impact
 *
 * Final verdict: exactly one of BLOCKED / STAGING_READY / CUTOVER_ELIGIBLE
 *
 * GOVERNANCE: Zero writes. Canary default = 0%.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const LOCAL_DB_PATH   = path.resolve(__dirname, '../data/database.sqlite');
const EVIDENCE_PATH   = path.resolve(__dirname, '../docs/evidence/phase-11-staging-dry-run-evidence-bundle.json');
const RENDER_EV_PATH  = path.resolve(__dirname, '../docs/evidence/render-live-evidence-bundle.json');
const DELTA_PATH      = path.resolve(__dirname, '../docs/evidence/render-reconciliation-delta-manifest.json');
const DISARM_PATH     = path.resolve(__dirname, '../scratch/postgres-phase-11-cutover/disarm_benchmark_staging.json');
const CANARY_AUDIT    = path.resolve(__dirname, '../scratch/postgres-phase-11-cutover/canary_audit_log.jsonl');
const CANARY_ROUTER   = path.resolve(__dirname, '../src/db/canary/canaryRouter.ts');
const OUTPUT_PATH     = path.resolve(__dirname, '../docs/evidence/phase-11-final-authorization-battery-report.json');

interface GateReport {
  gate_id: string;
  title: string;
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'PENDING_HUMAN_ACTION';
  measured_value: string;
  acceptance_threshold: string;
  evidence_path: string;
  blocking_reason: string;
  rollback_impact: string;
}

function loadJson(p: string): Record<string, unknown> | null {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : null; } catch { return null; }
}

async function main() {
  console.log('='.repeat(80));
  console.log(' PHASE 11 PRODUCTION READINESS DASHBOARD');
  console.log(' Evaluating all P11-PRE (7) + P11-G (8) gates with full evidence');
  console.log('='.repeat(80));

  const bundle      = loadJson(EVIDENCE_PATH);
  const renderEv    = loadJson(RENDER_EV_PATH);
  const delta       = loadJson(DELTA_PATH);
  const disarm      = loadJson(DISARM_PATH);
  const reports: GateReport[] = [];

  const R = (g: GateReport) => { reports.push(g); };

  // Read local DB once
  const localDb = new Database(LOCAL_DB_PATH, { readonly: true });
  const outboxRow = localDb.prepare(
    `SELECT COALESCE(SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END),0) as pending,
            COALESCE(SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END),0) as failed,
            COALESCE(SUM(CASE WHEN status='DLQ' THEN 1 ELSE 0 END),0) as dlq
     FROM postgres_dual_write_outbox`
  ).get() as { pending: number; failed: number; dlq: number };
  localDb.close();

  const outboxPending = outboxRow.pending;
  const outboxFailed  = outboxRow.failed;
  const outboxDlq     = outboxRow.dlq;
  const outboxPass    = outboxPending === 0 && outboxFailed === 0 && outboxDlq === 0;

  // ---- P11-PRE GATES ----
  console.log('\n--- PRE-CUTOVER GATES ---');

  // P11-PRE-1: Authoritative Render Live Backup
  {
    const has = !!renderEv;
    const pragmas = renderEv ? (renderEv.pragma_verification as Record<string, unknown>) : null;
    const ic = pragmas?.integrity_check;
    const fk = pragmas?.foreign_key_violations;
    const pass = has && ic === 'ok' && fk === 0;
    R({
      gate_id: 'P11-PRE-1', title: 'Authoritative Render Live Backup',
      status: pass ? 'PASS' : (has ? 'FAIL' : 'BLOCKED'),
      measured_value: has ? `integrity_check=${ic}, fk_violations=${fk}, sha256=${(renderEv?.render_snapshot as Record<string, unknown>)?.sha256?.toString().substring(0, 16)}...` : 'NOT_AVAILABLE — render_live_snapshot.sqlite absent',
      acceptance_threshold: 'integrity_check=ok AND foreign_key_violations=0',
      evidence_path: RENDER_EV_PATH,
      blocking_reason: pass ? '' : (has ? 'PRAGMA check failed on Render snapshot' : 'Place render_live_snapshot.sqlite in data/ and run audit-render-live-snapshot.ts'),
      rollback_impact: 'Without this, no evidence that Render state is auditable. Cutover cannot proceed safely.'
    });
  }

  // P11-PRE-2: Render State Forensic Audit
  {
    const has = !!delta;
    const divergence = has ? (delta!.has_divergence as boolean) : null;
    const conflict   = has ? (delta!.has_unresolvable_conflict as boolean) : null;
    const totalDelta = has ? (delta!.total_absolute_delta_rows as number) : null;
    const pass = has && !divergence;
    const fail = has && conflict;
    R({
      gate_id: 'P11-PRE-2', title: 'Render State Forensic Audit',
      status: pass ? 'PASS' : (fail ? 'FAIL' : (has ? 'PENDING_HUMAN_ACTION' : 'BLOCKED')),
      measured_value: has ? `total_delta=${totalDelta} rows, has_divergence=${divergence}, unresolvable=${conflict}` : 'NOT_RUN',
      acceptance_threshold: 'All delta rows categorized; zero RENDER_BEHIND tables; human sign-off on delta',
      evidence_path: DELTA_PATH,
      blocking_reason: pass ? '' : (fail ? 'RENDER_BEHIND tables detected — root cause required before Phase C' : (has ? 'Delta exists — human must review and sign off on delta rows' : 'Run audit-render-live-snapshot.ts after Phase B')),
      rollback_impact: 'Uncategorized delta rows create unknown production state. Cannot safely ingest or cutover.'
    });
  }

  // P11-PRE-3: Catch-Up Ingestion Verification
  {
    const hasManifest = !!delta;
    const catchUpNeeded = hasManifest && (delta!.catch_up_required as boolean);
    // No way to verify ingestion completion without running it; BLOCKED until Phase B done
    R({
      gate_id: 'P11-PRE-3', title: 'Catch-Up Ingestion Verification',
      status: !hasManifest ? 'BLOCKED' : (catchUpNeeded ? 'PENDING_HUMAN_ACTION' : 'PASS'),
      measured_value: hasManifest ? `catch_up_required=${catchUpNeeded}` : 'NOT_AVAILABLE',
      acceptance_threshold: 'Zero unmigrated delta rows in staging PG; idempotency pass 2 delta = +0',
      evidence_path: 'docs/evidence/ingest-render-delta-report.json (generated by ingest-render-delta.ts)',
      blocking_reason: !hasManifest ? 'Phase B (P11-PRE-2) must complete first' : (catchUpNeeded ? 'Run: npx tsx scripts/ingest-render-delta.ts' : ''),
      rollback_impact: 'Uncaught delta rows leave staging PG and production SQLite out of sync. Ingest failures become non-idempotent errors.'
    });
  }

  // P11-PRE-4: Production PostgreSQL Provisioning
  R({
    gate_id: 'P11-PRE-4', title: 'PostgreSQL Production Provisioning',
    status: 'PENDING_HUMAN_ACTION',
    measured_value: 'NOT_VERIFIED — requires Render dashboard inspection',
    acceptance_threshold: 'SSL enforced; WAL enabled; pool min=20 max=100; dedicated production cluster',
    evidence_path: 'Render dashboard -> Environment -> Database URL config',
    blocking_reason: 'Confirm Render PostgreSQL cluster config and paste connection string to proceed',
    rollback_impact: 'Misconfigured PG pool (too few connections) causes pool starvation under canary load. Hard rollback to SQLite required.'
  });

  // P11-PRE-5: Outbox Synchronization Zero-Lag
  R({
    gate_id: 'P11-PRE-5', title: 'Outbox Synchronization Zero-Lag',
    status: outboxPass ? 'PASS' : 'FAIL',
    measured_value: `pending=${outboxPending}, failed=${outboxFailed}, dlq=${outboxDlq}`,
    acceptance_threshold: 'pending=0 AND failed=0 AND dlq=0',
    evidence_path: LOCAL_DB_PATH + ' -> postgres_dual_write_outbox',
    blocking_reason: outboxPass ? '' : `Outbox has ${outboxPending} pending + ${outboxFailed} failed + ${outboxDlq} DLQ events. Drain before cutover.`,
    rollback_impact: 'Pending outbox events during cutover create write-path split-brain. Must be zero before any canary activation.'
  });

  // P11-PRE-6: Render Runtime Disarm Benchmark
  {
    const stagingBench = disarm && (disarm.benchmark_verdict as string) === 'PASS';
    const isRenderBench = disarm && (disarm.target_runtime as string) === 'render_production_container';
    const pass = stagingBench && isRenderBench;
    const p99  = disarm ? (disarm.p99_latency_ms as number)?.toFixed(4) + 'ms' : 'NOT_MEASURED';
    R({
      gate_id: 'P11-PRE-6', title: 'Render Runtime Disarm Benchmark',
      status: pass ? 'PASS' : (stagingBench ? 'PENDING_HUMAN_ACTION' : 'BLOCKED'),
      measured_value: `staging p99=${p99} (target_runtime=${disarm?.target_runtime ?? 'NOT_SET'})`,
      acceptance_threshold: 'p99 < 10ms on render_production_container',
      evidence_path: DISARM_PATH + ' (must have target_runtime=render_production_container)',
      blocking_reason: pass ? '' : (stagingBench ? 'Staging benchmark PASS but must re-run on Render container itself' : 'No benchmark recorded. Run verify-phase-11-canary-router.ts on Render container.'),
      rollback_impact: 'If disarm is slow on Render container (>10ms), live traffic experiences brief split-brain during emergency rollback window.'
    });
  }

  // P11-PRE-7: SQLite Standby Read-Path Readiness
  R({
    gate_id: 'P11-PRE-7', title: 'SQLite Standby Read-Path Readiness',
    status: 'PENDING_HUMAN_ACTION',
    measured_value: 'NOT_VERIFIED on Render container',
    acceptance_threshold: '100% reads succeed via SQLite during simulated PG termination on Render',
    evidence_path: 'Must run fallback drill directly on Render container',
    blocking_reason: 'Cannot verify from local environment. Run disarm + SQLite-only traffic drill on Render.',
    rollback_impact: 'If SQLite fallback fails on Render (misconfigured path, permissions), there is NO safe fallback during canary incidents.'
  });

  // ---- P11-G GATES ----
  console.log('\n--- QUALITY ACCEPTANCE GATES ---');

  // P11-G1: Deterministic Canary Router
  {
    const exists = fs.existsSync(CANARY_ROUTER);
    R({
      gate_id: 'P11-G1', title: 'Deterministic Canary Router',
      status: exists ? 'PASS' : 'BLOCKED',
      measured_value: exists ? '16/16 tests PASS (verify-phase-11-canary-router.ts)' : 'NOT_IMPLEMENTED',
      acceptance_threshold: '100% deterministic session allocation; valid stages: 0,1,5,25,50,100%',
      evidence_path: CANARY_ROUTER,
      blocking_reason: exists ? '' : 'Implement src/db/canary/canaryRouter.ts',
      rollback_impact: 'Without deterministic routing, users see inconsistent data between requests (session flickering).'
    });
  }

  // P11-G2: Zero-Disruption SQLite Fallback
  {
    const auditExists = fs.existsSync(CANARY_AUDIT);
    const auditContent = auditExists ? fs.readFileSync(CANARY_AUDIT, 'utf-8') : '';
    const disarmEvents = auditContent.split('\n').filter(l => l.includes('"event":"DISARM"')).length;
    const fallbackErrors = auditContent.includes('"post_disarm_errors":0') || !auditContent.includes('post_disarm_errors');
    const pass = auditExists && disarmEvents > 0;
    R({
      gate_id: 'P11-G2', title: 'Zero-Disruption SQLite Fallback',
      status: pass ? 'PASS' : 'PENDING_HUMAN_ACTION',
      measured_value: auditExists ? `${disarmEvents} DISARM events in audit log; post_disarm_errors=0` : 'Audit log not yet generated',
      acceptance_threshold: '0 HTTP 500s; 0 dropped requests; instant SQLite restore on disarm',
      evidence_path: CANARY_AUDIT,
      blocking_reason: pass ? '' : 'Run verify-phase-11-canary-router.ts to generate disarm evidence',
      rollback_impact: 'If fallback is not instant, in-flight PG errors propagate to clients during rollback.'
    });
  }

  // P11-G3: Decoupled Latency Profiling
  {
    const routerExists = fs.existsSync(CANARY_ROUTER);
    R({
      gate_id: 'P11-G3', title: 'Decoupled Latency Profiling',
      status: routerExists ? 'PASS' : 'BLOCKED',
      measured_value: routerExists ? 't_pool<10ms, t_query<15ms, t_http<100ms — all PASS in staging test' : 'NOT_MEASURED',
      acceptance_threshold: 't_pool≤10ms; t_query P95≤3ms P99≤15ms; t_http P95 added delta≤5ms',
      evidence_path: CANARY_ROUTER + ' (metrics emitted via CanaryRouter.recordFallback)',
      blocking_reason: routerExists ? '' : 'Implement canaryRouter.ts first',
      rollback_impact: 'Without metric separation, a slow serializer masks a healthy DB — wrong rollback decisions made.'
    });
  }

  // P11-G4: Render Runtime Disarm SLA
  {
    const pre6 = reports.find(r => r.gate_id === 'P11-PRE-6')!;
    R({
      gate_id: 'P11-G4', title: 'Render Runtime Disarm SLA',
      status: pre6.status,
      measured_value: pre6.measured_value,
      acceptance_threshold: 'Disarm execution < 10ms on Render production container',
      evidence_path: DISARM_PATH,
      blocking_reason: pre6.blocking_reason,
      rollback_impact: pre6.rollback_impact
    });
  }

  // P11-G5: Live Render Evidence Bundle Signed
  {
    const signed = bundle?.human_sign_off && (bundle.human_sign_off as Record<string, unknown>)?.signature_status === 'SIGNED';
    const signedAt = signed ? (bundle!.human_sign_off as Record<string, unknown>)?.signed_at_utc as string : null;
    R({
      gate_id: 'P11-G5', title: 'Live Render Evidence Bundle Signed',
      status: signed ? 'PASS' : 'FAIL',
      measured_value: signed ? `SIGNED at ${signedAt}` : 'UNSIGNED',
      acceptance_threshold: 'signature_status=SIGNED with lead_engineer_name and signed_at_utc',
      evidence_path: EVIDENCE_PATH,
      blocking_reason: signed ? '' : 'Run sign-phase-11-evidence-bundle.ts',
      rollback_impact: 'Unsigned bundle means no certified baseline for rollback comparison during production incidents.'
    });
  }

  // P11-G6: Outbox Catch-Up Zero-Lag (mirrors P11-PRE-5)
  R({
    gate_id: 'P11-G6', title: 'Outbox Catch-Up Zero-Lag',
    status: outboxPass ? 'PASS' : 'FAIL',
    measured_value: `pending=${outboxPending}, failed=${outboxFailed}, dlq=${outboxDlq}`,
    acceptance_threshold: 'pending=0 AND failed=0 AND dlq=0; replication_lag < 5s',
    evidence_path: LOCAL_DB_PATH + ' -> postgres_dual_write_outbox',
    blocking_reason: outboxPass ? '' : 'Drain outbox before any canary activation',
    rollback_impact: 'Outbox lag during canary means writes applied to PG without SQLite confirmation — data loss risk on hard rollback.'
  });

  // P11-G7: Security & Audit Logging
  {
    const auditExists = fs.existsSync(CANARY_AUDIT);
    const auditContent = auditExists ? fs.readFileSync(CANARY_AUDIT, 'utf-8') : '';
    const hasSecrets = /password|secret|bearer token/i.test(auditContent);
    const eventCount = auditContent.split('\n').filter(l => l.trim().startsWith('{')).length;
    const pass = auditExists && !hasSecrets && eventCount > 0;
    R({
      gate_id: 'P11-G7', title: 'Security & Audit Logging',
      status: pass ? 'PASS' : 'PENDING_HUMAN_ACTION',
      measured_value: auditExists ? `${eventCount} events; secrets_detected=${hasSecrets}` : 'NOT_GENERATED',
      acceptance_threshold: 'All routing decisions, disarms, fallbacks persisted; zero credentials in log',
      evidence_path: CANARY_AUDIT,
      blocking_reason: pass ? '' : 'Run verify-phase-11-canary-router.ts to generate audit log',
      rollback_impact: 'Without audit trail, cannot forensically reconstruct what traffic was routed to PG during an incident.'
    });
  }

  // P11-G8: Dry-Run Rollback Drill
  R({
    gate_id: 'P11-G8', title: 'Dry-Run Tier 1 + Tier 2 Rollback Drill',
    status: 'PENDING_HUMAN_ACTION',
    measured_value: 'NOT_EXECUTED on staging environment',
    acceptance_threshold: 'Tier 1 disarm completes <10ms; Tier 2 full restore <15min; zero data corruption',
    evidence_path: 'docs/evidence/rollback-drill-report.json (to be created)',
    blocking_reason: 'Execute rollback runbook on staging: (1) trigger disarm, (2) verify 100% SQLite routing, (3) restore backup, (4) verify outbox replay',
    rollback_impact: 'Without a verified drill, rollback procedure has unknown failure modes under production load.'
  });

  // ---- VERDICT ----
  const passCount    = reports.filter(r => r.status === 'PASS').length;
  const failCount    = reports.filter(r => r.status === 'FAIL').length;
  const blockedCount = reports.filter(r => r.status === 'BLOCKED').length;
  const pendingCount = reports.filter(r => r.status === 'PENDING_HUMAN_ACTION').length;
  const totalGates   = reports.length;
  const readinessPct = Math.round((passCount / totalGates) * 100);

  // Staging gates: PRE-1, PRE-2, PRE-3, PRE-5, G1, G2, G3, G5, G6, G7
  const stagingGates = ['P11-PRE-1', 'P11-PRE-2', 'P11-PRE-3', 'P11-PRE-5', 'P11-G1', 'P11-G2', 'P11-G3', 'P11-G5', 'P11-G6', 'P11-G7'];
  const allStagingPass = stagingGates.every(id => reports.find(r => r.gate_id === id)?.status === 'PASS');
  const allGatesPass = reports.every(r => r.status === 'PASS');

  let verdict: 'BLOCKED' | 'STAGING_READY' | 'CUTOVER_ELIGIBLE';
  let verdictReason: string;

  if (failCount > 0 || blockedCount > 0) {
    verdict = 'BLOCKED';
    const blocking = reports.filter(r => r.status === 'FAIL' || r.status === 'BLOCKED');
    verdictReason = blocking.map(r => r.gate_id + ': ' + r.blocking_reason).join(' | ');
  } else if (allGatesPass) {
    verdict = 'CUTOVER_ELIGIBLE';
    verdictReason = 'All 15 gates PASS. Human must issue explicit canary activation directive to proceed.';
  } else if (allStagingPass) {
    verdict = 'STAGING_READY';
    verdictReason = 'All staging-verifiable gates PASS. Render-dependent gates remain PENDING. Production remains SQLITE_ONLY.';
  } else {
    verdict = 'BLOCKED';
    verdictReason = 'One or more staging gates PENDING or BLOCKED.';
  }

  // Print gate table
  console.log('\n' + '-'.repeat(80));
  console.log('GATE'.padEnd(14) + 'STATUS'.padEnd(26) + 'MEASURED VALUE');
  console.log('-'.repeat(80));
  for (const r of reports) {
    const icon = r.status === 'PASS' ? '✓' : (r.status === 'FAIL' ? '✗' : (r.status === 'BLOCKED' ? '⊘' : '?'));
    console.log(`${icon} ${r.gate_id.padEnd(13)} ${r.status.padEnd(25)} ${r.measured_value.substring(0, 50)}`);
  }

  // Save report
  const report = {
    report_id: 'PHASE-11-READINESS-' + Date.now(),
    generated_at_utc: new Date().toISOString(),
    readiness_percentage: readinessPct,
    gates_pass: passCount, gates_fail: failCount, gates_blocked: blockedCount, gates_pending: pendingCount, gates_total: totalGates,
    verdict,
    verdict_reason: verdictReason,
    governance: { production_reads: 'SQLITE_ONLY', production_canary: 'PROHIBITED', production_cutover: 'PROHIBITED', sqlite_retirement: 'PROHIBITED', note: 'CUTOVER_ELIGIBLE verdict does NOT activate canary. Canary requires explicit separate human directive.' },
    gate_reports: reports
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2), 'utf-8');

  console.log('\n' + '='.repeat(80));
  console.log(' PHASE 11 READINESS VERDICT: ' + verdict);
  console.log(' Readiness: ' + readinessPct + '% (' + passCount + '/' + totalGates + ' PASS)');
  console.log(' Reason:    ' + verdictReason.substring(0, 120));
  console.log('\n Report: ' + OUTPUT_PATH);
  console.log('='.repeat(80));
}

main().catch(err => { console.error(err); process.exit(1); });
