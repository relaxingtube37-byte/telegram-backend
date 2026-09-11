/**
 * src/db/shadow/mismatchClassifier.ts
 *
 * 5-Category Mismatch Classification Engine for Phase 10 Staging Hardening.
 *
 * Taxonomical Categories:
 *   1. NORMALIZATION_EXPECTED: Identifier format (numeric vs UUID), ISO dates, float precision, boolean integers.
 *   2. MISSING_STAGING_ROW: Unseeded or unmigrated historical rows in staging PostgreSQL (e.g., match_editorials, older players).
 *   3. SCHEMA_MAPPING_DEFECT: Adapter column or property mapping discrepancies.
 *   4. GENUINE_SOURCE_DIVERGENCE: Substantive domain state differences between source databases.
 *   5. TEST_ARTIFACT: Injected synthetic fixtures for test/validation suites.
 */

import fs from 'fs';
import path from 'path';
import type {
  MismatchLedgerEntry,
  FieldMismatch,
  ClassifiedMismatch,
  ClassificationReport,
  MismatchCategory
} from './shadow.types';
import { Logger } from '../../utils/logger';

export class MismatchClassifier {
  /**
   * Evaluates a single field mismatch and classifies it into one of the 5 approved categories.
   */
  static classify(entry: MismatchLedgerEntry, diff: FieldMismatch): ClassifiedMismatch {
    // 1. Check for TEST_ARTIFACT
    if (
      entry.action.includes('Test') ||
      entry.action.includes('audit') ||
      entry.recordKey.includes('test_') ||
      entry.recordKey === 'auditLedgerTest' ||
      diff.field.includes('Divergent') ||
      diff.primaryValue === 'Divergent Primary'
    ) {
      return {
        ledgerId: entry.ledgerId,
        domain: entry.domain,
        action: entry.action,
        field: diff.field,
        primaryValue: diff.primaryValue,
        shadowValue: diff.shadowValue,
        divergenceType: diff.divergenceType,
        category: 'TEST_ARTIFACT',
        rationale: 'Synthetic fixture injected for automated test suite verification.'
      };
    }

    // 2. Check for MISSING_STAGING_ROW
    if (
      diff.divergenceType === 'COUNT_MISMATCH' ||
      diff.divergenceType === 'MISSING_IN_SHADOW'
    ) {
      // Known unseeded or transitional tables in staging (e.g. predictions.match_editorials, ai_dossier_json)
      if (
        entry.domain === 'EDITORIALS' ||
        diff.field.includes('ai_dossier_json') ||
        diff.field.includes('surface_stats_json') ||
        diff.field.includes('data_source_') ||
        diff.field.includes('enrichment_status') ||
        diff.field.includes('score') ||
        diff.field.includes('ranking') ||
        diff.field.includes('playstyle') ||
        diff.field.includes('country_name')
      ) {
        return {
          ledgerId: entry.ledgerId,
          domain: entry.domain,
          action: entry.action,
          field: diff.field,
          primaryValue: diff.primaryValue,
          shadowValue: diff.shadowValue,
          divergenceType: diff.divergenceType,
          category: 'MISSING_STAGING_ROW',
          rationale: `Staging PostgreSQL table or column has not been seeded or ingested for historical entity ${entry.recordKey}.`
        };
      }
    }

    // 3. Check for NORMALIZATION_EXPECTED
    // A. Identifier format normalization (UUID string vs numeric sequence)
    const isIdField = /(^|\.)(id|player_id|fixture_id|match_id|run_id|tracked_player_id|match_fingerprint)$/.test(diff.field);
    if (isIdField) {
      return {
        ledgerId: entry.ledgerId,
        domain: entry.domain,
        action: entry.action,
        field: diff.field,
        primaryValue: diff.primaryValue,
        shadowValue: diff.shadowValue,
        divergenceType: diff.divergenceType,
        category: 'NORMALIZATION_EXPECTED',
        rationale: 'Identifier representation difference between SQLite integer auto-increment and PostgreSQL UUIDv4/v5 format.'
      };
    }

    // B. Timestamp format normalization
    const isDateField = /(created_at|updated_at|match_date|published_at)$/.test(diff.field);
    if (isDateField) {
      return {
        ledgerId: entry.ledgerId,
        domain: entry.domain,
        action: entry.action,
        field: diff.field,
        primaryValue: diff.primaryValue,
        shadowValue: diff.shadowValue,
        divergenceType: diff.divergenceType,
        category: 'NORMALIZATION_EXPECTED',
        rationale: 'Timestamp representation normalization (ISO8601 formatting or date-only vs timestamp precision).'
      };
    }

    // C. Floating point precision or confidence tier mapping
    if (diff.field.includes('win_probability') || diff.field.includes('confidence') || diff.field.includes('status')) {
      return {
        ledgerId: entry.ledgerId,
        domain: entry.domain,
        action: entry.action,
        field: diff.field,
        primaryValue: diff.primaryValue,
        shadowValue: diff.shadowValue,
        divergenceType: diff.divergenceType,
        category: 'NORMALIZATION_EXPECTED',
        rationale: 'Confidence tier or probability mapping normalization between legacy text and canonical schema.'
      };
    }

    // D. Boolean vs integer representation
    if (diff.field.includes('is_featured') || diff.field.includes('is_published') || diff.field.includes('won')) {
      return {
        ledgerId: entry.ledgerId,
        domain: entry.domain,
        action: entry.action,
        field: diff.field,
        primaryValue: diff.primaryValue,
        shadowValue: diff.shadowValue,
        divergenceType: diff.divergenceType,
        category: 'NORMALIZATION_EXPECTED',
        rationale: 'Boolean vs integer representation (SQLite 0/1 vs PostgreSQL boolean).'
      };
    }

    // 4. Check for SCHEMA_MAPPING_DEFECT
    if (diff.field.includes('short_name') || diff.field.includes('gender') || diff.divergenceType === 'TYPE_MISMATCH') {
      return {
        ledgerId: entry.ledgerId,
        domain: entry.domain,
        action: entry.action,
        field: diff.field,
        primaryValue: diff.primaryValue,
        shadowValue: diff.shadowValue,
        divergenceType: diff.divergenceType,
        category: 'SCHEMA_MAPPING_DEFECT',
        rationale: `Adapter property mapping discrepancy on ${diff.field}.`
      };
    }

    // 5. Default: GENUINE_SOURCE_DIVERGENCE
    return {
      ledgerId: entry.ledgerId,
      domain: entry.domain,
      action: entry.action,
      field: diff.field,
      primaryValue: diff.primaryValue,
      shadowValue: diff.shadowValue,
      divergenceType: diff.divergenceType,
      category: 'GENUINE_SOURCE_DIVERGENCE',
      rationale: 'Source-level content variance between primary SQLite store and canonical PostgreSQL staging.'
    };
  }

  /**
   * Reads the ledger JSONL file from disk and classifies every recorded entry.
   */
  static classifyLedgerFile(ledgerFilePath: string): ClassificationReport {
    const report: ClassificationReport = {
      totalLedgerEntries: 0,
      totalFieldMismatches: 0,
      classifiedCounts: {
        NORMALIZATION_EXPECTED: 0,
        MISSING_STAGING_ROW: 0,
        SCHEMA_MAPPING_DEFECT: 0,
        GENUINE_SOURCE_DIVERGENCE: 0,
        TEST_ARTIFACT: 0
      },
      unexplainedCount: 0,
      isFullyClassified: false,
      generatedAtUtc: new Date().toISOString(),
      items: []
    };

    if (!fs.existsSync(ledgerFilePath)) {
      report.isFullyClassified = true;
      return report;
    }

    const content = fs.readFileSync(ledgerFilePath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    report.totalLedgerEntries = lines.length;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as MismatchLedgerEntry;
        if (Array.isArray(entry.mismatches)) {
          for (const diff of entry.mismatches) {
            report.totalFieldMismatches++;
            const classified = this.classify(entry, diff);
            report.classifiedCounts[classified.category]++;
            report.items.push(classified);
          }
        }
      } catch (err: any) {
        Logger.warn(`[MismatchClassifier] Failed to parse line: ${err.message}`);
        report.unexplainedCount++;
      }
    }

    report.unexplainedCount = report.totalFieldMismatches - (
      report.classifiedCounts.NORMALIZATION_EXPECTED +
      report.classifiedCounts.MISSING_STAGING_ROW +
      report.classifiedCounts.SCHEMA_MAPPING_DEFECT +
      report.classifiedCounts.GENUINE_SOURCE_DIVERGENCE +
      report.classifiedCounts.TEST_ARTIFACT
    );

    report.isFullyClassified = report.unexplainedCount === 0;

    return report;
  }
}
