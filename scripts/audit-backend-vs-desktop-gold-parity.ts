/**
 * scripts/audit-backend-vs-desktop-gold-parity.ts
 *
 * Forensic Schema, Table, View & Data Parity Audit between:
 * 1. Authoritative Desktop Gold: G:/state football/data/tennis_gold.sqlite (283MB, Read-Only)
 * 2. Primary Backend SQLite:      G:/telegram-backend/data/database.sqlite (545MB, Read-Only)
 *
 * GOVERNANCE: 100% READ-ONLY. ZERO MUTATION TO EITHER DATABASE.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

interface TableMeta {
  name: string;
  type: 'table' | 'view';
  sql: string;
  rowCount: number;
}

interface ColumnMeta {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: any;
  pk: number;
}

const DESKTOP_GOLD_PATH = 'G:/state football/data/tennis_gold.sqlite';
const BACKEND_SQLITE_PATH = path.resolve(__dirname, '../data/database.sqlite');
const SCRATCH_OUTPUT_DIR = path.resolve(__dirname, '../scratch/postgres-phase-11-cutover');
const JSON_OUTPUT_PATH = path.join(SCRATCH_OUTPUT_DIR, 'backend_vs_desktop_gold_parity.json');

async function main() {
  console.log('='.repeat(80));
  console.log(' 🔬 FORENSIC PARITY AUDIT: BACKEND SQLITE vs DESKTOP GOLD DATABASE');
  console.log(' Scope: Read-Only Schema, View, Index, Column & Data Count Reconciliation');
  console.log('='.repeat(80));

  if (!fs.existsSync(DESKTOP_GOLD_PATH)) {
    throw new Error(`Desktop Gold DB not found at: ${DESKTOP_GOLD_PATH}`);
  }
  if (!fs.existsSync(BACKEND_SQLITE_PATH)) {
    throw new Error(`Backend SQLite DB not found at: ${BACKEND_SQLITE_PATH}`);
  }

  const desktopStat = fs.statSync(DESKTOP_GOLD_PATH);
  const backendStat = fs.statSync(BACKEND_SQLITE_PATH);

  console.log(`\n📁 DATABASE METADATA:`);
  console.log(`  - Desktop Gold Path:   ${DESKTOP_GOLD_PATH}`);
  console.log(`  - Desktop Gold Size:   ${desktopStat.size.toLocaleString()} bytes`);
  console.log(`  - Backend SQLite Path: ${BACKEND_SQLITE_PATH}`);
  console.log(`  - Backend SQLite Size: ${backendStat.size.toLocaleString()} bytes`);

  const desktopDb = new Database(DESKTOP_GOLD_PATH, { readonly: true });
  const backendDb = new Database(BACKEND_SQLITE_PATH, { readonly: true });

  try {
    // -------------------------------------------------------------------------
    // 1. Extract Master Entities
    // -------------------------------------------------------------------------
    const getEntities = (db: Database.Database): TableMeta[] => {
      const rows = db.prepare(`
        SELECT type, name, sql FROM sqlite_master 
        WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
        ORDER BY type, name
      `).all() as { type: 'table' | 'view'; name: string; sql: string }[];

      return rows.map(r => {
        let rowCount = -1;
        try {
          const c = db.prepare(`SELECT COUNT(*) as count FROM "${r.name}"`).get() as { count: number };
          rowCount = c.count;
        } catch (e: any) {
          rowCount = -1; // e.g. view might have broken dependency or parameterized
        }
        return {
          name: r.name,
          type: r.type,
          sql: r.sql || '',
          rowCount
        };
      });
    };

    const desktopEntities = getEntities(desktopDb);
    const backendEntities = getEntities(backendDb);

    console.log(`\n📊 ENTITY INVENTORY:`);
    console.log(`  - Desktop Gold Entities: ${desktopEntities.length} (${desktopEntities.filter(e => e.type === 'table').length} tables, ${desktopEntities.filter(e => e.type === 'view').length} views)`);
    console.log(`  - Backend SQLite Entities:${backendEntities.length} (${backendEntities.filter(e => e.type === 'table').length} tables, ${backendEntities.filter(e => e.type === 'view').length} views)`);

    const desktopEntityMap = new Map(desktopEntities.map(e => [e.name, e]));
    const backendEntityMap = new Map(backendEntities.map(e => [e.name, e]));

    // Symmetrical Entity Classification
    const commonEntities: string[] = [];
    const desktopOnlyEntities: string[] = [];
    const backendOnlyEntities: string[] = [];

    for (const name of desktopEntityMap.keys()) {
      if (backendEntityMap.has(name)) {
        commonEntities.push(name);
      } else {
        desktopOnlyEntities.push(name);
      }
    }
    for (const name of backendEntityMap.keys()) {
      if (!desktopEntityMap.has(name)) {
        backendOnlyEntities.push(name);
      }
    }

    console.log(`\n📋 ENTITY CLASSIFICATION:`);
    console.log(`  - Shared Entities (in Both):   ${commonEntities.length}`);
    commonEntities.forEach(name => {
      const d = desktopEntityMap.get(name)!;
      const b = backendEntityMap.get(name)!;
      console.log(`    • ${name.padEnd(35)} [${d.type.toUpperCase()}] Desktop: ${d.rowCount.toLocaleString().padStart(8)} rows | Backend: ${b.rowCount.toLocaleString().padStart(8)} rows`);
    });

    console.log(`\n  - Desktop-Only Entities:       ${desktopOnlyEntities.length}`);
    desktopOnlyEntities.forEach(name => {
      const d = desktopEntityMap.get(name)!;
      console.log(`    • ${name.padEnd(35)} [${d.type.toUpperCase()}] Desktop: ${d.rowCount.toLocaleString().padStart(8)} rows`);
    });

    console.log(`\n  - Backend-Only Entities:       ${backendOnlyEntities.length}`);
    backendOnlyEntities.forEach(name => {
      const b = backendEntityMap.get(name)!;
      console.log(`    • ${name.padEnd(35)} [${b.type.toUpperCase()}] Backend: ${b.rowCount.toLocaleString().padStart(8)} rows`);
    });

    // -------------------------------------------------------------------------
    // 2. Deep Dive: gold_matches_validated Column & Row Parity
    // -------------------------------------------------------------------------
    console.log(`\n` + '='.repeat(80));
    console.log(' 🔍 DEEP DIVE: gold_matches_validated COMPARISON');
    console.log('='.repeat(80));

    let goldMatchesParity: any = null;
    if (desktopEntityMap.has('gold_matches_validated') && backendEntityMap.has('gold_matches_validated')) {
      const dCols = desktopDb.prepare('PRAGMA table_info(gold_matches_validated)').all() as ColumnMeta[];
      const bCols = backendDb.prepare('PRAGMA table_info(gold_matches_validated)').all() as ColumnMeta[];

      const dColNames = new Set(dCols.map(c => c.name));
      const bColNames = new Set(bCols.map(c => c.name));

      const sharedCols = dCols.filter(c => bColNames.has(c.name)).map(c => c.name);
      const desktopOnlyCols = dCols.filter(c => !bColNames.has(c.name)).map(c => c.name);
      const backendOnlyCols = bCols.filter(c => !dColNames.has(c.name)).map(c => c.name);

      console.log(`  - Desktop Column Count: ${dCols.length}`);
      console.log(`  - Backend Column Count: ${bCols.length}`);
      console.log(`  - Shared Columns:       ${sharedCols.length}`);
      console.log(`  - Desktop-Only Columns: ${desktopOnlyCols.length} ${desktopOnlyCols.length > 0 ? `(${desktopOnlyCols.join(', ')})` : ''}`);
      console.log(`  - Backend-Only Columns: ${backendOnlyCols.length} ${backendOnlyCols.length > 0 ? `(${backendOnlyCols.join(', ')})` : ''}`);

      console.log(`  - Desktop Column Names: ${dCols.map(c => c.name).join(', ')}`);
      
      const pkCols = dCols.filter(c => c.pk > 0).map(c => c.name);
      console.log(`  - Desktop Primary Key Columns: ${pkCols.length > 0 ? pkCols.join(', ') : 'NONE (ROWID)'}`);

      // Let's determine candidate identifier: either PK or match_id or rowid or tourney_id + match_num
      let idExpr = '';
      if (pkCols.length === 1) {
        idExpr = pkCols[0];
      } else if (dColNames.has('match_id')) {
        idExpr = 'match_id';
      } else if (dColNames.has('id')) {
        idExpr = 'id';
      } else if (dColNames.has('tourney_id') && dColNames.has('match_num')) {
        idExpr = "tourney_id || '_' || match_num";
      } else {
        idExpr = 'rowid';
      }

      console.log(`  - Match Identifier Expression: ${idExpr}`);

      const dIds = new Set(
        desktopDb.prepare(`SELECT ${idExpr} as match_key FROM gold_matches_validated`).all().map((r: any) => String(r.match_key))
      );
      const bIds = new Set(
        backendDb.prepare(`SELECT ${idExpr} as match_key FROM gold_matches_validated`).all().map((r: any) => String(r.match_key))
      );
      const dCount = desktopEntityMap.get('gold_matches_validated')!.rowCount;
      const bCount = backendEntityMap.get('gold_matches_validated')!.rowCount;

      let sharedIdsCount = 0;
      let desktopOnlyIdsCount = 0;
      let backendOnlyIdsCount = 0;

      for (const id of dIds) {
        if (bIds.has(id)) {
          sharedIdsCount++;
        } else {
          desktopOnlyIdsCount++;
        }
      }
      for (const id of bIds) {
        if (!dIds.has(id)) {
          backendOnlyIdsCount++;
        }
      }

      console.log(`  - Desktop Total Rows:   ${dCount.toLocaleString()}`);
      console.log(`  - Backend Total Rows:   ${bCount.toLocaleString()}`);
      console.log(`  - Shared Row IDs:       ${sharedIdsCount.toLocaleString()}`);
      console.log(`  - Desktop-Only IDs:     ${desktopOnlyIdsCount.toLocaleString()}`);
      console.log(`  - Backend-Only IDs:     ${backendOnlyIdsCount.toLocaleString()}`);

      goldMatchesParity = {
        desktopRowCount: dCount,
        backendRowCount: bCount,
        sharedIdsCount,
        desktopOnlyIdsCount,
        backendOnlyIdsCount,
        desktopColumnsCount: dCols.length,
        backendColumnsCount: bCols.length,
        sharedColumnsCount: sharedCols.length,
        desktopOnlyColumns: desktopOnlyCols,
        backendOnlyColumns: backendOnlyCols
      };
    }

    // -------------------------------------------------------------------------
    // 3. Deep Dive: Three-Tier Backtest Views
    // -------------------------------------------------------------------------
    console.log(`\n` + '='.repeat(80));
    console.log(' 🔍 DEEP DIVE: THREE-TIER BACKTEST VIEWS COMPARISON');
    console.log('='.repeat(80));

    const viewNames = [
      'gold_matches_ready_raw_view',
      'gold_matches_ready_enriched_view',
      'gold_matches_ready_view',
      'gold_matches_enriched_admissions'
    ];

    const viewsParity: any[] = [];
    viewNames.forEach(vName => {
      const d = desktopEntityMap.get(vName);
      const b = backendEntityMap.get(vName);

      const item = {
        name: vName,
        desktopExists: !!d,
        desktopType: d?.type || null,
        desktopRowCount: d?.rowCount ?? null,
        backendExists: !!b,
        backendType: b?.type || null,
        backendRowCount: b?.rowCount ?? null,
        delta: (d && b && d.rowCount >= 0 && b.rowCount >= 0) ? b.rowCount - d.rowCount : null
      };
      viewsParity.push(item);

      console.log(`  • ${vName.padEnd(35)}:`);
      console.log(`    - Desktop: ${d ? `${d.type} (${d.rowCount.toLocaleString()} rows)` : 'NOT FOUND'}`);
      console.log(`    - Backend: ${b ? `${b.type} (${b.rowCount.toLocaleString()} rows)` : 'NOT FOUND'}`);
      if (item.delta !== null) {
        console.log(`    - Delta (Backend - Desktop): ${item.delta >= 0 ? `+${item.delta}` : item.delta}`);
      }
    });

    // -------------------------------------------------------------------------
    // 4. Deep Dive: Telemetry & Application Layer Table Comparison
    // -------------------------------------------------------------------------
    console.log(`\n` + '='.repeat(80));
    console.log(' 🔍 DEEP DIVE: TELEMETRY & APPLICATION LAYER ARCHITECTURE');
    console.log('='.repeat(80));

    // Check historical_matches in backend
    const bHist = backendEntityMap.get('historical_matches');
    console.log(`  - Backend 'historical_matches': ${bHist ? `${bHist.rowCount.toLocaleString()} rows` : 'NOT FOUND'}`);

    // Check backend web/auth/referral tables
    const webTables = ['users', 'referral_sites', 'referral_clicks', 'partner_conversions', 'predictions', 'settings', 'postgres_dual_write_outbox'];
    console.log(`  - Backend Web/Application Tables:`);
    webTables.forEach(t => {
      const meta = backendEntityMap.get(t);
      console.log(`    • ${t.padEnd(30)}: ${meta ? `${meta.rowCount.toLocaleString()} rows` : 'NOT FOUND'}`);
    });

    // -------------------------------------------------------------------------
    // 5. Serialize Complete JSON Report
    // -------------------------------------------------------------------------
    if (!fs.existsSync(SCRATCH_OUTPUT_DIR)) {
      fs.mkdirSync(SCRATCH_OUTPUT_DIR, { recursive: true });
    }

    const fullReport = {
      generatedAtUtc: new Date().toISOString(),
      desktopGold: {
        path: DESKTOP_GOLD_PATH,
        sizeBytes: desktopStat.size,
        totalEntities: desktopEntities.length,
        tablesCount: desktopEntities.filter(e => e.type === 'table').length,
        viewsCount: desktopEntities.filter(e => e.type === 'view').length,
        entities: desktopEntities
      },
      backendSqlite: {
        path: BACKEND_SQLITE_PATH,
        sizeBytes: backendStat.size,
        totalEntities: backendEntities.length,
        tablesCount: backendEntities.filter(e => e.type === 'table').length,
        viewsCount: backendEntities.filter(e => e.type === 'view').length,
        entities: backendEntities
      },
      entityClassification: {
        commonEntitiesCount: commonEntities.length,
        commonEntities,
        desktopOnlyEntitiesCount: desktopOnlyEntities.length,
        desktopOnlyEntities,
        backendOnlyEntitiesCount: backendOnlyEntities.length,
        backendOnlyEntities
      },
      goldMatchesValidatedParity: goldMatchesParity,
      threeTierViewsParity: viewsParity
    };

    fs.writeFileSync(JSON_OUTPUT_PATH, JSON.stringify(fullReport, null, 2), 'utf8');
    console.log(`\n💾 Detailed forensic JSON report saved to: ${JSON_OUTPUT_PATH}`);

    return fullReport;
  } finally {
    desktopDb.close();
    backendDb.close();
  }
}

main().catch(err => {
  console.error('\n❌ Audit failed:', err);
  process.exit(1);
});
