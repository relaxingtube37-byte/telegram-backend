import { PredictionsRepo } from '../db/repositories/predictions.repo';
import type { Prediction } from '../types';

function ensureJsonField(val: any, fallbackToEnObject = true): any {
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
        return fallbackToEnObject ? { en: arr } : arr;
      } catch {}
    }
    if (fallbackToEnObject && trimmed.length > 0) {
      return { en: trimmed };
    }
  }
  return val;
}

export const PredictionsService = {
  formatPrediction: (raw: any): Prediction => {
    if (!raw) return raw;
    return {
      ...raw,
      key_factors: ensureJsonField(raw.key_factors, true) ?? { en: [] },
      ai_summary: ensureJsonField(raw.ai_summary, true) ?? undefined,
      devils_advocate_risk: ensureJsonField(raw.devils_advocate_risk, true) ?? undefined,
      best_bet_rationale: ensureJsonField(raw.best_bet_rationale, true) ?? undefined,
      alt_bet_rationale: ensureJsonField(raw.alt_bet_rationale, true) ?? undefined,
    };
  },

  getAll: (limit = 100): Prediction[] => {
    return PredictionsRepo.getAll(limit).map(PredictionsService.formatPrediction);
  },

  getActive: (): Prediction[] => {
    return PredictionsRepo.getActive().map(PredictionsService.formatPrediction);
  },

  getHistory: (limit = 50): Prediction[] => {
    return PredictionsRepo.getHistory(limit).map(PredictionsService.formatPrediction);
  },

  getById: (id: number): Prediction | null => {
    const raw = PredictionsRepo.getById(id);
    return raw ? PredictionsService.formatPrediction(raw) : null;
  },

  publish: (p: Prediction): number => {
    return PredictionsRepo.create(p);
  },

  updateResult: (id: number, status: string, resultScore?: string): boolean => {
    return PredictionsRepo.updateResult(id, status, resultScore);
  },

  updateResultByFixtureId: (fixtureId: number, status: string, resultScore?: string): boolean => {
    return PredictionsRepo.updateResultByFixtureId(fixtureId, status, resultScore);
  },

  updateMatchDateByFixtureId: (fixtureId: number, matchDate: string): boolean => {
    return PredictionsRepo.updateMatchDateByFixtureId(fixtureId, matchDate);
  },
};
