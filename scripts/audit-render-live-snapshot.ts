/**
 * scripts/audit-render-live-snapshot.ts
 *
 * Phase B — Live Render Snapshot Forensic Audit (Enhanced).
 *
 * PRECONDITION:
 *   Obtain snapshot from Render Shell:
 *     1. Render dashboard -> Web Service -> Shell
 *     2. sqlite3 data/database.sqlite ".backup /tmp/render_export.sqlite"
 *     3. Download and place at: G:/telegram-backend/data/render_live_snapshot.sqlite
 *
 * OUTPUTS (all read-only):
 *   B3: SHA-256, byte size, snapshot timestamp
 *   B4: PRAGMA integrity_check, foreign_key_check, quick_check
 *   B5: Row counts for all 9 production tables + schema fingerprint
 *   B6: Delta diff vs. staging baseline (from signed evidence bundle)
 *   B7: reconciliation_delta_manifest.json + render-live-evidence-bundle.json
 *   Outbox: snapshot of postgres_dual_write_outbox state
 *
 * GOVERNANCE: Zero writes to any DB. Zero production mutations.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const RENDER_SNAPSHOT_PATH = path.resolve(__dirname, '../data/render_live_snapshot.sqlite');
const EVIDENCE_BUNDLE_PATH = path.resolve(__dirname, '../docs/evidence/phase-11-staging-dry-run-evidence-bundle.json');
const OUTPUT_DIR = path.resolve(__dirname, '../docs/evidence');
const DELTA_MANIFEST_PATH = path.join(OUTPUT_DIR, 'render-reconciliation-delta-manifest.json');
const RENDER_EVIDENCE_BUNDLE_PATH = path.join(OUTPUT_DIR, 'render-live-evidence-bundle.json');

const REQUIRED_TABLES = [
  'users', 'referral_sites', 'referral_clicks', 'partner_conversions',
  'predictions', 'settings', 'historical_matches', 'top_players_cache',
  'postgres_dual_write_outbox'
] as const;
type TableName = typeof REQUIRED_TABLES[number];

interface SchemaTable { name: string; sql: string | null }

function computeSchemaFingerprint(db: Database.Database): string {
  const tables = db.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all() as SchemaTable[];
  const schema = tables.map(t => `${t.name}:${t.sql ?? ''}`).join('|');
  return crypto.createHash('sha256').update(schema).digest('hex').substring(0, 32);
}

async function main() {
  console.log('='.repeat(80));
  console.log(' PHASE B: RENDER LIVE SNAPSHOT FORENSIC AUDIT');
  console.log(' Status: READ-ONLY | Production: SQLITE_ONLY | Canary: PROHIBITED');
  console.log('='.repeat(80));

  // --- Preflight ---
  if (!fs.existsSync(RENDER_SNAPSHOT_PATH)) {
    console.error('\n[BLOCKED] Render snapshot not found at:');
    console.error('  ' + RENDER_SNAPSHOT_PATH);
    console.error('\n  Steps to obtain:');
    console.error('  1. Render dashboard -> Web Service -> Shell');
    console.error('  2. sqlite3 data/database.sqlite ".backup /tmp/render_export.sqlite"');
    console.error('  3. Download file -> place at data/render_live_snapshot.sqlite');
    process.exit(1);
  }

  if (!fs.existsSync(EVIDENCE_BUNDLE_PATH)) {
    console.error('[BLOCKED] Evidence bundle not found. Run Phase A first.');
    process.exit(1);
  }
  const bundle = JSON.parse(fs.readFileSync(EVIDENCE_BUNDLE_PATH, 'utf-8'));
  if (bundle.human_sign_off?.signature_status !== 'SIGNED') {
    console.error('[BLOCKED] Evidence bundle is UNSIGNED. Run sign-phase-11-evidence-bundle.ts first.');
    process.exit(1);
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // --- [B3] Cryptographic identity ---
  console.log('\n[B3] Computing Render snapshot cryptographic identity...');
  const snapshotTimestampUtc = new Date().toISOString();
  const snapshotStat = fs.statSync(RENDER_SNAPSHOT_PATH);
  const snapshotBytes = fs.readFileSync(RENDER_SNAPSHOT_PATH);
  const snapshotSha256 = crypto.createHash('sha256').update(snapshotBytes).digest('hex');

  console.log('  File:        ' + RENDER_SNAPSHOT_PATH);
  console.log('  Size:        ' + snapshotStat.size.toLocaleString() + ' bytes');
  console.log('  SHA-256:     ' + snapshotSha256);
  console.log('  Audited at:  ' + snapshotTimestampUtc);

  // --- [B4] PRAGMA integrity checks ---
  console.log('\n[B4] Running PRAGMA integrity checks...');
  const renderDb = new Database(RENDER_SNAPSHOT_PATH, { readonly: true });

  const integrityResult = renderDb.pragma('integrity_check') as { integrity_check: string }[];
  const integrityStatus = integrityResult[0]?.integrity_check ?? 'unknown';
  const fkResult = renderDb.pragma('foreign_key_check') as unknown[];
  const fkViolationCount = fkResult.length;
  const quickResult = renderDb.pragma('quick_check') as { quick_check: string }[];
  const quickStatus = quickResult[0]?.quick_check ?? 'unknown';
  const schemaFingerprint = computeSchemaFingerprint(renderDb);
  const userVersion = (renderDb.pragma('user_version') as { user_version: number }[])[0]?.user_version ?? 0;

  console.log('  integrity_check:       ' + integrityStatus + (integrityStatus === 'ok' ? ' ✓' : ' ✗'));
  console.log('  quick_check:           ' + quickStatus + (quickStatus === 'ok' ? ' ✓' : ' ✗'));
  console.log('  foreign_key_violations:' + fkViolationCount + (fkViolationCount === 0 ? ' ✓' : ' ✗'));
  console.log('  schema_fingerprint:    ' + schemaFingerprint);
  console.log('  user_version:          ' + userVersion);

  const pragmaPass = integrityStatus === 'ok' && quickStatus === 'ok' && fkViolationCount === 0;
  if (!pragmaPass) {
    console.error('\n[FAIL] PRAGMA checks failed. Cannot proceed with audit.');
    renderDb.close();
    process.exit(1);
  }
  console.log('  [PASS] All PRAGMA checks passed.');

  // --- [B5] Row counts + outbox state ---
  console.log('\n[B5] Extracting Render table row counts...');
  const renderCounts: Record<string, number> = {};
  for (const tableName of REQUIRED_TABLES) {
    try {
      const r = renderDb.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`).get() as { cnt: number };
      renderCounts[tableName] = r.cnt;
      console.log('  ' + tableName.padEnd(38) + r.cnt.toLocaleString().padStart(10));
    } catch {
      console.warn('  [WARN] Table "' + tableName + '" absent. Count = 0.');
      renderCounts[tableName] = 0;
    }
  }

  // Outbox detailed state (critical for P11-PRE-5)
  let outboxDetail = { total: 0, pending: 0, processing: 0, failed: 0, dlq: 0, max_event_id: null as number | null };
  try {
    const ob = renderDb.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status='PROCESSING' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status='DLQ' THEN 1 ELSE 0 END) as dlq,
        MAX(id) as max_event_id
      FROM postgres_dual_write_outbox
    `).get() as typeof outboxDetail;
    outboxDetail = ob;
    console.log('\n  Outbox state (postgres_dual_write_outbox):');
    console.log('    total:        ' + (outboxDetail.total ?? 0));
    console.log('    pending:      ' + (outboxDetail.pending ?? 0) + (outboxDetail.pending > 0 ? ' ⚠️' : ' ✓'));
    console.log('    processing:   ' + (outboxDetail.processing ?? 0));
    console.log('    failed:       ' + (outboxDetail.failed ?? 0) + (outboxDetail.failed > 0 ? ' ⚠️' : ' ✓'));
    console.log('    dlq:          ' + (outboxDetail.dlq ?? 0) + (outboxDetail.dlq > 0 ? ' ⚠️' : ' ✓'));
    console.log('    max_event_id: ' + (outboxDetail.max_event_id ?? 'null'));
  } catch (e) {
    console.warn('  [WARN] Could not query outbox detail: ' + (e as Error).message);
  }

  renderDb.close();

  // --- [B6] Delta diff vs. staging baseline ---
  console.log('\n[B6] Diffing Render counts vs. staging baseline (commit 25fc568)...');
  const baselineCounts = bundle.table_row_counts as Record<string, number>;

  const deltaRows: Array<{
    table: string; render_count: number; staging_count: number;
    delta: number; status: string; requires_catch_up: boolean;
  }> = [];
  let totalDelta = 0;
  let hasDivergence = false;
  let hasUnresolvableConflict = false;

  for (const tableName of REQUIRED_TABLES) {
    const renderCount = renderCounts[tableName] ?? 0;
    const baselineCount = baselineCounts[tableName] ?? 0;
    const delta = renderCount - baselineCount;
    totalDelta += Math.abs(delta);

    let status = 'MATCH';
    let requiresCatchUp = false;
    if (delta > 0) { status = 'RENDER_AHEAD'; hasDivergence = true; requiresCatchUp = true; }
    else if (delta < 0) {
      // Render behind baseline — potentially a conflict: data deleted in Render or baseline overcounted
      status = 'RENDER_BEHIND';
      hasDivergence = true;
      hasUnresolvableConflict = true; // behind is a blocker — needs human review
    }

    deltaRows.push({ table: tableName, render_count: renderCount, staging_count: baselineCount, delta, status, requires_catch_up: requiresCatchUp });
    const indicator = status === 'MATCH' ? '✓' : (status === 'RENDER_AHEAD' ? '▲' : '▼');
    console.log('  ' + indicator + ' ' + tableName.padEnd(36) + ' Render=' + renderCount.toString().padStart(8) + ' | Base=' + baselineCount.toString().padStart(8) + ' | Δ=' + (delta >= 0 ? '+' : '') + delta + ' [' + status + ']');
  }

  const outboxZeroLag = (outboxDetail.pending ?? 0) === 0 && (outboxDetail.failed ?? 0) === 0 && (outboxDetail.dlq ?? 0) === 0;

  // --- [B7] Write manifests ---
  console.log('\n[B7] Writing reconciliation manifests...');

  const deltaManifest = {
    manifest_id: 'RENDER-DELTA-' + Date.now(),
    audited_at_utc: snapshotTimestampUtc,
    render_snapshot: { sha256: snapshotSha256, size_bytes: snapshotStat.size, schema_fingerprint: schemaFingerprint, user_version: userVersion },
    staging_baseline: { commit: '25fc568', evidence_bundle: 'BUNDLE-PHASE-11-STAGING-DRYRUN-20260911154029' },
    total_absolute_delta_rows: totalDelta,
    has_divergence: hasDivergence,
    has_unresolvable_conflict: hasUnresolvableConflict,
    outbox_zero_lag: outboxZeroLag,
    catch_up_required: deltaRows.filter(d => d.requires_catch_up).length > 0,
    delta_requires_human_review: hasDivergence,
    table_deltas: deltaRows,
    governance: {
      production_reads: 'SQLITE_ONLY', production_canary: 'PROHIBITED',
      note: 'Delta rows with requires_catch_up=true must be ingested into staging PG. RENDER_BEHIND tables require human root-cause analysis before Phase C.'
    }
  };
  fs.writeFileSync(DELTA_MANIFEST_PATH, JSON.stringify(deltaManifest, null, 2), 'utf-8');

  const pre1Status = pragmaPass ? 'PASS' : 'FAIL';
  const pre2Status = !hasDivergence ? 'PASS' : (hasUnresolvableConflict ? 'FAIL' : 'PENDING_HUMAN_REVIEW');
  const pre5Status = outboxZeroLag ? 'PASS' : 'FAIL';

  const renderEvidenceBundle = {
    bundle_id: 'RENDER-LIVE-EVIDENCE-' + Date.now(),
    audited_at_utc: snapshotTimestampUtc,
    render_snapshot: {
      file_path: RENDER_SNAPSHOT_PATH, sha256: snapshotSha256,
      size_bytes: snapshotStat.size, schema_fingerprint: schemaFingerprint, user_version: userVersion
    },
    pragma_verification: { integrity_check: integrityStatus, quick_check: quickStatus, foreign_key_violations: fkViolationCount },
    render_table_row_counts: renderCounts,
    staging_baseline_counts: baselineCounts,
    outbox_state: outboxDetail,
    reconciliation: { total_delta: totalDelta, has_divergence: hasDivergence, has_unresolvable_conflict: hasUnresolvableConflict, catch_up_required: deltaManifest.catch_up_required },
    gate_verdicts: {
      'P11-PRE-1': { status: pre1Status, evidence: RENDER_EVIDENCE_BUNDLE_PATH, threshold: 'integrity_check=ok AND fk_violations=0' },
      'P11-PRE-2': { status: pre2Status, evidence: DELTA_MANIFEST_PATH, threshold: 'All delta rows categorized; no RENDER_BEHIND tables' },
      'P11-PRE-5': { status: pre5Status, evidence: 'outbox_state embedded above', threshold: 'pending=0 AND failed=0 AND dlq=0' }
    },
    governance: { production_reads: 'SQLITE_ONLY', production_canary: 'PROHIBITED', production_cutover: 'PROHIBITED' }
  };
  fs.writeFileSync(RENDER_EVIDENCE_BUNDLE_PATH, JSON.stringify(renderEvidenceBundle, null, 2), 'utf-8');

  // --- Summary ---
  console.log('\n' + '='.repeat(80));
  console.log(' PHASE B AUDIT COMPLETE');
  console.log('  P11-PRE-1 (Backup + PRAGMA):  ' + pre1Status);
  console.log('  P11-PRE-2 (Delta Audit):      ' + pre2Status + (hasDivergence ? ' — ' + totalDelta + ' total delta rows' : ''));
  console.log('  P11-PRE-5 (Outbox Zero-Lag):  ' + pre5Status);
  if (hasDivergence) {
    console.log('\n  [HUMAN REVIEW REQUIRED]');
    deltaRows.filter(d => d.status !== 'MATCH').forEach(d => {
      console.log('    ' + d.table + ': ' + d.status + ' (Δ=' + (d.delta >= 0 ? '+' : '') + d.delta + ')');
    });
  }
  console.log('\n  Manifests written:');
  console.log('    ' + DELTA_MANIFEST_PATH);
  console.log('    ' + RENDER_EVIDENCE_BUNDLE_PATH);
  console.log('\n  Next step: npx tsx scripts/ingest-render-delta.ts');
  console.log('='.repeat(80));
}

main().catch(err => { console.error('Unexpected error:', err); process.exit(1); });
