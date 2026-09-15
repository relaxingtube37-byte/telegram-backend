import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { configureLinkerConnection, initCanonicalLinkerSchema } from '../linker/schema';

export interface DryRunBootstrapReport {
  dbPath: string;
  fileSizeBytes: number;
  pragmas: {
    foreign_keys: number;
    busy_timeout: number;
    journal_mode: string;
    synchronous: number;
  };
  integrityCheck: string;
  foreignKeyErrors: number;
  tablesFound: string[];
  missingV2Tables: string[];
  triggersFound: string[];
  indexesCount: number;
  hasLegacyTables: boolean;
  status: 'SUCCESS' | 'FAILED';
  error?: string;
}

export const EXPECTED_V2_TABLES = [
  'canonical_players',
  'player_aliases',
  'canonical_tournaments',
  'tournament_aliases',
  'raw_source_evidence',
  'canonical_matches',
  'canonical_match_provenance',
  'match_source_links',
  'match_review_queue',
  'match_review_audit_log'
];

export const EXPECTED_V2_TRIGGERS = [
  'trg_canonical_players_updated_at',
  'trg_canonical_tournaments_updated_at',
  'trg_canonical_matches_updated_at'
];

export function bootstrapLinkerDryRunDb(
  targetDbPath: string = path.resolve('data/database.linker_dryrun.sqlite'),
  options: { enableWal?: boolean; cleanFirst?: boolean } = { enableWal: true }
): DryRunBootstrapReport {
  // Guard: NEVER allow live production DB path as target
  const resolvedPath = path.resolve(targetDbPath);
  const liveDbPath = path.resolve('data/database.sqlite');
  const legacyDryRunPath = path.resolve('data/database.dryrun.sqlite');

  if (resolvedPath === liveDbPath) {
    throw new Error('SECURITY VIOLATION: Refusing to run linker dry-run bootstrap against live production data/database.sqlite');
  }
  if (resolvedPath === legacyDryRunPath) {
    throw new Error('SAFETY VIOLATION: Refusing to run linker dry-run bootstrap against legacy copy data/database.dryrun.sqlite');
  }

  // Ensure target directory exists
  const targetDir = path.dirname(resolvedPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  if (options.cleanFirst) {
    for (const suffix of ['', '-wal', '-shm']) {
      const p = resolvedPath + suffix;
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {
          // ignore cleanup failures
        }
      }
    }
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(resolvedPath);

    // Apply explicit connection pragmas
    configureLinkerConnection(db, {
      enableWal: options.enableWal ?? true,
      synchronousNormal: true
    });

    // Execute idempotent v2 linker schema initialization
    initCanonicalLinkerSchema(db);

    // Read active PRAGMAs
    const fkVal = db.pragma('foreign_keys', { simple: true }) as number;
    const timeoutVal = db.pragma('busy_timeout', { simple: true }) as number;
    const journalVal = db.pragma('journal_mode', { simple: true }) as string;
    const syncVal = db.pragma('synchronous', { simple: true }) as number;

    // Run integrity & foreign key checks
    const integrityRows = db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
    const integrityResult = integrityRows.length > 0 ? integrityRows[0].integrity_check : 'unknown';

    const fkErrors = db.prepare('PRAGMA foreign_key_check').all() as any[];

    // Inspect database tables, triggers, indexes
    const tableRows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC")
      .all() as Array<{ name: string }>;
    const tablesFound = tableRows.map(r => r.name);

    const triggerRows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name ASC")
      .all() as Array<{ name: string }>;
    const triggersFound = triggerRows.map(r => r.name);

    const indexRows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC")
      .all() as Array<{ name: string }>;

    const missingV2Tables = EXPECTED_V2_TABLES.filter(t => !tablesFound.includes(t));
    const hasLegacyTables = tablesFound.some(t =>
      ['historical_matches', 'tracked_players', 'player_match_index', 'predictions', 'users'].includes(t)
    );

    // Checkpoint WAL passively if enabled to flush header
    if (options.enableWal) {
      try {
        db.pragma('wal_checkpoint(PASSIVE)');
      } catch {
        // checkpoint best-effort
      }
    }

    const stat = fs.existsSync(resolvedPath) ? fs.statSync(resolvedPath) : { size: 0 };

    const isSuccess =
      missingV2Tables.length === 0 &&
      fkErrors.length === 0 &&
      integrityResult === 'ok' &&
      fkVal === 1;

    return {
      dbPath: resolvedPath,
      fileSizeBytes: stat.size,
      pragmas: {
        foreign_keys: fkVal,
        busy_timeout: timeoutVal,
        journal_mode: journalVal,
        synchronous: syncVal
      },
      integrityCheck: integrityResult,
      foreignKeyErrors: fkErrors.length,
      tablesFound,
      missingV2Tables,
      triggersFound,
      indexesCount: indexRows.length,
      hasLegacyTables,
      status: isSuccess ? 'SUCCESS' : 'FAILED'
    };
  } finally {
    if (db) {
      db.close();
    }
  }
}

// Direct execution entrypoint
if (require.main === module) {
  try {
    console.log('================================================================');
    console.log('BOOTSTRAPPING DEDICATED LINKER DRY-RUN DATABASE');
    console.log('================================================================');

    const report = bootstrapLinkerDryRunDb();

    console.log(`Database Path:       ${report.dbPath}`);
    console.log(`File Size:           ${report.fileSizeBytes.toLocaleString()} bytes`);
    console.log(`Status:              ${report.status}`);
    console.log(`PRAGMA foreign_keys: ${report.pragmas.foreign_keys} (1 = ON)`);
    console.log(`PRAGMA busy_timeout: ${report.pragmas.busy_timeout} ms`);
    console.log(`PRAGMA journal_mode: ${report.pragmas.journal_mode}`);
    console.log(`PRAGMA integrity:    ${report.integrityCheck}`);
    console.log(`FK Errors:           ${report.foreignKeyErrors}`);
    console.log(`V2 Tables Present:   ${report.tablesFound.length}/${EXPECTED_V2_TABLES.length}`);
    console.log(`V2 Triggers Present: ${report.triggersFound.length}/${EXPECTED_V2_TRIGGERS.length}`);
    console.log(`Indexes Created:     ${report.indexesCount}`);
    console.log(`Legacy Tables Found: ${report.hasLegacyTables ? 'YES (UNEXPECTED)' : 'NONE (0)'}`);

    if (report.missingV2Tables.length > 0) {
      console.error('MISSING TABLES:', report.missingV2Tables);
      process.exit(1);
    }

    if (report.status !== 'SUCCESS') {
      console.error('BOOTSTRAP FAILED');
      process.exit(1);
    }

    console.log('================================================================');
    console.log('LINKER DRY-RUN DATABASE READY FOR CANONICAL SEEDING');
    console.log('================================================================');
  } catch (err: any) {
    console.error('FATAL ERROR DURING DRY-RUN BOOTSTRAP:', err.message);
    process.exit(1);
  }
}
