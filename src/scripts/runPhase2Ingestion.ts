import fs from 'fs';
import path from 'path';
import { runPhase2Ingestion } from '../linker/phase2IngestionRunner';

function main() {
  console.log('======================================================');
  console.log('   LINKER PHASE 2 MEDIUM BATCH INGESTION (2,500)      ');
  console.log('======================================================\n');

  const report = runPhase2Ingestion();

  // Write machine-readable JSON report
  const jsonPath = path.resolve('data/linker_phase2_report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');

  // Build human-readable Markdown summary
  const lines: string[] = [
    `# Linker Phase 2 Medium Batch Ingestion Report`,
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
    `### Bucket Breakdown`,
    ``,
    `| Bucket Name | Match Count |`,
    `| :--- | :---: |`,
  ];

  for (const [bName, bCount] of Object.entries(report.bucketBreakdown)) {
    lines.push(`| ${bName} | ${bCount} |`);
  }

  lines.push(``);
  lines.push(`### Table Count Deltas`);
  lines.push(``);
  lines.push(`| Table | Before Ingest | After Ingest | Delta |`);
  lines.push(`| :--- | :---: | :---: | :---: |`);
  lines.push(`| \`canonical_matches\` | ${report.tableCountsBefore.canonicalMatches} | ${report.tableCountsAfter.canonicalMatches} | +${report.tableCountsAfter.canonicalMatches - report.tableCountsBefore.canonicalMatches} |`);
  lines.push(`| \`match_source_links\` | ${report.tableCountsBefore.sourceLinks} | ${report.tableCountsAfter.sourceLinks} | +${report.tableCountsAfter.sourceLinks - report.tableCountsBefore.sourceLinks} |`);
  lines.push(`| \`raw_source_evidence\` | ${report.tableCountsBefore.rawEvidence} | ${report.tableCountsAfter.rawEvidence} | +${report.tableCountsAfter.rawEvidence - report.tableCountsBefore.rawEvidence} |`);
  lines.push(`| \`match_review_queue\` | ${report.tableCountsBefore.reviewQueue} | ${report.tableCountsAfter.reviewQueue} | +${report.tableCountsAfter.reviewQueue - report.tableCountsBefore.reviewQueue} |`);
  lines.push(`| \`match_review_audit_log\` | ${report.tableCountsBefore.auditLogs} | ${report.tableCountsAfter.auditLogs} | +${report.tableCountsAfter.auditLogs - report.tableCountsBefore.auditLogs} |`);
  lines.push(``);
  lines.push(`### Chunk Execution Details (10 Chunks of 250)`);
  lines.push(``);
  lines.push(`| Chunk | Matches | Auto-Links | New Canonicals | Review Queue | WAL Checkpoint |`);
  lines.push(`| :---: | :---: | :---: | :---: | :---: | :--- |`);

  for (const ch of report.chunks) {
    lines.push(`| Chunk ${ch.chunkIndex} | ${ch.matchesProcessed} | ${ch.autoLinks} | ${ch.newCanonicals} | ${ch.reviewQueues} | ${JSON.stringify(ch.walCheckpointResult)} |`);
  }

  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(report.phaseGateVerdict.summaryMarkdown);

  const summaryMarkdown = lines.join('\n');
  const mdPath = path.resolve('data/linker_phase2_summary.md');
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
