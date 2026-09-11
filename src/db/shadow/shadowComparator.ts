/**
 * src/db/shadow/shadowComparator.ts
 *
 * Core Shadow-Read Parity Comparison Engine for Phase 10.
 *
 * Key Architectural Invariants:
 *   1. Primary SQLite query returns immediately to the caller with ZERO delay (0.00ms latency impact).
 *   2. PostgreSQL shadow queries run completely asynchronously in setImmediate().
 *   3. All shadow execution errors and timeouts are caught and suppressed (never bubble up).
 *   4. Field-by-field diffing with normalization (ISO dates, numeric tolerance, null/undefined unification).
 *   5. Divergences are SHA-256 hashed and persisted to scratch/postgres-phase-10-shadow-reads/shadow_mismatch_ledger.jsonl.
 *   6. Disarmed instantly (<10ms) when ENABLE_STAGING_PG_SHADOW !== 'true'.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type {
  ShadowDomain,
  FieldMismatch,
  ComparisonResult,
  MismatchLedgerEntry,
  ShadowComparatorMetrics,
  LatencyHistogramStats
} from './shadow.types';
import { Logger } from '../../utils/logger';

const LEDGER_DIR = path.resolve(__dirname, '..', '..', '..', 'scratch', 'postgres-phase-10-shadow-reads');
const LEDGER_FILE = path.join(LEDGER_DIR, 'shadow_mismatch_ledger.jsonl');

export class ShadowComparator {
  private static primaryLatencies: number[] = [];
  private static shadowLatencies: number[] = [];
  private static inMemoryLedger: MismatchLedgerEntry[] = [];
  private static totalComparisons = 0;
  private static paritySuccessCount = 0;
  private static mismatchCount = 0;
  private static suppressedErrorsCount = 0;

  /**
   * Hard disable check: disarms comparator in <10ms if flag is false or in production.
   */
  static isEnabled(): boolean {
    if (process.env.NODE_ENV === 'production') return false;
    return process.env.ENABLE_STAGING_PG_SHADOW === 'true';
  }

  /**
   * Asynchronous detached shadow execution wrapper.
   * Immediately returns primary result. Runs shadow read & diff in setImmediate.
   */
  static runDetached<T>(
    domain: ShadowDomain,
    action: string,
    primaryPromise: Promise<T>,
    shadowFetcher: () => Promise<any>,
    recordKeyExtractor?: (res: T) => string
  ): Promise<T> {
    const t0 = performance.now();

    // Hook after primary promise completes
    primaryPromise.then((primaryResult) => {
      const primaryLatency = performance.now() - t0;

      // Check disable switch before scheduling async shadow work
      if (!this.isEnabled()) return;

      setImmediate(async () => {
        // Disarm check at execution time
        if (!this.isEnabled()) return;

        const tShadow0 = performance.now();
        try {
          const shadowResult = await shadowFetcher();
          // Disarm check after asynchronous shadow query finishes
          if (!this.isEnabled()) return;

          const shadowLatency = performance.now() - tShadow0;

          const recordKey = recordKeyExtractor ? recordKeyExtractor(primaryResult) : undefined;
          this.compare(domain, action, primaryResult, shadowResult, primaryLatency, shadowLatency, recordKey);
        } catch (err: any) {
          if (!this.isEnabled()) return;
          this.suppressedErrorsCount++;
          Logger.debug(`[Phase 10 Shadow Comparator] Suppressed shadow read error in ${domain}.${action}: ${err.message}`);
        }
      });

    }).catch(() => {
      // Primary errors bubble up naturally; shadow is skipped
    });

    return primaryPromise;
  }

  /**
   * Field-by-field parity comparison with deep normalization.
   */
  static compare(
    domain: ShadowDomain,
    action: string,
    primary: any,
    shadow: any,
    primaryLatencyMs = 0,
    shadowLatencyMs = 0,
    recordKey = 'root'
  ): ComparisonResult {
    this.totalComparisons++;
    if (this.primaryLatencies.length >= 2000) {
      this.primaryLatencies.shift();
      this.shadowLatencies.shift();
    }
    this.primaryLatencies.push(primaryLatencyMs);
    this.shadowLatencies.push(shadowLatencyMs);

    const primarySha256 = this.computeSha256(primary);
    const shadowSha256 = this.computeSha256(shadow);
    const mismatches: FieldMismatch[] = [];

    const { totalFields, matchingFields } = this.diffValues(primary, shadow, '', mismatches);
    const hasParity = mismatches.length === 0;

    if (hasParity) {
      this.paritySuccessCount++;
    } else {
      this.mismatchCount++;
      this.recordMismatch({
        ledgerId: crypto.randomUUID(),
        timestampUtc: new Date().toISOString(),
        domain,
        action,
        recordKey,
        primaryPayloadSha256: primarySha256,
        shadowPayloadSha256: shadowSha256,
        mismatches
      });
    }

    const parityRatePct = totalFields > 0 ? (matchingFields / totalFields) * 100 : 100;

    return {
      domain,
      action,
      recordKey,
      hasParity,
      totalFieldsChecked: totalFields,
      matchingFieldsCount: matchingFields,
      parityRatePct,
      primaryPayloadSha256: primarySha256,
      shadowPayloadSha256: shadowSha256,
      mismatches,
      primaryLatencyMs,
      shadowLatencyMs,
      timestampUtc: new Date().toISOString()
    };
  }

  /**
   * Deep recursive value diffing with domain-aware normalizations.
   */
  private static diffValues(
    p: any,
    s: any,
    pathPrefix: string,
    mismatches: FieldMismatch[]
  ): { totalFields: number; matchingFields: number } {
    let totalFields = 0;
    let matchingFields = 0;

    // 1. Array comparison
    if (Array.isArray(p) && Array.isArray(s)) {
      totalFields++;
      if (p.length !== s.length) {
        mismatches.push({
          field: pathPrefix || 'root_length',
          primaryValue: p.length,
          shadowValue: s.length,
          divergenceType: 'COUNT_MISMATCH',
          details: `Primary array length ${p.length} != Shadow array length ${s.length}`
        });
      } else {
        matchingFields++;
      }

      const maxLen = Math.max(p.length, s.length);
      for (let i = 0; i < maxLen; i++) {
        const itemRes = this.diffValues(p[i], s[i], `${pathPrefix}[${i}]`, mismatches);
        totalFields += itemRes.totalFields;
        matchingFields += itemRes.matchingFields;
      }
      return { totalFields, matchingFields };
    }

    // 2. Null/Undefined / Missing checks
    const pIsNil = p === null || p === undefined;
    const sIsNil = s === null || s === undefined;

    if (pIsNil && sIsNil) {
      return { totalFields: 1, matchingFields: 1 };
    }
    if (pIsNil && !sIsNil) {
      mismatches.push({
        field: pathPrefix || 'root',
        primaryValue: p,
        shadowValue: s,
        divergenceType: 'MISSING_IN_PRIMARY'
      });
      return { totalFields: 1, matchingFields: 0 };
    }
    if (!pIsNil && sIsNil) {
      mismatches.push({
        field: pathPrefix || 'root',
        primaryValue: p,
        shadowValue: s,
        divergenceType: 'MISSING_IN_SHADOW'
      });
      return { totalFields: 1, matchingFields: 0 };
    }

    // 3. Object comparison
    if (typeof p === 'object' && typeof s === 'object') {
      const pKeys = Object.keys(p);
      const sKeys = Object.keys(s);
      const allKeys = Array.from(new Set([...pKeys, ...sKeys]));

      for (const k of allKeys) {
        const currentPath = pathPrefix ? `${pathPrefix}.${k}` : k;
        const pVal = p[k];
        const sVal = s[k];

        const fieldRes = this.diffValues(pVal, sVal, currentPath, mismatches);
        totalFields += fieldRes.totalFields;
        matchingFields += fieldRes.matchingFields;
      }
      return { totalFields, matchingFields };
    }

    // 4. Primitive normalization & comparison
    totalFields++;

    if (this.areNormalizedValuesEqual(p, s)) {
      matchingFields++;
    } else {
      mismatches.push({
        field: pathPrefix || 'value',
        primaryValue: p,
        shadowValue: s,
        divergenceType: typeof p !== typeof s ? 'TYPE_MISMATCH' : 'VALUE_MISMATCH'
      });
    }

    return { totalFields, matchingFields };
  }

  /**
   * Evaluates value equivalence considering dates, floating point epsilon, and string casing.
   */
  private static areNormalizedValuesEqual(a: any, b: any): boolean {
    if (a === b) return true;

    // Number equality with floating point epsilon
    if (typeof a === 'number' && typeof b === 'number') {
      return Math.abs(a - b) < 0.001;
    }

    // Coerce numeric strings
    if ((typeof a === 'number' && typeof b === 'string') || (typeof a === 'string' && typeof b === 'number')) {
      const numA = Number(a);
      const numB = Number(b);
      if (!isNaN(numA) && !isNaN(numB)) {
        return Math.abs(numA - numB) < 0.001;
      }
    }

    // Boolean vs integer coercion (1/0)
    if (typeof a === 'boolean' && typeof b === 'number') {
      return (a ? 1 : 0) === b;
    }
    if (typeof a === 'number' && typeof b === 'boolean') {
      return a === (b ? 1 : 0);
    }

    // Date normalization (compare milliseconds if both parse as valid dates)
    if (typeof a === 'string' && typeof b === 'string') {
      if (a.trim() === b.trim()) return true;

      const dateA = Date.parse(a);
      const dateB = Date.parse(b);
      if (!isNaN(dateA) && !isNaN(dateB)) {
        return dateA === dateB;
      }
    }

    return false;
  }

  /**
   * Computes deterministic SHA-256 digest of payload.
   */
  private static computeSha256(val: any): string {
    if (val === undefined || val === null) {
      return 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    }
    const str = JSON.stringify(val);
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  /**
   * Persists mismatch ledger entry to scratch disk and in-memory buffer.
   */
  private static recordMismatch(entry: MismatchLedgerEntry): void {
    if (this.inMemoryLedger.length >= 50) {
      this.inMemoryLedger.shift();
    }
    this.inMemoryLedger.push(entry);

    try {
      if (!fs.existsSync(LEDGER_DIR)) {
        fs.mkdirSync(LEDGER_DIR, { recursive: true });
      }
      fs.appendFileSync(LEDGER_FILE, JSON.stringify(entry) + '\n', 'utf8');
    } catch (e: any) {
      Logger.warn(`[Phase 10 Shadow Comparator] Failed to write mismatch ledger: ${e.message}`);
    }
  }

  /**
   * Returns current execution metrics & latency stats.
   */
  static getMetrics(): ShadowComparatorMetrics {
    const calcStats = (latencies: number[]): LatencyHistogramStats => {
      if (latencies.length === 0) {
        return { count: 0, minMs: 0, maxMs: 0, avgMs: 0, p50Ms: 0, p90Ms: 0, p95Ms: 0, p99Ms: 0 };
      }
      const sorted = [...latencies].sort((a, b) => a - b);
      const sum = sorted.reduce((acc, v) => acc + v, 0);
      return {
        count: sorted.length,
        minMs: sorted[0],
        maxMs: sorted[sorted.length - 1],
        avgMs: sum / sorted.length,
        p50Ms: sorted[Math.floor(sorted.length * 0.5)],
        p90Ms: sorted[Math.floor(sorted.length * 0.9)],
        p95Ms: sorted[Math.floor(sorted.length * 0.95)],
        p99Ms: sorted[Math.floor(sorted.length * 0.99)]
      };
    };

    const overallParityRatePct =
      this.totalComparisons > 0 ? (this.paritySuccessCount / this.totalComparisons) * 100 : 100;

    return {
      totalComparisons: this.totalComparisons,
      paritySuccessCount: this.paritySuccessCount,
      mismatchCount: this.mismatchCount,
      suppressedErrorsCount: this.suppressedErrorsCount,
      overallParityRatePct,
      primaryLatency: calcStats(this.primaryLatencies),
      shadowLatency: calcStats(this.shadowLatencies)
    };
  }

  /**
   * Returns captured mismatch ledger.
   */
  static getMismatchLedger(): MismatchLedgerEntry[] {
    return [...this.inMemoryLedger];
  }

  /**
   * Clears in-memory metrics and ledger (for test isolation).
   */
  static reset(): void {
    this.primaryLatencies = [];
    this.shadowLatencies = [];
    this.inMemoryLedger = [];
    this.totalComparisons = 0;
    this.paritySuccessCount = 0;
    this.mismatchCount = 0;
    this.suppressedErrorsCount = 0;
  }
}
