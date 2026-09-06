import { Logger } from '../utils/logger';
import { runLocalTennisIngestion } from './importLocalTennisData';

export interface IngestionRunResult {
  totalMatches: number;
  upsert: { inserted: number; updated: number; skipped: number };
  duplicatesRemoved: number;
  apiGapFillRows: number;
  rapidApiEnriched: number;
  clearBeforeSync: boolean;
}

/** Import tennis data from local season CSV files only (no internet download). */
export async function runFullTennisIngestion(options?: {
  dataDir?: string;
  years?: number[];
  atpYears?: number[];
  wtaYears?: number[];
  challYears?: number[];
  includeChallengers?: boolean;
  includeWta?: boolean;
  clearBeforeSync?: boolean;
  enrichFromRapidApi?: boolean;
}): Promise<IngestionRunResult> {
  const years = options?.years || options?.atpYears || options?.wtaYears;
  Logger.info('Using local season CSV files (remote download disabled).');
  return runLocalTennisIngestion({
    dataDir: options?.dataDir,
    years,
    clearBeforeSync: options?.clearBeforeSync,
  });
}

if (process.argv[1] && process.argv[1].includes('importTennisData')) {
  runFullTennisIngestion()
    .then(() => process.exit(0))
    .catch((err) => {
      Logger.error('Failed to import local tennis dataset: ' + err.message);
      process.exit(1);
    });
}
