import fs from 'fs';
import path from 'path';
import { runProductionReadinessAudit } from '../linker/productionReadinessAudit';

function main() {
  console.log('======================================================');
  console.log('   LINKER PHASE 4 PRODUCTION-READINESS AUDIT          ');
  console.log('======================================================\n');

  const report = runProductionReadinessAudit();

  // Write machine-readable JSON report
  const jsonPath = path.resolve('data/linker_phase4_production_readiness_audit.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');

  // Write human-readable Markdown summary
  const mdPath = path.resolve('data/linker_phase4_production_readiness_audit.md');
  fs.writeFileSync(mdPath, report.summaryMarkdown, 'utf-8');

  console.log(report.summaryMarkdown);
  console.log(`\nMachine-readable report written to: ${jsonPath}`);
  console.log(`Human-readable summary written to:    ${mdPath}\n`);

  if (report.overallStatus === 'FAIL') {
    console.error('❌ PRODUCTION READINESS AUDIT FAILED. System NOT ready for production rollout.');
    process.exit(1);
  } else {
    console.log('✅ PRODUCTION READINESS AUDIT PASSED. Ready for production rollout proposal.');
    process.exit(0);
  }
}

main();
