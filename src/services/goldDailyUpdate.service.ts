import type Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

export interface DailyGoldMatchInput {
  rapid_event_id: number;
  match_date: string;
  start_utc?: string | null;
  tour: string;
  tourney_name: string;
  tourney_id?: string | null;
  surface_raw: string;
  round_name?: string | null;
  winner_name: string;
  loser_name: string;
  winner_id?: number | null;
  loser_id?: number | null;
  score: string;
  winner_rank?: number | null;
  loser_rank?: number | null;
  winner_odds?: number | null;
  loser_odds?: number | null;
  w_svpt?: number | null;
  w_1stIn?: number | null;
  w_1stWon?: number | null;
  w_2ndWon?: number | null;
  w_SvGms?: number | null;
  w_bpSaved?: number | null;
  w_bpFaced?: number | null;
  l_svpt?: number | null;
  l_1stIn?: number | null;
  l_1stWon?: number | null;
  l_2ndWon?: number | null;
  l_SvGms?: number | null;
  l_bpSaved?: number | null;
  l_bpFaced?: number | null;
  has_stats_bundle?: boolean;
  has_pbp_bundle?: boolean;
}

export interface DailyUpdateResult {
  runId: string;
  status: 'COMPLETED' | 'FAILED';
  matchesProcessed: number;
  matchesInserted: number;
  matchesUpdated: number;
  readyCount: number;
  excludedCount: number;
  affectedPlayersCount: number;
  error?: string;
}

function cleanName(n: string): string {
  return (n || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function normalizeSurf(s?: string): string {
  const norm = (s || '').toLowerCase();
  if (norm.includes('clay')) return 'CLAY';
  if (norm.includes('grass')) return 'GRASS';
  if (norm.includes('carpet') || norm.includes('indoor')) return 'INDOOR';
  if (norm.includes('hard')) return 'HARD';
  return 'UNKNOWN';
}

/**
 * Idempotent daily update service for the Gold Validated Dataset.
 * Upserts matches on conflict(rapid_event_id), validates model-readiness,
 * and incrementally updates the affected players in gold_player_history_3y.
 */
export class GoldDailyUpdateService {
  constructor(private readonly db: Database.Database) {}

  getLastSuccessfulRun(): { run_id: string; finished_at: string } | null {
    const row = this.db
      .prepare(`
        SELECT run_id, finished_at 
        FROM daily_update_state 
        WHERE status = 'COMPLETED' 
        ORDER BY id DESC 
        LIMIT 1
      `)
      .get() as { run_id: string; finished_at: string } | undefined;
    return row || null;
  }

  processDailyBatch(matches: DailyGoldMatchInput[], runType = 'DAILY_INCREMENTAL'): DailyUpdateResult {
    const runId = `daily_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
    const startedAt = new Date().toISOString();

    let inserted = 0;
    let updated = 0;
    let readyCount = 0;
    let excludedCount = 0;
    const affectedPlayers = new Set<string>();

    const checkExistingStmt = this.db.prepare(`
      SELECT rapid_event_id, row_hash, first_seen_at 
      FROM gold_matches_validated 
      WHERE rapid_event_id = ?
    `);

    const upsertStmt = this.db.prepare(`
      INSERT INTO gold_matches_validated (
        rapid_event_id,
        canonical_match_id,
        match_date,
        start_utc,
        tour,
        tourney_name,
        tourney_id,
        surface_raw,
        surface,
        round_name,
        winner_name,
        loser_name,
        winner_id,
        loser_id,
        score,
        winner_rank,
        loser_rank,
        winner_odds,
        loser_odds,
        has_odds,
        has_stats_bundle,
        has_pbp_bundle,
        bundle_storage_path,
        w_svpt, w_1stIn, w_1stWon, w_2ndWon, w_SvGms, w_bpSaved, w_bpFaced,
        l_svpt, l_1stIn, l_1stWon, l_2ndWon, l_SvGms, l_bpSaved, l_bpFaced,
        is_placeholder_serve,
        is_retirement_or_wo,
        is_non_singles,
        is_speculative_draw,
        source_presence,
        has_p1_history,
        has_p2_history,
        p1_prior_matches_count,
        p2_prior_matches_count,
        max_as_of_date,
        is_pit_safe,
        final_status,
        exclusion_reason,
        first_seen_at,
        last_seen_at,
        last_validated_at,
        last_run_id,
        row_hash
      ) VALUES (
        @rapid_event_id,
        @canonical_match_id,
        @match_date,
        @start_utc,
        @tour,
        @tourney_name,
        @tourney_id,
        @surface_raw,
        @surface,
        @round_name,
        @winner_name,
        @loser_name,
        @winner_id,
        @loser_id,
        @score,
        @winner_rank,
        @loser_rank,
        @winner_odds,
        @loser_odds,
        @has_odds,
        @has_stats_bundle,
        @has_pbp_bundle,
        @bundle_storage_path,
        @w_svpt, @w_1stIn, @w_1stWon, @w_2ndWon, @w_SvGms, @w_bpSaved, @w_bpFaced,
        @l_svpt, @l_1stIn, @l_1stWon, @l_2ndWon, @l_SvGms, @l_bpSaved, @l_bpFaced,
        @is_placeholder_serve,
        @is_retirement_or_wo,
        @is_non_singles,
        @is_speculative_draw,
        @source_presence,
        @has_p1_history,
        @has_p2_history,
        @p1_prior_matches_count,
        @p2_prior_matches_count,
        @max_as_of_date,
        @is_pit_safe,
        @final_status,
        @exclusion_reason,
        @first_seen_at,
        @last_seen_at,
        @last_validated_at,
        @last_run_id,
        @row_hash
      )
      ON CONFLICT(rapid_event_id) DO UPDATE SET
        canonical_match_id = excluded.canonical_match_id,
        match_date = excluded.match_date,
        start_utc = excluded.start_utc,
        tourney_name = excluded.tourney_name,
        surface = excluded.surface,
        score = excluded.score,
        winner_rank = excluded.winner_rank,
        loser_rank = excluded.loser_rank,
        winner_odds = excluded.winner_odds,
        loser_odds = excluded.loser_odds,
        has_odds = excluded.has_odds,
        has_stats_bundle = excluded.has_stats_bundle,
        has_pbp_bundle = excluded.has_pbp_bundle,
        w_svpt = excluded.w_svpt,
        w_1stIn = excluded.w_1stIn,
        w_1stWon = excluded.w_1stWon,
        final_status = excluded.final_status,
        exclusion_reason = excluded.exclusion_reason,
        last_seen_at = excluded.last_seen_at,
        last_validated_at = excluded.last_validated_at,
        last_run_id = excluded.last_run_id,
        row_hash = excluded.row_hash
    `);

    const queryPriorHistoryDatesStmt = this.db.prepare(`
      SELECT match_date 
      FROM gold_player_history_3y 
      WHERE clean_player_name = ? AND match_date < ? 
      ORDER BY match_date ASC
    `);

    const insertHistoryEntryStmt = this.db.prepare(`
      INSERT INTO gold_player_history_3y (
        player_name,
        clean_player_name,
        match_date,
        surface,
        won,
        rapid_event_id,
        canonical_match_id,
        opponent_name,
        score,
        is_gold_target_match,
        is_history_only,
        has_serve_stats,
        svpt,
        first_in,
        first_won,
        second_won,
        bp_saved,
        bp_faced,
        created_at
      ) VALUES (
        @player_name,
        @clean_player_name,
        @match_date,
        @surface,
        @won,
        @rapid_event_id,
        @canonical_match_id,
        @opponent_name,
        @score,
        1,
        0,
        @has_serve_stats,
        @svpt,
        @first_in,
        @first_won,
        @second_won,
        @bp_saved,
        @bp_faced,
        @created_at
      )
    `);

    const deleteOldHistoryForEventStmt = this.db.prepare(`
      DELETE FROM gold_player_history_3y WHERE rapid_event_id = ?
    `);

    const runTransaction = this.db.transaction(() => {
      const now = new Date().toISOString();

      for (const m of matches) {
        const rid = m.rapid_event_id;
        const normSurf = normalizeSurf(m.surface_raw);
        const wClean = cleanName(m.winner_name);
        const lClean = cleanName(m.loser_name);

        affectedPlayers.add(wClean);
        affectedPlayers.add(lClean);

        const score = m.score || '';
        const isRetOrWo = /W\/O|RET|DEF|WALKOVER/i.test(score) || !score ? 1 : 0;
        const isPlaceholder = (m.w_svpt === 100 && m.w_1stIn === 0) ? 1 : 0;
        const isNonSingles = (m.winner_name && m.winner_name.includes('/')) || (m.loser_name && m.loser_name.includes('/')) ? 1 : 0;
        const isSpeculative = score === '?-?' ? 1 : 0;

        const hasStats = m.has_stats_bundle ?? (Number(m.w_svpt || 0) > 0);
        const hasPbp = m.has_pbp_bundle ?? false;

        // Query prior dates strictly point-in-time
        const wPrior = (queryPriorHistoryDatesStmt.all(wClean, m.match_date) as Array<{ match_date: string }>).map(r => r.match_date);
        const lPrior = (queryPriorHistoryDatesStmt.all(lClean, m.match_date) as Array<{ match_date: string }>).map(r => r.match_date);

        let maxAsOfDate: string | null = null;
        if (wPrior.length > 0) maxAsOfDate = wPrior[wPrior.length - 1];
        if (lPrior.length > 0) {
          const lMax = lPrior[lPrior.length - 1];
          if (!maxAsOfDate || lMax > maxAsOfDate) maxAsOfDate = lMax;
        }

        const isPitSafe = !maxAsOfDate || maxAsOfDate < m.match_date;

        // Determine Final Status
        let finalStatus: string;
        let exclusionReason = '';

        if (!rid) {
          finalStatus = 'MISSING_ID';
          exclusionReason = 'Rapid event ID is null';
        } else if (!m.match_date || m.match_date < '2024-01-01') {
          finalStatus = 'INVALID_DATE';
          exclusionReason = 'Match date missing or outside 2024+ window';
        } else if (normSurf === 'UNKNOWN') {
          finalStatus = 'INVALID_SURFACE';
          exclusionReason = `Invalid surface: ${m.surface_raw}`;
        } else if (isRetOrWo === 1) {
          finalStatus = 'RETIREMENT_OR_WALKOVER';
          exclusionReason = 'Premature retirement or walkover';
        } else if (isPlaceholder === 1) {
          finalStatus = 'PLACEHOLDER_SERVE';
          exclusionReason = 'Placeholder serve telemetry';
        } else if (!hasStats && !hasPbp) {
          finalStatus = 'MISSING_STATS_AND_PBP';
          exclusionReason = 'Missing statistics and PBP bundles';
        } else if (!hasStats) {
          finalStatus = 'MISSING_STATS';
          exclusionReason = 'Missing statistics bundle';
        } else if (!hasPbp) {
          finalStatus = 'MISSING_PBP';
          exclusionReason = 'Missing point-by-point bundle';
        } else if (!isPitSafe) {
          finalStatus = 'FAILED_PIT';
          exclusionReason = 'Point-in-time leakage';
        } else if (wPrior.length === 0 || lPrior.length === 0) {
          finalStatus = 'MISSING_HISTORY';
          exclusionReason = 'Insufficient pre-match player history';
        } else if (isNonSingles === 1 || isSpeculative === 1) {
          finalStatus = 'OTHER_EXCLUDED';
          exclusionReason = 'Non-singles or speculative fixture';
        } else {
          finalStatus = 'READY';
          exclusionReason = 'Fully validated, complete telemetry, PIT-safe, model-ready';
        }

        if (finalStatus === 'READY') readyCount++;
        else excludedCount++;

        const canonicalMatchId = `cm_${(m.tour || 'ATP').toLowerCase()}_${m.match_date}_${wClean}_${lClean}_b${rid}`;
        const hashPayload = `${rid}|${m.match_date}|${normSurf}|${m.winner_name}|${m.loser_name}|${score}|${hasStats}|${hasPbp}|${finalStatus}`;
        const rowHash = crypto.createHash('sha256').update(hashPayload).digest('hex');

        const existing = checkExistingStmt.get(rid) as { rapid_event_id: number; row_hash: string; first_seen_at: string } | undefined;
        const firstSeen = existing?.first_seen_at || now;

        if (existing) {
          updated++;
        } else {
          inserted++;
        }

        upsertStmt.run({
          rapid_event_id: rid,
          canonical_match_id: canonicalMatchId,
          match_date: m.match_date,
          start_utc: m.start_utc || null,
          tour: (m.tour || 'ATP').toUpperCase(),
          tourney_name: m.tourney_name || 'Tour Tournament',
          tourney_id: m.tourney_id || null,
          surface_raw: m.surface_raw || 'Unknown',
          surface: normSurf,
          round_name: m.round_name || null,
          winner_name: m.winner_name,
          loser_name: m.loser_name,
          winner_id: m.winner_id || null,
          loser_id: m.loser_id || null,
          score,
          winner_rank: m.winner_rank || null,
          loser_rank: m.loser_rank || null,
          winner_odds: m.winner_odds || null,
          loser_odds: m.loser_odds || null,
          has_odds: m.winner_odds && m.loser_odds && m.winner_odds > 1.01 ? 1 : 0,
          has_stats_bundle: hasStats ? 1 : 0,
          has_pbp_bundle: hasPbp ? 1 : 0,
          bundle_storage_path: `data/bulk-match-bundles/events/${rid}`,
          w_svpt: m.w_svpt || null,
          w_1stIn: m.w_1stIn || null,
          w_1stWon: m.w_1stWon || null,
          w_2ndWon: m.w_2ndWon || null,
          w_SvGms: m.w_SvGms || null,
          w_bpSaved: m.w_bpSaved || null,
          w_bpFaced: m.w_bpFaced || null,
          l_svpt: m.l_svpt || null,
          l_1stIn: m.l_1stIn || null,
          l_1stWon: m.l_1stWon || null,
          l_2ndWon: m.l_2ndWon || null,
          l_SvGms: m.l_SvGms || null,
          l_bpSaved: m.l_bpSaved || null,
          l_bpFaced: m.l_bpFaced || null,
          is_placeholder_serve: isPlaceholder,
          is_retirement_or_wo: isRetOrWo,
          is_non_singles: isNonSingles,
          is_speculative_draw: isSpeculative,
          source_presence: 'SOURCE_B_ONLY',
          has_p1_history: wPrior.length > 0 ? 1 : 0,
          has_p2_history: lPrior.length > 0 ? 1 : 0,
          p1_prior_matches_count: wPrior.length,
          p2_prior_matches_count: lPrior.length,
          max_as_of_date: maxAsOfDate,
          is_pit_safe: isPitSafe ? 1 : 0,
          final_status: finalStatus,
          exclusion_reason: exclusionReason,
          first_seen_at: firstSeen,
          last_seen_at: now,
          last_validated_at: now,
          last_run_id: runId,
          row_hash: rowHash,
        });

        // Delete old history entries for this event if it was re-updated
        deleteOldHistoryForEventStmt.run(rid);

        // Insert new history records
        const hasServeStats = Number(m.w_svpt || 0) > 0 && isPlaceholder === 0;
        insertHistoryEntryStmt.run({
          player_name: m.winner_name,
          clean_player_name: wClean,
          match_date: m.match_date,
          surface: normSurf,
          won: 1,
          rapid_event_id: rid,
          canonical_match_id: canonicalMatchId,
          opponent_name: m.loser_name,
          score,
          has_serve_stats: hasServeStats ? 1 : 0,
          svpt: m.w_svpt || 0,
          first_in: m.w_1stIn || 0,
          first_won: m.w_1stWon || 0,
          second_won: m.w_2ndWon || 0,
          bp_saved: m.w_bpSaved || 0,
          bp_faced: m.w_bpFaced || 0,
          created_at: now,
        });

        insertHistoryEntryStmt.run({
          player_name: m.loser_name,
          clean_player_name: lClean,
          match_date: m.match_date,
          surface: normSurf,
          won: 0,
          rapid_event_id: rid,
          canonical_match_id: canonicalMatchId,
          opponent_name: m.winner_name,
          score,
          has_serve_stats: hasServeStats ? 1 : 0,
          svpt: m.l_svpt || 0,
          first_in: m.l_1stIn || 0,
          first_won: m.l_1stWon || 0,
          second_won: m.l_2ndWon || 0,
          bp_saved: m.l_bpSaved || 0,
          bp_faced: m.l_bpFaced || 0,
          created_at: now,
        });
      }

      // Record daily update state
      this.db
        .prepare(`
          INSERT INTO daily_update_state (
            run_id,
            run_type,
            started_at,
            finished_at,
            status,
            matches_fetched,
            matches_inserted,
            matches_updated,
            matches_validated,
            ready_count,
            errors_count,
            log_summary
          ) VALUES (
            @run_id,
            @run_type,
            @started_at,
            @finished_at,
            'COMPLETED',
            @matches_fetched,
            @matches_inserted,
            @matches_updated,
            @matches_validated,
            @ready_count,
            0,
            @log_summary
          )
        `)
        .run({
          run_id: runId,
          run_type: runType,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          matches_fetched: matches.length,
          matches_inserted: inserted,
          matches_updated: updated,
          matches_validated: matches.length,
          ready_count: readyCount,
          log_summary: `Daily batch processed: ${matches.length} matches (${inserted} new, ${updated} updated, ${readyCount} READY). Affected players: ${affectedPlayers.size}.`,
        });
    });

    try {
      runTransaction();
      return {
        runId,
        status: 'COMPLETED',
        matchesProcessed: matches.length,
        matchesInserted: inserted,
        matchesUpdated: updated,
        readyCount,
        excludedCount,
        affectedPlayersCount: affectedPlayers.size,
      };
    } catch (err: any) {
      return {
        runId,
        status: 'FAILED',
        matchesProcessed: matches.length,
        matchesInserted: 0,
        matchesUpdated: 0,
        readyCount: 0,
        excludedCount: 0,
        affectedPlayersCount: 0,
        error: err.message,
      };
    }
  }
}
