import { db } from '../db/connection';
import fs from 'node:fs';
import path from 'node:path';

const EVENTS_INDEX_PATH = path.resolve('./data/bulk-match-bundles/indexes/events-index.json');

function cleanPlayerNameForId(name: string): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

async function buildCanonicalMatches(): Promise<void> {
  console.log('══════════════════════════════════════════════════════════════');
  console.log(' BUILDING UNIFIED CANONICAL MATCH LAYER (canonical_matches)');
  console.log('══════════════════════════════════════════════════════════════\n');

  // Check if events-index.json exists
  if (!fs.existsSync(EVENTS_INDEX_PATH)) {
    throw new Error(`Master events index not found at ${EVENTS_INDEX_PATH}`);
  }

  console.log('Loading Source B events index from disk...');
  const eventsIndexData = JSON.parse(fs.readFileSync(EVENTS_INDEX_PATH, 'utf8')) as {
    events: any[];
  };
  const sourceBEventMap = new Map<number, any>();
  for (const ev of eventsIndexData.events) {
    sourceBEventMap.set(ev.rapid_event_id, ev);
  }
  console.log(`Loaded ${sourceBEventMap.size} Source B events.`);

  // Load dry-run mapping if available to get join methods and confidence scores
  const dryRunMappingPath = path.resolve('./scratch/dry-run-mapping.json');
  const mappingByHistId = new Map<number, any>();
  if (fs.existsSync(dryRunMappingPath)) {
    console.log('Loading dry-run mapping for join confidence scores...');
    const mappingArray = JSON.parse(fs.readFileSync(dryRunMappingPath, 'utf8')) as any[];
    for (const m of mappingArray) {
      if (m.historical_match_id && m.matched_rapid_event_id) {
        mappingByHistId.set(m.historical_match_id, m);
      }
    }
    console.log(`Loaded join mapping for ${mappingByHistId.size} historical matches.`);
  }

  // Clear existing canonical_matches before rebuilding
  console.log('Resetting canonical_matches table...');
  db.exec('DELETE FROM canonical_matches');

  // Prepared insert statement
  const insertStmt = db.prepare(`
    INSERT INTO canonical_matches (
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
      updated_at
    ) VALUES (
      @canonical_match_id,
      @canonical_match_date,
      @canonical_start_utc,
      @tour,
      @tourney_name,
      @tourney_level,
      @surface,
      @round_name,
      @canonical_winner_name,
      @canonical_loser_name,
      @score,
      @minutes,
      @source_a_historical_match_id,
      @source_b_rapid_event_id,
      @source_presence,
      @join_confidence,
      @join_confidence_score,
      @join_method,
      @data_source_stats,
      @data_source_pbp,
      @data_source_odds,
      @bundle_storage_path,
      @w_odds_match,
      @l_odds_match,
      @w_odds_set1,
      @l_odds_set1,
      @winner_rank,
      @loser_rank,
      @winner_rank_points,
      @loser_rank_points,
      @winner_ht,
      @loser_ht,
      @winner_age,
      @loser_age,
      @winner_ioc,
      @loser_ioc,
      @winner_hand,
      @loser_hand,
      @winner_seed,
      @loser_seed,
      @winner_entry,
      @loser_entry,
      @w_ace,
      @w_df,
      @w_svpt,
      @w_1stIn,
      @w_1stWon,
      @w_2ndWon,
      @w_SvGms,
      @w_bpSaved,
      @w_bpFaced,
      @l_ace,
      @l_df,
      @l_svpt,
      @l_1stIn,
      @l_1stWon,
      @l_2ndWon,
      @l_SvGms,
      @l_bpSaved,
      @l_bpFaced,
      @w_serve_won_pct,
      @l_serve_won_pct,
      @w_return_won_pct,
      @l_return_won_pct,
      @w_bp_won_pct,
      @l_bp_won_pct,
      @w_bp_saved_pct,
      @l_bp_saved_pct,
      @is_placeholder_serve,
      @is_retirement_or_wo,
      @is_non_singles,
      @is_speculative_draw,
      @is_canonical_modeling_usable,
      @is_backtest_safe,
      @canonical_status_reason,
      @created_at,
      @updated_at
    )
  `);

  // STEP 1: Process all historical_matches (Source A)
  console.log('\n--- STEP 1: INGESTING SOURCE A MATCHES & JOINING VERIFIED SOURCE B BUNDLES ---');
  const histMatches = db
    .prepare(
      `
    SELECT * FROM historical_matches ORDER BY id ASC
  `,
    )
    .all() as any[];
  console.log(`Loaded ${histMatches.length} matches from historical_matches.`);

  const usedSourceBIds = new Set<number>();
  const nowIso = new Date().toISOString();

  let sourceAOnlyCount = 0;
  let bothSourcesCount = 0;

  const insertBatch = db.transaction((rows: any[]) => {
    for (const r of rows) {
      insertStmt.run(r);
    }
  });

  const batchSize = 1000;
  let currentBatch: any[] = [];

  for (let i = 0; i < histMatches.length; i++) {
    const h = histMatches[i];

    // Check if this match has a verified Source B event
    let rapidEventId: number | null = null;
    let bEvent: any = null;

    if (h.rapid_event_id && sourceBEventMap.has(Number(h.rapid_event_id))) {
      rapidEventId = Number(h.rapid_event_id);
      bEvent = sourceBEventMap.get(rapidEventId);
    }

    const mapItem = mappingByHistId.get(h.id);
    if (!rapidEventId && mapItem && mapItem.rapid_event_id && sourceBEventMap.has(Number(mapItem.rapid_event_id))) {
      rapidEventId = Number(mapItem.rapid_event_id);
      bEvent = sourceBEventMap.get(rapidEventId);
    }

    const hasSourceB = rapidEventId != null && bEvent != null;
    if (hasSourceB) {
      usedSourceBIds.add(rapidEventId!);
      bothSourcesCount++;
    } else {
      sourceAOnlyCount++;
    }

    // Determine canonical identity & names
    const winnerClean = cleanPlayerNameForId(bEvent?.winner_name || h.winner_name);
    const loserClean = cleanPlayerNameForId(bEvent?.loser_name || h.loser_name);
    const canonicalMatchId = `cm_${(h.tour || 'TEN').toLowerCase()}_${h.match_date}_${winnerClean}_${loserClean}_h${h.id}`;

    const canonicalWinnerName = bEvent?.winner_name || h.winner_name;
    const canonicalLoserName = bEvent?.loser_name || h.loser_name;
    const canonicalDate = bEvent?.match_date || h.match_date;
    const canonicalStartUtc = bEvent?.start_utc || null;

    // Quality flags
    const isRetOrWo = !h.score || /W\/O|RET|DEF|WALKOVER/i.test(h.score) || h.score.trim() === '' ? 1 : 0;
    const isNonSingles = (h.winner_name && h.winner_name.includes('/')) || (h.loser_name && h.loser_name.includes('/')) ? 1 : 0;
    const isSpeculative = h.match_date >= '2026-08-28' && !hasSourceB ? 1 : 0;
    const isPlaceholder = (h.w_svpt === 100 && h.w_1stIn === 0) || (!hasSourceB && (h.w_svpt == null || h.w_svpt === 0)) ? 1 : 0;

    // Join confidence & method
    let joinConfidence = 'UNMATCHED';
    let joinConfidenceScore = 0.0;
    let joinMethod = 'none';

    if (hasSourceB) {
      if (mapItem) {
        joinConfidence = mapItem.confidence_score >= 0.98 ? 'HIGH_DETERMINISTIC_SCORE' : 'HIGH_NAME_DATE_WINDOW';
        joinConfidenceScore = mapItem.confidence_score || 0.95;
        joinMethod = mapItem.match_method || 'mapped_join';
      } else {
        joinConfidence = 'HIGH_DIRECT_ID';
        joinConfidenceScore = 1.0;
        joinMethod = 'direct_rapid_event_id';
      }
    }

    // Provenance
    const sourcePresence = hasSourceB ? 'BOTH_SOURCES' : 'SOURCE_A_ONLY';
    const dataSourceStats = hasSourceB && bEvent.has_statistics ? 'rapidapi_bundle' : isPlaceholder ? 'placeholder_stats' : 'csv_official';
    const dataSourcePbp = hasSourceB && bEvent.has_pbp ? 'rapidapi_bundle' : 'none';
    const dataSourceOdds = h.w_odds_match > 1.01 ? 'historical_bet365_csv' : 'none';
    const bundleStoragePath = hasSourceB ? `data/bulk-match-bundles/events/${rapidEventId}` : null;

    // Usability flags
    const isModelingUsable =
      sourcePresence === 'BOTH_SOURCES' && isRetOrWo === 0 && isPlaceholder === 0 && isNonSingles === 0 && (h.w_svpt || 0) > 0 ? 1 : 0;

    const isBacktestSafe =
      isModelingUsable === 1 &&
      (h.w_odds_match || 0) > 1.01 &&
      (h.l_odds_match || 0) > 1.01 &&
      (h.winner_rank || 0) >= 1 &&
      (h.winner_rank || 0) <= 100 &&
      (h.loser_rank || 0) >= 1 &&
      (h.loser_rank || 0) <= 100 &&
      canonicalDate >= '2024-01-01'
        ? 1
        : 0;

    let canonicalStatusReason = 'APPROVED_CANONICAL';
    if (isRetOrWo === 1) canonicalStatusReason = 'EXCLUDED_RETIREMENT_OR_WALKOVER';
    else if (isSpeculative === 1) canonicalStatusReason = 'EXCLUDED_SPECULATIVE_DRAW';
    else if (sourcePresence !== 'BOTH_SOURCES') canonicalStatusReason = 'EXCLUDED_NO_API_BUNDLE';
    else if (isPlaceholder === 1) canonicalStatusReason = 'EXCLUDED_PLACEHOLDER_SERVE';
    else if (isNonSingles === 1) canonicalStatusReason = 'EXCLUDED_NON_SINGLES';

    // Surface normalizer
    let surfaceNorm = h.surface || 'Unknown';
    const sLower = (h.surface || '').toLowerCase();
    if (sLower.includes('clay')) surfaceNorm = 'Clay';
    else if (sLower.includes('grass')) surfaceNorm = 'Grass';
    else if (sLower.includes('carpet') || sLower.includes('indoor')) surfaceNorm = 'Carpet/Indoor';
    else if (sLower.includes('hard')) surfaceNorm = 'Hard';

    currentBatch.push({
      canonical_match_id: canonicalMatchId,
      canonical_match_date: canonicalDate,
      canonical_start_utc: canonicalStartUtc,
      tour: h.tour || 'ATP',
      tourney_name: h.tourney_name,
      tourney_level: h.tourney_level || null,
      surface: surfaceNorm,
      round_name: h.round_name || null,
      canonical_winner_name: canonicalWinnerName,
      canonical_loser_name: canonicalLoserName,
      score: h.score,
      minutes: h.minutes || null,
      source_a_historical_match_id: h.id,
      source_b_rapid_event_id: rapidEventId,
      source_presence: sourcePresence,
      join_confidence: joinConfidence,
      join_confidence_score: joinConfidenceScore,
      join_method: joinMethod,
      data_source_stats: dataSourceStats,
      data_source_pbp: dataSourcePbp,
      data_source_odds: dataSourceOdds,
      bundle_storage_path: bundleStoragePath,
      w_odds_match: h.w_odds_match || null,
      l_odds_match: h.l_odds_match || null,
      w_odds_set1: h.w_odds_set1 || null,
      l_odds_set1: h.l_odds_set1 || null,
      winner_rank: h.winner_rank || null,
      loser_rank: h.loser_rank || null,
      winner_rank_points: h.winner_rank_points || null,
      loser_rank_points: h.loser_rank_points || null,
      winner_ht: h.winner_ht || null,
      loser_ht: h.loser_ht || null,
      winner_age: h.winner_age || null,
      loser_age: h.loser_age || null,
      winner_ioc: h.winner_ioc || null,
      loser_ioc: h.loser_ioc || null,
      winner_hand: h.winner_hand || null,
      loser_hand: h.loser_hand || null,
      winner_seed: h.winner_seed || null,
      loser_seed: h.loser_seed || null,
      winner_entry: h.winner_entry || null,
      loser_entry: h.loser_entry || null,
      w_ace: h.w_ace != null ? h.w_ace : null,
      w_df: h.w_df != null ? h.w_df : null,
      w_svpt: h.w_svpt != null ? h.w_svpt : null,
      w_1stIn: h.w_1stIn != null ? h.w_1stIn : null,
      w_1stWon: h.w_1stWon != null ? h.w_1stWon : null,
      w_2ndWon: h.w_2ndWon != null ? h.w_2ndWon : null,
      w_SvGms: h.w_SvGms != null ? h.w_SvGms : null,
      w_bpSaved: h.w_bpSaved != null ? h.w_bpSaved : null,
      w_bpFaced: h.w_bpFaced != null ? h.w_bpFaced : null,
      l_ace: h.l_ace != null ? h.l_ace : null,
      l_df: h.l_df != null ? h.l_df : null,
      l_svpt: h.l_svpt != null ? h.l_svpt : null,
      l_1stIn: h.l_1stIn != null ? h.l_1stIn : null,
      l_1stWon: h.l_1stWon != null ? h.l_1stWon : null,
      l_2ndWon: h.l_2ndWon != null ? h.l_2ndWon : null,
      l_SvGms: h.l_SvGms != null ? h.l_SvGms : null,
      l_bpSaved: h.l_bpSaved != null ? h.l_bpSaved : null,
      l_bpFaced: h.l_bpFaced != null ? h.l_bpFaced : null,
      w_serve_won_pct: h.w_serve_won_pct || null,
      l_serve_won_pct: h.l_serve_won_pct || null,
      w_return_won_pct: h.w_return_won_pct || null,
      l_return_won_pct: h.l_return_won_pct || null,
      w_bp_won_pct: h.w_bp_won_pct || null,
      l_bp_won_pct: h.l_bp_won_pct || null,
      w_bp_saved_pct: h.w_bp_saved_pct || null,
      l_bp_saved_pct: h.l_bp_saved_pct || null,
      is_placeholder_serve: isPlaceholder,
      is_retirement_or_wo: isRetOrWo,
      is_non_singles: isNonSingles,
      is_speculative_draw: isSpeculative,
      is_canonical_modeling_usable: isModelingUsable,
      is_backtest_safe: isBacktestSafe,
      canonical_status_reason: canonicalStatusReason,
      created_at: nowIso,
      updated_at: nowIso,
    });

    if (currentBatch.length >= batchSize) {
      insertBatch(currentBatch);
      currentBatch = [];
    }
  }

  if (currentBatch.length > 0) {
    insertBatch(currentBatch);
    currentBatch = [];
  }

  console.log(`Source A processing complete: ${bothSourcesCount} joined to Source B, ${sourceAOnlyCount} Source A only.`);

  // STEP 2: Ingest standalone Source B matches (events without Source A match)
  console.log('\n--- STEP 2: INGESTING STANDALONE SOURCE B MATCHES (CHALLENGER / PRELIMINARY) ---');
  let sourceBOnlyCount = 0;

  for (const ev of eventsIndexData.events) {
    if (usedSourceBIds.has(ev.rapid_event_id)) continue;

    sourceBOnlyCount++;

    const winnerClean = cleanPlayerNameForId(ev.winner_name || 'winner');
    const loserClean = cleanPlayerNameForId(ev.loser_name || 'loser');
    const canonicalMatchId = `cm_${(ev.tour || 'TEN').toLowerCase()}_${ev.match_date}_${winnerClean}_${loserClean}_b${ev.rapid_event_id}`;

    let surfaceNorm = ev.surface || 'Unknown';
    const sLower = (ev.surface || '').toLowerCase();
    if (sLower.includes('clay')) surfaceNorm = 'Clay';
    else if (sLower.includes('grass')) surfaceNorm = 'Grass';
    else if (sLower.includes('carpet') || sLower.includes('indoor')) surfaceNorm = 'Carpet/Indoor';
    else if (sLower.includes('hard')) surfaceNorm = 'Hard';

    const isRetOrWo = !ev.score || /W\/O|RET|DEF|WALKOVER/i.test(ev.score) || ev.score.trim() === '' ? 1 : 0;
    const isNonSingles = (ev.winner_name && ev.winner_name.includes('/')) || (ev.loser_name && ev.loser_name.includes('/')) ? 1 : 0;

    currentBatch.push({
      canonical_match_id: canonicalMatchId,
      canonical_match_date: ev.match_date,
      canonical_start_utc: ev.start_utc || null,
      tour: ev.tour || 'ATP',
      tourney_name: ev.tourney_name || 'Unknown Tournament',
      tourney_level: 'Challenger/ITF',
      surface: surfaceNorm,
      round_name: null,
      canonical_winner_name: ev.winner_name || 'Unknown',
      canonical_loser_name: ev.loser_name || 'Unknown',
      score: ev.score || '',
      minutes: null,
      source_a_historical_match_id: null,
      source_b_rapid_event_id: ev.rapid_event_id,
      source_presence: 'SOURCE_B_ONLY',
      join_confidence: 'UNMATCHED',
      join_confidence_score: 0.0,
      join_method: 'none',
      data_source_stats: ev.has_statistics ? 'rapidapi_bundle' : 'none',
      data_source_pbp: ev.has_pbp ? 'rapidapi_bundle' : 'none',
      data_source_odds: 'none',
      bundle_storage_path: `data/bulk-match-bundles/events/${ev.rapid_event_id}`,
      w_odds_match: null,
      l_odds_match: null,
      w_odds_set1: null,
      l_odds_set1: null,
      winner_rank: null,
      loser_rank: null,
      winner_rank_points: null,
      loser_rank_points: null,
      winner_ht: null,
      loser_ht: null,
      winner_age: null,
      loser_age: null,
      winner_ioc: null,
      loser_ioc: null,
      winner_hand: null,
      loser_hand: null,
      winner_seed: null,
      loser_seed: null,
      winner_entry: null,
      loser_entry: null,
      w_ace: null,
      w_df: null,
      w_svpt: null,
      w_1stIn: null,
      w_1stWon: null,
      w_2ndWon: null,
      w_SvGms: null,
      w_bpSaved: null,
      w_bpFaced: null,
      l_ace: null,
      l_df: null,
      l_svpt: null,
      l_1stIn: null,
      l_1stWon: null,
      l_2ndWon: null,
      l_SvGms: null,
      l_bpSaved: null,
      l_bpFaced: null,
      w_serve_won_pct: null,
      l_serve_won_pct: null,
      w_return_won_pct: null,
      l_return_won_pct: null,
      w_bp_won_pct: null,
      l_bp_won_pct: null,
      w_bp_saved_pct: null,
      l_bp_saved_pct: null,
      is_placeholder_serve: 0,
      is_retirement_or_wo: isRetOrWo,
      is_non_singles: isNonSingles,
      is_speculative_draw: 0,
      is_canonical_modeling_usable: 0, // standalone Source B lack Source A closing odds/ranks
      is_backtest_safe: 0,
      canonical_status_reason: 'EXCLUDED_SOURCE_B_ONLY',
      created_at: nowIso,
      updated_at: nowIso,
    });

    if (currentBatch.length >= batchSize) {
      insertBatch(currentBatch);
      currentBatch = [];
    }
  }

  if (currentBatch.length > 0) {
    insertBatch(currentBatch);
    currentBatch = [];
  }

  console.log(`Standalone Source B matches ingested: ${sourceBOnlyCount}.`);

  // STEP 3: Post-population audit
  console.log('\n--- STEP 3: POST-POPULATION INTEGRITY AUDIT ---');
  const auditCounts = db
    .prepare(
      `
    SELECT 
      COUNT(*) as total_canonical_matches,
      SUM(CASE WHEN source_presence = 'BOTH_SOURCES' THEN 1 ELSE 0 END) as both_sources_count,
      SUM(CASE WHEN source_presence = 'SOURCE_A_ONLY' THEN 1 ELSE 0 END) as source_a_only_count,
      SUM(CASE WHEN source_presence = 'SOURCE_B_ONLY' THEN 1 ELSE 0 END) as source_b_only_count,
      SUM(CASE WHEN is_canonical_modeling_usable = 1 THEN 1 ELSE 0 END) as modeling_usable_count,
      SUM(CASE WHEN is_backtest_safe = 1 THEN 1 ELSE 0 END) as backtest_safe_count,
      SUM(CASE WHEN w_odds_match IS NOT NULL AND w_odds_match > 1.01 THEN 1 ELSE 0 END) as valid_odds_preserved
    FROM canonical_matches
  `,
    )
    .get();

  console.log('Audit Results:', auditCounts);
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(' CANONICAL MATCHES LAYER COMPLETED SUCCESSFULLY');
  console.log('══════════════════════════════════════════════════════════════');
}

buildCanonicalMatches().catch(err => {
  console.error('Error building canonical matches:', err);
  process.exit(1);
});
