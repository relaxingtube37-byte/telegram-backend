import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { configureLinkerConnection } from './schema';

export type PhaseGateStatus = 'PASS' | 'WARNING' | 'FAIL';

export interface PhaseGateCheckResult {
  checkId: string;
  name: string;
  status: PhaseGateStatus;
  message: string;
  metrics: Record<string, unknown>;
}

export interface PhaseGateVerdict {
  timestamp: string;
  targetDbPath: string;
  overallStatus: PhaseGateStatus;
  passedCount: number;
  warningCount: number;
  failedCount: number;
  checks: PhaseGateCheckResult[];
  summaryMarkdown: string;
}

export interface PhaseGateOptions {
  customDbPath?: string;
  maxQueueRateSoftPct?: number; // default 20.0%
  maxQueueRateHardPct?: number; // default 25.0%
  maxUnresolvedAliasSoftPct?: number; // default 1.5%
  maxUnresolvedAliasHardPct?: number; // default 3.0%
  minPrecisionSoftPct?: number; // default 100.0%
  minPrecisionHardPct?: number; // default 99.5%
  walSoftLimitBytes?: number; // default 25 MB
  walHardLimitBytes?: number; // default 100 MB
}

export function validatePhaseGate(options: PhaseGateOptions = {}): PhaseGateVerdict {
  const targetDbPath = path.resolve(options.customDbPath || 'data/database.linker_dryrun.sqlite');
  const liveDbPath = path.resolve('data/database.sqlite');
  const legacyDryRunPath = path.resolve('data/database.dryrun.sqlite');

  // Hard safety guards
  if (targetDbPath === liveDbPath) {
    throw new Error('SECURITY VIOLATION: Refusing to run phase-gate validator against live production database data/database.sqlite');
  }
  if (targetDbPath === legacyDryRunPath) {
    throw new Error('SAFETY VIOLATION: Refusing to run phase-gate validator against legacy copy database data/database.dryrun.sqlite');
  }

  if (!fs.existsSync(targetDbPath)) {
    throw new Error(`Target database file does not exist: ${targetDbPath}`);
  }

  const db = new Database(targetDbPath, { readonly: true });
  configureLinkerConnection(db);

  const checks: PhaseGateCheckResult[] = [];

  try {
    // -------------------------------------------------------------------------
    // 1. PRAGMA integrity_check
    // -------------------------------------------------------------------------
    const integrityRes = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    const isIntegrityOk = integrityRes.length === 1 && integrityRes[0].integrity_check === 'ok';
    checks.push({
      checkId: 'CHK_1_INTEGRITY',
      name: 'SQLite Database Integrity Check',
      status: isIntegrityOk ? 'PASS' : 'FAIL',
      message: isIntegrityOk
        ? 'SQLite PRAGMA integrity_check returned ok'
        : `SQLite integrity check failed: ${JSON.stringify(integrityRes)}`,
      metrics: { rawResult: integrityRes },
    });

    // -------------------------------------------------------------------------
    // 2. PRAGMA foreign_key_check
    // -------------------------------------------------------------------------
    const fkRes = db.pragma('foreign_key_check') as any[];
    const fkErrorsCount = fkRes.length;
    checks.push({
      checkId: 'CHK_2_FOREIGN_KEYS',
      name: 'Foreign Key Constraint Enforcement',
      status: fkErrorsCount === 0 ? 'PASS' : 'FAIL',
      message: fkErrorsCount === 0
        ? 'Zero foreign key constraint violations across all tables'
        : `${fkErrorsCount} foreign key constraint violation(s) detected`,
      metrics: { fkViolationsCount: fkErrorsCount, violations: fkRes.slice(0, 10) },
    });

    // -------------------------------------------------------------------------
    // 3. False-Positive Merge Count
    // -------------------------------------------------------------------------
    // Inspect all canonical matches with 2 or more linked sources
    const multiSourceRows = db
      .prepare(`
        SELECT 
          cm.canonical_match_id,
          cm.player_low_id,
          cm.player_high_id,
          cm.match_date,
          cm.tour,
          cm.winner_canonical_id,
          msl.source_name,
          msl.source_match_id,
          msl.evidence_id,
          rse.raw_payload_json
        FROM canonical_matches cm
        JOIN match_source_links msl ON cm.canonical_match_id = msl.canonical_match_id
        JOIN raw_source_evidence rse ON msl.evidence_id = rse.evidence_id
        WHERE cm.evidence_count >= 2
        ORDER BY cm.canonical_match_id
      `)
      .all() as any[];

    // Group by canonical_match_id
    const groupedMatches = new Map<string, any[]>();
    for (const row of multiSourceRows) {
      if (!groupedMatches.has(row.canonical_match_id)) {
        groupedMatches.set(row.canonical_match_id, []);
      }
      groupedMatches.get(row.canonical_match_id)!.push(row);
    }

    let falsePositiveMerges = 0;
    const falsePositiveDetails: any[] = [];

    for (const [canonicalId, links] of groupedMatches.entries()) {
      const first = links[0];
      for (const link of links) {
        let payload: any = {};
        try {
          payload = JSON.parse(link.raw_payload_json || '{}');
        } catch {}

        const evDate = payload.matchDate || payload.date || first.match_date;
        const dateDiffDays = Math.abs(
          (new Date(evDate).getTime() - new Date(first.match_date).getTime()) / (1000 * 60 * 60 * 24)
        );

        // Date mismatch beyond symmetric 1-day window is a false-positive merge
        if (dateDiffDays > 1) {
          falsePositiveMerges++;
          falsePositiveDetails.push({
            canonicalId,
            reason: `Date discrepancy: canonical=${first.match_date}, evidence=${evDate} (diff=${dateDiffDays}d)`,
            source: link.source_name,
            sourceMatchId: link.source_match_id,
          });
          break;
        }

        // Tour mismatch check (e.g. ATP vs WTA)
        const evTour = (payload.tour || first.tour).toUpperCase();
        if (evTour !== first.tour.toUpperCase() && (first.tour === 'ATP' || first.tour === 'WTA')) {
          falsePositiveMerges++;
          falsePositiveDetails.push({
            canonicalId,
            reason: `Tour mismatch: canonical=${first.tour}, evidence=${evTour}`,
            source: link.source_name,
            sourceMatchId: link.source_match_id,
          });
          break;
        }
      }
    }

    checks.push({
      checkId: 'CHK_3_FALSE_POSITIVES',
      name: 'False-Positive Merge Audit',
      status: falsePositiveMerges === 0 ? 'PASS' : 'FAIL',
      message: falsePositiveMerges === 0
        ? `Zero false-positive merges detected across ${groupedMatches.size} multi-source matches`
        : `${falsePositiveMerges} false-positive merge(s) detected in canonical matches!`,
      metrics: {
        multiSourceMatchesChecked: groupedMatches.size,
        totalSourceLinksChecked: multiSourceRows.length,
        falsePositiveCount: falsePositiveMerges,
        details: falsePositiveDetails.slice(0, 10),
      },
    });

    // -------------------------------------------------------------------------
    // 4. Auto-Link Precision Summary
    // -------------------------------------------------------------------------
    const totalAutoLinksRow = db
      .prepare(`SELECT count(1) as c FROM match_source_links WHERE link_status IN ('AUTO_LINKED', 'MANUAL_APPROVED')`)
      .get() as any;
    const totalAutoLinks = totalAutoLinksRow ? totalAutoLinksRow.c : 0;

    const minPrecSoft = options.minPrecisionSoftPct ?? 100.0;
    const minPrecHard = options.minPrecisionHardPct ?? 99.5;

    const autoLinkPrecisionPct = totalAutoLinks > 0
      ? ((totalAutoLinks - falsePositiveMerges) / totalAutoLinks) * 100.0
      : 100.0;

    let precisionStatus: PhaseGateStatus = 'PASS';
    if (autoLinkPrecisionPct < minPrecHard || falsePositiveMerges > 0) {
      precisionStatus = 'FAIL';
    } else if (autoLinkPrecisionPct < minPrecSoft) {
      precisionStatus = 'WARNING';
    }

    checks.push({
      checkId: 'CHK_4_PRECISION',
      name: 'Auto-Link Precision Summary',
      status: precisionStatus,
      message: `Auto-link precision is ${autoLinkPrecisionPct.toFixed(2)}% (${totalAutoLinks - falsePositiveMerges}/${totalAutoLinks} links)`,
      metrics: {
        totalAutoLinks,
        falsePositiveMerges,
        autoLinkPrecisionPct,
        softThresholdPct: minPrecSoft,
        hardThresholdPct: minPrecHard,
      },
    });

    // -------------------------------------------------------------------------
    // 5. Review Queue Rate
    // -------------------------------------------------------------------------
    const totalEvidenceRow = db.prepare(`SELECT count(1) as c FROM raw_source_evidence`).get() as any;
    const totalEvidence = totalEvidenceRow ? totalEvidenceRow.c : 0;

    const queueStatsRow = db
      .prepare(`
        SELECT 
          count(1) as total_queue,
          sum(CASE WHEN review_status = 'PENDING' THEN 1 ELSE 0 END) as pending_queue,
          sum(CASE WHEN review_status = 'APPROVED' THEN 1 ELSE 0 END) as approved_queue,
          sum(CASE WHEN review_status = 'REJECTED' THEN 1 ELSE 0 END) as rejected_queue
        FROM match_review_queue
      `)
      .get() as any;

    const totalQueueItems = queueStatsRow?.total_queue || 0;
    const pendingQueueItems = queueStatsRow?.pending_queue || 0;
    const queueRatePct = totalEvidence > 0 ? (totalQueueItems / totalEvidence) * 100.0 : 0.0;

    const maxQueueSoft = options.maxQueueRateSoftPct ?? 20.0;
    const maxQueueHard = options.maxQueueRateHardPct ?? 25.0;

    let queueStatus: PhaseGateStatus = 'PASS';
    if (queueRatePct > maxQueueHard) {
      queueStatus = 'FAIL';
    } else if (queueRatePct > maxQueueSoft) {
      queueStatus = 'WARNING';
    }

    checks.push({
      checkId: 'CHK_5_REVIEW_QUEUE_RATE',
      name: 'Review Queue Routing Rate',
      status: queueStatus,
      message: `Review queue rate is ${queueRatePct.toFixed(1)}% (${totalQueueItems}/${totalEvidence} evidence rows, ${pendingQueueItems} pending)`,
      metrics: {
        totalEvidence,
        totalQueueItems,
        pendingQueueItems,
        approvedQueueItems: queueStatsRow?.approved_queue || 0,
        rejectedQueueItems: queueStatsRow?.rejected_queue || 0,
        queueRatePct,
        softThresholdPct: maxQueueSoft,
        hardThresholdPct: maxQueueHard,
      },
    });

    // -------------------------------------------------------------------------
    // 6. Unresolved Alias & Sibling Ambiguity Rate
    // -------------------------------------------------------------------------
    const siblingVetoRow = db
      .prepare(`SELECT count(1) as c FROM match_review_queue WHERE veto_triggers_json LIKE '%VETO_SIBLING_AMBIGUITY%'`)
      .get() as any;
    const siblingVetoCount = siblingVetoRow ? siblingVetoRow.c : 0;
    const aliasAmbiguityPct = totalEvidence > 0 ? (siblingVetoCount / totalEvidence) * 100.0 : 0.0;

    const maxAliasSoft = options.maxUnresolvedAliasSoftPct ?? 8.0;
    const maxAliasHard = options.maxUnresolvedAliasHardPct ?? 12.0;

    let aliasStatus: PhaseGateStatus = 'PASS';
    if (aliasAmbiguityPct > maxAliasHard) {
      aliasStatus = 'FAIL';
    } else if (aliasAmbiguityPct > maxAliasSoft) {
      aliasStatus = 'WARNING';
    }

    checks.push({
      checkId: 'CHK_6_UNRESOLVED_ALIAS_RATE',
      name: 'Unresolved / Ambiguous Alias Rate',
      status: aliasStatus,
      message: `Unresolved alias / sibling ambiguity rate is ${aliasAmbiguityPct.toFixed(2)}% (${siblingVetoCount}/${totalEvidence} matches)`,
      metrics: {
        siblingVetoCount,
        totalEvidence,
        aliasAmbiguityPct,
        softThresholdPct: maxAliasSoft,
        hardThresholdPct: maxAliasHard,
      },
    });

    // -------------------------------------------------------------------------
    // 7. Audit Log Consistency
    // -------------------------------------------------------------------------
    // Verify that all resolved queue items have a corresponding audit log entry
    const missingAuditsRow = db
      .prepare(`
        SELECT count(1) as c
        FROM match_review_queue mrq
        LEFT JOIN match_review_audit_log mral 
          ON mrq.review_id = mral.review_id 
         AND ((mrq.review_status = 'APPROVED' AND mral.action = 'APPROVE') 
           OR (mrq.review_status = 'REJECTED' AND mral.action = 'REJECT'))
        WHERE mrq.review_status IN ('APPROVED', 'REJECTED')
          AND mral.log_id IS NULL
      `)
      .get() as any;
    const missingAuditCount = missingAuditsRow ? missingAuditsRow.c : 0;

    // Check for corrupt audit rows
    const malformedAuditsRow = db
      .prepare(`
        SELECT count(1) as c
        FROM match_review_audit_log
        WHERE action IS NULL OR actor IS NULL OR logged_at IS NULL
      `)
      .get() as any;
    const malformedAuditCount = malformedAuditsRow ? malformedAuditsRow.c : 0;

    const totalAuditsRow = db.prepare(`SELECT count(1) as c FROM match_review_audit_log`).get() as any;
    const totalAudits = totalAuditsRow ? totalAuditsRow.c : 0;

    const auditConsistent = missingAuditCount === 0 && malformedAuditCount === 0;
    checks.push({
      checkId: 'CHK_7_AUDIT_LOG_CONSISTENCY',
      name: 'Audit Log Completeness & Consistency',
      status: auditConsistent ? 'PASS' : 'FAIL',
      message: auditConsistent
        ? `All ${totalAudits} audit records are consistent with resolved review items and actions`
        : `Audit inconsistencies: ${missingAuditCount} resolved items missing audit logs, ${malformedAuditCount} malformed logs`,
      metrics: { totalAudits, missingAuditCount, malformedAuditCount },
    });

    // -------------------------------------------------------------------------
    // 8. WAL File Size Status
    // -------------------------------------------------------------------------
    const walFilePath = `${targetDbPath}-wal`;
    let walSizeBytes = 0;
    if (fs.existsSync(walFilePath)) {
      try {
        walSizeBytes = fs.statSync(walFilePath).size;
      } catch {}
    }

    const walSoftLimit = options.walSoftLimitBytes ?? 25 * 1024 * 1024; // 25 MB
    const walHardLimit = options.walHardLimitBytes ?? 100 * 1024 * 1024; // 100 MB

    let walStatus: PhaseGateStatus = 'PASS';
    if (walSizeBytes > walHardLimit) {
      walStatus = 'FAIL';
    } else if (walSizeBytes > walSoftLimit) {
      walStatus = 'WARNING';
    }

    const walSizeMb = (walSizeBytes / (1024 * 1024)).toFixed(2);
    checks.push({
      checkId: 'CHK_8_WAL_SIZE',
      name: 'SQLite WAL File Size Status',
      status: walStatus,
      message: `WAL file size is ${walSizeMb} MB (Soft limit: ${(walSoftLimit / (1024 * 1024)).toFixed(0)} MB, Hard limit: ${(walHardLimit / (1024 * 1024)).toFixed(0)} MB)`,
      metrics: {
        walFilePath,
        walSizeBytes,
        walSizeMb,
        softLimitBytes: walSoftLimit,
        hardLimitBytes: walHardLimit,
      },
    });

    // -------------------------------------------------------------------------
    // 9. Snapshot / Rollback Readiness
    // -------------------------------------------------------------------------
    const dir = path.dirname(targetDbPath);
    const baseName = path.basename(targetDbPath);
    const potentialSnapshots = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(baseName) && (f.includes('.bak') || f.includes('.snap')));

    let validSnapshotFound = false;
    let snapshotFile = '';
    for (const snap of potentialSnapshots) {
      const snapPath = path.join(dir, snap);
      try {
        const stats = fs.statSync(snapPath);
        if (stats.size > 1024) {
          // Read first 16 bytes for SQLite signature
          const buf = Buffer.alloc(16);
          const fd = fs.openSync(snapPath, 'r');
          fs.readSync(fd, buf, 0, 16, 0);
          fs.closeSync(fd);
          if (buf.toString('utf8', 0, 15) === 'SQLite format 3') {
            validSnapshotFound = true;
            snapshotFile = snap;
            break;
          }
        }
      } catch {}
    }

    checks.push({
      checkId: 'CHK_9_SNAPSHOT_READINESS',
      name: 'Pre-Run Snapshot / Rollback Readiness',
      status: validSnapshotFound ? 'PASS' : 'WARNING',
      message: validSnapshotFound
        ? `Valid pre-run snapshot verified: ${snapshotFile}`
        : 'No valid pre-run snapshot file found (.bak or .snap). Rollback safety is degraded.',
      metrics: { validSnapshotFound, snapshotFile, potentialSnapshots },
    });

  } finally {
    db.close();
  }

  // ---------------------------------------------------------------------------
  // Overall Status Calculation
  // ---------------------------------------------------------------------------
  let overallStatus: PhaseGateStatus = 'PASS';
  const failedCount = checks.filter((c) => c.status === 'FAIL').length;
  const warningCount = checks.filter((c) => c.status === 'WARNING').length;
  const passedCount = checks.filter((c) => c.status === 'PASS').length;

  if (failedCount > 0) {
    overallStatus = 'FAIL';
  } else if (warningCount > 0) {
    overallStatus = 'WARNING';
  }

  // ---------------------------------------------------------------------------
  // Generate Human-Readable Markdown Summary
  // ---------------------------------------------------------------------------
  const badge = overallStatus === 'PASS' ? '🟢 PASS' : overallStatus === 'WARNING' ? '🟡 WARNING' : '🔴 FAIL';
  const lines: string[] = [
    `# Linker Phase Gate Validation Report`,
    ``,
    `**Overall Verdict:** **${badge}**  `,
    `**Timestamp:** \`${new Date().toISOString()}\`  `,
    `**Database:** \`${targetDbPath}\`  `,
    `**Summary:** ${passedCount} Passed, ${warningCount} Warnings, ${failedCount} Failed (${checks.length} checks total)  `,
    ``,
    `---`,
    ``,
    `## Check Results`,
    ``,
    `| Check | Rule Name | Status | Message |`,
    `| :--- | :--- | :---: | :--- |`,
  ];

  for (const c of checks) {
    const statusIcon = c.status === 'PASS' ? '✅ PASS' : c.status === 'WARNING' ? '⚠️ WARN' : '❌ FAIL';
    lines.push(`| \`${c.checkId}\` | ${c.name} | ${statusIcon} | ${c.message} |`);
  }

  lines.push(``);
  lines.push(`---`);
  lines.push(`## Decision Policy & Gate Recommendation`);
  if (overallStatus === 'PASS') {
    lines.push(`> [!NOTE]`);
    lines.push(`> **GO:** All safety invariants, integrity constraints, false-positive merge checks, precision targets, and audit trail validations passed with zero violations. Approved to proceed to next ingestion phase.`);
  } else if (overallStatus === 'WARNING') {
    lines.push(`> [!WARNING]`);
    lines.push(`> **PROCEED WITH CAUTION:** Hard safety criteria passed, but soft warning thresholds were exceeded (e.g., review queue rate or WAL size). Operator inspection recommended before launching next phase.`);
  } else {
    lines.push(`> [!CAUTION]`);
    lines.push(`> **NO-GO (HALT / ROLLBACK):** One or more critical invariant checks failed (false-positive merges detected, integrity corruption, or foreign key violation). Ingestion MUST HALT immediately and rollback to pre-phase snapshot.`);
  }
  lines.push(``);

  const summaryMarkdown = lines.join('\n');

  return {
    timestamp: new Date().toISOString(),
    targetDbPath,
    overallStatus,
    passedCount,
    warningCount,
    failedCount,
    checks,
    summaryMarkdown,
  };
}
