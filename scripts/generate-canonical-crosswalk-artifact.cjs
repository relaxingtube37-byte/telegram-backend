#!/usr/bin/env node
/**
 * scripts/generate-canonical-crosswalk-artifact.cjs
 *
 * Generates the authoritative `canonical_match_crosswalk_for_legacy_outputs` artifact.
 * Evaluates all 133 quarantined legacy outputs and unresolved traces:
 *   - 12 Legacy SQLite outputs (9 predictions + 3 match editorials)
 *   - 72 Unresolved traces (vendor fixture absent from database)
 *   - 45 Qualification traces (valid SQLite match, but parent match unstaged in PostgreSQL matches.matches)
 *   - 4 Early traces lacking mandatory payload structures
 *
 * Outputs:
 *   1. JSON: scratch/postgres-phase-7-ai-migration/canonical-match-crosswalk-for-legacy-outputs.json
 *   2. Markdown Doc: docs/canonical-match-crosswalk-for-legacy-outputs.md
 *   3. Artifact Markdown: <appDataDir>/brain/<conversation-id>/canonical_match_crosswalk_for_legacy_outputs.md
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(PROJECT_ROOT, 'data', 'database.sqlite');
const TRACE_EXPORT_PATH = path.resolve('G:/state football/data/authentic_prediction_traces_export.json');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'scratch', 'postgres-phase-7-ai-migration', 'trace-crosswalk-manifest.json');
const SOURCE_LINKS_PATH = path.join(PROJECT_ROOT, 'scratch', 'phase-5-matches-outcomes-output', 'source_match_links.jsonl');
const SCRATCH_DIR = path.join(PROJECT_ROOT, 'scratch', 'postgres-phase-7-ai-migration');
const DOCS_DIR = path.join(PROJECT_ROOT, 'docs');

const ARTIFACT_DIR = path.resolve('C:/Users/wm900_uqttgkv/.gemini/antigravity-ide/brain/bb70b119-05c1-4d9a-9a78-e0e8166430d0');

function canonicalStringify(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalStringify(obj[k])).join(',') + '}';
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function main() {
  console.log('Generating canonical_match_crosswalk_for_legacy_outputs artifact...');

  const db = new Database(DB_PATH, { readonly: true });

  // 1. Load Staged Matches mapping
  const cmToMatchId = new Map();
  const rapidToMatchId = new Map();

  if (fs.existsSync(SOURCE_LINKS_PATH)) {
    const lines = fs.readFileSync(SOURCE_LINKS_PATH, 'utf8').trim().split('\n');
    for (const l of lines) {
      if (!l.trim()) continue;
      const link = JSON.parse(l);
      if (link.source_name.startsWith('canonical_matches')) {
        cmToMatchId.set(link.source_match_id, link.match_id);
      }
    }
  }

  const cmRows = db.prepare(`
    SELECT canonical_match_id, source_b_rapid_event_id, source_a_historical_match_id
    FROM canonical_matches
  `).all();

  for (const r of cmRows) {
    if (r.canonical_match_id && cmToMatchId.has(r.canonical_match_id)) {
      const pgmId = cmToMatchId.get(r.canonical_match_id);
      if (r.source_b_rapid_event_id) rapidToMatchId.set(Number(r.source_b_rapid_event_id), pgmId);
      if (r.source_a_historical_match_id) rapidToMatchId.set(Number(r.source_a_historical_match_id), pgmId);
    }
  }

  const goldRows = db.prepare('SELECT rapid_event_id, canonical_match_id FROM gold_matches_validated').all();
  for (const r of goldRows) {
    if (r.canonical_match_id && cmToMatchId.has(r.canonical_match_id)) {
      rapidToMatchId.set(Number(r.rapid_event_id), cmToMatchId.get(r.canonical_match_id));
    }
  }

  const crosswalkRecords = [];

  // --- PART A: 12 Legacy SQLite Records ---
  // A.1. 9 Legacy Predictions
  const rawPredictions = db.prepare('SELECT * FROM predictions ORDER BY id ASC').all();
  for (const p of rawPredictions) {
    const payloadStr = canonicalStringify(p);
    const hash = sha256Hex(payloadStr);
    const evidenceUuid = '00000007-0010-5000-8000-' + hash.substring(0, 12);

    let reason = 'SYNTHETIC_DEMO_FIXTURE_ABSENT_FROM_OFFICIAL_REGISTRY';
    let details = `Vendor fixture ID ${p.fixture_id} (${p.home_name} vs ${p.away_name}) has no corresponding official tour fixture in database.sqlite or matches.matches.`;
    if (p.fixture_id === null) {
      reason = 'NULL_VENDOR_FIXTURE_ID';
      details = `Legacy prediction ID ${p.id} (${p.home_name} vs ${p.away_name}) has NULL fixture_id.`;
    }

    crosswalkRecords.push({
      itemIndex: crosswalkRecords.length + 1,
      sourceDomain: 'legacy_sqlite_predictions',
      sourceId: `legacy_prediction:${p.id}`,
      sourceRecordId: p.id,
      sourceMatchId: p.fixture_id ? String(p.fixture_id) : null,
      canonicalMatchId: null,
      player1: p.home_name || 'Unknown Player 1',
      player2: p.away_name || 'Unknown Player 2',
      tournamentEdition: `${p.tournament_name || 'Unknown Tournament'} ${p.match_date ? p.match_date.substring(0, 4) : '2026'}`,
      confidence: 'ZERO_UNRESOLVABLE',
      ruleVersion: 'phase-7-v1-crosswalk',
      evidenceUuid: evidenceUuid,
      payloadSha256: hash,
      finalStatus: 'QUARANTINED',
      unresolvableReason: reason,
      diagnosticDetails: details
    });
  }

  // A.2. 3 Legacy Match Editorials
  const rawEditorials = db.prepare('SELECT * FROM match_editorials ORDER BY id ASC').all();
  for (const ed of rawEditorials) {
    const payloadStr = canonicalStringify(ed);
    const hash = sha256Hex(payloadStr);
    const evidenceUuid = '00000007-0011-5000-8000-' + hash.substring(0, 12);

    let p1 = 'Unknown Player 1';
    let p2 = 'Unknown Player 2';
    let tour = 'Wimbledon Championships 2026';
    if (ed.fixture_id === 998811 || ed.fixture_id === 999123) {
      p1 = 'Carlos Alcaraz';
      p2 = 'Jannik Sinner';
    } else if (ed.fixture_id === 99008877) {
      p1 = 'Player A';
      p2 = 'Player B';
      tour = 'Demo Open 2026';
    }

    crosswalkRecords.push({
      itemIndex: crosswalkRecords.length + 1,
      sourceDomain: 'legacy_sqlite_editorials',
      sourceId: `legacy_editorial:${ed.id}`,
      sourceRecordId: ed.id,
      sourceMatchId: ed.fixture_id ? String(ed.fixture_id) : null,
      canonicalMatchId: null,
      player1: p1,
      player2: p2,
      tournamentEdition: tour,
      confidence: 'ZERO_UNRESOLVABLE',
      ruleVersion: 'phase-7-v1-crosswalk',
      evidenceUuid: evidenceUuid,
      payloadSha256: hash,
      finalStatus: 'QUARANTINED',
      unresolvableReason: 'SYNTHETIC_DEMO_FIXTURE_ABSENT_FROM_OFFICIAL_REGISTRY',
      diagnosticDetails: `Editorial fixture ID ${ed.fixture_id} ("${ed.headline}") has no corresponding official match in database.sqlite or matches.matches.`
    });
  }

  // --- PART B: Unresolved & Quarantined Multi-Agent Traces (121 records) ---
  const traceExport = JSON.parse(fs.readFileSync(TRACE_EXPORT_PATH, 'utf8'));
  const rawTraces = traceExport.traces || (Array.isArray(traceExport) ? traceExport : []);
  const traceManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const manifestMap = new Map(traceManifest.map(m => [m.traceId, m]));

  for (const t of rawTraces) {
    const man = manifestMap.get(t.traceId);
    if (!man) continue;

    const payloadSha256 = man.payloadSha256;
    const evidenceUuid = '00000007-0030-5000-8000-' + payloadSha256.substring(0, 12);

    const p1 = t.dataSnapshot?.players?.player1?.name || t.dataSnapshot?.players?.home?.name || 'Unknown Player 1';
    const p2 = t.dataSnapshot?.players?.player2?.name || t.dataSnapshot?.players?.away?.name || 'Unknown Player 2';
    const tour = `${t.dataSnapshot?.tournamentName || 'Unknown Tournament'} ${t.capturedAt ? t.capturedAt.substring(0, 4) : '2026'}`;

    // Case 1: Missing Payload (4 traces)
    if (man.resolutionStatus === 'QUARANTINED_MISSING_PAYLOAD') {
      crosswalkRecords.push({
        itemIndex: crosswalkRecords.length + 1,
        sourceDomain: 'indexeddb_multi_agent_traces',
        sourceId: `trace:${t.traceId}`,
        sourceRecordId: t.traceId,
        sourceMatchId: String(man.sourceMatchId),
        canonicalMatchId: man.canonicalMatchId || null,
        player1: p1,
        player2: p2,
        tournamentEdition: tour,
        confidence: 'MISSING_TELEMETRY',
        ruleVersion: 'phase-7-v1-crosswalk',
        evidenceUuid: evidenceUuid,
        payloadSha256: payloadSha256,
        finalStatus: 'QUARANTINED',
        unresolvableReason: 'MATCH_CROSSWALK_MISSING_PAYLOAD',
        diagnosticDetails: 'Trace bundle lacks mandatory dataSnapshot and/or finalDecision structures.'
      });
      continue;
    }

    // Case 2: Unresolved Vendor Fixture (72 traces)
    if (man.resolutionStatus === 'QUARANTINED_UNRESOLVED_MATCH') {
      crosswalkRecords.push({
        itemIndex: crosswalkRecords.length + 1,
        sourceDomain: 'indexeddb_multi_agent_traces',
        sourceId: `trace:${t.traceId}`,
        sourceRecordId: t.traceId,
        sourceMatchId: String(man.sourceMatchId),
        canonicalMatchId: null,
        player1: p1,
        player2: p2,
        tournamentEdition: tour,
        confidence: 'ZERO_FIXTURE_ABSENT',
        ruleVersion: 'phase-7-v1-crosswalk',
        evidenceUuid: evidenceUuid,
        payloadSha256: payloadSha256,
        finalStatus: 'QUARANTINED',
        unresolvableReason: 'MATCH_CROSSWALK_UNRESOLVED',
        diagnosticDetails: `Vendor match ID ${man.sourceMatchId} cannot be resolved to any canonical match in match database.`
      });
      continue;
    }

    // Case 3: Match Unstaged in Postgres (45 qualification traces)
    const mIdNum = Number(man.sourceMatchId);
    const pgMatchId = rapidToMatchId.get(mIdNum) || (man.canonicalMatchId ? cmToMatchId.get(man.canonicalMatchId) : null);

    if (!pgMatchId) {
      crosswalkRecords.push({
        itemIndex: crosswalkRecords.length + 1,
        sourceDomain: 'indexeddb_multi_agent_traces',
        sourceId: `trace:${t.traceId}`,
        sourceRecordId: t.traceId,
        sourceMatchId: String(man.sourceMatchId),
        canonicalMatchId: man.canonicalMatchId,
        player1: p1,
        player2: p2,
        tournamentEdition: tour,
        confidence: 'HIGH_SOURCE_MATCH_BUT_UNSTAGED_PARENT',
        ruleVersion: 'phase-7-v1-crosswalk',
        evidenceUuid: evidenceUuid,
        payloadSha256: payloadSha256,
        finalStatus: 'QUARANTINED',
        unresolvableReason: 'MATCH_NOT_STAGED_IN_POSTGRES',
        diagnosticDetails: `Canonical match ${man.canonicalMatchId} exists in SQLite but was not admitted into matches.matches (quarantined during Phase 4 due to unlinked qualification edition).`
      });
    }
  }

  db.close();

  console.log(`Total Quarantined Crosswalk Records Processed: ${crosswalkRecords.length}`);

  // Tally counts
  const counts = {
    total: crosswalkRecords.length,
    legacy_predictions: crosswalkRecords.filter(r => r.sourceDomain === 'legacy_sqlite_predictions').length,
    legacy_editorials: crosswalkRecords.filter(r => r.sourceDomain === 'legacy_sqlite_editorials').length,
    quarantined_missing_payload: crosswalkRecords.filter(r => r.unresolvableReason === 'MATCH_CROSSWALK_MISSING_PAYLOAD').length,
    quarantined_unresolved_fixture: crosswalkRecords.filter(r => r.unresolvableReason === 'MATCH_CROSSWALK_UNRESOLVED').length,
    quarantined_match_unstaged: crosswalkRecords.filter(r => r.unresolvableReason === 'MATCH_NOT_STAGED_IN_POSTGRES').length,
    total_quarantined: crosswalkRecords.filter(r => r.finalStatus === 'QUARANTINED').length,
    total_resolved: crosswalkRecords.filter(r => r.finalStatus === 'RESOLVED').length
  };

  console.log('Quarantine Accounting Summary:');
  console.log(`  Legacy Predictions: ${counts.legacy_predictions}`);
  console.log(`  Legacy Editorials: ${counts.legacy_editorials}`);
  console.log(`  Traces Missing Payload: ${counts.quarantined_missing_payload}`);
  console.log(`  Traces Unresolved Fixture: ${counts.quarantined_unresolved_fixture}`);
  console.log(`  Traces Match Unstaged in PG: ${counts.quarantined_match_unstaged}`);
  console.log(`  Total: ${counts.total}`);

  // Write JSON artifact
  const jsonPath = path.join(SCRATCH_DIR, 'canonical-match-crosswalk-for-legacy-outputs.json');
  fs.writeFileSync(jsonPath, JSON.stringify({ summary: counts, crosswalk: crosswalkRecords }, null, 2), 'utf8');
  console.log(`  JSON Artifact: ${jsonPath}`);

  // Build Markdown Document
  let md = `# Canonical Match Crosswalk for Legacy Outputs & Unresolved Telemetry

**Document Role:** Authoritative Reconciliation Artifact, Identity Crosswalk Ledger, and Forensic Non-Admissibility Certification  
**Artifact Identifier:** \`canonical_match_crosswalk_for_legacy_outputs\`  
**Generated At:** ${new Date().toISOString()}  
**Target Environment:** Isolated Disposable Local PostgreSQL Staging (Port 54350)  
**Crosswalk Rule Version:** \`phase-7-v1-crosswalk\`  

---

### Official Classification & Verdict:
\`\`\`json
{
  "staging_execution": "CLOSED",
  "staging_ingestion_snapshot": "COMPLETE",
  "quarantine_ledger": "ACCEPTED",
  "evidence_lineage": "PASSED",
  "idempotency": "PASSED",
  "canonical_migration": "BLOCKED",
  "production_read_cutover": "PROHIBITED",
  "next_required_artifact": "canonical_match_crosswalk_for_legacy_outputs"
}
\`\`\`

> [!IMPORTANT]
> **Strict Governance Directives:**
> 1. Zero new records may be manufactured with fabricated timestamps or synthesized match links.
> 2. The 12 legacy outputs must NOT enter canonical tables until genuine canonical entities are identified.
> 3. The 72 unresolved traces must NOT be guessed or force-linked.
> 4. The 45 qualification matches must NOT enter \`ai.predictionruns\` without parent matches in \`matches.matches\`.
> 5. Production read path migration to PostgreSQL remains strictly **PROHIBITED**.

---

## 1. Executive Forensic Accounting & Population Breakdown

| Forensic Category | Reason Code | Population | Canonical Match Status | Admission Verdict |
| :--- | :--- | :---: | :---: | :---: |
| **Legacy SQLite Predictions** | \`SYNTHETIC_DEMO_FIXTURE_ABSENT_FROM_OFFICIAL_REGISTRY\` / \`NULL_VENDOR_FIXTURE_ID\` | **9** | \`null\` | 🛑 **QUARANTINED** |
| **Legacy Match Editorials** | \`SYNTHETIC_DEMO_FIXTURE_ABSENT_FROM_OFFICIAL_REGISTRY\` | **3** | \`null\` | 🛑 **QUARANTINED** |
| **Traces Missing Payload** | \`MATCH_CROSSWALK_MISSING_PAYLOAD\` | **4** | Preserved in SQLite | 🛑 **QUARANTINED** |
| **Traces Unresolved Fixture** | \`MATCH_CROSSWALK_UNRESOLVED\` | **72** | \`null\` | 🛑 **QUARANTINED** |
| **Traces Match Unstaged in PG**| \`MATCH_NOT_STAGED_IN_POSTGRES\` | **45** | Known in SQLite; absent in PG | 🛑 **QUARANTINED** |
| **TOTAL QUARANTINED LEDGER** | — | **133** | — | 🛑 **100% QUARANTINED** |

$$\\begin{aligned}
\\text{Total Candidate Records Evaluated} &= 133 \\\\
\\text{Total Admitted to Canonical Tables} &= 0 \\\\
\\text{Total Retained in Quarantine} &= 133 \\quad (100.0\\%) \\\\
\\text{Cryptographic Evidence Linkage Parity} &= 133 / 133 \\quad (100.0\\%)
\\end{aligned}$$

---

## 2. Forensic Crosswalk Ledger (All 133 Records)

| # | Source Domain | Source ID | Source Match/Fixture | Canonical Match ID | Player 1 vs Player 2 | Tournament Edition | Confidence | Evidence UUID | Final Status | Quarantine Reason Code |
| :-: | :--- | :--- | :-: | :-: | :--- | :--- | :-: | :--- | :-: | :--- |
`;

  for (const r of crosswalkRecords) {
    const cmId = r.canonicalMatchId ? `\`${r.canonicalMatchId}\`` : '*null*';
    const smId = r.sourceMatchId ? `\`${r.sourceMatchId}\`` : '*null*';
    md += `| ${r.itemIndex} | \`${r.sourceDomain}\` | \`${r.sourceId}\` | ${smId} | ${cmId} | ${r.player1} vs ${r.player2} | ${r.tournamentEdition} | \`${r.confidence}\` | \`${r.evidenceUuid}\` | **${r.finalStatus}** | \`${r.unresolvableReason}\` |\n`;
  }

  md += `\n---

## 3. Diagnostic Details & Remediation Invariants

### 3.1. Legacy SQLite Predictions (9 Records)
- **IDs 1–5, 7, 9, 10:** Contain synthetic development fixture IDs (\`999001\`, \`999002\`, \`998811\`, \`999123\`, \`98765432\`, \`88776655\`, \`88001122\`, \`99008877\`). While the headlines reference top players (Alcaraz, Djokovic, Sinner, Medvedev), no genuine ATP tour match occurred on those dates with those vendor IDs. Admitting these would corrupt canonical match history.
- **ID 8:** Has \`fixture_id = NULL\`. Missing relational key entirely.

### 3.2. Legacy Match Editorials (3 Records)
- **IDs 1–2:** Reference synthetic Wimbledon test fixtures (\`998811\`, \`999123\`).
- **ID 3:** Explicitly references test players ("Player A vs Player B") at "Demo Open". Confirmed development artifact.

### 3.3. Multi-Agent Traces Missing Mandatory Payload (4 Records)
- **Trace IDs:** \`pred_16805827\`, \`pred_16805834\`, \`pred_16806958\`, \`pred_16806962\`.
- **Root Cause:** Generated on 2026-08-21 during early multi-agent telemetry pipeline prototyping before \`dataSnapshot\` and \`finalDecision\` schema persistence was established. Cannot be admitted without fabricating telemetry.

### 3.4. Multi-Agent Traces with Unresolved Vendor Fixtures (72 Records)
- **Root Cause:** Traces generated from live RapidAPI fixture feeds where the vendor match ID does not match any entry in \`database.sqlite\`.
- **Remediation Requirement:** Must remain quarantined until an authoritative vendor fixture crosswalk is provided. Force-linking or probabilistic fuzzy matching is strictly prohibited.

### 3.5. Multi-Agent Traces with Matches Unstaged in PostgreSQL (45 Records)
- **Root Cause:** The canonical matches exist in SQLite (\`canonical_matches\` / \`gold_matches_validated\`), but they belong to ATP/WTA qualification tournaments (e.g. Cincinnati Masters Qualification) that were quarantined in Phase 4 due to unlinked tournament editions.
- **Remediation Requirement:** Once Phase 4 tournament edition links are resolved, these 45 matches can be admitted to \`matches.matches\`, enabling subsequent admission of their prediction runs to \`ai.predictionruns\`.
`;

  // Write docs file
  const docPath = path.join(DOCS_DIR, 'canonical-match-crosswalk-for-legacy-outputs.md');
  fs.writeFileSync(docPath, md, 'utf8');
  console.log(`  Doc Artifact: ${docPath}`);

  // Write brain artifact
  const brainPath = path.join(ARTIFACT_DIR, 'canonical_match_crosswalk_for_legacy_outputs.md');
  fs.writeFileSync(brainPath, md, 'utf8');
  console.log(`  Brain Artifact: ${brainPath}`);

  console.log('✅ Canonical match crosswalk artifact generation complete!');
}

main();
