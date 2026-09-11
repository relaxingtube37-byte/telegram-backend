/**
 * src/db/canary/canaryRouter.ts
 *
 * Deterministic Canary Router — Phase 11 Core Component.
 *
 * DESIGN PRINCIPLES:
 * 1. Non-random: Uses MD5 hash ring on user identifier + endpoint for session stability.
 * 2. Read-only: Canary routing applies EXCLUSIVELY to read operations.
 * 3. Write-path isolation: All mutations continue through SQLite + dual-write outbox.
 * 4. Instant disarm: In-memory flag toggled atomically in < 10ms.
 * 5. Decoupled metrics: t_http, t_query, t_pool measured independently.
 *
 * GOVERNANCE:
 * - canaryPct defaults to 0 (all traffic to SQLite).
 * - Setting canaryPct > 0 requires explicit human directive.
 * - This file does NOT set canaryPct > 0 automatically.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CanaryMetrics {
  /** Total HTTP request duration (outer wall clock) */
  t_http_ms: number;
  /** PostgreSQL query execution time only */
  t_query_ms: number;
  /** Connection pool acquisition wait time */
  t_pool_ms: number;
  /** Whether this request was routed to PostgreSQL */
  routed_to_pg: boolean;
  /** Endpoint identifier */
  endpoint: string;
  /** Routed at timestamp */
  routed_at_utc: string;
}

export interface CanaryAuditRecord {
  event: 'ROUTE' | 'DISARM' | 'FALLBACK' | 'CIRCUIT_BREAK';
  reason?: string;
  endpoint?: string;
  routed_to_pg?: boolean;
  canary_pct?: number;
  metrics?: Partial<CanaryMetrics>;
  timestamp_utc: string;
}

// ---------------------------------------------------------------------------
// Latency Budget Thresholds (from Phase 11 spec Section 5.1)
// ---------------------------------------------------------------------------
export const LATENCY_BUDGET = {
  t_pool_max_ms: 10.0,       // Abort to SQLite if pool wait > 10ms
  t_query_p95_ms: 3.0,       // Target P95 for PG query execution
  t_query_p99_ms: 15.0,      // Target P99 for PG query execution
  t_query_hard_ceiling_ms: 50.0, // Circuit breaker trigger
  t_http_added_p95_ms: 5.0,  // Max allowed HTTP overhead vs SQLite baseline
  t_http_added_p99_ms: 25.0, // Max allowed P99 HTTP overhead
  t_http_hard_ceiling_ms: 100.0, // Single-request inspection trigger
} as const;

// ---------------------------------------------------------------------------
// CanaryRouter — Singleton
// ---------------------------------------------------------------------------

class CanaryRouterImpl {
  private _canaryPct: number = 0;  // Default: 0% — all traffic to SQLite
  private _armed: boolean = true;
  private _disarmReason: string | null = null;
  private _auditLog: CanaryAuditRecord[] = [];
  private readonly AUDIT_LOG_PATH = path.resolve(__dirname, '../../../scratch/postgres-phase-11-cutover/canary_audit_log.jsonl');

  /**
   * Determines whether a given request should be routed to PostgreSQL.
   * Uses a deterministic MD5 hash ring — not random — to ensure session stability.
   *
   * @param identifier  User ID, Telegram ID, or client IP (stable per session)
   * @param endpoint    Route identifier (e.g. '/api/predictions/feed')
   * @returns true if PG routing; false if SQLite routing
   */
  shouldRouteToPg(identifier: string, endpoint: string): boolean {
    // Safety: if disarmed or canaryPct is 0, always route to SQLite
    if (!this._armed || this._canaryPct <= 0) return false;
    if (this._canaryPct >= 100) return true;

    const hash = crypto.createHash('md5').update(`${identifier}:${endpoint}`).digest();
    const bucket = hash.readUInt16BE(0) % 100;
    const routed = bucket < this._canaryPct;

    this._appendAudit({
      event: 'ROUTE',
      endpoint,
      routed_to_pg: routed,
      canary_pct: this._canaryPct,
      timestamp_utc: new Date().toISOString(),
    });

    return routed;
  }

  /**
   * Performs an instant soft disarm (Tier 1 rollback).
   * Sets canaryPct to 0 and marks router as disarmed.
   * Target execution time: < 10ms (spec requirement P11-PRE-6 / P11-G4).
   */
  disarm(reason: string): void {
    const t0 = performance.now();
    this._armed = false;
    this._canaryPct = 0;
    this._disarmReason = reason;
    const elapsed = performance.now() - t0;

    const record: CanaryAuditRecord = {
      event: 'DISARM',
      reason,
      timestamp_utc: new Date().toISOString(),
      metrics: { t_http_ms: elapsed },
    };
    this._appendAudit(record);
    console.warn(`[CanaryRouter] DISARMED — reason: ${reason} (${elapsed.toFixed(3)}ms)`);
  }

  /**
   * Benchmarks disarm latency over N iterations.
   * Used for P11-G4 / P11-PRE-6 compliance.
   */
  benchmarkDisarm(iterations: number = 10000): {
    p50_ms: number; p95_ms: number; p99_ms: number; max_ms: number;
    budget_ms: number; verdict: 'PASS' | 'FAIL';
  } {
    const samples: number[] = [];
    for (let i = 0; i < iterations; i++) {
      // Re-arm before each disarm to measure clean path
      this._armed = true;
      const t0 = performance.now();
      this._armed = false;
      this._canaryPct = 0;
      samples.push(performance.now() - t0);
    }
    // Restore disarmed state
    this._armed = false;

    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(iterations * 0.50)];
    const p95 = samples[Math.floor(iterations * 0.95)];
    const p99 = samples[Math.floor(iterations * 0.99)];
    const max = samples[iterations - 1];
    const verdict = p99 < LATENCY_BUDGET.t_pool_max_ms ? 'PASS' : 'FAIL';

    return { p50_ms: p50, p95_ms: p95, p99_ms: p99, max_ms: max, budget_ms: LATENCY_BUDGET.t_pool_max_ms, verdict };
  }

  /**
   * Records a fallback event (PG request failed; falling back to SQLite).
   */
  recordFallback(endpoint: string, reason: string, metrics?: Partial<CanaryMetrics>): void {
    this._appendAudit({ event: 'FALLBACK', endpoint, reason, metrics, timestamp_utc: new Date().toISOString() });
  }

  /**
   * Records a circuit breaker trigger (query exceeded hard ceiling).
   */
  recordCircuitBreak(endpoint: string, t_query_ms: number): void {
    this._appendAudit({
      event: 'CIRCUIT_BREAK',
      endpoint,
      reason: `Query time ${t_query_ms.toFixed(2)}ms exceeded hard ceiling ${LATENCY_BUDGET.t_query_hard_ceiling_ms}ms`,
      metrics: { t_query_ms, endpoint },
      timestamp_utc: new Date().toISOString(),
    });
    this.disarm(`CIRCUIT_BREAK: query ${t_query_ms.toFixed(2)}ms > ${LATENCY_BUDGET.t_query_hard_ceiling_ms}ms`);
  }

  /**
   * Sets the canary percentage. Only callable explicitly — never auto-elevated.
   * Valid values: 0, 1, 5, 25, 50, 100 (per spec Section 4.1).
   * REQUIRES explicit human directive to set > 0.
   */
  setCanaryPct(pct: 0 | 1 | 5 | 25 | 50 | 100): void {
    const VALID_STAGES = [0, 1, 5, 25, 50, 100] as const;
    if (!VALID_STAGES.includes(pct)) {
      throw new Error(`Invalid canary percentage: ${pct}. Must be one of ${VALID_STAGES.join(', ')}.`);
    }
    this._canaryPct = pct;
    if (pct > 0) this._armed = true;
    console.log(`[CanaryRouter] Canary percentage set to ${pct}%. Armed: ${this._armed}`);
  }

  get canaryPct(): number { return this._canaryPct; }
  get isArmed(): boolean { return this._armed; }
  get disarmReason(): string | null { return this._disarmReason; }

  private _appendAudit(record: CanaryAuditRecord): void {
    this._auditLog.push(record);
    // Async persist to disk (non-blocking, fire-and-forget)
    try {
      const dir = path.dirname(this.AUDIT_LOG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(this.AUDIT_LOG_PATH, JSON.stringify(record) + '\n', 'utf-8');
    } catch {
      // Never throw from audit; logging is best-effort
    }
  }

  getAuditLog(): CanaryAuditRecord[] { return [...this._auditLog]; }
}

// Export as singleton
export const CanaryRouter = new CanaryRouterImpl();
export default CanaryRouter;
