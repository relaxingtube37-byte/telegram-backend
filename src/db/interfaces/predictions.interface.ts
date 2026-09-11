import type { Prediction } from '../../types';

export interface IPredictionsRepo {
  getAll(limit?: number): Promise<Prediction[]>;
  getActive(): Promise<Prediction[]>;
  getHistory(limit?: number): Promise<Prediction[]>;
  getById(id: number): Promise<Prediction | null>;
  getByFixtureId(fixtureId: number): Promise<Prediction | null>;
  create(p: Prediction): Promise<number>;
  updateResult(id: number, status: string, resultScore?: string): Promise<boolean>;
  updateResultByFixtureId(fixtureId: number, status: string, resultScore?: string): Promise<boolean>;
  updateChannelMessageId(id: number, channelMsgId: number): Promise<void>;
  delete(id: number): Promise<boolean>;
}
