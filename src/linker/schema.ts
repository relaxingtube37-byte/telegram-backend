import type Database from 'better-sqlite3';

export interface ConnectionPragmaOptions {
  enableWal?: boolean;
  synchronousNormal?: boolean;
}

export function configureLinkerConnection(
  db: Database.Database,
  options: ConnectionPragmaOptions = {}
): void {
  // Mandatory connection pragmas
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // Explicit opt-in persistent database pragmas
  if (options.enableWal) {
    db.pragma('journal_mode = WAL');
  }
  if (options.synchronousNormal) {
    db.pragma('synchronous = NORMAL');
  }
}

export function enableWalModeExplicitly(db: Database.Database): string {
  return db.pragma('journal_mode = WAL', { simple: true }) as string;
}

export function initCanonicalLinkerSchema(db: Database.Database): void {
  configureLinkerConnection(db);
  db.exec(`

    -- 1. Canonical Players
    CREATE TABLE IF NOT EXISTS canonical_players (
      canonical_player_id TEXT PRIMARY KEY,
      full_name_standard TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT NOT NULL,
      birth_date TEXT,
      ioc_country TEXT,
      gender TEXT NOT NULL CHECK (gender IN ('M', 'F')),
      hand TEXT CHECK (hand IN ('R', 'L', 'A', 'U')),
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );

    CREATE TABLE IF NOT EXISTS player_aliases (
      alias_id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_player_id TEXT NOT NULL,
      source_name TEXT NOT NULL,
      raw_name TEXT NOT NULL,
      normalized_token TEXT NOT NULL,
      is_verified INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0, 1)),
      has_sibling_conflict INTEGER NOT NULL DEFAULT 0 CHECK (has_sibling_conflict IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      FOREIGN KEY (canonical_player_id) REFERENCES canonical_players(canonical_player_id) ON DELETE CASCADE,
      UNIQUE(source_name, raw_name)
    );

    -- 2. Canonical Tournaments
    CREATE TABLE IF NOT EXISTS canonical_tournaments (
      canonical_tourney_id TEXT PRIMARY KEY,
      name_standard TEXT NOT NULL,
      tour TEXT NOT NULL CHECK (tour IN ('ATP', 'WTA', 'CHALLENGER', 'ITF')),
      tour_level TEXT NOT NULL CHECK (tour_level IN ('GRAND_SLAM', 'MASTERS_1000', 'WTA_1000', 'ATP_500', 'ATP_250', 'CHALLENGER', 'ITF')),
      default_surface TEXT NOT NULL CHECK (default_surface IN ('HARD', 'CLAY', 'GRASS', 'CARPET')),
      country_ioc TEXT,
      city TEXT,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );

    CREATE TABLE IF NOT EXISTS tournament_aliases (
      alias_id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_tourney_id TEXT NOT NULL,
      source_name TEXT NOT NULL,
      raw_name TEXT NOT NULL,
      normalized_token TEXT NOT NULL,
      is_verified INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      FOREIGN KEY (canonical_tourney_id) REFERENCES canonical_tournaments(canonical_tourney_id) ON DELETE CASCADE,
      UNIQUE(source_name, raw_name)
    );

    -- 3. Raw Source Evidence
    CREATE TABLE IF NOT EXISTS raw_source_evidence (
      evidence_id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_name TEXT NOT NULL,
      source_match_id TEXT NOT NULL,
      raw_payload_json TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      UNIQUE(source_name, source_match_id)
    );

    -- 4. Canonical Matches (Symmetric Pair)
    CREATE TABLE IF NOT EXISTS canonical_matches (
      canonical_match_id TEXT PRIMARY KEY,
      match_date TEXT NOT NULL,
      tour TEXT NOT NULL CHECK (tour IN ('ATP', 'WTA', 'CHALLENGER', 'ITF')),
      canonical_tourney_id TEXT NOT NULL,
      surface TEXT NOT NULL CHECK (surface IN ('HARD', 'CLAY', 'GRASS', 'CARPET')),
      round_name TEXT NOT NULL CHECK (round_name IN ('F', 'SF', 'QF', 'R16', 'R32', 'R64', 'R128', 'RR', 'Q1', 'Q2', 'Q3')),
      player_low_id TEXT NOT NULL,
      player_high_id TEXT NOT NULL,
      match_status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (match_status IN ('SCHEDULED', 'FINISHED', 'RETIRED', 'WALKOVER', 'ABANDONED', 'CANCELLED')),
      winner_canonical_id TEXT,
      loser_canonical_id TEXT,
      canonical_score TEXT,
      source_mask INTEGER NOT NULL DEFAULT 0,
      evidence_count INTEGER NOT NULL DEFAULT 1,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      CHECK (player_low_id < player_high_id),
      FOREIGN KEY (canonical_tourney_id) REFERENCES canonical_tournaments(canonical_tourney_id),
      FOREIGN KEY (player_low_id) REFERENCES canonical_players(canonical_player_id),
      FOREIGN KEY (player_high_id) REFERENCES canonical_players(canonical_player_id),
      FOREIGN KEY (winner_canonical_id) REFERENCES canonical_players(canonical_player_id),
      FOREIGN KEY (loser_canonical_id) REFERENCES canonical_players(canonical_player_id)
    );

    -- 5. Field-Level Provenance
    CREATE TABLE IF NOT EXISTS canonical_match_provenance (
      provenance_id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_match_id TEXT NOT NULL,
      field_name TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_match_id TEXT NOT NULL,
      evidence_id INTEGER NOT NULL,
      raw_value TEXT,
      value_hash TEXT NOT NULL,
      priority_weight INTEGER NOT NULL DEFAULT 10,
      confidence REAL NOT NULL DEFAULT 1.0,
      rule_version TEXT NOT NULL DEFAULT 'v2.1.0',
      recorded_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      FOREIGN KEY (canonical_match_id) REFERENCES canonical_matches(canonical_match_id) ON DELETE CASCADE,
      FOREIGN KEY (evidence_id) REFERENCES raw_source_evidence(evidence_id),
      UNIQUE(canonical_match_id, field_name, source_name)
    );

    -- 6. Match Source Links
    CREATE TABLE IF NOT EXISTS match_source_links (
      link_id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_match_id TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_match_id TEXT NOT NULL,
      evidence_id INTEGER NOT NULL,
      confidence_score REAL NOT NULL,
      scorer_version TEXT NOT NULL DEFAULT 'v2.1.0',
      rule_version TEXT NOT NULL DEFAULT 'v2.1.0',
      link_status TEXT NOT NULL CHECK (link_status IN ('AUTO_LINKED', 'MANUAL_APPROVED', 'REJECTED', 'QUARANTINED')),
      linked_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      FOREIGN KEY (canonical_match_id) REFERENCES canonical_matches(canonical_match_id) ON DELETE CASCADE,
      FOREIGN KEY (evidence_id) REFERENCES raw_source_evidence(evidence_id),
      UNIQUE(source_name, source_match_id)
    );

    -- 7. Review Queue & Audit Trail
    CREATE TABLE IF NOT EXISTS match_review_queue (
      review_id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_canonical_id TEXT,
      incoming_source TEXT NOT NULL,
      incoming_source_id TEXT NOT NULL,
      incoming_evidence_id INTEGER NOT NULL,
      confidence_score REAL NOT NULL,
      scorer_version TEXT NOT NULL DEFAULT 'v2.1.0',
      rule_version TEXT NOT NULL DEFAULT 'v2.1.0',
      evidence_hash TEXT NOT NULL,
      veto_triggers_json TEXT,
      divergent_fields_json TEXT NOT NULL,
      review_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (review_status IN ('PENDING', 'APPROVED', 'REJECTED', 'ESCALATED')),
      lock_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      resolved_at TEXT,
      resolved_by TEXT,
      FOREIGN KEY (candidate_canonical_id) REFERENCES canonical_matches(canonical_match_id) ON DELETE SET NULL,
      FOREIGN KEY (incoming_evidence_id) REFERENCES raw_source_evidence(evidence_id)
    );

    CREATE TABLE IF NOT EXISTS match_review_audit_log (
      log_id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id INTEGER,
      action TEXT NOT NULL CHECK (action IN ('SUBMIT', 'AUTO_VETO', 'APPROVE', 'REJECT', 'SPLIT', 'REVERT')),
      previous_state_json TEXT,
      new_state_json TEXT,
      actor TEXT NOT NULL,
      reason TEXT,
      logged_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      FOREIGN KEY (review_id) REFERENCES match_review_queue(review_id) ON DELETE SET NULL
    );

    -- 8. Indexes for Candidate Generation
    CREATE INDEX IF NOT EXISTS idx_cm_symmetric_date ON canonical_matches(player_low_id, player_high_id, match_date);
    CREATE INDEX IF NOT EXISTS idx_cm_tourney_date ON canonical_matches(canonical_tourney_id, round_name, match_date);
    CREATE INDEX IF NOT EXISTS idx_pa_lookup ON player_aliases(source_name, normalized_token);
    CREATE INDEX IF NOT EXISTS idx_ta_lookup ON tournament_aliases(source_name, normalized_token);
    CREATE INDEX IF NOT EXISTS idx_raw_evidence_source ON raw_source_evidence(source_name, source_match_id);
    CREATE INDEX IF NOT EXISTS idx_mrq_pending ON match_review_queue(review_status) WHERE review_status = 'PENDING';

    -- 9. Foreign Key Indexes for Performant Joins and Cascading Deletes
    CREATE INDEX IF NOT EXISTS idx_pa_player_id ON player_aliases(canonical_player_id);
    CREATE INDEX IF NOT EXISTS idx_ta_tourney_id ON tournament_aliases(canonical_tourney_id);
    CREATE INDEX IF NOT EXISTS idx_cm_player_high ON canonical_matches(player_high_id);
    CREATE INDEX IF NOT EXISTS idx_cm_winner ON canonical_matches(winner_canonical_id);
    CREATE INDEX IF NOT EXISTS idx_cmp_evidence ON canonical_match_provenance(evidence_id);
    CREATE INDEX IF NOT EXISTS idx_msl_canonical_id ON match_source_links(canonical_match_id);
    CREATE INDEX IF NOT EXISTS idx_msl_evidence ON match_source_links(evidence_id);
    CREATE INDEX IF NOT EXISTS idx_mrq_candidate ON match_review_queue(candidate_canonical_id);
    CREATE INDEX IF NOT EXISTS idx_mrq_evidence ON match_review_queue(incoming_evidence_id);
    CREATE INDEX IF NOT EXISTS idx_mral_review_id ON match_review_audit_log(review_id);
  `);

  // Triggers for updated_at
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_canonical_players_updated_at
    AFTER UPDATE OF full_name_standard, first_name, last_name, birth_date, ioc_country, gender, hand ON canonical_players
    FOR EACH ROW
    BEGIN
      UPDATE canonical_players 
      SET updated_at = CURRENT_TIMESTAMP 
      WHERE canonical_player_id = OLD.canonical_player_id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_canonical_tournaments_updated_at
    AFTER UPDATE OF name_standard, tour, tour_level, default_surface, country_ioc, city ON canonical_tournaments
    FOR EACH ROW
    BEGIN
      UPDATE canonical_tournaments 
      SET updated_at = CURRENT_TIMESTAMP 
      WHERE canonical_tourney_id = OLD.canonical_tourney_id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_canonical_matches_updated_at
    AFTER UPDATE OF match_date, tour, canonical_tourney_id, surface, round_name, player_low_id, player_high_id, match_status, winner_canonical_id, loser_canonical_id, canonical_score, source_mask, evidence_count ON canonical_matches
    FOR EACH ROW
    WHEN OLD.version = NEW.version
    BEGIN
      UPDATE canonical_matches 
      SET updated_at = CURRENT_TIMESTAMP,
          version = OLD.version + 1
      WHERE canonical_match_id = OLD.canonical_match_id;
    END;
  `);
}
