import fs from 'fs';
import path from 'path';
import { runPhase1Ingestion } from '../linker/phase1IngestionRunner';

function main() {
  console.log('======================================================');
  console.log('   LINKER PHASE 1 PILOT INGESTION (500 MATCHES)       ');
  console.log('======================================================\n');

  const report = runPhase1Ingestion();

  // Write machine-readable JSON report
  const jsonPath = path.resolve('data/linker_phase1_report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');

  // Build human-readable Markdown summary
  const lines: string[] = [
    `# Linker Phase 1 Pilot Batch Ingestion Report`,
    ``,
    `**Verdict:** **${report.phaseGateVerdict.overallStatus === 'PASS' ? '🟢 PASS' : report.phaseGateVerdict.overallStatus === 'WARNING' ? '🟡 WARNING' : '🔴 FAIL'}**  `,
    `**Timestamp:** \`${report.timestamp}\`  `,
    `**Target Database:** \`${report.targetDbPath}\`  `,
    `**Pre-Phase Snapshot:** \`${report.snapshotPath}\`  `,
    ``,
    `---`,
    ``,
    `## Ingestion Summary Counts`,
    ``,
    `| Metric | Count | Percentage |`,
    `| :--- | :---: | :---: |`,
    `| **Total Cohort Processed** | **${report.totalProcessed}** | 100.0% |`,
    `| Multi-Source Auto-Links | ${report.totalAutoLinks} | ${report.autoLinkRatePct.toFixed(1)}% |`,
    `| New Canonical Matches Created | ${report.totalNewCanonicals} | ${( (report.totalNewCanonicals / report.totalProcessed) * 100 ).toFixed(1)}% |`,
    `| Review Queue Items Routed | ${report.totalReviewQueues} | ${report.reviewQueueRatePct.toFixed(1)}% |`,
    ``,
    `### Table Count Deltas`,
    ``,
    `| Table | Before Ingest | After Ingest | Delta |`,
    `| :--- | :---: | :---: | :---: |`,
    `| \`canonical_matches\` | ${report.tableCountsBefore.canonicalMatches} | ${report.tableCountsAfter.canonicalMatches} | +${report.tableCountsAfter.canonicalMatches - report.tableCountsBefore.canonicalMatches} |`,
    `| \`match_source_links\` | ${report.tableCountsBefore.sourceLinks} | ${report.tableCountsAfter.sourceLinks} | +${report.tableCountsAfter.sourceLinks - report.tableCountsBefore.sourceLinks} |`,
    `| \`raw_source_evidence\` | ${report.tableCountsBefore.rawEvidence} | ${report.tableCountsAfter.rawEvidence} | +${report.tableCountsAfter.rawEvidence - report.tableCountsBefore.rawEvidence} |`,
    `| \`match_review_queue\` | ${report.tableCountsBefore.reviewQueue} | ${report.tableCountsAfter.reviewQueue} | +${report.tableCountsAfter.reviewQueue - report.tableCountsBefore.reviewQueue} |`,
    `| \`match_review_audit_log\` | ${report.tableCountsBefore.auditLogs} | ${report.tableCountsAfter.auditLogs} | +${report.tableCountsAfter.auditLogs - report.tableCountsBefore.auditLogs} |`,
    ``,
    `### Chunk Execution Details`,
    ``,
    `| Chunk | Matches | Auto-Links | New Canonicals | Review Queue | WAL Checkpoint |`,
    `| :---: | :---: | :---: | :---: | :---: | :--- |`,
  ];

  for (const ch of report.chunks) {
    lines.push(`| Chunk ${ch.chunkIndex} | ${ch.matchesProcessed} | ${ch.autoLinks} | ${ch.newCanonicals} | ${ch.reviewQueues} | ${JSON.stringify(ch.walCheckpointResult)} |`);
  }

  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(report.phaseGateVerdict.summaryMarkdown);

  const summaryMarkdown = lines.join('\n');
  const mdPath = path.resolve('data/linker_phase1_summary.md');
  fs.writeFileSync(mdPath, summaryMarkdown, 'utf-8');

  console.log(summaryMarkdown);
  console.log(`\nMachine-readable report written to: ${jsonPath}`);
  console.log(`Human-readable summary written to:    ${mdPath}\n`);

  if (report.phaseGateVerdict.overallStatus === 'FAIL') {
    console.error('❌ PHASE GATE FAILED. Ingestion halted.');
    process.exit(1);
  } else {
    console.log('✅ PHASE GATE PASSED.');
    process.exit(0);
  }
}

main();
