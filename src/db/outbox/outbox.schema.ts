/**
 * src/db/outbox/outbox.schema.ts
 *
 * Schema DDL and index initialization for postgres_dual_write_outbox table in SQLite.
 */

import Database from 'better-sqlite3';

export const OUTBOX_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS postgres_dual_write_outbox (
  event_id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK ( status IN ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'DLQ') ),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  locked_at TEXT,
  delivered_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outbox_claim 
  ON postgres_dual_write_outbox (status, available_at);

CREATE INDEX IF NOT EXISTS idx_outbox_aggregate 
  ON postgres_dual_write_outbox (aggregate_type, aggregate_id);
`;

export function ensureOutboxSchema(db: Database.Database): void {
  db.exec(OUTBOX_SCHEMA_DDL);
}
