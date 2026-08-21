import { PredictionsRepo } from '../db/repositories/predictions.repo';
import type { Prediction } from '../types';

export const PredictionsService = {
  formatPrediction: (raw: any): Prediction => {
    return {
      ...raw,
      key_factors: typeof raw.key_factors === 'string'
        ? (() => { try { return JSON.parse(raw.key_factors); } catch { return []; } })()
        : (raw.key_factors || []),
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
};
