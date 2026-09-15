import fs from 'fs';
import path from 'path';
import { validatePhaseGate } from '../linker/phaseGateValidator';

function main() {
  const args = process.argv.slice(2);
  let customDbPath: string | undefined;

  const dbIndex = args.indexOf('--db');
  if (dbIndex !== -1 && args[dbIndex + 1]) {
    customDbPath = path.resolve(args[dbIndex + 1]);
  }

  const verdict = validatePhaseGate({ customDbPath });

  // Save machine-readable JSON verdict
  const jsonPath = path.resolve('data/linker_phase_gate_verdict.json');
  fs.writeFileSync(jsonPath, JSON.stringify(verdict, null, 2), 'utf-8');

  // Save human-readable Markdown summary
  const mdPath = path.resolve('data/linker_phase_gate_summary.md');
  fs.writeFileSync(mdPath, verdict.summaryMarkdown, 'utf-8');

  // Print summary to console
  console.log(verdict.summaryMarkdown);
  console.log(`Machine-readable verdict written to: ${jsonPath}`);
  console.log(`Human-readable summary written to:    ${mdPath}\n`);

  if (verdict.overallStatus === 'FAIL') {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main();
