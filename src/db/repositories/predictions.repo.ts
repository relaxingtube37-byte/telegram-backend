import { db } from '../connection';
import type { Prediction } from '../../types';

export const PredictionsRepo = {
  getAll: (limit = 100): any[] => {
    return db.prepare('SELECT * FROM predictions ORDER BY published_at DESC LIMIT ?').all(limit);
  },

  getActive: (): any[] => {
    return db.prepare("SELECT * FROM predictions WHERE status = 'UPCOMING' OR status = 'LIVE' ORDER BY match_date ASC, published_at DESC").all();
  },

  getHistory: (limit = 50): any[] => {
    return db.prepare("SELECT * FROM predictions WHERE status = 'WON' OR status = 'LOST' OR status = 'VOID' OR status = 'INTERRUPTED' ORDER BY published_at DESC LIMIT ?").all(limit);
  },

  getById: (id: number): any => {
    return db.prepare('SELECT * FROM predictions WHERE id = ?').get(id);
  },

  getByFixtureId: (fixtureId: number): any => {
    return db.prepare('SELECT * FROM predictions WHERE fixture_id = ?').get(fixtureId);
  },

  create: (p: Prediction): number => {
    const stmt = db.prepare(`
      INSERT INTO predictions (
        fixture_id, tournament_name, round_name, surface, match_date,
        home_name, away_name, home_odds, away_odds,
        predicted_winner, win_probability, confidence, predicted_score,
        best_bet_selection, best_bet_market, best_bet_ev, best_bet_rationale,
        alt_bet_selection, alt_bet_market, key_factors, devils_advocate_risk,
        ai_summary, home_image, away_image, home_id, away_id,
        status, channel_message_id, published_at, created_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `);

    const info = stmt.run(
      p.fixture_id || null, p.tournament_name || null, p.round_name || null, p.surface || null, p.match_date || null,
      p.home_name, p.away_name, p.home_odds || null, p.away_odds || null,
      p.predicted_winner, p.win_probability, p.confidence, p.predicted_score || null,
      p.best_bet_selection || null, p.best_bet_market || null, p.best_bet_ev || null, p.best_bet_rationale || null,
      p.alt_bet_selection || null, p.alt_bet_market || null,
      Array.isArray(p.key_factors) ? JSON.stringify(p.key_factors) : p.key_factors || null,
      p.devils_advocate_risk || null, p.ai_summary || null,
      p.home_image || null, p.away_image || null, p.home_id || null, p.away_id || null,
      p.status || 'UPCOMING', p.channel_message_id || null,
      p.published_at || new Date().toISOString(), p.created_at || new Date().toISOString()
    );

    return Number(info.lastInsertRowid);
  },

  updateResult: (id: number, status: string, resultScore?: string): boolean => {
    const stmt = db.prepare('UPDATE predictions SET status = ?, result_score = ? WHERE id = ?');
    const info = stmt.run(status, resultScore || null, id);
    return info.changes > 0;
  },

  updateResultByFixtureId: (fixtureId: number, status: string, resultScore?: string): boolean => {
    const stmt = db.prepare('UPDATE predictions SET status = ?, result_score = ? WHERE fixture_id = ?');
    const info = stmt.run(status, resultScore || null, fixtureId);
    return info.changes > 0;
  },

  updateChannelMessageId: (id: number, channelMsgId: number): void => {
    db.prepare('UPDATE predictions SET channel_message_id = ? WHERE id = ?').run(channelMsgId, id);
  },

  delete: (id: number): boolean => {
    const info = db.prepare('DELETE FROM predictions WHERE id = ?').run(id);
    return info.changes > 0;
  },

  clearAll: (): void => {
    db.prepare('DELETE FROM predictions').run();
  },
};
