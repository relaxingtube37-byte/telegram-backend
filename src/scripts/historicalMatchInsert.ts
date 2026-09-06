import { db } from '../db/connection';
import { matchRichnessScore, namesLikelyMatch, normalizeTourneyName } from './historicalMatchKeys';

export interface HistoricalMatchRecord {
  tour: 'ATP' | 'WTA';
  tourney_id: string;
  tourney_name: string;
  tourney_level: string;
  draw_size: number;
  surface: string;
  match_date: string;
  match_num: number;
  round_name: string;
  winner_id: number;
  winner_seed: number;
  winner_entry: string;
  winner_name: string;
  winner_hand: string;
  winner_ht: number;
  winner_ioc: string;
  winner_age: number;
  winner_rank: number;
  winner_rank_points: number;
  loser_id: number;
  loser_seed: number;
  loser_entry: string;
  loser_name: string;
  loser_hand: string;
  loser_ht: number;
  loser_ioc: string;
  loser_age: number;
  loser_rank: number;
  loser_rank_points: number;
  score: string;
  best_of: number;
  minutes: number;
  w_ace: number;
  w_df: number;
  w_svpt: number;
  w_1stIn: number;
  w_1stWon: number;
  w_2ndWon: number;
  w_SvGms: number;
  w_bpSaved: number;
  w_bpFaced: number;
  l_ace: number;
  l_df: number;
  l_svpt: number;
  l_1stIn: number;
  l_1stWon: number;
  l_2ndWon: number;
  l_SvGms: number;
  l_bpSaved: number;
  l_bpFaced: number;
  w_odds_match?: number | null;
  l_odds_match?: number | null;
  w_odds_set1?: number | null;
  l_odds_set1?: number | null;
  w_serve_won_pct?: number | null;
  l_serve_won_pct?: number | null;
  w_return_won_pct?: number | null;
  l_return_won_pct?: number | null;
  w_bp_won_pct?: number | null;
  l_bp_won_pct?: number | null;
  w_bp_saved_pct?: number | null;
  l_bp_saved_pct?: number | null;
  created_at: string;
  rapid_event_id?: number;
}

export type HistoricalMatchRow = HistoricalMatchRecord & { id: number };

export interface UpsertSummary {
  inserted: number;
  updated: number;
  skipped: number;
}

function withSqlDefaults<T extends HistoricalMatchRecord>(record: T): T {
  return {
    ...record,
    w_odds_match: record.w_odds_match ?? null,
    l_odds_match: record.l_odds_match ?? null,
    w_odds_set1: record.w_odds_set1 ?? null,
    l_odds_set1: record.l_odds_set1 ?? null,
    w_serve_won_pct: record.w_serve_won_pct ?? null,
    l_serve_won_pct: record.l_serve_won_pct ?? null,
    w_return_won_pct: record.w_return_won_pct ?? null,
    l_return_won_pct: record.l_return_won_pct ?? null,
    w_bp_won_pct: record.w_bp_won_pct ?? null,
    l_bp_won_pct: record.l_bp_won_pct ?? null,
    w_bp_saved_pct: record.w_bp_saved_pct ?? null,
    l_bp_saved_pct: record.l_bp_saved_pct ?? null,
    rapid_event_id: record.rapid_event_id,
  };
}

const insertStmt = db.prepare(`
  INSERT INTO historical_matches (
    tour, tourney_id, tourney_name, tourney_level, draw_size, surface, match_date, match_num,
    round_name, winner_id, winner_seed, winner_entry, winner_name, winner_hand, winner_ht, winner_ioc, winner_age, winner_rank, winner_rank_points,
    loser_id, loser_seed, loser_entry, loser_name, loser_hand, loser_ht, loser_ioc, loser_age, loser_rank, loser_rank_points,
    score, best_of, minutes,
    w_ace, w_df, w_svpt, w_1stIn, w_1stWon, w_2ndWon, w_SvGms, w_bpSaved, w_bpFaced,
    l_ace, l_df, l_svpt, l_1stIn, l_1stWon, l_2ndWon, l_SvGms, l_bpSaved, l_bpFaced,
    w_odds_match, l_odds_match, w_odds_set1, l_odds_set1,
    w_serve_won_pct, l_serve_won_pct, w_return_won_pct, l_return_won_pct,
    w_bp_won_pct, l_bp_won_pct, w_bp_saved_pct, l_bp_saved_pct,
    created_at, rapid_event_id
  ) VALUES (
    @tour, @tourney_id, @tourney_name, @tourney_level, @draw_size, @surface, @match_date, @match_num,
    @round_name, @winner_id, @winner_seed, @winner_entry, @winner_name, @winner_hand, @winner_ht, @winner_ioc, @winner_age, @winner_rank, @winner_rank_points,
    @loser_id, @loser_seed, @loser_entry, @loser_name, @loser_hand, @loser_ht, @loser_ioc, @loser_age, @loser_rank, @loser_rank_points,
    @score, @best_of, @minutes,
    @w_ace, @w_df, @w_svpt, @w_1stIn, @w_1stWon, @w_2ndWon, @w_SvGms, @w_bpSaved, @w_bpFaced,
    @l_ace, @l_df, @l_svpt, @l_1stIn, @l_1stWon, @l_2ndWon, @l_SvGms, @l_bpSaved, @l_bpFaced,
    @w_odds_match, @l_odds_match, @w_odds_set1, @l_odds_set1,
    @w_serve_won_pct, @l_serve_won_pct, @w_return_won_pct, @l_return_won_pct,
    @w_bp_won_pct, @l_bp_won_pct, @w_bp_saved_pct, @l_bp_saved_pct,
    @created_at, @rapid_event_id
  )
`);

const updateStmt = db.prepare(`
  UPDATE historical_matches SET
    tourney_id = @tourney_id,
    tourney_name = @tourney_name,
    tourney_level = @tourney_level,
    draw_size = @draw_size,
    surface = @surface,
    match_num = @match_num,
    round_name = @round_name,
    winner_id = @winner_id,
    winner_seed = @winner_seed,
    winner_entry = @winner_entry,
    winner_hand = @winner_hand,
    winner_ht = @winner_ht,
    winner_ioc = @winner_ioc,
    winner_age = @winner_age,
    winner_rank = @winner_rank,
    winner_rank_points = @winner_rank_points,
    loser_id = @loser_id,
    loser_seed = @loser_seed,
    loser_entry = @loser_entry,
    loser_hand = @loser_hand,
    loser_ht = @loser_ht,
    loser_ioc = @loser_ioc,
    loser_age = @loser_age,
    loser_rank = @loser_rank,
    loser_rank_points = @loser_rank_points,
    score = @score,
    best_of = @best_of,
    minutes = @minutes,
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
    w_odds_match = @w_odds_match,
    l_odds_match = @l_odds_match,
    w_odds_set1 = @w_odds_set1,
    l_odds_set1 = @l_odds_set1,
    w_serve_won_pct = @w_serve_won_pct,
    l_serve_won_pct = @l_serve_won_pct,
    w_return_won_pct = @w_return_won_pct,
    l_return_won_pct = @l_return_won_pct,
    w_bp_won_pct = @w_bp_won_pct,
    l_bp_won_pct = @l_bp_won_pct,
    w_bp_saved_pct = @w_bp_saved_pct,
    l_bp_saved_pct = @l_bp_saved_pct,
    rapid_event_id = COALESCE(@rapid_event_id, rapid_event_id)
  WHERE id = @id
`);

const findStrictStmt = db.prepare(`
  SELECT * FROM historical_matches
  WHERE tour = @tour
    AND match_date = @match_date
    AND winner_name = @winner_name
    AND loser_name = @loser_name
    AND lower(trim(tourney_name)) = @tourney_name_norm
  LIMIT 1
`);

const findLooseStmt = db.prepare(`
  SELECT * FROM historical_matches
  WHERE tour = @tour
    AND match_date = @match_date
    AND winner_name = @winner_name
    AND loser_name = @loser_name
  LIMIT 1
`);

const findByRapidEventStmt = db.prepare(`
  SELECT * FROM historical_matches WHERE rapid_event_id = @rapid_event_id LIMIT 1
`);

function sameMatchPlayers(
  a: Pick<HistoricalMatchRecord, 'winner_name' | 'loser_name'>,
  b: Pick<HistoricalMatchRecord, 'winner_name' | 'loser_name'>,
): boolean {
  return (
    namesLikelyMatch(a.winner_name, b.winner_name) && namesLikelyMatch(a.loser_name, b.loser_name)
  );
}

function findFuzzyMatchOnDate(record: HistoricalMatchRecord): HistoricalMatchRow | null {
  const candidates = db
    .prepare(
      `
    SELECT * FROM historical_matches
    WHERE tour = @tour AND match_date = @match_date
    LIMIT 300
  `,
    )
    .all({ tour: record.tour, match_date: record.match_date }) as HistoricalMatchRow[];

  for (const row of candidates) {
    if (sameMatchPlayers(row, record)) return row;
  }
  return null;
}

function findExistingMatch(record: HistoricalMatchRecord): HistoricalMatchRow | null {
  if (record.rapid_event_id) {
    const byEvent = findByRapidEventStmt.get({ rapid_event_id: record.rapid_event_id }) as
      | HistoricalMatchRow
      | undefined;
    if (byEvent) return byEvent;
  }

  const strict = findStrictStmt.get({
    tour: record.tour,
    match_date: record.match_date,
    winner_name: record.winner_name,
    loser_name: record.loser_name,
    tourney_name_norm: normalizeTourneyName(record.tourney_name),
  }) as HistoricalMatchRow | undefined;

  if (strict) return strict;

  return (
    (findLooseStmt.get({
      tour: record.tour,
      match_date: record.match_date,
      winner_name: record.winner_name,
      loser_name: record.loser_name,
    }) as HistoricalMatchRow | undefined) || findFuzzyMatchOnDate(record)
  );
}

export function insertHistoricalMatchRecords(records: HistoricalMatchRecord[]): number {
  const summary = upsertHistoricalMatchRecords(records);
  return summary.inserted + summary.updated;
}

export function upsertHistoricalMatchRecords(records: HistoricalMatchRecord[]): UpsertSummary {
  const summary: UpsertSummary = { inserted: 0, updated: 0, skipped: 0 };

  const upsertTransaction = db.transaction((rows: HistoricalMatchRecord[]) => {
    for (const record of rows) {
      const existing = findExistingMatch(record);
      if (!existing) {
        insertStmt.run(withSqlDefaults(record));
        summary.inserted++;
        continue;
      }

      const oldScore = matchRichnessScore(existing);
      const newScore = matchRichnessScore(record);
      const enrichesMissing =
        (record.w_odds_match != null && existing.w_odds_match == null) ||
        (record.w_serve_won_pct != null && existing.w_serve_won_pct == null) ||
        (record.winner_rank > 0 && existing.winner_rank === 0) ||
        (record.loser_rank > 0 && existing.loser_rank === 0);
      if (newScore > oldScore || enrichesMissing) {
        updateStmt.run(withSqlDefaults({ ...existing, ...record, id: existing.id }));
        summary.updated++;
      } else {
        summary.skipped++;
      }
    }
  });

  upsertTransaction(records);
  return summary;
}

export function patchHistoricalMatchStats(id: number, patch: Partial<HistoricalMatchRecord>): boolean {
  const existing = db.prepare('SELECT * FROM historical_matches WHERE id = ?').get(id) as HistoricalMatchRow | undefined;
  if (!existing) return false;

  const merged = { ...existing, ...patch, id: existing.id, created_at: existing.created_at };
  if (matchRichnessScore(merged) <= matchRichnessScore(existing)) return false;

  updateStmt.run(withSqlDefaults(merged));
  return true;
}

/** Fill only empty odds/rank fields — used by incremental API enrichment. */
export function patchHistoricalMatchGaps(id: number, patch: Partial<HistoricalMatchRecord>): boolean {
  const existing = db.prepare('SELECT * FROM historical_matches WHERE id = ?').get(id) as HistoricalMatchRow | undefined;
  if (!existing) return false;

  const merged: HistoricalMatchRow = { ...existing };
  let changed = false;

  const fillRank = (key: 'winner_rank' | 'loser_rank', value: number | undefined) => {
    if (!value || value <= 0 || merged[key] > 0) return;
    merged[key] = value;
    changed = true;
  };

  const fillOdds = (key: 'w_odds_match' | 'l_odds_match' | 'w_odds_set1' | 'l_odds_set1', value: number | null | undefined) => {
    if (value == null || value <= 0) return;
    const cur = merged[key];
    if (cur != null && cur > 0) return;
    merged[key] = value;
    changed = true;
  };

  fillRank('winner_rank', patch.winner_rank);
  fillRank('loser_rank', patch.loser_rank);
  fillOdds('w_odds_match', patch.w_odds_match);
  fillOdds('l_odds_match', patch.l_odds_match);
  fillOdds('w_odds_set1', patch.w_odds_set1);
  fillOdds('l_odds_set1', patch.l_odds_set1);

  if (patch.rapid_event_id && !merged.rapid_event_id) {
    merged.rapid_event_id = patch.rapid_event_id;
    changed = true;
  }

  if (!changed) return false;
  updateStmt.run(withSqlDefaults(merged));
  return true;
}

/** Remove duplicate match rows; keeps the row with the richest stats. */
export function removeDuplicateHistoricalMatches(): number {
  const before = db.prepare('SELECT COUNT(*) as c FROM historical_matches').get() as { c: number };

  db.prepare(
    `
    DELETE FROM historical_matches
    WHERE id IN (
      SELECT id FROM (
        SELECT id,
          ROW_NUMBER() OVER (
            PARTITION BY tour, match_date, winner_name, loser_name, lower(trim(tourney_name))
            ORDER BY (w_svpt + l_svpt + minutes + w_ace + winner_rank + loser_rank) DESC, id ASC
          ) AS rn
        FROM historical_matches
      )
      WHERE rn > 1
    )
  `,
  ).run();

  const after = db.prepare('SELECT COUNT(*) as c FROM historical_matches').get() as { c: number };
  return before.c - after.c;
}

export function listSparseHistoricalMatches(options?: {
  tour?: 'ATP' | 'WTA';
  sinceDate?: string;
  limit?: number;
}): HistoricalMatchRow[] {
  const sinceDate = options?.sinceDate || '2024-01-01';
  const limit = options?.limit || 200;
  const tourClause = options?.tour ? 'AND tour = @tour' : '';

  return db
    .prepare(
      `
    SELECT * FROM historical_matches
    WHERE match_date >= @sinceDate
      AND (w_svpt IS NULL OR w_svpt = 0)
      ${tourClause}
    ORDER BY match_date DESC
    LIMIT @limit
  `,
    )
    .all({ sinceDate, limit, tour: options?.tour }) as HistoricalMatchRow[];
}
