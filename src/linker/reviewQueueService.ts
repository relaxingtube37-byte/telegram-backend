import type Database from 'better-sqlite3';
import { MatchLinkerEngine } from './matchLinker';
import { SourceName } from './types';

export class LockConflictError extends Error {
  public statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'LockConflictError';
  }
}

export class NotFoundError extends Error {
  public statusCode = 404;
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  public statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface ListReviewQueueOptions {
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ESCALATED' | 'ALL';
  source?: string;
  limit?: number;
  offset?: number;
}

export interface ReviewQueueItemResponse {
  review_id: number;
  candidate_canonical_id: string | null;
  incoming_source: string;
  incoming_source_id: string;
  incoming_evidence_id: number;
  confidence_score: number;
  scorer_version: string;
  rule_version: string;
  evidence_hash: string;
  veto_triggers: string[];
  divergent_fields: Record<string, unknown>;
  review_status: string;
  lock_version: number;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  incoming_payload: Record<string, unknown> | null;
  candidate_match: {
    canonical_match_id: string;
    match_date: string;
    canonical_tourney_id: string;
    player_low_id: string;
    player_high_id: string;
    canonical_score: string | null;
    winner_canonical_id: string | null;
    source_mask: number;
    version: number;
  } | null;
}

export interface ListReviewQueueResult {
  items: ReviewQueueItemResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApproveReviewItemOptions {
  expectedLockVersion: number;
  targetCanonicalId?: string;
  actor?: string;
  reason?: string;
}

export interface RejectReviewItemOptions {
  expectedLockVersion: number;
  actor?: string;
  reason?: string;
}

export interface SplitCanonicalMatchOptions {
  sourceToDetach: string;
  expectedVersion?: number;
  actor?: string;
  reason: string;
}

export class ReviewQueueService {
  private linkerEngine: MatchLinkerEngine;
  private canonicalTable: string;

  constructor(private db: Database.Database, options: { canonicalTableName?: string } = {}) {
    this.canonicalTable = options.canonicalTableName === 'canonical_matches_v2' ? 'canonical_matches_v2' : (options.canonicalTableName || 'canonical_matches');
    this.linkerEngine = new MatchLinkerEngine(db, { canonicalTableName: this.canonicalTable });
  }

  public listItems(options: ListReviewQueueOptions = {}): ListReviewQueueResult {
    const limit = Math.min(Math.max(1, Number(options.limit) || 50), 200);
    const offset = Math.max(0, Number(options.offset) || 0);
    const statusFilter = options.status && options.status !== 'ALL' ? options.status : (options.status === 'ALL' ? null : 'PENDING');
    const sourceFilter = options.source ? options.source.trim() : null;

    const conditions: string[] = [];
    const params: any[] = [];

    if (statusFilter) {
      conditions.push('mrq.review_status = ?');
      params.push(statusFilter);
    }
    if (sourceFilter) {
      conditions.push('mrq.incoming_source = ?');
      params.push(sourceFilter);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = this.db
      .prepare(`SELECT count(*) as total FROM match_review_queue mrq ${whereClause}`)
      .get(...params) as { total: number };

    const total = countRow ? countRow.total : 0;

    const query = `
      SELECT 
        mrq.review_id,
        mrq.candidate_canonical_id,
        mrq.incoming_source,
        mrq.incoming_source_id,
        mrq.incoming_evidence_id,
        mrq.confidence_score,
        mrq.scorer_version,
        mrq.rule_version,
        mrq.evidence_hash,
        mrq.veto_triggers_json,
        mrq.divergent_fields_json,
        mrq.review_status,
        mrq.lock_version,
        mrq.created_at,
        mrq.resolved_at,
        mrq.resolved_by,
        rse.raw_payload_json,
        cm.match_date AS candidate_match_date,
        cm.canonical_tourney_id AS candidate_tourney_id,
        cm.player_low_id AS candidate_player_low_id,
        cm.player_high_id AS candidate_player_high_id,
        cm.canonical_score AS candidate_canonical_score,
        cm.winner_canonical_id AS candidate_winner_id,
        cm.source_mask AS candidate_source_mask,
        cm.version AS candidate_version
      FROM match_review_queue mrq
      LEFT JOIN raw_source_evidence rse ON mrq.incoming_evidence_id = rse.evidence_id
      LEFT JOIN ${this.canonicalTable} cm ON mrq.candidate_canonical_id = cm.canonical_match_id
      ${whereClause}
      ORDER BY mrq.review_id DESC
      LIMIT ? OFFSET ?
    `;

    const rows = this.db.prepare(query).all(...params, limit, offset) as any[];

    const items: ReviewQueueItemResponse[] = rows.map((row) => {
      let vetoTriggers: string[] = [];
      let divergentFields: Record<string, unknown> = {};
      let incomingPayload: Record<string, unknown> | null = null;

      try {
        if (row.veto_triggers_json) vetoTriggers = JSON.parse(row.veto_triggers_json);
      } catch {}

      try {
        if (row.divergent_fields_json) divergentFields = JSON.parse(row.divergent_fields_json);
      } catch {}

      try {
        if (row.raw_payload_json) incomingPayload = JSON.parse(row.raw_payload_json);
      } catch {}

      const candidateMatch = row.candidate_canonical_id
        ? {
            canonical_match_id: row.candidate_canonical_id,
            match_date: row.candidate_match_date,
            canonical_tourney_id: row.candidate_tourney_id,
            player_low_id: row.candidate_player_low_id,
            player_high_id: row.candidate_player_high_id,
            canonical_score: row.candidate_canonical_score,
            winner_canonical_id: row.candidate_winner_id,
            source_mask: row.candidate_source_mask,
            version: row.candidate_version,
          }
        : null;

      return {
        review_id: row.review_id,
        candidate_canonical_id: row.candidate_canonical_id,
        incoming_source: row.incoming_source,
        incoming_source_id: row.incoming_source_id,
        incoming_evidence_id: row.incoming_evidence_id,
        confidence_score: row.confidence_score,
        scorer_version: row.scorer_version,
        rule_version: row.rule_version,
        evidence_hash: row.evidence_hash,
        veto_triggers: vetoTriggers,
        divergent_fields: divergentFields,
        review_status: row.review_status,
        lock_version: row.lock_version,
        created_at: row.created_at,
        resolved_at: row.resolved_at,
        resolved_by: row.resolved_by,
        incoming_payload: incomingPayload,
        candidate_match: candidateMatch,
      };
    });

    return { items, total, limit, offset };
  }

  public getItemById(reviewId: number): ReviewQueueItemResponse {
    const query = `
      SELECT 
        mrq.review_id,
        mrq.candidate_canonical_id,
        mrq.incoming_source,
        mrq.incoming_source_id,
        mrq.incoming_evidence_id,
        mrq.confidence_score,
        mrq.scorer_version,
        mrq.rule_version,
        mrq.evidence_hash,
        mrq.veto_triggers_json,
        mrq.divergent_fields_json,
        mrq.review_status,
        mrq.lock_version,
        mrq.created_at,
        mrq.resolved_at,
        mrq.resolved_by,
        rse.raw_payload_json,
        cm.match_date AS candidate_match_date,
        cm.canonical_tourney_id AS candidate_tourney_id,
        cm.player_low_id AS candidate_player_low_id,
        cm.player_high_id AS candidate_player_high_id,
        cm.canonical_score AS candidate_canonical_score,
        cm.winner_canonical_id AS candidate_winner_id,
        cm.source_mask AS candidate_source_mask,
        cm.version AS candidate_version
      FROM match_review_queue mrq
      LEFT JOIN raw_source_evidence rse ON mrq.incoming_evidence_id = rse.evidence_id
      LEFT JOIN ${this.canonicalTable} cm ON mrq.candidate_canonical_id = cm.canonical_match_id
      WHERE mrq.review_id = ?
    `;

    const row = this.db.prepare(query).get(reviewId) as any;
    if (!row) {
      throw new NotFoundError(`Review item #${reviewId} not found`);
    }

    let vetoTriggers: string[] = [];
    let divergentFields: Record<string, unknown> = {};
    let incomingPayload: Record<string, unknown> | null = null;

    try {
      if (row.veto_triggers_json) vetoTriggers = JSON.parse(row.veto_triggers_json);
    } catch {}

    try {
      if (row.divergent_fields_json) divergentFields = JSON.parse(row.divergent_fields_json);
    } catch {}

    try {
      if (row.raw_payload_json) incomingPayload = JSON.parse(row.raw_payload_json);
    } catch {}

    const candidateMatch = row.candidate_canonical_id
      ? {
          canonical_match_id: row.candidate_canonical_id,
          match_date: row.candidate_match_date,
          canonical_tourney_id: row.candidate_tourney_id,
          player_low_id: row.candidate_player_low_id,
          player_high_id: row.candidate_player_high_id,
          canonical_score: row.candidate_canonical_score,
          winner_canonical_id: row.candidate_winner_id,
          source_mask: row.candidate_source_mask,
          version: row.candidate_version,
        }
      : null;

    return {
      review_id: row.review_id,
      candidate_canonical_id: row.candidate_canonical_id,
      incoming_source: row.incoming_source,
      incoming_source_id: row.incoming_source_id,
      incoming_evidence_id: row.incoming_evidence_id,
      confidence_score: row.confidence_score,
      scorer_version: row.scorer_version,
      rule_version: row.rule_version,
      evidence_hash: row.evidence_hash,
      veto_triggers: vetoTriggers,
      divergent_fields: divergentFields,
      review_status: row.review_status,
      lock_version: row.lock_version,
      created_at: row.created_at,
      resolved_at: row.resolved_at,
      resolved_by: row.resolved_by,
      incoming_payload: incomingPayload,
      candidate_match: candidateMatch,
    };
  }

  public approve(reviewId: number, options: ApproveReviewItemOptions) {
    if (typeof options.expectedLockVersion !== 'number') {
      throw new ValidationError('expected_lock_version is required for optimistic concurrency');
    }

    const item = this.db.prepare(`SELECT * FROM match_review_queue WHERE review_id = ?`).get(reviewId) as any;
    if (!item) {
      throw new NotFoundError(`Review item #${reviewId} not found`);
    }

    // Idempotency check: if already APPROVED
    if (item.review_status === 'APPROVED') {
      return {
        success: true,
        idempotent: true,
        status: 'APPROVED',
        reviewId,
        canonicalMatchId: item.candidate_canonical_id,
        lockVersion: item.lock_version,
        message: `Review item #${reviewId} was already approved`,
      };
    }

    if (item.review_status !== 'PENDING') {
      throw new ValidationError(`Review item #${reviewId} cannot be approved because current status is ${item.review_status}`);
    }

    if (item.lock_version !== options.expectedLockVersion) {
      throw new LockConflictError(
        `Lock version conflict: review item #${reviewId} current lock_version is ${item.lock_version}, expected ${options.expectedLockVersion}`
      );
    }

    try {
      const actor = options.actor || 'admin';
      const reason = options.reason || 'Manually approved by admin';
      const res = this.linkerEngine.approveReviewItem(
        reviewId,
        actor,
        reason,
        options.expectedLockVersion,
        options.targetCanonicalId
      );

      return {
        success: true,
        idempotent: false,
        status: 'APPROVED',
        reviewId,
        canonicalMatchId: res.canonicalMatchId,
        lockVersion: item.lock_version + 1,
        message: `Review item #${reviewId} approved and linked to ${res.canonicalMatchId}`,
      };
    } catch (err: any) {
      if (err.message && (err.message.includes('Lock version conflict') || err.message.includes('Concurrent edit collision'))) {
        throw new LockConflictError(err.message);
      }
      if (err.message && (err.message.includes('not found') || err.message.includes('without a candidate'))) {
        throw new ValidationError(err.message);
      }
      throw err;
    }
  }

  public reject(reviewId: number, options: RejectReviewItemOptions) {
    if (typeof options.expectedLockVersion !== 'number') {
      throw new ValidationError('expected_lock_version is required for optimistic concurrency');
    }

    const item = this.db.prepare(`SELECT * FROM match_review_queue WHERE review_id = ?`).get(reviewId) as any;
    if (!item) {
      throw new NotFoundError(`Review item #${reviewId} not found`);
    }

    // Idempotency check: if already REJECTED
    if (item.review_status === 'REJECTED') {
      return {
        success: true,
        idempotent: true,
        status: 'REJECTED',
        reviewId,
        lockVersion: item.lock_version,
        message: `Review item #${reviewId} was already rejected`,
      };
    }

    if (item.review_status !== 'PENDING') {
      throw new ValidationError(`Review item #${reviewId} cannot be rejected because current status is ${item.review_status}`);
    }

    if (item.lock_version !== options.expectedLockVersion) {
      throw new LockConflictError(
        `Lock version conflict: review item #${reviewId} current lock_version is ${item.lock_version}, expected ${options.expectedLockVersion}`
      );
    }

    try {
      const actor = options.actor || 'admin';
      const reason = options.reason || 'False positive match rejected';
      const separatedCanonicalId = this.linkerEngine.rejectReviewItem(
        reviewId,
        actor,
        reason,
        options.expectedLockVersion
      );

      return {
        success: true,
        idempotent: false,
        status: 'REJECTED',
        reviewId,
        separatedCanonicalId,
        lockVersion: item.lock_version + 1,
        message: `Review item #${reviewId} rejected. Created separated canonical match ${separatedCanonicalId}`,
      };
    } catch (err: any) {
      if (err.message && (err.message.includes('Lock version conflict') || err.message.includes('Concurrent edit collision'))) {
        throw new LockConflictError(err.message);
      }
      throw err;
    }
  }

  public split(canonicalMatchId: string, options: SplitCanonicalMatchOptions) {
    if (!options.sourceToDetach) {
      throw new ValidationError('sourceToDetach is required');
    }
    if (!options.reason || !options.reason.trim()) {
      throw new ValidationError('reason is required for split action audit trail');
    }

    const canonical = this.db
      .prepare(`SELECT * FROM canonical_matches WHERE canonical_match_id = ?`)
      .get(canonicalMatchId) as any;
    if (!canonical) {
      throw new NotFoundError(`Canonical match ${canonicalMatchId} not found`);
    }

    if (typeof options.expectedVersion === 'number' && canonical.version !== options.expectedVersion) {
      throw new LockConflictError(
        `Version conflict: canonical match ${canonicalMatchId} has version ${canonical.version}, expected ${options.expectedVersion}`
      );
    }

    const actor = options.actor || 'admin';
    try {
      const newCanonicalId = this.linkerEngine.splitCanonicalMatch(
        canonicalMatchId,
        options.sourceToDetach as SourceName,
        actor,
        options.reason,
        options.expectedVersion
      );

      return {
        success: true,
        action: 'SPLIT',
        originalCanonicalMatchId: canonicalMatchId,
        detachedSource: options.sourceToDetach,
        separatedCanonicalMatchId: newCanonicalId,
        previousVersion: canonical.version,
        newVersion: canonical.version + 1,
        message: `Source ${options.sourceToDetach} detached from ${canonicalMatchId} into new entity ${newCanonicalId}`,
      };
    } catch (err: any) {
      if (err.message && err.message.includes('Version conflict')) {
        throw new LockConflictError(err.message);
      }
      if (err.message && err.message.includes('not found')) {
        throw new NotFoundError(err.message);
      }
      throw err;
    }
  }

  public getAuditLogs(options: { reviewId?: number; action?: string; limit?: number; offset?: number } = {}) {
    const limit = Math.min(Math.max(1, Number(options.limit) || 50), 200);
    const offset = Math.max(0, Number(options.offset) || 0);

    const conditions: string[] = [];
    const params: any[] = [];

    if (options.reviewId !== undefined) {
      conditions.push('review_id = ?');
      params.push(options.reviewId);
    }
    if (options.action) {
      conditions.push('action = ?');
      params.push(options.action);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = this.db
      .prepare(`SELECT count(*) as total FROM match_review_audit_log ${whereClause}`)
      .get(...params) as { total: number };
    const total = countRow ? countRow.total : 0;

    const rows = this.db
      .prepare(
        `SELECT log_id, review_id, action, previous_state_json, new_state_json, actor, reason, logged_at
         FROM match_review_audit_log
         ${whereClause}
         ORDER BY log_id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as any[];

    const items = rows.map((r) => {
      let previousState = null;
      let newState = null;
      try {
        if (r.previous_state_json) previousState = JSON.parse(r.previous_state_json);
      } catch {}
      try {
        if (r.new_state_json) newState = JSON.parse(r.new_state_json);
      } catch {}

      return {
        log_id: r.log_id,
        review_id: r.review_id,
        action: r.action,
        previous_state: previousState,
        new_state: newState,
        actor: r.actor,
        reason: r.reason,
        logged_at: r.logged_at,
      };
    });

    return { items, total, limit, offset };
  }
}
