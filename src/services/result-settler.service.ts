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
  private static defaultIntervalMs = 5 * 1000; // 5 seconds

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
          const statusCode = Number(ev.status?.code ?? -1);

          // Extract sets score (e.g. 2-0, 2-1)
          const hSets = Number(ev.homeScore?.current ?? ev.homeScore?.display ?? 0) || 0;
          const aSets = Number(ev.awayScore?.current ?? ev.awayScore?.display ?? 0) || 0;
          const maxSetsWon = Math.max(hSets, aSets);

          // Identify specific termination reasons for unfinished matches
          const isRetirement =
            statusCode === 92 ||
            statusDesc.includes('retired') ||
            statusDesc.includes('retirement');

          const isWalkover =
            statusCode === 93 ||
            statusDesc.includes('walkover');

          const isCanceledOrPostponed =
            statusType === 'canceled' ||
            statusType === 'cancelled' ||
            statusDesc.includes('cancel') ||
            statusDesc.includes('postpon') ||
            statusDesc.includes('abandon') ||
            statusDesc.includes('not played');

          const isFinished =
            statusType === 'finished' ||
            statusDesc.includes('finish') ||
            statusDesc.includes('ended') ||
            isRetirement ||
            isWalkover;

          // ── CASE 1: UNFINISHED / PREMATURE MATCH TERMINATION -> VOID (NEVER LOST) ──
          // In tennis: ATP/WTA/Challenger/ITF matches require at least 2 sets won by the winner.
          // If a match is marked finished but neither player won 2 sets (e.g. 1-0 or 0-1),
          // or if the match ended by retirement/walkover/cancellation/abandonment:
          // In sports betting and fair prediction tracking, it MUST be settled as VOID.
          if (isRetirement || isWalkover || isCanceledOrPostponed || (isFinished && maxSetsWon < 2)) {
            let voidScore = 'VOID';
            if (isWalkover) {
              voidScore = 'W/O';
            } else if (isRetirement || (isFinished && maxSetsWon < 2)) {
              const rawScore = (hSets !== 0 || aSets !== 0) ? `${hSets}-${aSets}` : '';
              voidScore = rawScore ? `${rawScore} (Ret.)` : 'RET';
            } else if (statusDesc.includes('abandon')) {
              voidScore = 'ABAND.';
            } else if (statusDesc.includes('postpon')) {
              voidScore = 'POSTP.';
            }

            const ok = PredictionsService.updateResultByFixtureId(fixtureId, 'VOID', voidScore);
            if (ok) {
              settledCount++;
              settledList.push({ fixture_id: fixtureId, status: 'VOID', score: voidScore });
              Logger.info(
                `[ResultSettler] 🔄 Match #${fixtureId} (${pred.home_name} vs ${pred.away_name}) is UNFINISHED/RETIRED -> Settled as VOID [Score: ${voidScore}]`
              );

              // Notify Telegram channel of VOID outcome
              try {
                const announce = await ChannelPosterService.announceResultIfNeeded(
                  { ...pred, status: 'VOID' },
                  'VOID',
                  voidScore
                );
                if (announce.posted) {
                  Logger.info(`[ResultSettler] Channel VOID result posted for fixture #${fixtureId}`);
                }
              } catch (channelErr: any) {
                Logger.warn(`[ResultSettler] Failed to post channel VOID update for #${fixtureId}: ${channelErr.message}`);
              }
            }
            continue;
          }

          // ── CASE 2: ACTIVE MATCH NOT YET FINISHED ──
          if (!isFinished) {
            // Check 2A: In Progress / LIVE with genuine triplet scores
            if (statusType === 'inprogress' || statusDesc.includes('in progress') || statusDesc.includes('live')) {
              const hPoints = ev.homeScore?.point ?? '0';
              const aPoints = ev.awayScore?.point ?? '0';
              let hGames = 0;
              let aGames = 0;
              for (let i = 1; i <= 5; i++) {
                const hp = ev.homeScore?.[`period${i}`];
                const ap = ev.awayScore?.[`period${i}`];
                if (hp !== undefined && ap !== undefined) {
                  hGames = hp;
                  aGames = ap;
                }
              }
              const liveScoreStr = `${hSets}-${aSets}   ${hPoints}-${aPoints}    ${hGames}-${aGames}`;
              PredictionsService.updateResultByFixtureId(fixtureId, 'LIVE', liveScoreStr);
              Logger.info(`[ResultSettler] Match #${fixtureId} (${pred.home_name} vs ${pred.away_name}) is LIVE: ${liveScoreStr}`);
            }
            // Check 2B: Interrupted / Suspended / Rain Delay
            else if (
              statusType === 'interrupted' ||
              statusDesc.includes('interrupted') ||
              statusDesc.includes('suspended') ||
              statusDesc.includes('delay') ||
              statusDesc.includes('rain')
            ) {
              if (pred.status !== 'INTERRUPTED') {
                PredictionsService.updateResultByFixtureId(fixtureId, 'INTERRUPTED', pred.result_score || 'PAUSED');
                Logger.info(`[ResultSettler] Match #${fixtureId} (${pred.home_name} vs ${pred.away_name}) is INTERRUPTED`);
              }
            }
            // Check 2C: Not Started / Upcoming
            else if (
              statusType === 'notstarted' ||
              statusDesc.includes('not started') ||
              statusCode === 0
            ) {
              if (pred.status !== 'UPCOMING' || pred.result_score) {
                PredictionsService.updateResultByFixtureId(fixtureId, 'UPCOMING', undefined);
                Logger.info(`[ResultSettler] Match #${fixtureId} (${pred.home_name} vs ${pred.away_name}) is NOT STARTED -> reverted to UPCOMING`);
              }
            }
            continue;
          }

          // ── CASE 3: GENUINELY COMPLETED MATCH (Winner Won >= 2 sets) ──
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

          // Fail-safe: if match is finished but winner is missing or unknown, VOID it (never false-flag as LOST)
          if (!actualWinnerName || !pred.predicted_winner) {
            Logger.warn(`[ResultSettler] Match #${fixtureId} completed without definitive winner. Settling as VOID.`);
            const scoreStr = `${hSets}-${aSets}`;
            PredictionsService.updateResultByFixtureId(fixtureId, 'VOID', scoreStr);
            settledCount++;
            settledList.push({ fixture_id: fixtureId, status: 'VOID', score: scoreStr });
            continue;
          }

          // Strict winner name verification
          const won = isWinnerNameMatch(actualWinnerName, pred.predicted_winner);
          const status: 'WON' | 'LOST' = won ? 'WON' : 'LOST';
          const scoreStr = `${hSets}-${aSets}`;

          // Persist settled outcome in SQLite
          const ok = PredictionsService.updateResultByFixtureId(fixtureId, status, scoreStr);
          if (ok) {
            settledCount++;
            settledList.push({ fixture_id: fixtureId, status, score: scoreStr });
            Logger.success(
              `[ResultSettler] 🎯 Settled #${fixtureId} (${pred.home_name} vs ${pred.away_name}) -> ${status} [Score: ${scoreStr}]`
            );

            // Notify Telegram channel once per fixture (durable result_announced_at)
            try {
              const announce = await ChannelPosterService.announceResultIfNeeded(
                { ...pred, status },
                status,
                scoreStr,
              );
              if (announce.posted) {
                Logger.info(`[ResultSettler] Channel result update posted for fixture #${fixtureId}`);
              } else if (announce.skipped) {
                Logger.info(`[ResultSettler] Channel result skipped (#${fixtureId}): ${announce.reason}`);
              }
            } catch (channelErr: any) {
              Logger.warn(`[ResultSettler] Failed to post channel update for #${fixtureId}: ${channelErr.message}`);
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

    const hasApiKey = Boolean((ENV.ALLSPORTS_API_KEY && ENV.ALLSPORTS_API_KEY.length > 5) || (ENV.RAPIDAPI_KEY && ENV.RAPIDAPI_KEY.length > 5));
    if (!hasApiKey) {
      Logger.warn('[ResultSettler] Neither ALLSPORTS_API_KEY nor RAPIDAPI_KEY is configured. Auto-settler disabled gracefully.');
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
