import fs from 'fs';
import path from 'path';

const filePath = 'C:\\Users\\wm900_uqttgkv\\Downloads\\55555555tions_and_traces_2026-09-02.json';
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

console.log('═════════════════════════════════════════════════════════════════════════');
console.log('📋 COMPLETE AUDIT OF 10 BACKTEST PREDICTIONS & TRACES');
console.log('Exported At:', data.exportedAt);
console.log('Format Version:', data.formatVersion);
console.log('Total Predictions:', data.totalPredictions);
console.log('Total Traces:', data.totalTraces);
console.log('═════════════════════════════════════════════════════════════════════════\n');

const predictions = data.predictions || [];
const traces = data.traces || {};

console.log('--- MATCH BY MATCH BREAKDOWN ---');
predictions.forEach((p: any, idx: number) => {
  console.log(`\n─────────────────────────────────────────────────────────────────────────`);
  console.log(`MATCH ${idx + 1}: ${p.homePlayer} vs ${p.awayPlayer}`);
  console.log(`Fixture ID: ${p.fixtureId} | Date: ${p.date || p.matchDate} | Tourney: ${p.tournamentName} | Surface: ${p.surface}`);
  console.log(`Actual Result: Winner = ${p.actualResult?.winner || p.actualResult?.actualWinner} | Score = ${p.actualResult?.score || p.actualResult?.matchScore}`);
  console.log(`Predicted Winner: ${p.prediction?.winner} (Prob: ${p.prediction?.winProbability}%, Conf: ${p.prediction?.confidence}, Risk: ${p.prediction?.riskLevel})`);
  console.log(`Predicted Score: ${p.prediction?.predictedScore}`);
  console.log(`Agent Consensus: ${p.prediction?.agentConsensus}`);
  console.log(`Data Quality Score: ${p.dataQualityScore}`);
  console.log(`Best Bet:`, p.prediction?.bestBet);
  console.log(`Alternative Bet:`, p.prediction?.alternativeBet);
  console.log(`Evaluation:`, p.evaluation);

  const traceId = p.agentTraceId || p.id;
  const trace = Array.isArray(traces) ? traces.find((t: any) => t.id === traceId || t.workflowId === String(p.fixtureId)) : traces[traceId];
  if (trace) {
    console.log(`Trace found:`, {
      agentsAvailable: trace.agents ? trace.agents.map((a: any) => a.name || a.agentName) : 'none',
      hasSpecialistTraces: Boolean(trace.specialistTraces || trace.precomputedSpecialists),
      totalDurationMs: trace.totalDurationMs || trace.elapsedSeconds
    });
  } else {
    console.log(`Trace: not directly keyed by traceId`);
  }
});

// Trace structure inspection
console.log('\n═════════════════════════════════════════════════════════════════════════');
console.log('🧠 MULTI-AGENT TRACE STRUCTURE');
console.log('═════════════════════════════════════════════════════════════════════════');
if (Array.isArray(traces)) {
  console.log(`Traces is Array with ${traces.length} items`);
  if (traces[0]) {
    console.log('Sample trace keys:', Object.keys(traces[0]));
    if (traces[0].agents) {
      console.log('Agents in trace 0:');
      traces[0].agents.forEach((ag: any) => {
        console.log(`  - [${ag.name || ag.agentName}]: output length ${ag.output?.length || 0} chars, status: ${ag.status}`);
      });
    }
  }
} else {
  console.log('Traces is Object with keys:', Object.keys(traces).slice(0, 5));
  const firstKey = Object.keys(traces)[0];
  if (firstKey) {
    const t = traces[firstKey];
    console.log('Sample trace keys:', Object.keys(t));
    if (t.agents) {
      console.log('Agents in sample trace:');
      t.agents.forEach((ag: any) => {
        console.log(`  - [${ag.name || ag.agentName}]: output length ${ag.output?.length || 0} chars, status: ${ag.status}`);
      });
    }
  }
}
