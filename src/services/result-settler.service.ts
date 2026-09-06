/**
 * ════════════════════════════════════════════════════════════════════════════
 * ⏱️ AUTONOMOUS RESULT SETTLER SERVICE (BACKGROUND WORKER)
 * ════════════════════════════════════════════════════════════════════════════
 * Operates independently on the backend without requiring Football State desktop.
 * Periodically checks all UPCOMING / LIVE predictions against RapidAPI Tennis:
 * 1. Detects finished matches, retirements, or walkovers.
 * 2. Settles prediction status (WON / LOST / VOID) and saves actual score.
 * 3. Keeps win-rate and accuracy stats up-to-date in real-time.
 * 4. Automatically sends result update replies to Telegram Channel posts.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { PredictionsRepo } from '../db/repositories/predictions.repo';
import { PredictionsService } from './predictions.service';
import { ChannelPosterService } from './channel-poster.service';
import { BackendTennisApi } from '../dataPool/dataPool.tennisApi';
import { ENV } from '../config/env';
import { Logger } from '../utils/logger';
import type { Prediction } from '../types';

export function isWinnerNameMatch(actual: string, predicted: string): boolean {
  if (!actual || !predicted) return false;
  const a = actual.toLowerCase().trim();
  const b = predicted.toLowerCase().trim();
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  // Check last name matching (e.g. "Alcaraz" vs "Carlos Alcaraz")
  const aParts = a.split(/\s+/).filter(Boolean);
  const bParts = b.split(/\s+/).filter(Boolean);
  const aLast = aParts[aParts.length - 1];
  const bLast = bParts[bParts.length - 1];
  if (aLast && bLast && aLast.length >= 3 && bLast.length >= 3 && aLast === bLast) {
    return true;
  }

  return false;
}

export class ResultSettlerService {
  private static timer: NodeJS.Timeout | null = null;
  private static isRunning = false;
  private static defaultIntervalMs = 5 * 60 * 1000; // 5 minutes

  /**
   * Evaluates and settles all active (UPCOMING / LIVE) predictions.
   * Can be invoked by the scheduled timer or manually via admin endpoint.
   */
  static async settleActivePredictions(): Promise<{
    checked: number;
    settled: number;
    settledList: { fixture_id: number; status: string; score: string }[];
  }> {
    if (this.isRunning) {
      Logger.info('[ResultSettler] Settlement check already in progress, skipping concurrent run.');
      return { checked: 0, settled: 0, settledList: [] };
    }

    this.isRunning = true;
    try {
      const activePredictions: Prediction[] = PredictionsRepo.getActive();
      const eligible = activePredictions.filter(
        (p) => p.fixture_id && (p.status === 'UPCOMING' || p.status === 'LIVE')
      );

      if (eligible.length === 0) {
        return { checked: 0, settled: 0, settledList: [] };
      }

      Logger.info(`[ResultSettler] Checking outcomes for ${eligible.length} active prediction(s)...`);

      let settledCount = 0;
      const settledList: { fixture_id: number; status: string; score: string }[] = [];

      for (const pred of eligible) {
        const fixtureId = pred.fixture_id!;
        try {
          const eventData = await BackendTennisApi.getEventDetails(fixtureId);
          if (!eventData || !eventData.event) continue;

          const ev = eventData.event;
          const statusType = String(ev.status?.type || '').toLowerCase();
          const statusDesc = String(ev.status?.description || '').toLowerCase();

          const isFinished =
            statusType === 'finished' ||
            statusDesc.includes('finish') ||
            statusDesc.includes('ended') ||
            statusDesc.includes('retired') ||
            statusDesc.includes('walkover');

          if (!isFinished) {
            // Update to LIVE if match has started
            if (statusType === 'inprogress' && pred.status !== 'LIVE') {
              PredictionsService.updateResultByFixtureId(fixtureId, 'LIVE');
              Logger.info(`[ResultSettler] Match #${fixtureId} (${pred.home_name} vs ${pred.away_name}) is now LIVE.`);
            }
            continue;
          }

          // Determine winner
          let actualWinnerName: string | null = null;
          if (ev.winnerCode === 1) {
            actualWinnerName = ev.homeTeam?.name || pred.home_name;
          } else if (ev.winnerCode === 2) {
            actualWinnerName = ev.awayTeam?.name || pred.away_name;
          } else if (ev.homeTeam?.winner) {
            actualWinnerName = ev.homeTeam.name;
          } else if (ev.awayTeam?.winner) {
            actualWinnerName = ev.awayTeam.name;
          }

          // Determine settlement status
          let status: 'WON' | 'LOST' | 'VOID' = 'LOST';
          if (statusDesc.includes('cancelled') || statusDesc.includes('postponed')) {
            status = 'VOID';
          } else if (actualWinnerName) {
            const won = isWinnerNameMatch(actualWinnerName, pred.predicted_winner);
            status = won ? 'WON' : 'LOST';
          }

          // Format match score
          const hScore = ev.homeScore?.current ?? ev.homeScore?.display ?? '';
          const aScore = ev.awayScore?.current ?? ev.awayScore?.display ?? '';
          let scoreStr = hScore !== '' && aScore !== '' ? `${hScore}:${aScore}` : '';

          const sets: string[] = [];
          for (let i = 1; i <= 5; i++) {
            const hP = ev.homeScore?.[`period${i}`];
            const aP = ev.awayScore?.[`period${i}`];
            if (hP !== undefined && aP !== undefined) {
              sets.push(`${hP}-${aP}`);
            }
          }
          if (sets.length > 0) {
            scoreStr = scoreStr ? `${scoreStr} (${sets.join(', ')})` : sets.join(', ');
          }
          if (!scoreStr) scoreStr = statusDesc ? statusDesc.toUpperCase() : 'FT';

          // Persist settled outcome in SQLite
          const ok = PredictionsService.updateResultByFixtureId(fixtureId, status, scoreStr);
          if (ok) {
            settledCount++;
            settledList.push({ fixture_id: fixtureId, status, score: scoreStr });
            Logger.success(
              `[ResultSettler] 🎯 Settled #${fixtureId} (${pred.home_name} vs ${pred.away_name}) -> ${status} [Score: ${scoreStr}]`
            );

            // Notify Telegram channel if message ID is linked
            if (pred.channel_message_id) {
              try {
                await ChannelPosterService.updateResult(pred.channel_message_id, status, scoreStr);
                Logger.info(`[ResultSettler] Channel result update posted for message #${pred.channel_message_id}`);
              } catch (channelErr: any) {
                Logger.warn(`[ResultSettler] Failed to post channel update for #${pred.channel_message_id}: ${channelErr.message}`);
              }
            }
          }
        } catch (err: any) {
          Logger.warn(`[ResultSettler] Error checking fixture #${fixtureId}: ${err.message}`);
        }
      }

      return {
        checked: eligible.length,
        settled: settledCount,
        settledList,
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Starts the background settlement interval daemon.
   */
  static start(intervalMs = this.defaultIntervalMs): void {
    if (this.timer) {
      Logger.info('[ResultSettler] Service is already active.');
      return;
    }

    if (!ENV.RAPIDAPI_KEY || ENV.RAPIDAPI_KEY.length < 5) {
      Logger.warn('[ResultSettler] RAPIDAPI_KEY is not configured. Auto-settler disabled gracefully.');
      return;
    }

    Logger.success(`[ResultSettler] ⏱️ Auto Result Settler Worker started (Interval: ${Math.round(intervalMs / 1000)}s)`);

    // Initial delayed run after 15 seconds to allow full server boot
    setTimeout(() => {
      this.settleActivePredictions().catch((e) =>
        Logger.warn(`[ResultSettler] Initial settlement check failed: ${e.message}`)
      );
    }, 15000);

    this.timer = setInterval(() => {
      this.settleActivePredictions().catch((e) =>
        Logger.warn(`[ResultSettler] Scheduled settlement check failed: ${e.message}`)
      );
    }, intervalMs);
  }

  /**
   * Stops the background settlement interval daemon.
   */
  static stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      Logger.info('[ResultSettler] Service stopped.');
    }
  }
}
