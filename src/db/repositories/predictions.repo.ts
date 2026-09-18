import { db } from '../connection';
import type { Prediction } from '../../types';

function parseJsonField<T = any>(val: any, fallbackToEnObject = true): T | undefined {
  if (val === null || val === undefined) return undefined;
  if (typeof val === 'object') return val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        return JSON.parse(trimmed);
      } catch {}
    }
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const arr = JSON.parse(trimmed);
        return (fallbackToEnObject ? { en: arr } : arr) as any;
      } catch {}
    }
    if (fallbackToEnObject && trimmed.length > 0) {
      return { en: trimmed } as any;
    }
  }
  return val;
}

function serializeJsonField(val: any): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'object') return JSON.stringify(val);
  if (typeof val === 'string') return val;
  return String(val);
}

function mapRow(row: any): Prediction | null {
  if (!row) return null;
  return {
    ...row,
    gender: row.gender || undefined,
    tour_category: row.tour_category || undefined,
    key_factors: parseJsonField(row.key_factors, true) ?? { en: [] },
    ai_summary: parseJsonField(row.ai_summary, true) ?? undefined,
    devils_advocate_risk: parseJsonField(row.devils_advocate_risk, true) ?? undefined,
    best_bet_rationale: parseJsonField(row.best_bet_rationale, true) ?? undefined,
    alt_bet_rationale: parseJsonField(row.alt_bet_rationale, true) ?? undefined,
  };
}

export const PredictionsRepo = {
  getAll: (limit = 500): Prediction[] => {
    return db.prepare('SELECT * FROM predictions ORDER BY published_at DESC LIMIT ?').all(limit).map(mapRow) as Prediction[];
  },

  getActive: (): Prediction[] => {
    return db.prepare("SELECT * FROM predictions WHERE status = 'UPCOMING' OR status = 'LIVE' OR status = 'INTERRUPTED' ORDER BY match_date ASC, published_at DESC").all().map(mapRow) as Prediction[];
  },

  getHistory: (limit = 50): Prediction[] => {
    return db.prepare("SELECT * FROM predictions WHERE status = 'WON' OR status = 'LOST' OR status = 'VOID' OR status = 'INTERRUPTED' ORDER BY published_at DESC LIMIT ?").all(limit).map(mapRow) as Prediction[];
  },

  getById: (id: number): Prediction | null => {
    return mapRow(db.prepare('SELECT * FROM predictions WHERE id = ?').get(id));
  },

  getByFixtureId: (fixtureId: number): Prediction | null => {
    return mapRow(db.prepare('SELECT * FROM predictions WHERE fixture_id = ?').get(fixtureId));
  },

  findActiveByTeams: (home: string, away: string): Prediction | null => {
    return mapRow(db.prepare(`
      SELECT * FROM predictions
      WHERE (lower(home_name) = lower(?) AND lower(away_name) = lower(?))
         OR (lower(home_name) LIKE lower(?) AND lower(away_name) LIKE lower(?))
      ORDER BY id DESC
      LIMIT 1
    `).get(home, away, `%${home}%`, `%${away}%`));
  },

  backfillMissingGenders: (): number => {
    try {
      const rows = db.prepare("SELECT id, tournament_name, round_name, home_name, away_name FROM predictions WHERE gender IS NULL OR gender = ''").all() as any[];
      if (!rows || rows.length === 0) return 0;

      const updateStmt = db.prepare('UPDATE predictions SET gender = ?, tour_category = COALESCE(tour_category, ?) WHERE id = ?');
      let count = 0;
      for (const row of rows) {
        const text = `${row.tournament_name || ''} ${row.round_name || ''} ${row.home_name || ''} ${row.away_name || ''}`.toLowerCase();
        const isWomen =
          text.includes('wta') ||
          text.includes('women') ||
          text.includes('ladies') ||
          text.includes('bjk') ||
          text.includes('billie jean king') ||
          text.includes('girls') ||
          text.includes('guadalajara') ||
          text.includes('sao paulo') ||
          text.includes('monastir') ||
          text.includes('caldas da rainha') ||
          /\bw(15|25|35|50|75|100)\b/.test(text);

        const g = isWomen ? 'women' : 'men';
        const tour = isWomen ? (text.includes('125') ? 'WTA125' : 'WTA') : (text.includes('challenger') ? 'CHALLENGER' : 'ATP');
        updateStmt.run(g, tour, row.id);
        count++;
      }
      return count;
    } catch {
      return 0;
    }
  },

  create: (p: Prediction): number => {
    if (p.fixture_id) {
      const existing = PredictionsRepo.getByFixtureId(p.fixture_id);
      if (existing) {
        const updateStmt = db.prepare(`
          UPDATE predictions SET
            tournament_name = COALESCE(?, tournament_name),
            round_name = COALESCE(?, round_name),
            surface = COALESCE(?, surface),
            match_date = COALESCE(?, match_date),
            home_name = ?,
            away_name = ?,
            gender = COALESCE(?, gender),
            tour_category = COALESCE(?, tour_category),
            home_odds = COALESCE(?, home_odds),
            away_odds = COALESCE(?, away_odds),
            predicted_winner = ?,
            win_probability = ?,
            confidence = ?,
            predicted_score = COALESCE(?, predicted_score),
            best_bet_selection = COALESCE(?, best_bet_selection),
            best_bet_market = COALESCE(?, best_bet_market),
            best_bet_ev = COALESCE(?, best_bet_ev),
            best_bet_rationale = COALESCE(?, best_bet_rationale),
            alt_bet_selection = COALESCE(?, alt_bet_selection),
            alt_bet_market = COALESCE(?, alt_bet_market),
            alt_bet_rationale = COALESCE(?, alt_bet_rationale),
            key_factors = COALESCE(?, key_factors),
            devils_advocate_risk = COALESCE(?, devils_advocate_risk),
            ai_summary = COALESCE(?, ai_summary),
            home_image = COALESCE(?, home_image),
            away_image = COALESCE(?, away_image),
            home_id = COALESCE(?, home_id),
            away_id = COALESCE(?, away_id),
            status = COALESCE(?, status)
          WHERE id = ?
        `);

        updateStmt.run(
          p.tournament_name || null, p.round_name || null, p.surface || null, p.match_date || null,
          p.home_name, p.away_name,
          p.gender || null, p.tour_category || null,
          p.home_odds || null, p.away_odds || null,
          p.predicted_winner, p.win_probability, p.confidence, p.predicted_score || null,
          p.best_bet_selection || null, p.best_bet_market || null, p.best_bet_ev || null,
          serializeJsonField(p.best_bet_rationale),
          p.alt_bet_selection || null, p.alt_bet_market || null,
          serializeJsonField(p.alt_bet_rationale),
          serializeJsonField(p.key_factors),
          serializeJsonField(p.devils_advocate_risk),
          serializeJsonField(p.ai_summary),
          p.home_image || null, p.away_image || null, p.home_id || null, p.away_id || null,
          p.status || 'UPCOMING',
          existing.id
        );

        return Number(existing.id);
      }
    }

    const stmt = db.prepare(`
      INSERT INTO predictions (
        fixture_id, tournament_name, round_name, surface, match_date,
        home_name, away_name, gender, tour_category, home_odds, away_odds,
        predicted_winner, win_probability, confidence, predicted_score,
        best_bet_selection, best_bet_market, best_bet_ev, best_bet_rationale,
        alt_bet_selection, alt_bet_market, alt_bet_rationale, key_factors, devils_advocate_risk,
        ai_summary, home_image, away_image, home_id, away_id,
        status, channel_message_id, published_at, created_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `);

    const info = stmt.run(
      p.fixture_id || null, p.tournament_name || null, p.round_name || null, p.surface || null, p.match_date || null,
      p.home_name, p.away_name, p.gender || null, p.tour_category || null, p.home_odds || null, p.away_odds || null,
      p.predicted_winner, p.win_probability, p.confidence, p.predicted_score || null,
      p.best_bet_selection || null, p.best_bet_market || null, p.best_bet_ev || null,
      serializeJsonField(p.best_bet_rationale),
      p.alt_bet_selection || null, p.alt_bet_market || null,
      serializeJsonField(p.alt_bet_rationale),
      serializeJsonField(p.key_factors),
      serializeJsonField(p.devils_advocate_risk),
      serializeJsonField(p.ai_summary),
      p.home_image || null, p.away_image || null, p.home_id || null, p.away_id || null,
      p.status || 'UPCOMING', p.channel_message_id || null,
      p.published_at || new Date().toISOString(), p.created_at || new Date().toISOString()
    );

    return Number(info.lastInsertRowid);
  },

  updateResult: (id: number, status: string, resultScore?: string): boolean => {
    const stmt = db.prepare(`
      UPDATE predictions 
      SET status = CASE 
            WHEN status IN ('WON', 'LOST', 'VOID', 'INTERRUPTED') AND ? IN ('LIVE', 'UPCOMING') 
            THEN status 
            ELSE ? 
          END, 
          result_score = COALESCE(?, result_score) 
      WHERE id = ?
    `);
    const info = stmt.run(status, status, resultScore || null, id);

    try {
      const { NeonSyncService } = require('../../services/neon-sync.service');
      const pool = NeonSyncService?.getPool?.();
      if (pool) {
        pool.query(
          `UPDATE predictions 
           SET status = CASE 
                 WHEN status IN ('WON', 'LOST', 'VOID', 'INTERRUPTED') AND $1 IN ('LIVE', 'UPCOMING') 
                 THEN status 
                 ELSE $1 
               END,
               result_score = COALESCE($2, result_score)
           WHERE id = $3`,
          [status, resultScore || null, id]
        ).catch((err: any) => {
          console.warn?.('[PredictionsRepo] Neon updateResult async warning:', err?.message);
        });
      }
    } catch {}

    return info.changes > 0;
  },

  updateResultByFixtureId: (fixtureId: number, status: string, resultScore?: string): boolean => {
    const stmt = db.prepare(`
      UPDATE predictions 
      SET status = CASE 
            WHEN status IN ('WON', 'LOST', 'VOID', 'INTERRUPTED') AND ? IN ('LIVE', 'UPCOMING') 
            THEN status 
            ELSE ? 
          END, 
          result_score = COALESCE(?, result_score) 
      WHERE fixture_id = ?
    `);
    const info = stmt.run(status, status, resultScore || null, fixtureId);

    try {
      const { NeonSyncService } = require('../../services/neon-sync.service');
      const pool = NeonSyncService?.getPool?.();
      if (pool) {
        pool.query(
          `UPDATE predictions 
           SET status = CASE 
                 WHEN status IN ('WON', 'LOST', 'VOID', 'INTERRUPTED') AND $1 IN ('LIVE', 'UPCOMING') 
                 THEN status 
                 ELSE $1 
               END,
               result_score = COALESCE($2, result_score)
           WHERE fixture_id = $3`,
          [status, resultScore || null, fixtureId]
        ).catch((err: any) => {
          console.warn?.('[PredictionsRepo] Neon updateResultByFixtureId async warning:', err?.message);
        });
      }
    } catch {}

    return info.changes > 0;
  },

  updateMatchDateByFixtureId: (fixtureId: number, matchDate: string): boolean => {
    const stmt = db.prepare('UPDATE predictions SET match_date = ? WHERE fixture_id = ?');
    const info = stmt.run(matchDate, fixtureId);
    return info.changes > 0;
  },

  updateChannelMessageId: (id: number, channelMsgId: number): void => {
    db.prepare('UPDATE predictions SET channel_message_id = ? WHERE id = ?').run(channelMsgId, id);
  },

  /**
   * Durable "result already posted to channel" mark, keyed by prediction row
   * (unique fixture_id). Survives backend restart and backup import/export.
   */
  markResultAnnounced: (
    id: number,
    announcedAt: string,
    resultChannelMessageId?: number | null,
  ): void => {
    db.prepare(`
      UPDATE predictions
      SET result_announced_at = ?,
          result_channel_message_id = COALESCE(?, result_channel_message_id)
      WHERE id = ?
    `).run(announcedAt, resultChannelMessageId ?? null, id);

    // Asynchronously dual-write to Neon PostgreSQL so cloud DB is immediately in sync
    try {
      const pred = PredictionsRepo.getById(id);
      const fixtureId = pred?.fixture_id ? Number(pred.fixture_id) : null;
      const { NeonSyncService } = require('../../services/neon-sync.service');
      const pool = NeonSyncService?.getPool?.();
      if (pool) {
        pool.query(
          `UPDATE predictions 
           SET result_announced_at = COALESCE($1, result_announced_at),
               result_channel_message_id = COALESCE($2, result_channel_message_id)
           WHERE id = $3 OR (fixture_id IS NOT NULL AND fixture_id = $4)`,
          [announcedAt, resultChannelMessageId ?? null, id, fixtureId]
        ).catch((err: any) => {
          console.warn?.('[PredictionsRepo] Cloud Neon markResultAnnounced warning:', err?.message);
        });
      }
    } catch {
      // Ignore if neon sync not available
    }
  },

  isResultAnnounced: (prediction: { result_announced_at?: string | null; result_channel_message_id?: number | null } | null | undefined): boolean => {
    if (!prediction) return false;
    if (prediction.result_announced_at) return true;
    if (prediction.result_channel_message_id != null && Number(prediction.result_channel_message_id) > 0) {
      return true;
    }
    return false;
  },


  delete: (id: number): boolean => {
    const info = db.prepare('DELETE FROM predictions WHERE id = ?').run(id);
    return info.changes > 0;
  },

  clearAll: (): void => {
    db.prepare('DELETE FROM predictions').run();
  },

  /**
   * Patch specific fields of a prediction row.
   * Only whitelisted fields are allowed to prevent accidental data corruption.
   */
  patch: (id: number, fields: Partial<Pick<Prediction, 'tournament_name' | 'round_name' | 'surface' | 'match_date'>>): boolean => {
    const allowed = ['tournament_name', 'round_name', 'surface', 'match_date'] as const;
    const entries = (Object.keys(fields) as (typeof allowed[number])[])
      .filter(k => allowed.includes(k) && fields[k] !== undefined);
    if (entries.length === 0) return false;
    const setClauses = entries.map(k => `${k} = ?`).join(', ');
    const values = entries.map(k => fields[k] ?? null);
    const info = db.prepare(`UPDATE predictions SET ${setClauses} WHERE id = ?`).run(...values, id);
    return info.changes > 0;
  },
};

