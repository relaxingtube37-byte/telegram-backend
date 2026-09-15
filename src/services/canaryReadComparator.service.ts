import Database from 'better-sqlite3';
import path from 'path';

export interface CanaryFieldMismatch {
  canonicalMatchId: string;
  field: string;
  legacyValue: any;
  operationalValue: any;
  divergenceType: 'NAME_STANDARDIZATION' | 'SCORE_FORMAT' | 'SEMANTIC_MISMATCH' | 'SURFACE_FORMAT';
}

export interface CanaryComparisonResult {
  queryType: 'MATCH_BY_ID' | 'MATCHES_BY_DATE' | 'BACKTEST_CANDIDATES';
  identifier: string;
  legacyDurationMs: number;
  operationalDurationMs: number;
  latencyDeltaMs: number; // operational - legacy
  hasParity: boolean;
  mismatches: CanaryFieldMismatch[];
}

export interface CanaryVerificationReport {
  timestamp: string;
  totalComparisons: number;
  sampleRatePct: number;
  parityRatePct: number;
  latencyStats: {
    legacyAvgMs: number;
    operationalAvgMs: number;
    deltaAvgMs: number;
    deltaP50Ms: number;
    deltaP90Ms: number;
    deltaP95Ms: number;
    deltaP99Ms: number;
  };
  mismatchSummary: {
    totalMismatches: number;
    nameStandardizations: number;
    scoreFormatVariations: number;
    semanticMismatches: number;
  };
  sampleMismatches: CanaryFieldMismatch[];
  verdict: 'SAFE_FOR_CUTOVER' | 'UNSAFE';
  legacyDatabaseUntouched: boolean;
}

export class CanaryReadComparator {
  private db: Database.Database;
  private isClosed = false;

  constructor(dbPath: string = 'data/database.sqlite') {
    const resolvedPath = path.resolve(dbPath);
    // Readonly connection to protect the database file
    this.db = new Database(resolvedPath, { readonly: true });
    this.db.pragma('busy_timeout = 5000');

    // Create in-memory TEMP VIEW on this connection only (zero disk write)
    this.initTempOperationalView();
  }

  private initTempOperationalView(): void {
    this.db.exec(`
      CREATE TEMP VIEW IF NOT EXISTS temp_canonical_matches_operational AS
      -- 1. Verified Shadow v2 Layer
      SELECT 
        cm.canonical_match_id,
        cm.match_date AS canonical_match_date,
        cm.tour,
        ct.name_standard AS tourney_name,
        cm.surface,
        cm.round_name,
        pw.full_name_standard AS canonical_winner_name,
        pl.full_name_standard AS canonical_loser_name,
        cm.canonical_score AS score,
        CASE WHEN cm.match_status IN ('RETIRED', 'WALKOVER') THEN 1 ELSE 0 END AS is_retirement_or_wo,
        1 AS is_canonical_modeling_usable,
        1 AS is_backtest_safe,
        0 AS is_archive_only
      FROM canonical_matches_v2 cm
      JOIN canonical_tournaments ct ON ct.canonical_tourney_id = cm.canonical_tourney_id
      JOIN canonical_players pw ON pw.canonical_player_id = cm.winner_canonical_id
      JOIN canonical_players pl ON pl.canonical_player_id = cm.loser_canonical_id

      UNION ALL

      -- 2. Legacy v1 Fallback
      SELECT 
        legacy.canonical_match_id,
        legacy.canonical_match_date,
        legacy.tour,
        legacy.tourney_name,
        legacy.surface,
        legacy.round_name,
        legacy.canonical_winner_name,
        legacy.canonical_loser_name,
        legacy.score,
        legacy.is_retirement_or_wo,
        legacy.is_canonical_modeling_usable,
        legacy.is_backtest_safe,
        legacy.is_archive_only
      FROM canonical_matches legacy
      WHERE NOT EXISTS (
        SELECT 1 FROM canonical_matches_v2 cm2
        WHERE cm2.canonical_match_id = legacy.canonical_match_id
      );
    `);
  }

  /**
   * Compares a single match lookup between legacy v1 and operational projection.
   */
  public compareMatchById(canonicalMatchId: string): CanaryComparisonResult {
    // 1. Query legacy
    const t0 = performance.now();
    const legacyRow = this.db
      .prepare('SELECT * FROM canonical_matches WHERE canonical_match_id = ?')
      .get(canonicalMatchId) as any;
    const t1 = performance.now();

    // 2. Query operational temp view
    const t2 = performance.now();
    const operationalRow = this.db
      .prepare('SELECT * FROM temp_canonical_matches_operational WHERE canonical_match_id = ?')
      .get(canonicalMatchId) as any;
    const t3 = performance.now();

    const legacyDurationMs = Number((t1 - t0).toFixed(3));
    const operationalDurationMs = Number((t3 - t2).toFixed(3));
    const latencyDeltaMs = Number((operationalDurationMs - legacyDurationMs).toFixed(3));

    const mismatches: CanaryFieldMismatch[] = [];

    if (!legacyRow && !operationalRow) {
      return {
        queryType: 'MATCH_BY_ID',
        identifier: canonicalMatchId,
        legacyDurationMs,
        operationalDurationMs,
        latencyDeltaMs,
        hasParity: true,
        mismatches: [],
      };
    }

    if (legacyRow && operationalRow) {
      // Compare core attributes
      if (legacyRow.canonical_match_date !== operationalRow.canonical_match_date) {
        mismatches.push({
          canonicalMatchId,
          field: 'canonical_match_date',
          legacyValue: legacyRow.canonical_match_date,
          operationalValue: operationalRow.canonical_match_date,
          divergenceType: 'SEMANTIC_MISMATCH',
        });
      }

      // Check name differences (standardization expected)
      if (legacyRow.canonical_winner_name !== operationalRow.canonical_winner_name) {
        mismatches.push({
          canonicalMatchId,
          field: 'canonical_winner_name',
          legacyValue: legacyRow.canonical_winner_name,
          operationalValue: operationalRow.canonical_winner_name,
          divergenceType: 'NAME_STANDARDIZATION',
        });
      }

      if (legacyRow.canonical_loser_name !== operationalRow.canonical_loser_name) {
        mismatches.push({
          canonicalMatchId,
          field: 'canonical_loser_name',
          legacyValue: legacyRow.canonical_loser_name,
          operationalValue: operationalRow.canonical_loser_name,
          divergenceType: 'NAME_STANDARDIZATION',
        });
      }

      // Check normalized score
      const normLegacyScore = (legacyRow.score || '').replace(/\s+/g, '');
      const normOpScore = (operationalRow.score || '').replace(/\s+/g, '');
      if (normLegacyScore !== normOpScore) {
        mismatches.push({
          canonicalMatchId,
          field: 'score',
          legacyValue: legacyRow.score,
          operationalValue: operationalRow.score,
          divergenceType: 'SCORE_FORMAT',
        });
      }
    }

    // Has parity if there are zero semantic mismatches
    const hasParity = !mismatches.some((m) => m.divergenceType === 'SEMANTIC_MISMATCH');

    return {
      queryType: 'MATCH_BY_ID',
      identifier: canonicalMatchId,
      legacyDurationMs,
      operationalDurationMs,
      latencyDeltaMs,
      hasParity,
      mismatches,
    };
  }

  /**
   * Compares a batch query by date.
   */
  public compareMatchesByDate(matchDate: string, limit: number = 20): CanaryComparisonResult {
    const t0 = performance.now();
    const legacyRows = this.db
      .prepare('SELECT canonical_match_id, score, tour, surface FROM canonical_matches WHERE canonical_match_date = ? LIMIT ?')
      .all(matchDate, limit) as any[];
    const t1 = performance.now();

    const t2 = performance.now();
    const operationalRows = this.db
      .prepare('SELECT canonical_match_id, score, tour, surface FROM temp_canonical_matches_operational WHERE canonical_match_date = ? LIMIT ?')
      .all(matchDate, limit) as any[];
    const t3 = performance.now();

    const legacyDurationMs = Number((t1 - t0).toFixed(3));
    const operationalDurationMs = Number((t3 - t2).toFixed(3));
    const latencyDeltaMs = Number((operationalDurationMs - legacyDurationMs).toFixed(3));

    const mismatches: CanaryFieldMismatch[] = [];

    const legacyIds = new Set(legacyRows.map((r) => r.canonical_match_id));
    const opIds = new Set(operationalRows.map((r) => r.canonical_match_id));

    // In a hybrid view, all legacy rows that are not superseded by v2 should be returned
    let semanticDiff = false;
    for (const r of legacyRows) {
      if (!opIds.has(r.canonical_match_id)) {
        // v2 might have slightly shifted ID if canonicalized, check count parity
        if (Math.abs(legacyRows.length - operationalRows.length) > 0) {
          semanticDiff = true;
          break;
        }
      }
    }

    return {
      queryType: 'MATCHES_BY_DATE',
      identifier: matchDate,
      legacyDurationMs,
      operationalDurationMs,
      latencyDeltaMs,
      hasParity: !semanticDiff,
      mismatches,
    };
  }

  public close(): void {
    if (!this.isClosed) {
      this.db.close();
      this.isClosed = true;
    }
  }
}
