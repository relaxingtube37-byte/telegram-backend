/**
 * scripts/sign-phase-11-evidence-bundle.ts
 *
 * Phase 11 Evidence Bundle Sign-Off Tool.
 *
 * PURPOSE:
 *   Applies a formal human sign-off to the Phase 11 staging dry-run evidence bundle.
 *   Changes signature_status from UNSIGNED -> SIGNED.
 *
 * GOVERNANCE:
 *   - This script does NOT authorize production canary or cutover.
 *   - It does NOT modify any database files.
 *   - It ONLY updates the evidence bundle JSON and writes a commit-ready audit record.
 *   - All authorization state remains: production_reads=SQLITE_ONLY, production_cutover=PROHIBITED.
 *
 * USAGE:
 *   npx tsx scripts/sign-phase-11-evidence-bundle.ts --engineer "Your Name" [--auditor "Auditor Name"]
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const EVIDENCE_BUNDLE_PATH = path.resolve(__dirname, '../docs/evidence/phase-11-staging-dry-run-evidence-bundle.json');
const AUDIT_LOG_PATH = path.resolve(__dirname, '../docs/evidence/phase-11-sign-off-audit-log.json');

function parseArgs(): { engineer: string | null; auditor: string | null } {
  const args = process.argv.slice(2);
  let engineer: string | null = null;
  let auditor: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--engineer' && args[i + 1]) { engineer = args[i + 1]; i++; }
    if (args[i] === '--auditor' && args[i + 1]) { auditor = args[i + 1]; i++; }
  }
  return { engineer, auditor };
}

async function main() {
  console.log('='.repeat(80));
  console.log(' PHASE 11: EVIDENCE BUNDLE SIGN-OFF TOOL');
  console.log(' Governance: STAGING ONLY | Production Status: SQLITE_ONLY');
  console.log('='.repeat(80));

  const { engineer, auditor } = parseArgs();
  if (!engineer) {
    console.error('ERROR: --engineer argument is required.');
    console.error('  npx tsx scripts/sign-phase-11-evidence-bundle.ts --engineer "Your Name"');
    process.exit(1);
  }

  console.log('\n[1/4] Loading evidence bundle...');
  const bundleRaw = fs.readFileSync(EVIDENCE_BUNDLE_PATH, 'utf-8');
  const bundle = JSON.parse(bundleRaw) as Record<string, unknown>;
  const humanSignOff = bundle.human_sign_off as Record<string, unknown>;
  console.log('  Bundle ID:      ' + bundle.bundle_id);
  console.log('  Current status: ' + humanSignOff.signature_status);

  if (humanSignOff.signature_status === 'SIGNED') {
    console.warn('Bundle is already SIGNED. Exiting without changes.');
    process.exit(0);
  }

  console.log('\n[2/4] Verifying backup integrity...');
  const backupArtifact = bundle.backup_artifact as Record<string, unknown>;
  const backupPath = backupArtifact.file_path as string;
  let backupIntegrityStatus = 'SKIP - backup file not found on this machine';
  if (fs.existsSync(backupPath)) {
    const backupBytes = fs.readFileSync(backupPath);
    const recomputedSha = crypto.createHash('sha256').update(backupBytes).digest('hex');
    const storedSha = backupArtifact.sha256_checksum as string;
    if (recomputedSha === storedSha) {
      backupIntegrityStatus = 'PASS - SHA-256 matches (' + recomputedSha.substring(0, 16) + '...)';
    } else {
      console.error('INTEGRITY FAILURE: Backup SHA-256 mismatch!');
      console.error('  Stored:     ' + storedSha);
      console.error('  Computed:   ' + recomputedSha);
      process.exit(1);
    }
  }
  console.log('  Backup integrity: ' + backupIntegrityStatus);

  console.log('\n[3/4] Applying sign-off...');
  const signedAtUtc = new Date().toISOString();
  const updatedBundle = {
    ...bundle,
    governance_status: 'SIGNED_STAGING_CERTIFIED',
    human_sign_off: {
      ...humanSignOff,
      signature_status: 'SIGNED',
      lead_engineer_name: engineer,
      security_auditor_name: auditor ?? '- (single-reviewer sign-off)',
      signed_at_utc: signedAtUtc,
      production_canary_remains: 'PROHIBITED',
      production_reads_remain: 'SQLITE_ONLY',
      production_cutover_remains: 'PROHIBITED',
    },
  };
  fs.writeFileSync(EVIDENCE_BUNDLE_PATH, JSON.stringify(updatedBundle, null, 2), 'utf-8');
  console.log('  Bundle updated -> signature_status: SIGNED');
  console.log('  Signed by: ' + engineer + ' at ' + signedAtUtc);

  console.log('\n[4/4] Writing audit log...');
  const storedBundleSha = humanSignOff.bundle_content_sha256 as string;
  const auditLog = {
    event: 'PHASE_11_EVIDENCE_BUNDLE_SIGNED',
    bundle_id: bundle.bundle_id,
    signed_at_utc: signedAtUtc,
    lead_engineer_name: engineer,
    security_auditor_name: auditor ?? '- (single-reviewer sign-off)',
    bundle_content_sha256: storedBundleSha,
    backup_integrity: backupIntegrityStatus,
    governance_assertions: {
      production_reads: 'SQLITE_ONLY',
      production_shadow_reads: 'PROHIBITED',
      production_cutover: 'PROHIBITED',
      sqlite_retirement: 'PROHIBITED',
      canary_routing: 'PROHIBITED',
    },
    declaration: humanSignOff.declaration,
    next_authorized_action: 'Phase B - Live Render Snapshot Extraction (requires explicit human authorization)',
  };
  fs.writeFileSync(AUDIT_LOG_PATH, JSON.stringify(auditLog, null, 2), 'utf-8');
  console.log('  Audit log: ' + AUDIT_LOG_PATH);

  console.log('\n' + '='.repeat(80));
  console.log(' PHASE A COMPLETE: Evidence bundle SIGNED');
  console.log('  production_reads = SQLITE_ONLY (unchanged)');
  console.log('  Next: Phase B - Render Live Snapshot (requires explicit human authorization)');
  console.log('  Commit: docs/evidence/phase-11-staging-dry-run-evidence-bundle.json');
  console.log('          docs/evidence/phase-11-sign-off-audit-log.json');
  console.log('='.repeat(80));
}

main().catch((err) => { console.error('Unexpected error:', err); process.exit(1); });
