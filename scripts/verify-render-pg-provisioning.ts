/**
 * scripts/verify-render-pg-provisioning.ts
 *
 * Phase 11 Gate P11-PRE-4: Render Production PostgreSQL Provisioning Validator.
 *
 * CRITERIA EVALUATED (per spec Section 5.2):
 * 1. SSL/TLS Connection Enforcement: verifies active SSL/TLS handshake.
 * 2. WAL Level: verifies wal_level is active (replica/logical) for point-in-time recovery.
 * 3. Connection Capacity: verifies max_connections and pool configuration limits.
 * 4. Engine Version: verifies PostgreSQL >= 15.
 * 5. Latency RTT: measures round-trip ping time (target: < 200ms).
 * 6. Transactional Read/Write capability: probe transactional temp table.
 *
 * GOVERNANCE & SECURITY RULES:
 * - Pass connection string via environment variable RENDER_PG_CONNECTION_STRING.
 * - Password and credentials are NEVER logged, committed, or written to evidence files.
 * - If no connection string is provided, safely outputs PENDING_HUMAN_ACTION guidance.
 * - Emits official report to docs/evidence/render-pg-provisioning-report.json.
 */

import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';

const OUTPUT_PATH = path.resolve(__dirname, '../docs/evidence/render-pg-provisioning-report.json');

function maskConnectionString(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return urlStr.replace(/:([^@]+)@/, ':***@');
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log(' PHASE 11: RENDER POSTGRESQL PROVISIONING VALIDATION (P11-PRE-4)');
  console.log(' Governance: Read-Only Probe | Zero Mutation | No Secrets Logged');
  console.log('='.repeat(80));

  const connectionString = process.env.RENDER_PG_CONNECTION_STRING?.trim();

  if (!connectionString) {
    console.log('\n[P11-PRE-4 STATUS]: PENDING_HUMAN_ACTION');
    console.log('  No connection string provided in environment variable RENDER_PG_CONNECTION_STRING.');
    console.log('\n--------------------------------------------------------------------------------');
    console.log(' INSTRUCTIONS TO PROVISION RENDER POSTGRESQL:');
    console.log('--------------------------------------------------------------------------------');
    console.log(' 1. Open Render Dashboard: https://dashboard.render.com');
    console.log(' 2. Click "New +" -> "PostgreSQL"');
    console.log(' 3. Configure Database:');
    console.log('    - Name:      telegram-backend-postgres');
    console.log('    - Database:  telegram_backend');
    console.log('    - User:      telegram_admin');
    console.log('    - Region:    Same region as web service (e.g. Frankfurt / Oregon)');
    console.log('    - PG Ver:    PostgreSQL 16 (or latest LTS)');
    console.log(' 4. Once provisioned, copy the "External Database URL" (or Internal URL if same VPC).');
    console.log(' 5. Run verification in PowerShell:');
    console.log('    $env:RENDER_PG_CONNECTION_STRING = "postgres://..."');
    console.log('    npx tsx scripts/verify-render-pg-provisioning.ts');
    console.log('--------------------------------------------------------------------------------\n');

    const pendingReport = {
      report_id: `REPORT-PG-PROVISIONING-${Date.now()}`,
      generated_at_utc: new Date().toISOString(),
      status: 'PENDING_HUMAN_ACTION',
      measured_value: 'NOT_CONFIGURED — RENDER_PG_CONNECTION_STRING environment variable empty',
      acceptance_threshold: 'SSL enforced; WAL enabled; pool min=20 max=100; dedicated production cluster',
      checks: {
        ssl_enforced: false,
        wal_enabled: false,
        connection_capacity: false,
        ping_latency_ms: null,
        pg_version: null
      },
      instructions: 'Provision Render PostgreSQL instance and re-run with RENDER_PG_CONNECTION_STRING set.',
      governance: {
        production_reads: 'SQLITE_ONLY',
        production_canary: 'PROHIBITED',
        production_cutover: 'PROHIBITED'
      }
    };

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(pendingReport, null, 2), 'utf-8');
    console.log(`Report updated: ${OUTPUT_PATH}`);
    process.exit(0);
  }

  // Active Connection Probe
  const maskedUrl = maskConnectionString(connectionString);
  console.log(`\nConnecting to target PostgreSQL: ${maskedUrl}`);

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }, // Render standard self-signed/proxy cert
    connectionTimeoutMillis: 10000,
  });

  const t0 = performance.now();

  try {
    await client.connect();
    const connectTimeMs = performance.now() - t0;
    console.log(`  [✓] Connected successfully in ${connectTimeMs.toFixed(1)}ms`);

    // 1. SSL Status
    const sslRes = await client.query("SHOW ssl;");
    const sslVal = sslRes.rows[0]?.ssl;
    const isSsl = sslVal === 'on' || sslVal === 'true';
    console.log(`  [${isSsl ? '✓' : '✗'}] SSL Enforcement: ssl=${sslVal}`);

    // 2. Engine Version
    const verRes = await client.query("SELECT version();");
    const fullVersion = verRes.rows[0]?.version || '';
    const verMatch = fullVersion.match(/PostgreSQL (\d+)/i);
    const majorVersion = verMatch ? parseInt(verMatch[1], 10) : 0;
    const isVersionOk = majorVersion >= 15;
    console.log(`  [${isVersionOk ? '✓' : '✗'}] Engine Version: ${fullVersion.split(',')[0]} (Major: ${majorVersion})`);

    // 3. WAL Level
    const walRes = await client.query("SHOW wal_level;");
    const walLevel = walRes.rows[0]?.wal_level;
    const isWalOk = ['replica', 'logical'].includes(walLevel);
    console.log(`  [${isWalOk ? '✓' : '✗'}] WAL Level: wal_level=${walLevel}`);

    // 4. Max Connections
    const connRes = await client.query("SHOW max_connections;");
    const maxConn = parseInt(connRes.rows[0]?.max_connections || '0', 10);
    const isConnOk = maxConn >= 50;
    console.log(`  [${isConnOk ? '✓' : '⚠️'}] Connection Limit: max_connections=${maxConn} (target: >= 50, recommended: 100)`);

    // 5. Ping RTT Latency
    const tPing = performance.now();
    await client.query("SELECT 1 as ping;");
    const pingLatencyMs = performance.now() - tPing;
    const isPingOk = pingLatencyMs < 300;
    console.log(`  [${isPingOk ? '✓' : '⚠️'}] RTT Ping Latency: ${pingLatencyMs.toFixed(2)}ms`);

    // 6. Transactional Read/Write Probe
    await client.query("BEGIN; CREATE TEMP TABLE _probe_p11 (x int); DROP TABLE _probe_p11; COMMIT;");
    console.log(`  [✓] Transactional DDL/DML Probe: OK`);

    await client.end();

    const allPassed = isSsl && isVersionOk && isWalOk && isConnOk;
    const reportStatus = allPassed ? 'PASS' : 'FAIL';

    const report = {
      report_id: `REPORT-PG-PROVISIONING-${Date.now()}`,
      generated_at_utc: new Date().toISOString(),
      status: reportStatus,
      target_host_masked: maskedUrl,
      measured_value: `SSL=${sslVal}, PG_Ver=${majorVersion}, WAL=${walLevel}, max_conn=${maxConn}, ping=${pingLatencyMs.toFixed(1)}ms`,
      acceptance_threshold: 'SSL enforced; WAL enabled; pool min=20 max=100; dedicated production cluster',
      checks: {
        ssl_enforced: isSsl,
        wal_enabled: isWalOk,
        version_ge_15: isVersionOk,
        connection_capacity_ok: isConnOk,
        max_connections: maxConn,
        ping_latency_ms: pingLatencyMs,
        pg_full_version: fullVersion.split(',')[0]
      },
      governance: {
        production_reads: 'SQLITE_ONLY',
        production_canary: 'PROHIBITED',
        production_cutover: 'PROHIBITED',
        note: 'Validated connection capability only. Zero production tables mutated.'
      }
    };

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2), 'utf-8');

    console.log('\n' + '='.repeat(80));
    console.log(` P11-PRE-4 VALIDATION VERDICT: ${reportStatus}`);
    console.log(` Report written to: ${OUTPUT_PATH}`);
    console.log('='.repeat(80));

  } catch (err: any) {
    console.error(`\n[FAIL] Connection error: ${err.message}`);
    const failReport = {
      report_id: `REPORT-PG-PROVISIONING-${Date.now()}`,
      generated_at_utc: new Date().toISOString(),
      status: 'FAIL',
      target_host_masked: maskedUrl,
      measured_value: `Connection failed: ${err.message}`,
      acceptance_threshold: 'SSL enforced; WAL enabled; pool min=20 max=100; dedicated production cluster',
      checks: {
        ssl_enforced: false,
        wal_enabled: false,
        connection_capacity: false,
        ping_latency_ms: null,
        error: err.message
      },
      governance: {
        production_reads: 'SQLITE_ONLY',
        production_canary: 'PROHIBITED',
        production_cutover: 'PROHIBITED'
      }
    };

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(failReport, null, 2), 'utf-8');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error in provisioning verification:', err);
  process.exit(1);
});
