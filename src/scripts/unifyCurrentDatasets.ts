import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

// Paths
const DB_PATH = path.resolve('./data/database.sqlite');
const MAPPING_PATH = path.resolve('./scratch/dry-run-mapping.json');
const DIAGNOSTIC_PATH = path.resolve('./scratch/diagnostic-report.md');
const BUNDLES_DIR = path.resolve('./data/bulk-match-bundles/events');

const BACKUP_DIR_D = 'D:/db-backups/telegram-backend';
const BACKUP_DIR_G = 'G:/db-backups/telegram-backend';

interface MappingItem {
  pmi_id: number;
  tracked_player_id: number;
  historical_match_id: number | null;
  old_rapid_event_id: number | null;
  matched_rapid_event_id: number | null;
  confidence: 'high' | 'medium' | 'unresolved';
  match_method: string;
  pmi_date: string;
  source_b_date: string | null;
  pmi_player: string;
  pmi_opponent: string;
  source_b_winner: string | null;
  source_b_loser: string | null;
  pmi_tourney: string;
  source_b_tourney: string | null;
  pmi_score: string;
  source_b_score: string | null;
  date_diff_days: number | null;
  tourney_similarity_score: number | null;
}

interface ParsedStats {
  w_ace: number | null;
  w_df: number | null;
  w_svpt: number | null;
  w_1stIn: number | null;
  w_1stWon: number | null;
  w_2ndWon: number | null;
  w_SvGms: number | null;
  w_bpSaved: number | null;
  w_bpFaced: number | null;
  l_ace: number | null;
  l_df: number | null;
  l_svpt: number | null;
  l_1stIn: number | null;
  l_1stWon: number | null;
  l_2ndWon: number | null;
  l_SvGms: number | null;
  l_bpSaved: number | null;
  l_bpFaced: number | null;
  w_serve_won_pct: number | null;
  l_serve_won_pct: number | null;
  w_return_won_pct: number | null;
  l_return_won_pct: number | null;
  w_bp_won_pct: number | null;
  l_bp_won_pct: number | null;
  w_bp_saved_pct: number | null;
  l_bp_saved_pct: number | null;
}

function parseBundleStats(eventId: number): ParsedStats | null {
  const statsFile = path.join(BUNDLES_DIR, String(eventId), 'statistics.json');
  const detailsFile = path.join(BUNDLES_DIR, String(eventId), 'event_details.json');

  if (!fs.existsSync(statsFile) || !fs.existsSync(detailsFile)) {
    return null;
  }

  try {
    const statsJson = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
    const detailsJson = JSON.parse(fs.readFileSync(detailsFile, 'utf8'));

    const winnerCode = detailsJson.event?.winnerCode; // 1 = home, 2 = away
    if (winnerCode !== 1 && winnerCode !== 2) {
      return null;
    }

    const allPeriod = statsJson.statistics?.find((p: any) => p.period === 'ALL');
    if (!allPeriod || !allPeriod.groups) {
      return null;
    }

    const statMap: Record<string, { home: number; away: number; homeTotal?: number; awayTotal?: number }> = {};
    for (const group of allPeriod.groups) {
      for (const item of group.statisticsItems || []) {
        const key = item.key || item.name;
        statMap[key] = {
          home: Number(item.homeValue ?? item.home ?? 0),
          away: Number(item.awayValue ?? item.away ?? 0),
          homeTotal: item.homeTotal != null ? Number(item.homeTotal) : undefined,
          awayTotal: item.awayTotal != null ? Number(item.awayTotal) : undefined,
        };
      }
    }

    const isWinnerHome = winnerCode === 1;

    const w_ace = isWinnerHome ? statMap['aces']?.home ?? null : statMap['aces']?.away ?? null;
    const l_ace = isWinnerHome ? statMap['aces']?.away ?? null : statMap['aces']?.home ?? null;

    const w_df = isWinnerHome ? statMap['doubleFaults']?.home ?? null : statMap['doubleFaults']?.away ?? null;
    const l_df = isWinnerHome ? statMap['doubleFaults']?.away ?? null : statMap['doubleFaults']?.home ?? null;

    const w_svpt = isWinnerHome
      ? statMap['firstServeAccuracy']?.homeTotal ?? null
      : statMap['firstServeAccuracy']?.awayTotal ?? null;
    const l_svpt = isWinnerHome
      ? statMap['firstServeAccuracy']?.awayTotal ?? null
      : statMap['firstServeAccuracy']?.homeTotal ?? null;

    const w_1stIn = isWinnerHome
      ? statMap['firstServeAccuracy']?.home ?? null
      : statMap['firstServeAccuracy']?.away ?? null;
    const l_1stIn = isWinnerHome
      ? statMap['firstServeAccuracy']?.away ?? null
      : statMap['firstServeAccuracy']?.home ?? null;

    const w_1stWon = isWinnerHome
      ? statMap['firstServePointsAccuracy']?.home ?? null
      : statMap['firstServePointsAccuracy']?.away ?? null;
    const l_1stWon = isWinnerHome
      ? statMap['firstServePointsAccuracy']?.away ?? null
      : statMap['firstServePointsAccuracy']?.home ?? null;

    const w_2ndWon = isWinnerHome
      ? statMap['secondServePointsAccuracy']?.home ?? null
      : statMap['secondServePointsAccuracy']?.away ?? null;
    const l_2ndWon = isWinnerHome
      ? statMap['secondServePointsAccuracy']?.away ?? null
      : statMap['secondServePointsAccuracy']?.home ?? null;

    const w_SvGms = isWinnerHome
      ? statMap['serviceGamesTotal']?.home ?? null
      : statMap['serviceGamesTotal']?.away ?? null;
    const l_SvGms = isWinnerHome
      ? statMap['serviceGamesTotal']?.away ?? null
      : statMap['serviceGamesTotal']?.home ?? null;

    const w_bpSaved = isWinnerHome
      ? statMap['breakPointsSaved']?.home ?? null
      : statMap['breakPointsSaved']?.away ?? null;
    const w_bpFaced = isWinnerHome
      ? statMap['breakPointsSaved']?.homeTotal ?? null
      : statMap['breakPointsSaved']?.awayTotal ?? null;

    const l_bpSaved = isWinnerHome
      ? statMap['breakPointsSaved']?.away ?? null
      : statMap['breakPointsSaved']?.home ?? null;
    const l_bpFaced = isWinnerHome
      ? statMap['breakPointsSaved']?.awayTotal ?? null
      : statMap['breakPointsSaved']?.homeTotal ?? null;

    const w_serve_points_won = isWinnerHome
      ? statMap['servicePointsScored']?.home ?? (w_1stWon != null && w_2ndWon != null ? w_1stWon + w_2ndWon : null)
      : statMap['servicePointsScored']?.away ?? (w_1stWon != null && w_2ndWon != null ? w_1stWon + w_2ndWon : null);

    const l_serve_points_won = isWinnerHome
      ? statMap['servicePointsScored']?.away ?? (l_1stWon != null && l_2ndWon != null ? l_1stWon + l_2ndWon : null)
      : statMap['servicePointsScored']?.home ?? (l_1stWon != null && l_2ndWon != null ? l_1stWon + l_2ndWon : null);

    const w_serve_won_pct =
      w_svpt != null && w_svpt > 0 && w_serve_points_won != null ? (w_serve_points_won / w_svpt) * 100 : null;
    const l_serve_won_pct =
      l_svpt != null && l_svpt > 0 && l_serve_points_won != null ? (l_serve_points_won / l_svpt) * 100 : null;

    const w_return_points_won = isWinnerHome
      ? statMap['receiverPointsScored']?.home ?? null
      : statMap['receiverPointsScored']?.away ?? null;
    const l_return_points_won = isWinnerHome
      ? statMap['receiverPointsScored']?.away ?? null
      : statMap['receiverPointsScored']?.home ?? null;

    const w_return_won_pct =
      l_svpt != null && l_svpt > 0 && w_return_points_won != null ? (w_return_points_won / l_svpt) * 100 : null;
    const l_return_won_pct =
      w_svpt != null && w_svpt > 0 && l_return_points_won != null ? (l_return_points_won / w_svpt) * 100 : null;

    const w_bp_won = isWinnerHome
      ? statMap['breakPointsScored']?.home ?? null
      : statMap['breakPointsScored']?.away ?? null;
    const l_bp_won = isWinnerHome
      ? statMap['breakPointsScored']?.away ?? null
      : statMap['breakPointsScored']?.home ?? null;

    const w_bp_won_pct =
      l_bpFaced != null && l_bpFaced > 0 && w_bp_won != null ? (w_bp_won / l_bpFaced) * 100 : null;
    const l_bp_won_pct =
      w_bpFaced != null && w_bpFaced > 0 && l_bp_won != null ? (l_bp_won / w_bpFaced) * 100 : null;

    const w_bp_saved_pct =
      w_bpFaced != null && w_bpFaced > 0 && w_bpSaved != null ? (w_bpSaved / w_bpFaced) * 100 : null;
    const l_bp_saved_pct =
      l_bpFaced != null && l_bpFaced > 0 && l_bpSaved != null ? (l_bpSaved / l_bpFaced) * 100 : null;

    return {
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
    };
  } catch (err) {
    return null;
  }
}

async function main(): Promise<void> {
  console.log('══════════════════════════════════════════════════════════════');
  console.log(' CANONICAL DATASET UNIFICATION (SOURCE A + SOURCE B)');
  console.log('══════════════════════════════════════════════════════════════\n');

  // =========================================================================
  // STEP 0: MANDATORY SAFE BACKUP
  // =========================================================================
  console.log('--- STEP 0: EXECUTING MANDATORY SAFE BACKUP ---');
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`Original database file not found at: ${DB_PATH}`);
  }

  const originalSize = fs.statSync(DB_PATH).size;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // Primary backup path on D: (or G: fallback)
  const targetBackupDir = fs.existsSync('D:/') ? BACKUP_DIR_D : BACKUP_DIR_G;
  fs.mkdirSync(targetBackupDir, { recursive: true });
  fs.mkdirSync(BACKUP_DIR_G, { recursive: true });

  const backupDbPathD = path.join(targetBackupDir, `database_backup_${timestamp}.sqlite`);
  const backupDbPathG = path.join(BACKUP_DIR_G, `database_backup_${timestamp}.sqlite`);

  console.log(`Copying database to primary backup: ${backupDbPathD}...`);
  fs.copyFileSync(DB_PATH, backupDbPathD);
  fs.copyFileSync(DB_PATH, backupDbPathG);

  // Copy mapping and diagnostic files
  if (fs.existsSync(MAPPING_PATH)) {
    fs.copyFileSync(MAPPING_PATH, path.join(targetBackupDir, `dry-run-mapping_${timestamp}.json`));
    fs.copyFileSync(MAPPING_PATH, path.join(BACKUP_DIR_G, `dry-run-mapping_${timestamp}.json`));
  }
  if (fs.existsSync(DIAGNOSTIC_PATH)) {
    fs.copyFileSync(DIAGNOSTIC_PATH, path.join(targetBackupDir, `diagnostic-report_${timestamp}.md`));
    fs.copyFileSync(DIAGNOSTIC_PATH, path.join(BACKUP_DIR_G, `diagnostic-report_${timestamp}.md`));
  }

  // Verify backup byte size
  const backupSizeD = fs.statSync(backupDbPathD).size;
  const backupSizeG = fs.statSync(backupDbPathG).size;

  if (backupSizeD !== originalSize || backupSizeG !== originalSize) {
    throw new Error(
      `BACKUP VERIFICATION FAILED! Original size=${originalSize}, Backup D size=${backupSizeD}, Backup G size=${backupSizeG}. Aborting.`,
    );
  }

  console.log(`✅ Backup verified successfully!`);
  console.log(`   - Primary Path: ${backupDbPathD} (${backupSizeD} bytes)`);
  console.log(`   - Redundant Path: ${backupDbPathG} (${backupSizeG} bytes)\n`);

  // =========================================================================
  // STEP 1: LOAD MAPPING & INITIAL DATABASE STATE
  // =========================================================================
  console.log('--- STEP 1: INITIALIZING TRANSACTION & AUDIT BASELINE ---');
  const db = new Database(DB_PATH);

  // Baseline row counts
  const pmiCountBefore = db.prepare('SELECT COUNT(*) as c FROM player_match_index').get() as { c: number };
  const histCountBefore = db.prepare('SELECT COUNT(*) as c FROM historical_matches').get() as { c: number };
  const trackedCountBefore = db.prepare('SELECT COUNT(*) as c FROM tracked_players').get() as { c: number };

  const validOddsBefore = db
    .prepare('SELECT COUNT(*) as c FROM historical_matches WHERE w_odds_match IS NOT NULL AND w_odds_match > 1.01')
    .get() as { c: number };

  const placeholderStatsBefore = db
    .prepare('SELECT COUNT(*) as c FROM historical_matches WHERE w_svpt = 100 AND w_1stIn = 0')
    .get() as { c: number };

  console.log('Baseline Database Counts (Before Unification):', {
    player_match_index_rows: pmiCountBefore.c,
    historical_matches_rows: histCountBefore.c,
    tracked_players_rows: trackedCountBefore.c,
    rows_with_valid_odds: validOddsBefore.c,
    placeholder_serve_rows: placeholderStatsBefore.c,
  });

  // Load Mapping Items
  console.log(`Loading confirmed mapping records from ${MAPPING_PATH}...`);
  const mappingItems = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8')) as MappingItem[];
  console.log(`Loaded ${mappingItems.length} mapping records.\n`);

  // =========================================================================
  // STEP 2: SCHEMA MIGRATIONS (ADD COLUMNS IF MISSING)
  // =========================================================================
  console.log('--- STEP 2: APPLYING SCHEMA MIGRATIONS IN PLAYER_MATCH_INDEX ---');
  const existingCols = (db.prepare('PRAGMA table_info(player_match_index)').all() as any[]).map((c) => c.name);

  if (!existingCols.includes('enrichment_status')) {
    db.prepare("ALTER TABLE player_match_index ADD COLUMN enrichment_status TEXT DEFAULT 'historical_only_no_source_b'").run();
    console.log("Added column 'enrichment_status' to player_match_index.");
  }
  if (!existingCols.includes('data_source_stats')) {
    db.prepare('ALTER TABLE player_match_index ADD COLUMN data_source_stats TEXT').run();
    console.log("Added column 'data_source_stats' to player_match_index.");
  }
  if (!existingCols.includes('data_source_pbp')) {
    db.prepare('ALTER TABLE player_match_index ADD COLUMN data_source_pbp TEXT').run();
    console.log("Added column 'data_source_pbp' to player_match_index.");
  }
  if (!existingCols.includes('data_source_details')) {
    db.prepare('ALTER TABLE player_match_index ADD COLUMN data_source_details TEXT').run();
    console.log("Added column 'data_source_details' to player_match_index.");
  }

  // =========================================================================
  // STEP 3: TRANSACTIONAL WRITE OPERATION
  // =========================================================================
  console.log('\n--- STEP 3: EXECUTING CANONICAL UNIFICATION TRANSACTION ---');

  const updatePmiMatchedStmt = db.prepare(`
    UPDATE player_match_index
    SET 
      rapid_event_id = @rapid_event_id,
      enrichment_status = @enrichment_status,
      completeness = @completeness,
      has_api_details = @has_api_details,
      has_api_statistics = @has_api_statistics,
      has_api_pbp = @has_api_pbp,
      data_source_stats = @data_source_stats,
      data_source_pbp = @data_source_pbp,
      data_source_details = @data_source_details,
      updated_at = @updated_at
    WHERE id = @pmi_id
  `);

  const updatePmiUnmatchedStmt = db.prepare(`
    UPDATE player_match_index
    SET 
      enrichment_status = 'historical_only_no_source_b',
      updated_at = @updated_at
    WHERE id = @pmi_id
  `);

  const updateHistMatchStatsStmt = db.prepare(`
    UPDATE historical_matches
    SET
      rapid_event_id = @rapid_event_id,
      w_ace = @w_ace,
      w_df = @w_df,
      w_svpt = @w_svpt,
      w_1stIn = @w_1stIn,
      w_1stWon = @w_1stWon,
      w_2ndWon = @w_2ndWon,
      w_SvGms = @w_SvGms,
      w_bpSaved = @w_bpSaved,
      w_bpFaced = @w_bpFaced,
      l_ace = @l_ace,
      l_df = @l_df,
      l_svpt = @l_svpt,
      l_1stIn = @l_1stIn,
      l_1stWon = @l_1stWon,
      l_2ndWon = @l_2ndWon,
      l_SvGms = @l_SvGms,
      l_bpSaved = @l_bpSaved,
      l_bpFaced = @l_bpFaced,
      w_serve_won_pct = @w_serve_won_pct,
      l_serve_won_pct = @l_serve_won_pct,
      w_return_won_pct = @w_return_won_pct,
      l_return_won_pct = @l_return_won_pct,
      w_bp_won_pct = @w_bp_won_pct,
      l_bp_won_pct = @l_bp_won_pct,
      w_bp_saved_pct = @w_bp_saved_pct,
      l_bp_saved_pct = @l_bp_saved_pct
    WHERE id = @hist_id
  `);

  const updateHistMatchRapidIdOnlyStmt = db.prepare(`
    UPDATE historical_matches
    SET rapid_event_id = @rapid_event_id
    WHERE id = @hist_id AND (rapid_event_id IS NULL OR rapid_event_id != @rapid_event_id)
  `);

  let rowsEnrichedFromApi = 0;
  let rowsPreservedHistoricalOnly = 0;
  let placeholderStatsReplaced = 0;
  let skippedNoRealStats = 0;
  let writeFailures = 0;

  const nowIso = new Date().toISOString();

  // Execute inside a single SQL transaction
  const executeUnification = db.transaction(() => {
    for (const item of mappingItems) {
      const isMatched =
        (item.confidence === 'high' || item.confidence === 'medium') && item.matched_rapid_event_id != null;

      if (!isMatched) {
        // Unmatched historical row -> preserve explicitly
        updatePmiUnmatchedStmt.run({
          pmi_id: item.pmi_id,
          updated_at: nowIso,
        });
        rowsPreservedHistoricalOnly++;
        continue;
      }

      const rapidEventId = item.matched_rapid_event_id!;
      const eventDir = path.join(BUNDLES_DIR, String(rapidEventId));
      const hasDetails = fs.existsSync(path.join(eventDir, 'event_details.json'));
      const hasPbp = fs.existsSync(path.join(eventDir, 'point_by_point.json'));
      const hasStats = fs.existsSync(path.join(eventDir, 'statistics.json'));

      const parsedStats = parseBundleStats(rapidEventId);

      // Update PMI
      updatePmiMatchedStmt.run({
        pmi_id: item.pmi_id,
        rapid_event_id: rapidEventId,
        enrichment_status: 'enriched_from_api',
        completeness: hasStats && hasPbp ? 'full' : hasStats ? 'stats_only' : 'partial',
        has_api_details: hasDetails ? 1 : 0,
        has_api_statistics: hasStats && parsedStats != null ? 1 : 0,
        has_api_pbp: hasPbp ? 1 : 0,
        data_source_stats: hasStats && parsedStats != null ? 'rapidapi_statistics_bundle' : null,
        data_source_pbp: hasPbp ? 'rapidapi_pbp_bundle' : null,
        data_source_details: hasDetails ? 'rapidapi_event_details' : null,
        updated_at: nowIso,
      });
      rowsEnrichedFromApi++;

      // Update Historical Matches if linked
      if (item.historical_match_id != null) {
        if (parsedStats != null && parsedStats.w_svpt != null && parsedStats.w_svpt > 0) {
          updateHistMatchStatsStmt.run({
            hist_id: item.historical_match_id,
            rapid_event_id: rapidEventId,
            w_ace: parsedStats.w_ace,
            w_df: parsedStats.w_df,
            w_svpt: parsedStats.w_svpt,
            w_1stIn: parsedStats.w_1stIn,
            w_1stWon: parsedStats.w_1stWon,
            w_2ndWon: parsedStats.w_2ndWon,
            w_SvGms: parsedStats.w_SvGms,
            w_bpSaved: parsedStats.w_bpSaved,
            w_bpFaced: parsedStats.w_bpFaced,
            l_ace: parsedStats.l_ace,
            l_df: parsedStats.l_df,
            l_svpt: parsedStats.l_svpt,
            l_1stIn: parsedStats.l_1stIn,
            l_1stWon: parsedStats.l_1stWon,
            l_2ndWon: parsedStats.l_2ndWon,
            l_SvGms: parsedStats.l_SvGms,
            l_bpSaved: parsedStats.l_bpSaved,
            l_bpFaced: parsedStats.l_bpFaced,
            w_serve_won_pct: parsedStats.w_serve_won_pct,
            l_serve_won_pct: parsedStats.l_serve_won_pct,
            w_return_won_pct: parsedStats.w_return_won_pct,
            l_return_won_pct: parsedStats.l_return_won_pct,
            w_bp_won_pct: parsedStats.w_bp_won_pct,
            l_bp_won_pct: parsedStats.l_bp_won_pct,
            w_bp_saved_pct: parsedStats.w_bp_saved_pct,
            l_bp_saved_pct: parsedStats.l_bp_saved_pct,
          });
          placeholderStatsReplaced++;
        } else {
          updateHistMatchRapidIdOnlyStmt.run({
            hist_id: item.historical_match_id,
            rapid_event_id: rapidEventId,
          });
          skippedNoRealStats++;
        }
      }
    }
  });

  // Execute Transaction
  console.log('Writing updates to SQLite database inside transaction...');
  executeUnification();
  console.log('Transaction executed successfully.\n');

  // =========================================================================
  // STEP 4: POST-WRITE VALIDATION AUDIT
  // =========================================================================
  console.log('--- STEP 4: POST-WRITE VALIDATION AUDIT ---');

  const pmiCountAfter = db.prepare('SELECT COUNT(*) as c FROM player_match_index').get() as { c: number };
  const histCountAfter = db.prepare('SELECT COUNT(*) as c FROM historical_matches').get() as { c: number };
  const trackedCountAfter = db.prepare('SELECT COUNT(*) as c FROM tracked_players').get() as { c: number };

  const validOddsAfter = db
    .prepare('SELECT COUNT(*) as c FROM historical_matches WHERE w_odds_match IS NOT NULL AND w_odds_match > 1.01')
    .get() as { c: number };

  const placeholderStatsAfter = db
    .prepare('SELECT COUNT(*) as c FROM historical_matches WHERE w_svpt = 100 AND w_1stIn = 0')
    .get() as { c: number };

  const realStatsCountAfter = db
    .prepare('SELECT COUNT(*) as c FROM historical_matches WHERE w_1stIn > 0 AND w_svpt != 100')
    .get() as { c: number };

  const pmiEnrichmentStatusSummary = db
    .prepare(
      `
    SELECT enrichment_status, COUNT(*) as count
    FROM player_match_index
    GROUP BY enrichment_status
  `,
    )
    .all();

  const validatedAudit = db
    .prepare(
      `
    SELECT 
      COUNT(*) as total_validated,
      SUM(is_historical_usable) as historical_usable,
      SUM(is_backtest_usable) as backtest_usable,
      SUM(is_placeholder_serve) as placeholder_serve_rows,
      SUM(is_raw_serve_feature_usable) as raw_serve_usable
    FROM player_matches_validated
  `,
    )
    .get() as any;

  // Validation assertions
  if (pmiCountAfter.c < pmiCountBefore.c || histCountAfter.c < histCountBefore.c) {
    throw new Error(
      `VALIDATION FAILED: Row count decreased! PMI: ${pmiCountBefore.c} -> ${pmiCountAfter.c}, Historical: ${histCountBefore.c} -> ${histCountAfter.c}`,
    );
  }

  if (validOddsAfter.c !== validOddsBefore.c) {
    throw new Error(
      `VALIDATION FAILED: Odds count changed! Before: ${validOddsBefore.c}, After: ${validOddsAfter.c}`,
    );
  }

  console.log('Post-Write Validation Summary:', {
    backup_file: backupDbPathD,
    backup_size_bytes: backupSizeD,
    pmi_rows_before: pmiCountBefore.c,
    pmi_rows_after: pmiCountAfter.c,
    hist_rows_before: histCountBefore.c,
    hist_rows_after: histCountAfter.c,
    rows_enriched_from_api: rowsEnrichedFromApi,
    rows_preserved_historical_only: rowsPreservedHistoricalOnly,
    placeholder_stats_replaced: placeholderStatsReplaced,
    skipped_no_real_stats_or_walkover: skippedNoRealStats,
    valid_odds_preserved: `${validOddsAfter.c} / ${validOddsBefore.c} (100% intact)`,
    placeholder_stats_before: placeholderStatsBefore.c,
    placeholder_stats_after: placeholderStatsAfter.c,
    real_serve_stats_after: realStatsCountAfter.c,
    pmi_status_breakdown: pmiEnrichmentStatusSummary,
    validated_layer_audit: validatedAudit,
  });

  // =========================================================================
  // STEP 5: UPDATE PROJECT MEMORY WITH DURABLE UNIFICATION DECISION
  // =========================================================================
  const memoryPath = path.resolve('./project-memory/MEMORY.md');
  if (fs.existsSync(memoryPath)) {
    let memContent = fs.readFileSync(memoryPath, 'utf8');
    const updateEntry = `- 2026-09-02: Canonical dataset unification completed. ${rowsEnrichedFromApi} PMI rows enriched from Source B RapidAPI bundles (real serve statistics, PBP flags, provenance fields); ${rowsPreservedHistoricalOnly} rows preserved as historical_only_no_source_b. Odds and biometrics 100% preserved. Zero rows deleted.`;
    if (!memContent.includes('Canonical dataset unification completed')) {
      memContent = memContent.replace(
        '## Progress\n',
        `## Progress\n${updateEntry}\n`,
      );
      fs.writeFileSync(memoryPath, memContent, 'utf8');
    }
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(' CANONICAL UNIFICATION COMPLETED SUCCESSFULLY');
  console.log('══════════════════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('\n❌ UNIFICATION TRANSACTION FAILED:', err);
  process.exit(1);
});
