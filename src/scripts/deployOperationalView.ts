import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

export interface DeploymentProbeResult {
  probeName: string;
  query: string;
  durationMs: number;
  rowCount: number;
  passed: boolean;
  details?: any;
}

export interface OperationalViewDeploymentReport {
  timestamp: string;
  mode: 'DRY_RUN' | 'EXECUTE';
  targetDbPath: string;
  snapshotPath: string;
  pragmasVerified: {
    journal_mode: string;
    foreign_keys: number;
    busy_timeout: number;
    wal_autocheckpoint: number;
  };
  baselineCounts: {
    legacyMatches: number;
    shadowMatchesV2: number;
  };
  postDeployCounts: {
    legacyMatches: number;
    shadowMatchesV2: number;
    operationalViewTotal: number;
  };
  probes: DeploymentProbeResult[];
  status: 'SUCCESS' | 'FAILED';
  error?: string;
}

export const REFINED_OPERATIONAL_VIEW_DDL = `
CREATE VIEW IF NOT EXISTS canonical_matches_operational (
  id,
  canonical_match_id,
  canonical_match_date,
  canonical_start_utc,
  tour,
  tourney_name,
  tourney_level,
  surface,
  round_name,
  canonical_winner_name,
  canonical_loser_name,
  score,
  minutes,
  source_a_historical_match_id,
  source_b_rapid_event_id,
  source_presence,
  join_confidence,
  join_confidence_score,
  join_method,
  data_source_stats,
  data_source_pbp,
  data_source_odds,
  bundle_storage_path,
  w_odds_match,
  l_odds_match,
  w_odds_set1,
  l_odds_set1,
  winner_rank,
  loser_rank,
  winner_rank_points,
  loser_rank_points,
  winner_ht,
  loser_ht,
  winner_age,
  loser_age,
  winner_ioc,
  loser_ioc,
  winner_hand,
  loser_hand,
  winner_seed,
  loser_seed,
  winner_entry,
  loser_entry,
  w_ace,
  w_df,
  w_svpt,
  w_1stIn,
  w_1stWon,
  w_2ndWon,
  w_SvGms,
  w_bpSaved,
  w_bpFaced,
  l_ace,
  l_df,
  l_svpt,
  l_1stIn,
  l_1stWon,
  l_2ndWon,
  l_SvGms,
  l_bpSaved,
  l_bpFaced,
  w_serve_won_pct,
  l_serve_won_pct,
  w_return_won_pct,
  l_return_won_pct,
  w_bp_won_pct,
  l_bp_won_pct,
  w_bp_saved_pct,
  l_bp_saved_pct,
  is_placeholder_serve,
  is_retirement_or_wo,
  is_non_singles,
  is_speculative_draw,
  is_canonical_modeling_usable,
  is_backtest_safe,
  canonical_status_reason,
  created_at,
  updated_at,
  is_archive_only
) AS
SELECT
  NULL AS id,
  cm.canonical_match_id,
  cm.match_date AS canonical_match_date,
  NULL AS canonical_start_utc,
  cm.tour,
  ct.name_standard AS tourney_name,
  ct.tour_level,
  cm.surface,
  cm.round_name,
  pw.full_name_standard AS canonical_winner_name,
  pl.full_name_standard AS canonical_loser_name,
  COALESCE(cm.canonical_score, '') AS score,
  NULL AS minutes,
  NULL AS source_a_historical_match_id,
  NULL AS source_b_rapid_event_id,
  CASE WHEN cm.evidence_count >= 2 THEN 'both' ELSE 'single' END AS source_presence,
  'HIGH' AS join_confidence,
  100.0 AS join_confidence_score,
  'v2_deterministic_linker' AS join_method,
  'none' AS data_source_stats,
  'none' AS data_source_pbp,
  'none' AS data_source_odds,
  NULL AS bundle_storage_path,
  NULL AS w_odds_match,
  NULL AS l_odds_match,
  NULL AS w_odds_set1,
  NULL AS l_odds_set1,
  NULL AS winner_rank,
  NULL AS loser_rank,
  NULL AS winner_rank_points,
  NULL AS loser_rank_points,
  NULL AS winner_ht,
  NULL AS loser_ht,
  NULL AS winner_age,
  NULL AS loser_age,
  pw.ioc_country AS winner_ioc,
  pl.ioc_country AS loser_ioc,
  pw.hand AS winner_hand,
  pl.hand AS loser_hand,
  NULL AS winner_seed,
  NULL AS loser_seed,
  NULL AS winner_entry,
  NULL AS loser_entry,
  NULL AS w_ace, NULL AS w_df, NULL AS w_svpt, NULL AS w_1stIn, NULL AS w_1stWon, NULL AS w_2ndWon, NULL AS w_SvGms, NULL AS w_bpSaved, NULL AS w_bpFaced,
  NULL AS l_ace, NULL AS l_df, NULL AS l_svpt, NULL AS l_1stIn, NULL AS l_1stWon, NULL AS l_2ndWon, NULL AS l_SvGms, NULL AS l_bpSaved, NULL AS l_bpFaced,
  NULL AS w_serve_won_pct, NULL AS l_serve_won_pct, NULL AS w_return_won_pct, NULL AS l_return_won_pct, NULL AS w_bp_won_pct, NULL AS l_bp_won_pct, NULL AS w_bp_saved_pct, NULL AS l_bp_saved_pct,
  0 AS is_placeholder_serve,
  CASE WHEN cm.match_status IN ('RETIRED', 'WALKOVER') THEN 1 ELSE 0 END AS is_retirement_or_wo,
  0 AS is_non_singles,
  0 AS is_speculative_draw,
  CASE WHEN cm.match_status = 'FINISHED' THEN 1 ELSE 0 END AS is_canonical_modeling_usable,
  CASE WHEN cm.match_status = 'FINISHED' THEN 1 ELSE 0 END AS is_backtest_safe,
  'V2_LINKED_CONFIRMED' AS canonical_status_reason,
  cm.created_at,
  cm.updated_at,
  0 AS is_archive_only
FROM canonical_matches_v2 cm
JOIN canonical_tournaments ct ON ct.canonical_tourney_id = cm.canonical_tourney_id
JOIN canonical_players pw ON pw.canonical_player_id = cm.winner_canonical_id
JOIN canonical_players pl ON pl.canonical_player_id = cm.loser_canonical_id

UNION ALL

SELECT
  legacy.id,
  legacy.canonical_match_id,
  legacy.canonical_match_date,
  legacy.canonical_start_utc,
  legacy.tour,
  legacy.tourney_name,
  legacy.tourney_level,
  legacy.surface,
  legacy.round_name,
  legacy.canonical_winner_name,
  legacy.canonical_loser_name,
  legacy.score,
  legacy.minutes,
  legacy.source_a_historical_match_id,
  legacy.source_b_rapid_event_id,
  legacy.source_presence,
  legacy.join_confidence,
  legacy.join_confidence_score,
  legacy.join_method,
  legacy.data_source_stats,
  legacy.data_source_pbp,
  legacy.data_source_odds,
  legacy.bundle_storage_path,
  legacy.w_odds_match,
  legacy.l_odds_match,
  legacy.w_odds_set1,
  legacy.l_odds_set1,
  legacy.winner_rank,
  legacy.loser_rank,
  legacy.winner_rank_points,
  legacy.loser_rank_points,
  legacy.winner_ht,
  legacy.loser_ht,
  legacy.winner_age,
  legacy.loser_age,
  legacy.winner_ioc,
  legacy.loser_ioc,
  legacy.winner_hand,
  legacy.loser_hand,
  legacy.winner_seed,
  legacy.loser_seed,
  legacy.winner_entry,
  legacy.loser_entry,
  legacy.w_ace, legacy.w_df, legacy.w_svpt, legacy.w_1stIn, legacy.w_1stWon, legacy.w_2ndWon, legacy.w_SvGms, legacy.w_bpSaved, legacy.w_bpFaced,
  legacy.l_ace, legacy.l_df, legacy.l_svpt, legacy.l_1stIn, legacy.l_1stWon, legacy.l_2ndWon, legacy.l_SvGms, legacy.l_bpSaved, legacy.l_bpFaced,
  legacy.w_serve_won_pct, legacy.l_serve_won_pct, legacy.w_return_won_pct, legacy.l_return_won_pct, legacy.w_bp_won_pct, legacy.l_bp_won_pct, legacy.w_bp_saved_pct, legacy.l_bp_saved_pct,
  legacy.is_placeholder_serve,
  legacy.is_retirement_or_wo,
  legacy.is_non_singles,
  legacy.is_speculative_draw,
  legacy.is_canonical_modeling_usable,
  legacy.is_backtest_safe,
  legacy.canonical_status_reason,
  legacy.created_at,
  legacy.updated_at,
  legacy.is_archive_only
FROM canonical_matches legacy
WHERE NOT EXISTS (
  SELECT 1 FROM canonical_matches_v2 cm2
  WHERE cm2.canonical_match_id = legacy.canonical_match_id
);
`;

export class OperationalViewDeployer {
  private targetDbPath: string;
  private snapshotDir: string;
  private isDryRun: boolean;

  constructor(options: {
    targetDbPath?: string;
    snapshotDir?: string;
    isDryRun?: boolean;
  } = {}) {
    this.targetDbPath = path.resolve(options.targetDbPath || 'data/database.sqlite');
    this.snapshotDir = path.resolve(options.snapshotDir || 'data/backups');
    this.isDryRun = options.isDryRun ?? true; // Safe dry-run by default
  }

  public async deploy(): Promise<OperationalViewDeploymentReport> {
    const snapshotPath = path.join(this.snapshotDir, 'database_wal_safe_pre_cutover.sqlite');

    if (!fs.existsSync(this.targetDbPath)) {
      throw new Error(`Target production database not found: ${this.targetDbPath}`);
    }

    // Step 1: Local physical disk verification
    const isUnc = this.targetDbPath.startsWith('\\\\') || this.targetDbPath.startsWith('//');
    const isLocalDrive = /^[A-Za-z]:[\\/]/.test(this.targetDbPath);
    if (isUnc || !isLocalDrive) {
      throw new Error(`SECURITY VIOLATION: Database path "${this.targetDbPath}" is not on a verified local disk.`);
    }

    const liveDb = new Database(this.targetDbPath);

    // Step 2: PRAGMA configuration and assertion on dedicated writer connection
    liveDb.pragma('busy_timeout = 5000');
    liveDb.pragma('foreign_keys = ON');
    liveDb.pragma('journal_mode = WAL');
    liveDb.pragma('wal_autocheckpoint = 1000');

    const pragmaJournal = liveDb.pragma('journal_mode', { simple: true }) as string;
    const pragmaFk = liveDb.pragma('foreign_keys', { simple: true }) as number;
    const pragmaBusy = liveDb.pragma('busy_timeout', { simple: true }) as number;
    const pragmaAutoCheckpoint = liveDb.pragma('wal_autocheckpoint', { simple: true }) as number;

    if (pragmaJournal.toLowerCase() !== 'wal') {
      throw new Error(`PRAGMA journal_mode could not be set to WAL. Active: ${pragmaJournal}`);
    }
    if (pragmaFk !== 1) {
      throw new Error(`PRAGMA foreign_keys is not ON. Active: ${pragmaFk}`);
    }
    if (pragmaBusy !== 5000) {
      throw new Error(`PRAGMA busy_timeout could not be set to 5000. Active: ${pragmaBusy}`);
    }
    if (pragmaAutoCheckpoint !== 1000) {
      throw new Error(`PRAGMA wal_autocheckpoint could not be set to 1000. Active: ${pragmaAutoCheckpoint}`);
    }

    const pragmasVerified = {
      journal_mode: pragmaJournal,
      foreign_keys: pragmaFk,
      busy_timeout: pragmaBusy,
      wal_autocheckpoint: pragmaAutoCheckpoint,
    };

    // Step 3: Baseline invariant checks
    const legacyBefore = (liveDb.prepare('SELECT count(1) as c FROM canonical_matches').get() as any).c;
    const v2Before = (liveDb.prepare('SELECT count(1) as c FROM canonical_matches_v2').get() as any).c;

    if (legacyBefore !== 140432) {
      throw new Error(`LEGACY INVARIANT VIOLATION: Expected 140,432 rows in legacy canonical_matches, found ${legacyBefore}`);
    }
    if (v2Before !== 7505) {
      throw new Error(`V2 SHADOW INVARIANT VIOLATION: Expected 7,505 rows in canonical_matches_v2, found ${v2Before}`);
    }

    if (this.isDryRun) {
      console.log('[Operational View Deployer] ℹ️ DRY RUN MODE: Preconditions validated. Zero database writes executed.');
      liveDb.close();

      return {
        timestamp: new Date().toISOString(),
        mode: 'DRY_RUN',
        targetDbPath: this.targetDbPath,
        snapshotPath,
        pragmasVerified,
        baselineCounts: {
          legacyMatches: legacyBefore,
          shadowMatchesV2: v2Before,
        },
        postDeployCounts: {
          legacyMatches: legacyBefore,
          shadowMatchesV2: v2Before,
          operationalViewTotal: legacyBefore,
        },
        probes: [],
        status: 'SUCCESS',
      };
    }

    // -------------------------------------------------------------------------
    // ACTUAL EXECUTION (When explicitly called with --execute)
    // -------------------------------------------------------------------------
    try {
      console.log(`[Deployer] Capturing pre-cutover WAL-safe snapshot: ${snapshotPath}...`);
      if (!fs.existsSync(this.snapshotDir)) fs.mkdirSync(this.snapshotDir, { recursive: true });
      if (fs.existsSync(snapshotPath)) {
        try { fs.unlinkSync(snapshotPath); } catch {}
      }

      await liveDb.backup(snapshotPath);

      // Verify snapshot integrity
      const snapDb = new Database(snapshotPath, { readonly: true });
      try {
        const snapInt = (snapDb.pragma('integrity_check') as any[])[0]?.integrity_check;
        const snapFk = (snapDb.pragma('foreign_key_check') as any[]).length;
        if (snapInt !== 'ok') throw new Error(`Snapshot failed integrity check: ${snapInt}`);
        if (snapFk > 0) throw new Error(`Snapshot failed foreign key check: ${snapFk} errors`);
      } finally {
        snapDb.close();
      }
      console.log(`[Deployer] ✅ Snapshot verified: ${(fs.statSync(snapshotPath).size / (1024 * 1024)).toFixed(2)} MB`);

      // Execute View DDL
      console.log('[Deployer] Creating view: canonical_matches_operational...');
      liveDb.exec(REFINED_OPERATIONAL_VIEW_DDL);

      // Step 5: Post-Create Validation Probes
      const probes: DeploymentProbeResult[] = [];

      // Probe 1: Total row count coverage
      const t0 = performance.now();
      const opCountRow = liveDb.prepare('SELECT count(1) as c FROM canonical_matches_operational').get() as any;
      const t1 = performance.now();
      probes.push({
        probeName: 'Coverage Count Probe',
        query: 'SELECT count(1) as c FROM canonical_matches_operational',
        durationMs: Number((t1 - t0).toFixed(2)),
        rowCount: opCountRow.c,
        passed: opCountRow.c >= legacyBefore,
      });

      // Probe 2: Sample V2 Match Lookup
      const t2 = performance.now();
      const v2Sample = liveDb.prepare(
        "SELECT canonical_match_id, tourney_name, canonical_winner_name, canonical_loser_name, score FROM canonical_matches_operational WHERE canonical_match_id LIKE 'cm_2024%' LIMIT 1"
      ).get() as any;
      const t3 = performance.now();
      probes.push({
        probeName: 'V2 Sample Record Probe',
        query: "SELECT ... FROM canonical_matches_operational WHERE canonical_match_id LIKE 'cm_2024%' LIMIT 1",
        durationMs: Number((t3 - t2).toFixed(2)),
        rowCount: v2Sample ? 1 : 0,
        passed: !!v2Sample && !!v2Sample.canonical_match_id && !!v2Sample.canonical_winner_name,
        details: v2Sample,
      });

      // Probe 3: Sample Legacy Archive Match Lookup
      const t4 = performance.now();
      const legacySample = liveDb.prepare(
        'SELECT canonical_match_id, tourney_name, canonical_winner_name, canonical_loser_name, score FROM canonical_matches_operational WHERE is_archive_only = 1 LIMIT 1'
      ).get() as any;
      const t5 = performance.now();
      probes.push({
        probeName: 'Legacy Archive Record Probe',
        query: 'SELECT ... FROM canonical_matches_operational WHERE is_archive_only = 1 LIMIT 1',
        durationMs: Number((t5 - t4).toFixed(2)),
        rowCount: legacySample ? 1 : 0,
        passed: !!legacySample && !!legacySample.canonical_match_id && !!legacySample.canonical_winner_name,
        details: legacySample,
      });

      // Probe 4: Database integrity & foreign key check
      const integrity = (liveDb.pragma('integrity_check') as any[])[0]?.integrity_check;
      const fkErrors = (liveDb.pragma('foreign_key_check') as any[]).length;
      probes.push({
        probeName: 'Database Health Probe',
        query: 'PRAGMA integrity_check; PRAGMA foreign_key_check;',
        durationMs: 0,
        rowCount: 0,
        passed: integrity === 'ok' && fkErrors === 0,
      });

      const legacyAfter = (liveDb.prepare('SELECT count(1) as c FROM canonical_matches').get() as any).c;
      const v2After = (liveDb.prepare('SELECT count(1) as c FROM canonical_matches_v2').get() as any).c;

      const allProbesPassed = probes.every((p) => p.passed);
      if (!allProbesPassed) {
        throw new Error('POST-DEPLOYMENT PROBE FAILED: One or more validation checks did not pass.');
      }

      return {
        timestamp: new Date().toISOString(),
        mode: 'EXECUTE',
        targetDbPath: this.targetDbPath,
        snapshotPath,
        pragmasVerified,
        baselineCounts: {
          legacyMatches: legacyBefore,
          shadowMatchesV2: v2Before,
        },
        postDeployCounts: {
          legacyMatches: legacyAfter,
          shadowMatchesV2: v2After,
          operationalViewTotal: opCountRow.c,
        },
        probes,
        status: 'SUCCESS',
      };
    } finally {
      liveDb.close();
    }
  }

  /**
   * Reverts canonical_matches_operational back to raw canonical_matches legacy passthrough.
   */
  public rollback(): void {
    const liveDb = new Database(this.targetDbPath);
    try {
      liveDb.pragma('busy_timeout = 5000');
      liveDb.exec(`
        DROP VIEW IF EXISTS canonical_matches_operational;
        CREATE VIEW canonical_matches_operational AS SELECT * FROM canonical_matches;
      `);
      console.log('[Deployer] ⚠️ Level 1 Rollback executed: canonical_matches_operational reverted to raw legacy table.');
    } finally {
      liveDb.close();
    }
  }
}

// CLI Entrypoint
if (require.main === module) {
  const isExecuteRequested = process.argv.includes('--execute');
  const isRollbackRequested = process.argv.includes('--rollback');

  const deployer = new OperationalViewDeployer({
    isDryRun: !isExecuteRequested,
  });

  if (isRollbackRequested) {
    deployer.rollback();
  } else {
    deployer
      .deploy()
      .then((report) => {
        console.log(JSON.stringify(report, null, 2));
      })
      .catch((err) => {
        console.error('[DEPLOYMENT ERROR]:', err);
        process.exit(1);
      });
  }
}
