/**
 * src/db/shadow/shadow.types.ts
 *
 * Type definitions for Phase 10 Staging Shadow-Read Parity Comparator.
 */

export type ShadowDomain = 'PREDICTIONS' | 'EDITORIALS' | 'PLAYERS' | 'MATCHES';

export type DivergenceType =
  | 'MISSING_IN_SHADOW'
  | 'MISSING_IN_PRIMARY'
  | 'VALUE_MISMATCH'
  | 'TYPE_MISMATCH'
  | 'COUNT_MISMATCH';

export interface FieldMismatch {
  field: string;
  primaryValue: any;
  shadowValue: any;
  divergenceType: DivergenceType;
  details?: string;
}

export interface ComparisonResult {
  domain: ShadowDomain;
  action: string;
  recordKey?: string;
  hasParity: boolean;
  totalFieldsChecked: number;
  matchingFieldsCount: number;
  parityRatePct: number;
  primaryPayloadSha256: string;
  shadowPayloadSha256: string;
  mismatches: FieldMismatch[];
  primaryLatencyMs: number;
  shadowLatencyMs: number;
  timestampUtc: string;
}

export interface MismatchLedgerEntry {
  ledgerId: string;
  timestampUtc: string;
  domain: ShadowDomain;
  action: string;
  recordKey: string;
  primaryPayloadSha256: string;
  shadowPayloadSha256: string;
  mismatches: FieldMismatch[];
}

export interface LatencyHistogramStats {
  count: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface ShadowComparatorMetrics {
  totalComparisons: number;
  paritySuccessCount: number;
  mismatchCount: number;
  suppressedErrorsCount: number;
  overallParityRatePct: number;
  primaryLatency: LatencyHistogramStats;
  shadowLatency: LatencyHistogramStats;
}

export type MismatchCategory =
  | 'NORMALIZATION_EXPECTED'
  | 'MISSING_STAGING_ROW'
  | 'SCHEMA_MAPPING_DEFECT'
  | 'GENUINE_SOURCE_DIVERGENCE'
  | 'TEST_ARTIFACT';

export interface ClassifiedMismatch {
  ledgerId: string;
  domain: ShadowDomain;
  action: string;
  field: string;
  primaryValue: any;
  shadowValue: any;
  divergenceType: DivergenceType;
  category: MismatchCategory;
  rationale: string;
}

export interface ClassificationReport {
  totalLedgerEntries: number;
  totalFieldMismatches: number;
  classifiedCounts: Record<MismatchCategory, number>;
  unexplainedCount: number;
  isFullyClassified: boolean;
  generatedAtUtc: string;
  items: ClassifiedMismatch[];
}

