/**
 * Background job: phase 1 player history → phase 2 match bundles (stats + PBP).
 */

import path from 'node:path';
import fs from 'node:fs';
import {
  BulkBundleStore,
  fetchEventBundle,
  RateLimitedTennisClient,
} from './bulkMatchBundleFetch.service';
import {
  BulkPlayerHistoryStore,
  defaultBundlesDir,
  estimateHistoryFetch,
  fetchPlayerMatchHistory,
  fetchTopRankedPlayers,
  listEventsFromPlayerHistory,
  readDistinctEventCount,
  type RankedPlayer,
} from './bulkPlayerHistoryFetch.service';
import { Logger } from '../utils/logger';

export type BulkJobPhase = 'players' | 'bundles' | 'done';
export type BulkHistoryJobStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error';

export interface BulkHistoryJobConfig {
  fromDate: string;
  toDate: string;
  rankLimit: number;
  reqPerSec: number;
  outDir: string;
  bundlesDir: string;
  saveRawPages: boolean;
  maxPages: number;
  resume: boolean;
  autoBundles: boolean;
  bundlesOnly: boolean;
  bundleTestLimit: number;
}

export interface BulkHistoryJobProgress {
  phase: BulkJobPhase;
  playersDone: number;
  playersTotal: number;
  playersSkipped: number;
  currentPlayer: string | null;
  currentPlayerId: number | null;
  eventsListed: number;
  bundlesDone: number;
  bundlesTotal: number;
  currentEventId: number | null;
  bundlesStatsOk: number;
  bundlesPbpOk: number;
  apiCalls: number;
  startedAt: string | null;
  updatedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
}

export interface BulkHistoryJobState {
  status: BulkHistoryJobStatus;
  stopRequested: boolean;
  config: BulkHistoryJobConfig | null;
  progress: BulkHistoryJobProgress;
}

const DEFAULT_CONFIG: BulkHistoryJobConfig = {
  fromDate: '2024-01-01',
  toDate: '2026-12-31',
  rankLimit: 200,
  reqPerSec: 8,
  outDir: path.resolve('data/bulk-player-history'),
  bundlesDir: path.resolve('data/bulk-match-bundles'),
  saveRawPages: false,
  maxPages: 120,
  resume: true,
  autoBundles: true,
  bundlesOnly: false,
  bundleTestLimit: 0,
};

function emptyProgress(phase: BulkJobPhase = 'players'): BulkHistoryJobProgress {
  return {
    phase,
    playersDone: 0,
    playersTotal: 0,
    playersSkipped: 0,
    currentPlayer: null,
    currentPlayerId: null,
    eventsListed: 0,
    bundlesDone: 0,
    bundlesTotal: 0,
    currentEventId: null,
    bundlesStatsOk: 0,
    bundlesPbpOk: 0,
    apiCalls: 0,
    startedAt: null,
    updatedAt: null,
    finishedAt: null,
    lastError: null,
  };
}

function atomicWriteJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function resolveConfig(partial?: Partial<BulkHistoryJobConfig>, defaultOutDir?: string): BulkHistoryJobConfig {
  const outDir = partial?.outDir || defaultOutDir || DEFAULT_CONFIG.outDir;
  return {
    ...DEFAULT_CONFIG,
    outDir,
    bundlesDir: partial?.bundlesDir || defaultBundlesDir(outDir),
    ...partial,
    resume: partial?.resume !== false,
    autoBundles: partial?.autoBundles !== false,
  };
}

type LegacyProgress = BulkHistoryJobProgress & { eventsTotal?: number };

function normalizeProgress(raw?: Partial<LegacyProgress>, phase: BulkJobPhase = 'players'): BulkHistoryJobProgress {
  const merged = { ...emptyProgress(phase), ...raw, phase: raw?.phase || phase };
  if (raw?.eventsTotal && !raw.eventsListed) {
    merged.eventsListed = raw.eventsTotal;
  }
  return merged;
}

/**
 * Fast phase inference — only reads 400 player files, NOT 57k bundle manifests.
 * Bundle completion is read from the saved progress in job-control.json.
 */
function inferPhaseFromDisk(
  outDir: string,
  _bundlesDir: string,
  rankLimit: number,
  savedBundlesDone = 0,
  savedBundlesTotal = 0,
): BulkJobPhase {
  const playersDone = new BulkPlayerHistoryStore(outDir).loadCompletedPlayerIds().size;
  const playersTarget = rankLimit * 2;
  if (playersDone < playersTarget) return 'players';

  // Use saved counts instead of scanning 57k manifests
  const eventsCount = savedBundlesTotal > 0 ? savedBundlesTotal : readDistinctEventCount(outDir);
  if (eventsCount > 0 && savedBundlesDone < eventsCount) return 'bundles';
  if (eventsCount > 0 && savedBundlesDone >= eventsCount) return 'done';
  return 'bundles';
}

function isFullyComplete(
  outDir: string,
  bundlesDir: string,
  rankLimit: number,
  savedBundlesDone = 0,
  savedBundlesTotal = 0,
): boolean {
  return inferPhaseFromDisk(outDir, bundlesDir, rankLimit, savedBundlesDone, savedBundlesTotal) === 'done';
}

export class BulkPlayerHistoryJob {
  private state: BulkHistoryJobState = {
    status: 'idle',
    stopRequested: false,
    config: null,
    progress: emptyProgress(),
  };

  private runPromise: Promise<void> | null = null;
  private rankedPlayers: RankedPlayer[] = [];
  private stateFilePath: string;
  private lastPersistAt = 0;

  constructor(private readonly defaultOutDir = path.resolve('data/bulk-player-history')) {
    this.stateFilePath = path.join(this.defaultOutDir, 'job-control.json');
    this.loadState();
  }

  private controlPath(outDir: string): string {
    return path.join(outDir, 'job-control.json');
  }

  private loadState(): void {
    if (!fs.existsSync(this.stateFilePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.stateFilePath, 'utf8')) as BulkHistoryJobState;
      if (parsed.status === 'running') {
        parsed.status = 'paused';
        parsed.stopRequested = false;
      }
      const outDir = parsed.config?.outDir || this.defaultOutDir;
      const bundlesDir = parsed.config?.bundlesDir || defaultBundlesDir(outDir);
      const rankLimit = parsed.config?.rankLimit || DEFAULT_CONFIG.rankLimit;
      // Use saved bundle counts to avoid scanning 57k files at startup
      const savedBundlesDone = parsed.progress?.bundlesDone ?? 0;
      const savedBundlesTotal = parsed.progress?.bundlesTotal ?? 0;
      const inferredPhase = inferPhaseFromDisk(outDir, bundlesDir, rankLimit, savedBundlesDone, savedBundlesTotal);
      parsed.progress = normalizeProgress(parsed.progress, inferredPhase === 'done' ? 'done' : inferredPhase);
      if (parsed.status === 'completed' && inferredPhase === 'bundles') {
        parsed.status = 'idle';
        parsed.progress.phase = 'bundles';
      }
      this.state = { ...this.state, ...parsed, stopRequested: false };
    } catch {
      // ignore
    }
  }

  private persistState(outDir?: string): void {
    const file = outDir ? this.controlPath(outDir) : this.stateFilePath;
    this.stateFilePath = file;
    atomicWriteJson(file, this.state);
  }

  private persistStateThrottled(outDir: string, force = false): void {
    const now = Date.now();
    if (!force && now - this.lastPersistAt < 2500) return;
    this.lastPersistAt = now;
    this.persistState(outDir);
  }

  private pauseJob(outDir: string): void {
    this.state.status = 'paused';
    this.state.progress.currentPlayer = null;
    this.state.progress.currentPlayerId = null;
    this.state.progress.currentEventId = null;
    this.state.progress.updatedAt = new Date().toISOString();
    this.persistState(outDir);
    Logger.info('[BulkJob] Paused by user');
  }

  getState(): BulkHistoryJobState {
    return JSON.parse(JSON.stringify(this.state)) as BulkHistoryJobState;
  }

  isRunning(): boolean {
    return this.state.status === 'running';
  }

  requestPause(): { ok: boolean; message: string } {
    if (this.state.status !== 'running') {
      return { ok: false, message: 'Job is not running.' };
    }
    this.state.stopRequested = true;
    this.persistState(this.state.config?.outDir);
    const phaseLabel = this.state.progress.phase === 'bundles' ? 'بازی' : 'بازیکن';
    return { ok: true, message: `توقف ثبت شد — بعد از ${phaseLabel} فعلی متوقف می‌شود.` };
  }

  start(partial?: Partial<BulkHistoryJobConfig>): { ok: boolean; message: string } {
    if (this.state.status === 'running') {
      return { ok: false, message: 'Job already running.' };
    }

    const config = resolveConfig(partial, this.defaultOutDir);
    const historyStore = new BulkPlayerHistoryStore(config.outDir);
    const playersOnDisk = historyStore.loadCompletedPlayerIds().size;
    const playersTarget = config.rankLimit * 2;
    const playersComplete = playersOnDisk >= playersTarget;
    const eventsOnDisk = readDistinctEventCount(config.outDir);
    // Always allow bundles phase to start when players are complete.
    // bundlesDone will be recounted properly inside runBundlesPhase().
    const startPhase: BulkJobPhase =
      config.bundlesOnly || playersComplete ? 'bundles' : 'players';
    const keepProgress = config.resume && Boolean(this.state.progress.startedAt);

    this.state = {
      status: 'running',
      stopRequested: false,
      config,
      progress: {
        ...normalizeProgress(keepProgress ? this.state.progress : undefined, startPhase),
        phase: startPhase,
        playersSkipped: playersOnDisk,
        playersDone: playersOnDisk,
        playersTotal: playersTarget,
        eventsListed: eventsOnDisk,
        // Reset to 0 so runBundlesPhase does a real scan via loadCompletedEventIds()
        bundlesDone: 0,
        bundlesTotal: eventsOnDisk,
        startedAt: keepProgress ? this.state.progress.startedAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        finishedAt: null,
        lastError: null,
      },
    };
    this.persistState(config.outDir);

    this.runPromise = this.runJob(config).finally(() => {
      this.runPromise = null;
    });

    if (config.bundlesOnly || startPhase === 'bundles') {
      return { ok: true, message: 'شروع دریافت دیتای بازی‌ها (stat + PBP).' };
    }
    return { ok: true, message: config.resume ? 'ادامه دریافت لیست بازیکنان.' : 'شروع دریافت لیست.' };
  }

  private async runJob(config: BulkHistoryJobConfig): Promise<void> {
    const client = new RateLimitedTennisClient(config.reqPerSec);

    try {
      if (config.bundlesOnly || this.state.progress.phase === 'bundles') {
        await this.runBundlesPhase(config, client);
        return;
      }

      await this.runPlayersPhase(config, client);

      if (this.state.stopRequested) return;

      if (config.autoBundles) {
        this.state.progress.phase = 'bundles';
        this.persistState(config.outDir);
        await this.runBundlesPhase(config, client);
      } else {
        this.state.status = 'completed';
        this.state.progress.phase = 'done';
        this.state.progress.finishedAt = new Date().toISOString();
        this.persistState(config.outDir);
      }
    } catch (err) {
      this.state.status = 'error';
      this.state.progress.lastError = err instanceof Error ? err.message : String(err);
      this.state.progress.updatedAt = new Date().toISOString();
      this.persistState(config.outDir);
      Logger.error(`[BulkJob] ${this.state.progress.lastError}`);
    }
  }

  private async runPlayersPhase(config: BulkHistoryJobConfig, client: RateLimitedTennisClient): Promise<void> {
    const store = new BulkPlayerHistoryStore(config.outDir);
    const ranked = await fetchTopRankedPlayers(client, config.rankLimit);
    this.rankedPlayers = [...ranked.atp, ...ranked.wta];
    store.saveRankings('atp', ranked.atp);
    store.saveRankings('wta', ranked.wta);

    let players = [...this.rankedPlayers];
    let apiCalls = ranked.apiCalls;

    const completed = config.resume ? store.loadCompletedPlayerIds() : new Set<number>();
    this.state.progress.playersSkipped = completed.size;
    players = players.filter((p) => !completed.has(p.rapid_player_id));
    this.state.progress.playersTotal = players.length + completed.size;
    this.state.progress.playersDone = completed.size;
    this.state.progress.phase = 'players';
    this.persistState(config.outDir);

    for (const player of players) {
      if (this.state.stopRequested) {
        this.pauseJob(config.outDir);
        return;
      }

      this.state.progress.currentPlayer = player.full_name;
      this.state.progress.currentPlayerId = player.rapid_player_id;
      this.state.progress.updatedAt = new Date().toISOString();
      this.persistState(config.outDir);

      const result = await fetchPlayerMatchHistory(client, player, {
        fromDate: config.fromDate,
        toDate: config.toDate,
        maxPages: config.maxPages,
        saveRawPages: config.saveRawPages,
        shouldStop: () => this.state.stopRequested,
      });

      apiCalls += result.apiCalls;
      this.state.progress.eventsListed += result.events.length;
      this.state.progress.apiCalls = apiCalls;

      store.savePlayerBundle(player, result.manifest, result.events, config.saveRawPages ? result.rawPages : undefined);
      store.appendProgress({
        phase: 'players',
        rapid_player_id: player.rapid_player_id,
        full_name: player.full_name,
        events: result.events.length,
        at: new Date().toISOString(),
      });

      this.state.progress.playersDone += 1;
      this.state.progress.updatedAt = new Date().toISOString();
      this.persistState(config.outDir);

      if (this.state.stopRequested) {
        this.pauseJob(config.outDir);
        return;
      }
    }

    store.rebuildGlobalEventIndex(this.rankedPlayers);
    this.state.progress.eventsListed = listEventsFromPlayerHistory(config.outDir).length;
    this.persistState(config.outDir);
  }

  private async runBundlesPhase(config: BulkHistoryJobConfig, client: RateLimitedTennisClient): Promise<void> {
    const historyStore = new BulkPlayerHistoryStore(config.outDir);
    if (this.rankedPlayers.length === 0) {
      const atpPath = path.join(config.outDir, 'rankings', 'atp-top200.json');
      const wtaPath = path.join(config.outDir, 'rankings', 'wta-top200.json');
      if (fs.existsSync(atpPath)) {
        const atp = JSON.parse(fs.readFileSync(atpPath, 'utf8')) as { players?: RankedPlayer[] };
        this.rankedPlayers.push(...(atp.players || []));
      }
      if (fs.existsSync(wtaPath)) {
        const wta = JSON.parse(fs.readFileSync(wtaPath, 'utf8')) as { players?: RankedPlayer[] };
        this.rankedPlayers.push(...(wta.players || []));
      }
    }

    const indexPath = path.join(config.outDir, 'indexes', 'all-events.json');
    if (!fs.existsSync(indexPath)) {
      historyStore.rebuildGlobalEventIndex(this.rankedPlayers);
    }
    Logger.info(`[BulkJob] Loading event queue (${readDistinctEventCount(config.outDir)} events on disk)…`);
    const allEvents = listEventsFromPlayerHistory(config.outDir);
    Logger.info(`[BulkJob] Queue ready: ${allEvents.length} events, concurrency=${Math.max(2, Math.min(config.reqPerSec, 16))}`);
    const bundleStore = new BulkBundleStore(config.bundlesDir);
    const completed = config.resume ? bundleStore.loadCompletedEventIds() : new Set<number>();
    let queue = allEvents.filter((e) => !completed.has(e.rapid_event_id));
    const isTestRun = config.bundleTestLimit > 0;
    if (isTestRun) queue = queue.slice(0, config.bundleTestLimit);

    this.state.progress.phase = 'bundles';
    this.state.progress.bundlesTotal = allEvents.length;
    this.state.progress.bundlesDone = completed.size;
    this.state.progress.eventsListed = allEvents.length;
    this.persistState(config.outDir);

    bundleStore.writeRunManifest({
      started_at: new Date().toISOString(),
      source: config.outDir,
      queue_events: queue.length,
      skipped_completed: completed.size,
      via: 'bulk-fetch-ui',
    });

    const concurrency = Math.max(2, Math.min(config.reqPerSec, 16));
    let nextIdx = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        if (this.state.stopRequested) return;
        const i = nextIdx++;
        if (i >= queue.length) return;

        const event = queue[i];
        this.state.progress.currentEventId = event.rapid_event_id;
        this.state.progress.currentPlayer = `${event.tourney_name || 'Match'} — ${event.score || event.match_date}`;
        this.state.progress.updatedAt = new Date().toISOString();

        const result = await fetchEventBundle(client, bundleStore, event, {
          shouldStop: () => this.state.stopRequested,
        });

        if (this.state.stopRequested && result.apiCalls === 0) return;

        this.state.progress.apiCalls += result.apiCalls;
        if (result.statistics_status === 'ok' || result.statistics_status === 'cached') {
          this.state.progress.bundlesStatsOk += 1;
        }
        if (result.pbp_status === 'ok' || result.pbp_status === 'cached') {
          this.state.progress.bundlesPbpOk += 1;
        }
        this.state.progress.bundlesDone += 1;
        this.persistStateThrottled(config.outDir);
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    if (this.state.stopRequested) {
      this.pauseJob(config.outDir);
      return;
    }

    bundleStore.rebuildPlayerIndex(allEvents);

    if (this.state.stopRequested) {
      this.pauseJob(config.outDir);
      return;
    }

    if (allEvents.length > 0 && !isTestRun && this.state.progress.bundlesDone < allEvents.length) {
      this.state.status = 'error';
      this.state.progress.lastError = `Bundles stopped early (${this.state.progress.bundlesDone}/${allEvents.length}).`;
      this.state.progress.updatedAt = new Date().toISOString();
      this.persistState(config.outDir);
      return;
    }

    this.state.status = 'completed';
    this.state.progress.phase = 'done';
    this.state.progress.finishedAt = new Date().toISOString();
    this.state.progress.currentPlayer = null;
    this.state.progress.currentEventId = null;
    this.persistState(config.outDir);

    bundleStore.writeRunManifest({
      finished_at: this.state.progress.finishedAt,
      fetched_events: this.state.progress.bundlesDone,
      api_calls: this.state.progress.apiCalls,
      via: 'bulk-fetch-ui',
    });
  }

  getEstimate(config?: Partial<BulkHistoryJobConfig>): Record<string, unknown> {
    const cfg = resolveConfig(config, this.defaultOutDir);
    const events = readDistinctEventCount(cfg.outDir);
    return {
      ...estimateHistoryFetch(
        Array.from({ length: cfg.rankLimit * 2 }, (_, i) => ({
          rapid_player_id: i,
          full_name: '',
          short_name: null,
          country_code: null,
          tour: i < cfg.rankLimit ? 'ATP' : 'WTA',
          gender: i < cfg.rankLimit ? 'M' : 'F',
          current_rank: (i % cfg.rankLimit) + 1,
          ranking_points: null,
        })),
        9,
      ),
      bundles_events_on_disk: events,
      bundles_api_calls_estimate: events * 3,
      dateWindow: { from: cfg.fromDate, to: cfg.toDate },
      reqPerSec: cfg.reqPerSec,
    };
  }
}

export const bulkPlayerHistoryJob = new BulkPlayerHistoryJob();
