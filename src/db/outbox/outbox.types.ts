/**
 * src/db/outbox/outbox.types.ts
 *
 * Types and interfaces for the Transactional SQLite Outbox and Dual-Write Worker.
 */

export type OutboxEventStatus = 'PENDING' | 'PROCESSING' | 'DELIVERED' | 'FAILED' | 'DLQ';

export interface OutboxRecord {
  event_id: string;
  aggregate_type: string;
  aggregate_id: string;
  operation: string;
  payload_json: string;
  payload_sha256: string;
  idempotency_key: string;
  status: OutboxEventStatus;
  attempt_count: number;
  available_at: string;
  locked_at: string | null;
  delivered_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppendOutboxInput {
  aggregateType: string;
  aggregateId: string;
  operation: string;
  payload: any;
  idempotencyKey: string;
  availableAt?: Date;
}

export interface OutboxMetrics {
  total: number;
  pending: number;
  processing: number;
  delivered: number;
  failed: number;
  dlq: number;
}

export interface DlqForensicEnvelope {
  event_id: string;
  idempotency_key: string;
  aggregate_type: string;
  aggregate_id: string;
  operation: string;
  payload_json: string;
  payload_sha256: string;
  attempt_count: number;
  first_failed_at: string;
  last_failed_at: string;
  last_error_code: string;
  last_error_message: string;
  source_commit: string;
}
