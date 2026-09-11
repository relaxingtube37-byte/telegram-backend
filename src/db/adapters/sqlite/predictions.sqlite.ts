import type { IPredictionsRepo } from '../../interfaces/predictions.interface';
import type { Prediction } from '../../../types';
import { PredictionsRepo } from '../../repositories/predictions.repo';

export class SqlitePredictionsAdapter implements IPredictionsRepo {
  async getAll(limit = 100): Promise<Prediction[]> {
    return PredictionsRepo.getAll(limit);
  }

  async getActive(): Promise<Prediction[]> {
    return PredictionsRepo.getActive();
  }

  async getHistory(limit = 50): Promise<Prediction[]> {
    return PredictionsRepo.getHistory(limit);
  }

  async getById(id: number): Promise<Prediction | null> {
    const res = PredictionsRepo.getById(id);
    return res || null;
  }

  async getByFixtureId(fixtureId: number): Promise<Prediction | null> {
    const res = PredictionsRepo.getByFixtureId(fixtureId);
    return res || null;
  }

  async create(p: Prediction): Promise<number> {
    return PredictionsRepo.create(p);
  }

  async updateResult(id: number, status: string, resultScore?: string): Promise<boolean> {
    return PredictionsRepo.updateResult(id, status, resultScore);
  }

  async updateResultByFixtureId(fixtureId: number, status: string, resultScore?: string): Promise<boolean> {
    return PredictionsRepo.updateResultByFixtureId(fixtureId, status, resultScore);
  }

  async updateChannelMessageId(id: number, channelMsgId: number): Promise<void> {
    PredictionsRepo.updateChannelMessageId(id, channelMsgId);
  }

  async delete(id: number): Promise<boolean> {
    return PredictionsRepo.delete(id);
  }
}
