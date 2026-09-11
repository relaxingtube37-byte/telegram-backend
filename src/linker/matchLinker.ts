import crypto from 'crypto';
import type Database from 'better-sqlite3';
import {
  type CanonicalMatchCandidate,
  type IncomingRawMatch,
  type LinkDecision,
  type ResolvedMatchContext,
  type ScoredCandidate,
  type SourceName,
  RULE_VERSION,
  SCORER_VERSION,
  SOURCE_BITMASKS,
  SOURCE_PRIORITIES,
} from './types';
import { buildResolvedContext } from './entityResolver';
import { findCandidatesForMatch } from './candidateFinder';
import { scoreCandidate } from './matchScorer';

export interface MatchLinkerEngineOptions {
  canonicalTableName?: 'canonical_matches' | 'canonical_matches_v2' | string;
}

export class MatchLinkerEngine {
  private canonicalTable: string;

  constructor(private db: Database.Database, options: MatchLinkerEngineOptions = {}) {
    const fkEnabled = this.db.pragma('foreign_keys', { simple: true });
    if (fkEnabled !== 1) {
      throw new Error(
        'MatchLinkerEngine requires SQLite foreign keys to be enabled (PRAGMA foreign_keys = ON). Configure connection before initializing engine.'
      );
    }
    this.canonicalTable = options.canonicalTableName === 'canonical_matches_v2' ? 'canonical_matches_v2' : (options.canonicalTableName || 'canonical_matches');
  }

  public getCanonicalTableName(): string {
    return this.canonicalTable;
  }

  /**
   * Main entry point: Processes an incoming raw match through the linking pipeline.
   */
  public processRawMatch(incoming: IncomingRawMatch): LinkDecision {
    const rawPayloadJson = JSON.stringify(incoming.rawPayload || {});
    const payloadHash = crypto.createHash('sha256').update(rawPayloadJson).digest('hex');

    // 1. Stage raw source evidence
    const evidenceId = this.stageRawEvidence(incoming, rawPayloadJson, payloadHash);

    // 2. Resolve entities & build symmetric match context
    const ctx = buildResolvedContext(this.db, incoming, evidenceId);

    // 3. Immediate guard against sibling / player identity ambiguity or identical player IDs
    if (ctx.hasSiblingAmbiguity || !ctx.playerLowId || !ctx.playerHighId || ctx.playerLowId === ctx.playerHighId) {
      const reviewId = this.routeToReviewQueue(
        ctx,
        undefined,
        0,
        ['VETO_SIBLING_AMBIGUITY'],
        { reason: 'Sibling, unresolved, or identical player identity' },
        payloadHash
      );
      return {
        action: 'REVIEW_QUEUE',
        reviewId,
        confidenceScore: 0,
        scorerVersion: SCORER_VERSION,
        ruleVersion: RULE_VERSION,
        vetoTriggers: ['VETO_SIBLING_AMBIGUITY'],
      };
    }

    // 4. Query candidate matches within symmetric +/- 1 day window
    const candidates = findCandidatesForMatch(this.db, ctx, this.canonicalTable);

    // If no candidate exists in the narrow window, create a new canonical match
    if (candidates.length === 0) {
      const canonicalMatchId = this.createNewCanonicalMatch(ctx, payloadHash);
      return {
        action: 'CREATE_NEW_CANONICAL',
        canonicalMatchId,
        confidenceScore: 100,
        scorerVersion: SCORER_VERSION,
        ruleVersion: RULE_VERSION,
        vetoTriggers: [],
      };
    }

    // 5. Score candidates and evaluate veto rules
    const scored: ScoredCandidate[] = candidates
      .map((c) => scoreCandidate(ctx, c))
      .sort((a, b) => b.totalScore - a.totalScore);

    const best = scored[0];

    // 6. Execute 3-Band Decision Policy
    // Band A: AUTO_LINK (Score >= 90.0 AND zero vetoes)
    if (best.totalScore >= 90.0 && best.vetoes.length === 0) {
      this.executeAutoLink(ctx, best.candidate, best.totalScore, payloadHash);
      return {
        action: 'AUTO_LINK',
        canonicalMatchId: best.candidate.canonicalMatchId,
        confidenceScore: best.totalScore,
        scorerVersion: SCORER_VERSION,
        ruleVersion: RULE_VERSION,
        vetoTriggers: [],
      };
    }

    // Band B: REVIEW_QUEUE (Score >= 70.0 OR Vetoed with potential overlap)
    if (best.totalScore >= 70.0 || best.vetoes.length > 0) {
      const divergentFields = {
        date: { incoming: ctx.incoming.matchDate, candidate: best.candidate.matchDate },
        score: { incoming: ctx.incoming.rawScore, candidate: best.candidate.canonicalScore },
        tournament: { incoming: ctx.incoming.rawTournamentName, candidate: best.candidate.canonicalTourneyId },
        round: { incoming: ctx.roundName, candidate: best.candidate.roundName },
        winner: { incoming: ctx.winnerCanonicalId, candidate: best.candidate.winnerCanonicalId },
      };

      const reviewId = this.routeToReviewQueue(
        ctx,
        best.candidate.canonicalMatchId,
        best.totalScore,
        best.vetoes,
        divergentFields,
        payloadHash
      );

      return {
        action: 'REVIEW_QUEUE',
        canonicalMatchId: best.candidate.canonicalMatchId,
        reviewId,
        confidenceScore: best.totalScore,
        scorerVersion: SCORER_VERSION,
        ruleVersion: RULE_VERSION,
        vetoTriggers: best.vetoes,
        divergentFields,
      };
    }

    // Band C: Score < 70.0 with no vetoes -> Independent match
    const canonicalMatchId = this.createNewCanonicalMatch(ctx, payloadHash);
    return {
      action: 'CREATE_NEW_CANONICAL',
      canonicalMatchId,
      confidenceScore: best.totalScore,
      scorerVersion: SCORER_VERSION,
      ruleVersion: RULE_VERSION,
      vetoTriggers: [],
    };
  }

  // ==========================================================================
  // REVIEW QUEUE LIFECYCLE ACTIONS
  // ==========================================================================

  /**
   * Approves a pending review item, linking the incoming source to candidate canonical match.
   */
  public approveReviewItem(
    reviewId: number,
    reviewer: string,
    reason = 'Manual verification confirmed',
    expectedLockVersion?: number,
    targetCanonicalId?: string
  ): LinkDecision {
    return this.db.transaction(() => {
      const item = this.db.prepare(`SELECT * FROM match_review_queue WHERE review_id = ?`).get(reviewId) as any;
      if (!item) throw new Error(`Review item #${reviewId} not found`);
      if (item.review_status !== 'PENDING') throw new Error(`Review item #${reviewId} is already ${item.review_status}`);

      if (expectedLockVersion !== undefined && item.lock_version !== expectedLockVersion) {
        throw new Error(`Lock version conflict: review item #${reviewId} has lock_version ${item.lock_version}, expected ${expectedLockVersion}`);
      }

      const targetId = targetCanonicalId || item.candidate_canonical_id;
      if (!targetId) {
        throw new Error(`Cannot approve review item #${reviewId} without a candidate or target canonical match`);
      }

      const candidate = this.db
        .prepare(`SELECT * FROM ${this.canonicalTable} WHERE canonical_match_id = ?`)
        .get(targetId) as any;
      if (!candidate) throw new Error(`Candidate canonical match ${targetId} not found`);

      const incomingBit = SOURCE_BITMASKS[item.incoming_source as SourceName] || 0;

      // 1. Update review queue status with optimistic lock check
      const res = this.db
        .prepare(
          `UPDATE match_review_queue 
           SET review_status = 'APPROVED', resolved_at = CURRENT_TIMESTAMP, resolved_by = ?, candidate_canonical_id = ?, lock_version = lock_version + 1
           WHERE review_id = ? AND lock_version = ?`
        )
        .run(reviewer, targetId, reviewId, item.lock_version);
      if (res.changes === 0) throw new Error(`Concurrent edit collision on review item #${reviewId}`);

      // 2. Insert link
      this.db
        .prepare(
          `INSERT OR REPLACE INTO match_source_links (
             canonical_match_id, source_name, source_match_id, evidence_id,
             confidence_score, scorer_version, rule_version, link_status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'MANUAL_APPROVED')`
        )
        .run(
          candidate.canonical_match_id,
          item.incoming_source,
          item.incoming_source_id,
          item.incoming_evidence_id,
          100.0,
          SCORER_VERSION,
          RULE_VERSION
        );

      // 3. Update canonical match
      this.db
        .prepare(
          `UPDATE ${this.canonicalTable} 
           SET source_mask = source_mask | ?,
               evidence_count = evidence_count + 1,
               updated_at = CURRENT_TIMESTAMP,
               version = version + 1
           WHERE canonical_match_id = ?`
        )
        .run(incomingBit, candidate.canonical_match_id);

      // 4. Record Field-Level Provenance for approved match
      const ev = this.db
        .prepare(`SELECT raw_payload_json FROM raw_source_evidence WHERE evidence_id = ?`)
        .get(item.incoming_evidence_id) as any;
      const rawPayload = JSON.parse(ev?.raw_payload_json || '{}');
      const incomingScore = rawPayload.score || rawPayload.rawScore;
      const priority = SOURCE_PRIORITIES[item.incoming_source as SourceName] || 10;
      if (incomingScore) {
        const scoreHash = crypto.createHash('sha256').update(incomingScore).digest('hex');
        this.db
          .prepare(
            `INSERT OR REPLACE INTO canonical_match_provenance (
               canonical_match_id, field_name, source_name, source_match_id,
               evidence_id, raw_value, value_hash, priority_weight, confidence, rule_version
             ) VALUES (?, 'canonical_score', ?, ?, ?, ?, ?, ?, 1.0, ?)`
          )
          .run(
            candidate.canonical_match_id,
            item.incoming_source,
            item.incoming_source_id,
            item.incoming_evidence_id,
            incomingScore,
            scoreHash,
            priority,
            RULE_VERSION
          );
      }

      // 5. Record audit log
      this.db
        .prepare(
          `INSERT INTO match_review_audit_log (
             review_id, action, previous_state_json, new_state_json, actor, reason
           ) VALUES (?, 'APPROVE', ?, ?, ?, ?)`
        )
        .run(
          reviewId,
          JSON.stringify({ status: 'PENDING', lock_version: item.lock_version }),
          JSON.stringify({ status: 'APPROVED', lock_version: item.lock_version + 1, canonicalMatchId: candidate.canonical_match_id }),
          reviewer,
          reason
        );

      return {
        action: 'AUTO_LINK' as const,
        canonicalMatchId: candidate.canonical_match_id,
        confidenceScore: 100.0,
        scorerVersion: SCORER_VERSION,
        ruleVersion: RULE_VERSION,
        vetoTriggers: [],
      };
    })();
  }

  /**
   * Rejects a pending review item and creates an independent canonical match for the incoming source.
   */
  public rejectReviewItem(
    reviewId: number,
    reviewer: string,
    reason = 'False positive match rejected',
    expectedLockVersion?: number
  ): string {
    return this.db.transaction(() => {
      const item = this.db.prepare(`SELECT * FROM match_review_queue WHERE review_id = ?`).get(reviewId) as any;
      if (!item) throw new Error(`Review item #${reviewId} not found`);
      if (item.review_status !== 'PENDING') throw new Error(`Review item #${reviewId} is already ${item.review_status}`);

      if (expectedLockVersion !== undefined && item.lock_version !== expectedLockVersion) {
        throw new Error(`Lock version conflict: review item #${reviewId} has lock_version ${item.lock_version}, expected ${expectedLockVersion}`);
      }

      // 1. Update review status
      const res = this.db
        .prepare(
          `UPDATE match_review_queue 
           SET review_status = 'REJECTED', resolved_at = CURRENT_TIMESTAMP, resolved_by = ?, lock_version = lock_version + 1
           WHERE review_id = ? AND lock_version = ?`
        )
        .run(reviewer, reviewId, item.lock_version);
      if (res.changes === 0) throw new Error(`Concurrent edit collision on review item #${reviewId}`);

      // 2. Fetch raw evidence
      const ev = this.db
        .prepare(`SELECT raw_payload_json, payload_sha256 FROM raw_source_evidence WHERE evidence_id = ?`)
        .get(item.incoming_evidence_id) as any;
      const rawPayload = JSON.parse(ev?.raw_payload_json || '{}');

      const incoming: IncomingRawMatch = {
        sourceName: item.incoming_source,
        sourceMatchId: item.incoming_source_id,
        matchDate: rawPayload.matchDate || rawPayload.date || '2024-01-01',
        tour: rawPayload.tour || 'ATP',
        gender: rawPayload.gender || 'M',
        rawTournamentName: rawPayload.tournament || rawPayload.tournamentName || 'Tournament',
        rawPlayer1: rawPayload.player1 || rawPayload.homePlayer || 'Player 1',
        rawPlayer2: rawPayload.player2 || rawPayload.awayPlayer || 'Player 2',
        rawWinnerName: rawPayload.winnerName,
        rawScore: rawPayload.score,
        rawPayload,
      };

      const ctx = buildResolvedContext(this.db, incoming, item.incoming_evidence_id);
      const newCanonicalId = this.createNewCanonicalMatch(ctx, ev?.payload_sha256 || '');

      // 3. Record audit log
      this.db
        .prepare(
          `INSERT INTO match_review_audit_log (
             review_id, action, previous_state_json, new_state_json, actor, reason
           ) VALUES (?, 'REJECT', ?, ?, ?, ?)`
        )
        .run(
          reviewId,
          JSON.stringify({ status: 'PENDING', candidate: item.candidate_canonical_id }),
          JSON.stringify({ status: 'REJECTED', separatedCanonicalId: newCanonicalId }),
          reviewer,
          reason
        );

      return newCanonicalId;
    })();
  }

  /**
   * Splits a bad merge by detaching a specific source into its own distinct canonical match.
   */
  public splitCanonicalMatch(
    canonicalMatchId: string,
    sourceToDetach: SourceName,
    reviewer: string,
    reason: string,
    expectedVersion?: number
  ): string {
    return this.db.transaction(() => {
      const canonical = this.db
        .prepare(`SELECT * FROM ${this.canonicalTable} WHERE canonical_match_id = ?`)
        .get(canonicalMatchId) as any;
      if (!canonical) throw new Error(`Canonical match ${canonicalMatchId} not found`);

      if (expectedVersion !== undefined && canonical.version !== expectedVersion) {
        throw new Error(`Version conflict: canonical match ${canonicalMatchId} has version ${canonical.version}, expected ${expectedVersion}`);
      }

      const link = this.db
        .prepare(`SELECT * FROM match_source_links WHERE canonical_match_id = ? AND source_name = ?`)
        .get(canonicalMatchId, sourceToDetach) as any;
      if (!link) throw new Error(`Link for source ${sourceToDetach} on match ${canonicalMatchId} not found`);

      const bitmask = SOURCE_BITMASKS[sourceToDetach] || 0;

      // 1. Remove link and provenance for that source
      this.db.prepare(`DELETE FROM match_source_links WHERE link_id = ?`).run(link.link_id);
      this.db
        .prepare(`DELETE FROM canonical_match_provenance WHERE canonical_match_id = ? AND source_name = ?`)
        .run(canonicalMatchId, sourceToDetach);

      // 2. Decrement original canonical match
      this.db
        .prepare(
          `UPDATE ${this.canonicalTable} 
           SET source_mask = source_mask & ~?,
               evidence_count = MAX(1, evidence_count - 1),
               updated_at = CURRENT_TIMESTAMP,
               version = version + 1
           WHERE canonical_match_id = ?`
        )
        .run(bitmask, canonicalMatchId);

      // 3. Create independent canonical match for detached source
      const ev = this.db
        .prepare(`SELECT raw_payload_json, payload_sha256 FROM raw_source_evidence WHERE evidence_id = ?`)
        .get(link.evidence_id) as any;
      const rawPayload = JSON.parse(ev?.raw_payload_json || '{}');

      const incoming: IncomingRawMatch = {
        sourceName: sourceToDetach,
        sourceMatchId: link.source_match_id,
        matchDate: rawPayload.matchDate || rawPayload.date || '2024-01-01',
        tour: rawPayload.tour || 'ATP',
        gender: rawPayload.gender || 'M',
        rawTournamentName: rawPayload.tournament || rawPayload.tournamentName || 'Tournament',
        rawPlayer1: rawPayload.player1 || rawPayload.homePlayer || 'Player 1',
        rawPlayer2: rawPayload.player2 || rawPayload.awayPlayer || 'Player 2',
        rawWinnerName: rawPayload.winnerName,
        rawScore: rawPayload.score,
        rawPayload,
      };

      const ctx = buildResolvedContext(this.db, incoming, link.evidence_id);
      const newCanonicalId = this.createNewCanonicalMatch(ctx, ev?.payload_sha256 || '', true);

      // 4. Log split action
      this.db
        .prepare(
          `INSERT INTO match_review_audit_log (
             review_id, action, previous_state_json, new_state_json, actor, reason
           ) VALUES (NULL, 'SPLIT', ?, ?, ?, ?)`
        )
        .run(
          JSON.stringify({ canonicalMatchId, detachedSource: sourceToDetach }),
          JSON.stringify({ newCanonicalId }),
          reviewer,
          reason
        );

      return newCanonicalId;
    })();
  }

  // ==========================================================================
  // INTERNAL PIPELINE HELPERS
  // ==========================================================================

  private stageRawEvidence(incoming: IncomingRawMatch, payloadJson: string, payloadHash: string): number {
    const existing = this.db
      .prepare(`SELECT evidence_id FROM raw_source_evidence WHERE source_name = ? AND source_match_id = ?`)
      .get(incoming.sourceName, incoming.sourceMatchId) as any;

    if (existing) {
      return existing.evidence_id;
    }

    const info = this.db
      .prepare(
        `INSERT INTO raw_source_evidence (source_name, source_match_id, raw_payload_json, payload_sha256)
         VALUES (?, ?, ?, ?)`
      )
      .run(incoming.sourceName, incoming.sourceMatchId, payloadJson, payloadHash);

    return Number(info.lastInsertRowid);
  }

  private executeAutoLink(
    ctx: ResolvedMatchContext,
    candidate: CanonicalMatchCandidate,
    score: number,
    payloadHash: string
  ): void {
    const bitmask = SOURCE_BITMASKS[ctx.incoming.sourceName] || 0;
    const priority = SOURCE_PRIORITIES[ctx.incoming.sourceName] || 10;

    this.db.transaction(() => {
      // 1. Insert Link
      this.db
        .prepare(
          `INSERT OR REPLACE INTO match_source_links (
             canonical_match_id, source_name, source_match_id, evidence_id,
             confidence_score, scorer_version, rule_version, link_status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'AUTO_LINKED')`
        )
        .run(
          candidate.canonicalMatchId,
          ctx.incoming.sourceName,
          ctx.incoming.sourceMatchId,
          ctx.evidenceId,
          score,
          SCORER_VERSION,
          RULE_VERSION
        );

      // 2. Check existing field provenance priority to apply source precedence
      const existingScoreProv = this.db
        .prepare(
          `SELECT priority_weight FROM canonical_match_provenance WHERE canonical_match_id = ? AND field_name = 'canonical_score' ORDER BY priority_weight DESC LIMIT 1`
        )
        .get(candidate.canonicalMatchId) as any;

      const shouldUpdateScore = ctx.incoming.rawScore && (!existingScoreProv || priority >= existingScoreProv.priority_weight);

      // 3. Update Canonical Match
      this.db
        .prepare(
          `UPDATE ${this.canonicalTable} 
           SET source_mask = source_mask | ?,
               evidence_count = evidence_count + 1,
               canonical_score = CASE WHEN ? THEN ? ELSE canonical_score END,
               winner_canonical_id = COALESCE(winner_canonical_id, ?),
               updated_at = CURRENT_TIMESTAMP,
               version = version + 1
           WHERE canonical_match_id = ?`
        )
        .run(
          bitmask,
          shouldUpdateScore ? 1 : 0,
          ctx.incoming.rawScore,
          ctx.winnerCanonicalId ?? null,
          candidate.canonicalMatchId
        );

      // 4. Record Field-Level Provenance
      if (ctx.incoming.rawScore) {
        const scoreHash = crypto.createHash('sha256').update(ctx.incoming.rawScore).digest('hex');
        this.db
          .prepare(
            `INSERT OR REPLACE INTO canonical_match_provenance (
               canonical_match_id, field_name, source_name, source_match_id,
               evidence_id, raw_value, value_hash, priority_weight, confidence, rule_version
             ) VALUES (?, 'canonical_score', ?, ?, ?, ?, ?, ?, 1.0, ?)`
          )
          .run(
            candidate.canonicalMatchId,
            ctx.incoming.sourceName,
            ctx.incoming.sourceMatchId,
            ctx.evidenceId,
            ctx.incoming.rawScore,
            scoreHash,
            priority,
            RULE_VERSION
          );
      }
    })();
  }

  private routeToReviewQueue(
    ctx: ResolvedMatchContext,
    candidateId?: string,
    score = 0,
    vetoes: string[] = [],
    divergentFields: Record<string, unknown> = {},
    payloadHash = ''
  ): number {
    const existing = this.db
      .prepare(
        `SELECT review_id FROM match_review_queue WHERE incoming_source = ? AND incoming_source_id = ? AND review_status = 'PENDING'`
      )
      .get(ctx.incoming.sourceName, ctx.incoming.sourceMatchId) as any;

    if (existing) {
      return existing.review_id;
    }

    const info = this.db
      .prepare(
        `INSERT INTO match_review_queue (
           candidate_canonical_id, incoming_source, incoming_source_id, incoming_evidence_id,
           confidence_score, scorer_version, rule_version, evidence_hash,
           veto_triggers_json, divergent_fields_json, review_status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`
      )
      .run(
        candidateId ?? null,
        ctx.incoming.sourceName,
        ctx.incoming.sourceMatchId,
        ctx.evidenceId,
        score,
        SCORER_VERSION,
        RULE_VERSION,
        payloadHash,
        JSON.stringify(vetoes),
        JSON.stringify(divergentFields)
      );

    const reviewId = Number(info.lastInsertRowid);

    // Write audit log
    this.db
      .prepare(
        `INSERT INTO match_review_audit_log (
           review_id, action, previous_state_json, new_state_json, actor, reason
         ) VALUES (?, ?, NULL, ?, 'SYSTEM', ?)`
      )
      .run(
        reviewId,
        vetoes.length > 0 ? 'AUTO_VETO' : 'SUBMIT',
        JSON.stringify({ score, candidateId, vetoes }),
        vetoes.length > 0 ? `Vetoed: ${vetoes.join(', ')}` : 'Routed to review (Score 70-89.9)'
      );

    return reviewId;
  }

  private ensureEntitiesExist(ctx: ResolvedMatchContext): void {
    const gender = ctx.incoming.tour === 'WTA' ? 'F' : 'M';
    const tourneyLevel =
      ctx.incoming.tour === 'CHALLENGER' ? 'CHALLENGER' : ctx.incoming.tour === 'ITF' ? 'ITF' : 'ATP_250';

    // 1. Ensure tournament exists
    const tourneyId = ctx.canonicalTourneyId || 'ct_unknown';
    this.db
      .prepare(
        `INSERT OR IGNORE INTO canonical_tournaments (
           canonical_tourney_id, name_standard, tour, tour_level, default_surface
         ) VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        tourneyId,
        ctx.incoming.rawTournamentName || 'Unknown Tournament',
        ctx.incoming.tour,
        tourneyLevel,
        ctx.surface
      );

    // 2. Ensure player 1 exists
    this.db
      .prepare(
        `INSERT OR IGNORE INTO canonical_players (
           canonical_player_id, full_name_standard, last_name, gender
         ) VALUES (?, ?, ?, ?)`
      )
      .run(
        ctx.player1CanonicalId,
        ctx.incoming.rawPlayer1,
        ctx.incoming.rawPlayer1.split(' ').pop() || ctx.incoming.rawPlayer1,
        gender
      );

    // 3. Ensure player 2 exists
    this.db
      .prepare(
        `INSERT OR IGNORE INTO canonical_players (
           canonical_player_id, full_name_standard, last_name, gender
         ) VALUES (?, ?, ?, ?)`
      )
      .run(
        ctx.player2CanonicalId,
        ctx.incoming.rawPlayer2,
        ctx.incoming.rawPlayer2.split(' ').pop() || ctx.incoming.rawPlayer2,
        gender
      );
  }

  private createNewCanonicalMatch(ctx: ResolvedMatchContext, payloadHash: string, isSplit = false): string {
    const bitmask = SOURCE_BITMASKS[ctx.incoming.sourceName] || 0;
    const priority = SOURCE_PRIORITIES[ctx.incoming.sourceName] || 10;
    const cleanTourney = (ctx.canonicalTourneyId || 'tourney').replace(/[^a-zA-Z0-9]/g, '');
    const suffix = isSplit ? `_split_${Date.now()}` : '';
    const canonicalId = `cm_${ctx.incoming.matchDate}_${cleanTourney}_${ctx.playerLowId}_${ctx.playerHighId}${suffix}`;

    return this.db.transaction(() => {
      // 0. Ensure referenced entities exist to satisfy foreign keys
      this.ensureEntitiesExist(ctx);

      // 1. Insert Canonical Match
      this.db
        .prepare(
          `INSERT OR IGNORE INTO ${this.canonicalTable} (
             canonical_match_id, match_date, tour, canonical_tourney_id,
             surface, round_name, player_low_id, player_high_id,
             match_status, winner_canonical_id, loser_canonical_id, canonical_score,
             source_mask, evidence_count
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'FINISHED', ?, ?, ?, ?, 1)`
        )
        .run(
          canonicalId,
          ctx.incoming.matchDate,
          ctx.incoming.tour,
          ctx.canonicalTourneyId || 'ct_unknown',
          ctx.surface,
          ctx.roundName,
          ctx.playerLowId,
          ctx.playerHighId,
          ctx.winnerCanonicalId ?? null,
          ctx.loserCanonicalId ?? null,
          ctx.incoming.rawScore ?? null,
          bitmask
        );

      // 2. Insert Link
      this.db
        .prepare(
          `INSERT OR REPLACE INTO match_source_links (
             canonical_match_id, source_name, source_match_id, evidence_id,
             confidence_score, scorer_version, rule_version, link_status
           ) VALUES (?, ?, ?, ?, 100.0, ?, ?, 'AUTO_LINKED')`
        )
        .run(canonicalId, ctx.incoming.sourceName, ctx.incoming.sourceMatchId, ctx.evidenceId, SCORER_VERSION, RULE_VERSION);

      // 3. Record Provenance
      if (ctx.incoming.rawScore) {
        const scoreHash = crypto.createHash('sha256').update(ctx.incoming.rawScore).digest('hex');
        this.db
          .prepare(
            `INSERT OR REPLACE INTO canonical_match_provenance (
               canonical_match_id, field_name, source_name, source_match_id,
               evidence_id, raw_value, value_hash, priority_weight, confidence, rule_version
             ) VALUES (?, 'canonical_score', ?, ?, ?, ?, ?, ?, 1.0, ?)`
          )
          .run(
            canonicalId,
            ctx.incoming.sourceName,
            ctx.incoming.sourceMatchId,
            ctx.evidenceId,
            ctx.incoming.rawScore,
            scoreHash,
            priority,
            RULE_VERSION
          );
      }

      return canonicalId;
    })();
  }
}
