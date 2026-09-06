import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/connection';
import { initSchema } from '../db/schema';
import { Logger } from '../utils/logger';
import { ENV } from '../config/env';
import { parseSeasonCsvTextToMatchRecords } from './seasonCsvParser';
import {
  removeDuplicateHistoricalMatches,
  upsertHistoricalMatchRecords,
  type UpsertSummary,
} from './historicalMatchInsert';
import type { IngestionRunResult } from './importTennisData';

initSchema();

const FILE_PATTERN = /^(\d{4})-(atp|wta)-season\.csv$/i;

function emptyUpsert(): UpsertSummary {
  return { inserted: 0, updated: 0, skipped: 0 };
}

function mergeUpsert(target: UpsertSummary, next: UpsertSummary): void {
  target.inserted += next.inserted;
  target.updated += next.updated;
  target.skipped += next.skipped;
}

export function resolveLocalDataDir(customDir?: string): string {
  const candidates = [
    customDir?.trim(),
    ENV.LOCAL_TENNIS_DATA_DIR,
    path.resolve(process.cwd(), '../state football/2021-2026-data'),
    path.resolve(process.cwd(), '../../state football/2021-2026-data'),
  ].filter((v): v is string => Boolean(v && v.trim()));

  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      return path.resolve(dir);
    }
  }

  throw new Error(
    `Local tennis data folder not found. Set LOCAL_TENNIS_DATA_DIR or place files in state football/2021-2026-data`,
  );
}

export function listLocalSeasonFiles(dataDir: string, years?: number[]): string[] {
  const files = fs
    .readdirSync(dataDir)
    .filter((name) => FILE_PATTERN.test(name))
    .map((name) => {
      const match = name.match(FILE_PATTERN)!;
      return { name, year: parseInt(match[1], 10), tour: match[2].toUpperCase() as 'ATP' | 'WTA' };
    })
    .filter((f) => (years?.length ? years.includes(f.year) : true))
    .sort((a, b) => a.year - b.year || a.tour.localeCompare(b.tour));

  return files.map((f) => path.join(dataDir, f.name));
}

function importLocalFile(filePath: string, tour: 'ATP' | 'WTA', label: string): UpsertSummary {
  Logger.info(`📂 Importing ${label} from ${filePath}`);
  const csvText = fs.readFileSync(filePath, 'utf8');
  const records = parseSeasonCsvTextToMatchRecords(csvText, tour);
  if (!records.length) {
    Logger.warn(`⚠️ No finished matches parsed in ${label}`);
    return emptyUpsert();
  }
  const summary = upsertHistoricalMatchRecords(records);
  Logger.success(
    `✅ ${label}: ${records.length} rows (inserted ${summary.inserted}, updated ${summary.updated}, skipped ${summary.skipped})`,
  );
  return summary;
}

function saveIngestionRun(result: IngestionRunResult, years: number[], dataDir: string): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO ingestion_sync_state (key, value, updated_at)
    VALUES (@key, @value, @updated_at)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  stmt.run({ key: 'last_ingestion_at', value: now, updated_at: now });
  stmt.run({ key: 'last_ingestion_years', value: JSON.stringify(years), updated_at: now });
  stmt.run({ key: 'last_ingestion_result', value: JSON.stringify(result), updated_at: now });
  stmt.run({ key: 'local_data_dir', value: dataDir, updated_at: now });
}

export async function runLocalTennisIngestion(options?: {
  dataDir?: string;
  years?: number[];
  clearBeforeSync?: boolean;
}): Promise<IngestionRunResult> {
  const dataDir = resolveLocalDataDir(options?.dataDir);
  const files = listLocalSeasonFiles(dataDir, options?.years);
  if (!files.length) {
    throw new Error(`No season CSV files found in ${dataDir}`);
  }

  Logger.info(`📁 Local data dir: ${dataDir} (${files.length} files)`);

  const { purgeLegacyHistoricalPool } = await import('../services/localPoolMaintenance.service');
  purgeLegacyHistoricalPool();

  if (options?.clearBeforeSync) {
    db.exec('DELETE FROM historical_matches;');
    Logger.info('Cleared historical_matches table (fresh import).');
  }

  const upsert = emptyUpsert();
  const importedYears = new Set<number>();

  for (const filePath of files) {
    const base = path.basename(filePath);
    const match = base.match(FILE_PATTERN)!;
    const year = parseInt(match[1], 10);
    const tour = match[2].toUpperCase() as 'ATP' | 'WTA';
    importedYears.add(year);
    mergeUpsert(upsert, importLocalFile(filePath, tour, `${tour} ${year}`));
  }

  const duplicatesRemoved = removeDuplicateHistoricalMatches();

  const totalRow = db.prepare('SELECT COUNT(*) as c FROM historical_matches').get() as { c: number };
  const result: IngestionRunResult = {
    totalMatches: totalRow.c,
    upsert,
    duplicatesRemoved,
    apiGapFillRows: 0,
    rapidApiEnriched: 0,
    clearBeforeSync: Boolean(options?.clearBeforeSync),
  };

  saveIngestionRun(result, [...importedYears].sort(), dataDir);

  try {
    const { reindexAllTrackedPlayersFromHistorical } = await import('../services/playerArchive.service');
    const reindex = reindexAllTrackedPlayersFromHistorical('2021-01-01');
    Logger.info(`Player match index linked ${reindex.linked} rows across ${reindex.players} tracked players`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Logger.warn(`Player index reindex skipped: ${message}`);
  }

  Logger.success(`🎉 Local import complete: ${result.totalMatches.toLocaleString()} matches in pool`);
  return result;
}
