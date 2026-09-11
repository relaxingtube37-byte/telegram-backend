/**
 * scripts/audit-render-live-snapshot.ts
 *
 * Phase B — Live Render Snapshot Forensic Audit.
 *
 * PRECONDITION:
 *   You must first manually export the live Render SQLite file.
 *   Steps to obtain it from Render:
 *     1. Open Render dashboard -> Your Web Service -> Shell
 *     2. Run: sqlite3 data/database.sqlite ".backup '/tmp/render_export.sqlite'"
 *     3. Download the file from Render Shell or use Render Disk download feature.
 *     4. Place the file at: data/render_live_snapshot.sqlite
 *
 * WHAT THIS SCRIPT DOES (read-only):
 *   B3: Compute SHA-256, byte size, timestamp
 *   B4: Run PRAGMA integrity_check and foreign_key_check
 *   B5: Extract row counts for all 9 production tables
 *   B6: Diff Render counts vs. local baseline (from evidence bundle)
 *   B7: Generate reconciliation_delta_manifest.json
 *
 * GOVERNANCE: Zero writes to any database. Zero production mutations.
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

async function main() {
  console.log('='.repeat(80));
  console.log(' PHASE B: RENDER LIVE SNAPSHOT FORENSIC AUDIT');
  console.log(' Status: READ-ONLY | Production: SQLITE_ONLY | Canary: PROHIBITED');
  console.log('='.repeat(80));

  // ---------------------------------------------------------------------------
  // Preflight: Check that snapshot file exists
  // ---------------------------------------------------------------------------
  if (!fs.existsSync(RENDER_SNAPSHOT_PATH)) {
    console.error('\n[BLOCKED] Render live snapshot not found at:');
    console.error('  ' + RENDER_SNAPSHOT_PATH);
    console.error('\nTo obtain the snapshot from Render:');
    console.error('  1. Open Render dashboard -> Your Web Service -> Shell');
    console.error('  2. Run: sqlite3 data/database.sqlite ".backup /tmp/render_export.sqlite"');
    console.error('  3. Download the file and place it at: data/render_live_snapshot.sqlite');
    console.error('\nPhase B cannot proceed until the snapshot is available.');
    process.exit(1);
  }

  // Load staging baseline from evidence bundle
  const bundleRaw = fs.readFileSync(EVIDENCE_BUNDLE_PATH, 'utf-8');
  const bundle = JSON.parse(bundleRaw) as {
    human_sign_off: { signature_status: string };
    backup_artifact: { snapshot_timestamp_utc: string; file_size_bytes: number; sha256_checksum: string };
    table_row_counts: Record<TableName, number>;
  };

  if (bundle.human_sign_off.signature_status !== 'SIGNED') {
    console.error('[BLOCKED] Evidence bundle is not SIGNED. Run Phase A sign-off first.');
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // [B3] Compute SHA-256, byte size, timestamp
  // ---------------------------------------------------------------------------
  console.log('\n[B3] Computing Render snapshot cryptographic identity...');
  const snapshotStat = fs.statSync(RENDER_SNAPSHOT_PATH);
  const snapshotBytes = fs.readFileSync(RENDER_SNAPSHOT_PATH);
  const snapshotSha256 = crypto.createHash('sha256').update(snapshotBytes).digest('hex');
  const snapshotTimestampUtc = new Date().toISOString();

  console.log('  File size:   ' + snapshotStat.size.toLocaleString() + ' bytes');
  console.log('  SHA-256:     ' + snapshotSha256);
  console.log('  Audited at:  ' + snapshotTimestampUtc);

  // ---------------------------------------------------------------------------
  // [B4] PRAGMA checks
  // ---------------------------------------------------------------------------
  console.log('\n[B4] Running PRAGMA integrity checks...');
  const renderDb = new Database(RENDER_SNAPSHOT_PATH, { readonly: true });
  const integrityResult = renderDb.pragma('integrity_check') as { integrity_check: string }[];
  const integrityStatus = integrityResult[0]?.integrity_check ?? 'unknown';
  const fkResult = renderDb.pragma('foreign_key_check') as unknown[];
  const fkViolationCount = fkResult.length;

  console.log('  integrity_check:        ' + integrityStatus);
  console.log('  foreign_key_violations: ' + fkViolationCount);

  if (integrityStatus !== 'ok') {
    console.error('[FAIL] integrity_check returned: ' + integrityStatus);
    renderDb.close();
    process.exit(1);
  }
  if (fkViolationCount > 0) {
    console.error('[FAIL] ' + fkViolationCount + ' foreign key violations found.');
    renderDb.close();
    process.exit(1);
  }
  console.log('  [PASS] All PRAGMA checks passed.');

  // ---------------------------------------------------------------------------
  // [B5] Extract row counts for all 9 tables
  // ---------------------------------------------------------------------------
  console.log('\n[B5] Extracting Render table row counts...');
  const renderCounts: Record<string, number> = {};

  for (const tableName of REQUIRED_TABLES) {
    try {
      const result = renderDb.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`).get() as { cnt: number };
      renderCounts[tableName] = result.cnt;
      console.log(`  ${tableName.padEnd(36)} ${result.cnt.toLocaleString()}`);
    } catch (err) {
      console.warn(`  [WARN] Table "${tableName}" not found in Render snapshot. Count = 0.`);
      renderCounts[tableName] = 0;
    }
  }

  renderDb.close();

  // ---------------------------------------------------------------------------
  // [B6] Diff vs. staging baseline
  // ---------------------------------------------------------------------------
  console.log('\n[B6] Diffing Render counts vs. staging baseline (commit 25fc568)...');
  const baselineCounts = bundle.table_row_counts;

  const deltaRows: Array<{
    table: string;
    render_count: number;
    staging_baseline_count: number;
    delta: number;
    status: string;
  }> = [];

  let totalDelta = 0;
  let hasDivergence = false;

  for (const tableName of REQUIRED_TABLES) {
    const renderCount = renderCounts[tableName] ?? 0;
    const baselineCount = baselineCounts[tableName] ?? 0;
    const delta = renderCount - baselineCount;
    totalDelta += Math.abs(delta);

    let status = 'MATCH';
    if (delta > 0) { status = 'RENDER_AHEAD'; hasDivergence = true; }
    else if (delta < 0) { status = 'RENDER_BEHIND'; hasDivergence = true; }

    deltaRows.push({ table: tableName, render_count: renderCount, staging_baseline_count: baselineCount, delta, status });
    console.log(`  ${tableName.padEnd(36)} Render=${renderCount.toLocaleString().padStart(8)} | Baseline=${baselineCount.toLocaleString().padStart(8)} | delta=${delta > 0 ? '+' + delta : delta} | ${status}`);
  }

  console.log('\n  Total absolute delta: ' + totalDelta + ' rows');
  console.log('  Has divergence: ' + hasDivergence);

  // ---------------------------------------------------------------------------
  // [B7] Write reconciliation_delta_manifest.json
  // ---------------------------------------------------------------------------
  console.log('\n[B7] Writing reconciliation delta manifest...');

  const deltaManifest = {
    manifest_id: 'RENDER-DELTA-' + Date.now(),
    audited_at_utc: snapshotTimestampUtc,
    render_snapshot_sha256: snapshotSha256,
    render_snapshot_size_bytes: snapshotStat.size,
    staging_baseline_commit: '25fc568',
    total_absolute_delta_rows: totalDelta,
    has_divergence: hasDivergence,
    delta_requires_human_review: hasDivergence,
    table_deltas: deltaRows,
    governance: {
      production_reads: 'SQLITE_ONLY',
      production_canary: 'PROHIBITED',
      note: 'All delta rows require human-in-the-loop sign-off before staging ingestion (Phase C).',
    },
  };

  fs.writeFileSync(DELTA_MANIFEST_PATH, JSON.stringify(deltaManifest, null, 2), 'utf-8');
  console.log('  Delta manifest: ' + DELTA_MANIFEST_PATH);

  // Write render-live-evidence-bundle.json (P11-PRE-1 artifact)
  const renderEvidenceBundle = {
    bundle_id: 'RENDER-LIVE-EVIDENCE-' + Date.now(),
    audited_at_utc: snapshotTimestampUtc,
    render_snapshot: {
      file_path: RENDER_SNAPSHOT_PATH,
      sha256_checksum: snapshotSha256,
      file_size_bytes: snapshotStat.size,
    },
    pragma_verification: {
      integrity_check: integrityStatus,
      foreign_key_violations: fkViolationCount,
    },
    render_table_row_counts: renderCounts,
    staging_baseline_table_row_counts: baselineCounts,
    reconciliation_delta: {
      total_absolute_delta: totalDelta,
      has_divergence: hasDivergence,
      delta_manifest_path: DELTA_MANIFEST_PATH,
    },
    human_review_required: hasDivergence,
    gate_status: {
      'P11-PRE-1': integrityStatus === 'ok' && fkViolationCount === 0 ? 'PASS' : 'FAIL',
      'P11-PRE-2': 'PENDING_HUMAN_REVIEW',
    },
    governance: {
      production_reads: 'SQLITE_ONLY',
      production_canary: 'PROHIBITED',
      production_cutover: 'PROHIBITED',
    },
  };

  fs.writeFileSync(RENDER_EVIDENCE_BUNDLE_PATH, JSON.stringify(renderEvidenceBundle, null, 2), 'utf-8');
  console.log('  Render evidence bundle: ' + RENDER_EVIDENCE_BUNDLE_PATH);

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n' + '='.repeat(80));
  const pre1Status = renderEvidenceBundle.gate_status['P11-PRE-1'];
  console.log(' PHASE B AUDIT COMPLETE');
  console.log('  P11-PRE-1 (Backup + PRAGMA): ' + pre1Status);
  console.log('  P11-PRE-2 (Delta Audit):     ' + (hasDivergence ? 'PENDING_HUMAN_REVIEW (' + totalDelta + ' rows delta)' : 'PASS (zero delta)'));
  if (hasDivergence) {
    console.log('\n  [HUMAN REVIEW REQUIRED]');
    console.log('  Review: ' + DELTA_MANIFEST_PATH);
    console.log('  Categorize delta rows and provide sign-off before Phase C.');
  }
  console.log('\n  Commit: docs/evidence/render-live-evidence-bundle.json');
  console.log('          docs/evidence/render-reconciliation-delta-manifest.json');
  console.log('='.repeat(80));
}

main().catch((err) => { console.error('Unexpected error:', err); process.exit(1); });
