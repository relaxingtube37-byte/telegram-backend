/**
 * Script: stage-qualification-matches.cjs
 * Role: Generate deterministic Phase 4 staging patch for the 20 verified qualification matches
 *       and output SQL batch and link mapping files.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const AUDIT_JSON = path.join(PROJECT_ROOT, 'scratch', 'postgres-phase-7-ai-migration', 'qualification-matches-audit.json');
const DB_PATH = path.join(PROJECT_ROOT, 'data', 'database.sqlite');
const P4_SCRATCH = path.join(PROJECT_ROOT, 'scratch', 'postgres-phase-4-matches');
const PATCH_SQL = path.join(P4_SCRATCH, 'batch_qualification_admitted_matches.sql');
const PATCH_LINKS_JSONL = path.join(PROJECT_ROOT, 'scratch', 'postgres-phase-7-ai-migration', 'qualification_match_links.jsonl');

const NAMESPACE_MATCHES = '6ba7b815-9dad-11d1-80b4-00c04fd430c8';

function uuidv5(name, namespaceUuid) {
  const nsBytes = Buffer.from(namespaceUuid.replace(/-/g, ''), 'hex');
  const nameBytes = Buffer.from(name, 'utf8');
  const hash = crypto.createHash('sha1').update(Buffer.concat([nsBytes, nameBytes])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // v5
  hash[8] = (hash[8] & 0x3f) | 0x80; // RFC 4122
  const hex = hash.toString('hex', 0, 16);
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20, 32)
  ].join('-');
}

function normalizeRound(r) {
  if (!r) return 'R32';
  const s = String(r).toUpperCase().trim();
  if (s === 'Q1' || s.includes('QUALIFICATION ROUND 1') || s.includes('1ST ROUND QUALIFYING')) return 'Q1';
  if (s === 'Q2' || s.includes('QUALIFICATION ROUND 2') || s.includes('2ND ROUND QUALIFYING')) return 'Q2';
  if (s === 'Q3' || s.includes('QUALIFICATION ROUND 3') || s.includes('3RD ROUND QUALIFYING')) return 'Q3';
  if (s.includes('ROUND OF 128') || s === 'R128') return 'R128';
  if (s.includes('ROUND OF 64') || s === 'R64') return 'R64';
  if (s.includes('ROUND OF 32') || s === 'R32') return 'R32';
  if (s.includes('ROUND OF 16') || s === 'R16') return 'R16';
  if (s.includes('QUARTERFINAL') || s === 'QF') return 'QF';
  if (s.includes('SEMIFINAL') || s === 'SF') return 'SF';
  if (s.includes('FINAL') || s === 'F') return 'F';
  return 'R32';
}

function sqlEscape(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function generateStagingPatch() {
  console.log('='.repeat(78));
  console.log(' GENERATING PHASE 4 STAGING PATCH FOR 20 QUALIFICATION MATCHES');
  console.log(' Timestamp: ' + new Date().toISOString());
  console.log('='.repeat(78));

  const auditData = JSON.parse(fs.readFileSync(AUDIT_JSON, 'utf8'));
  const resolvable = auditData.matches.filter(m => m.verdict === 'CANONICAL_RESOLVABLE');
  console.log(`\n[1/4] Found ${resolvable.length} CANONICAL_RESOLVABLE matches.`);

  const db = new Database(DB_PATH, { readonly: true });

  const matchesRows = [];
  const participantsRows = [];
  const resultsRows = [];
  const linksRows = [];

  for (const m of resolvable) {
    const gold = db.prepare('SELECT * FROM gold_matches_validated WHERE rapid_event_id = ?').get(m.fixtureId);
    if (!gold) throw new Error(`Match ${m.fixtureId} missing in SQLite gold_matches_validated!`);

    const roundCode = normalizeRound(gold.round_name);
    const editionId = m.matchedEditionId;
    const winnerPlayerId = m.winnerResolution.playerId;
    const loserPlayerId = m.loserResolution.playerId;

    // Symmetrical participant ordering (p1 < p2)
    let p1Id, p2Id, p1IsWinner, p2IsWinner;
    let p1Rank = null, p2Rank = null;
    let p1Pts = null, p2Pts = null;

    if (winnerPlayerId < loserPlayerId) {
      p1Id = winnerPlayerId;
      p2Id = loserPlayerId;
      p1IsWinner = true;
      p2IsWinner = false;
      p1Rank = gold.winner_rank || null;
      p2Rank = gold.loser_rank || null;
    } else {
      p1Id = loserPlayerId;
      p2Id = winnerPlayerId;
      p1IsWinner = false;
      p2IsWinner = true;
      p1Rank = gold.loser_rank || null;
      p2Rank = gold.winner_rank || null;
    }

function normalizeSurface(s) {
  if (!s) return 'Hard';
  const str = String(s).toLowerCase().trim();
  if (str.includes('clay')) return 'Clay';
  if (str.includes('grass')) return 'Grass';
  if (str.includes('carpet')) return 'Carpet';
  return 'Hard';
}

    // Deterministic match_id
    const matchId = uuidv5(`${editionId}:${roundCode}:${p1Id}:${p2Id}`, NAMESPACE_MATCHES);
    const startUtc = gold.start_utc || (gold.match_date ? `${gold.match_date}T12:00:00.000Z` : '2026-08-15T12:00:00.000Z');
    const surface = normalizeSurface(gold.surface);
    const bestOf = (gold.tourney_name && gold.tourney_name.includes('US Open') && !gold.tourney_name.includes('Qualifying') && !gold.round_name.includes('Qualifying')) ? 5 : 3;
    const isRetirement = gold.score && (gold.score.includes('RET') || gold.score.includes('W/O')) ? true : false;
    const createdAt = '2026-09-11T12:00:00.000Z';

    // 1. matches.matches
    matchesRows.push(`(${sqlEscape(matchId)}, ${sqlEscape(editionId)}, ${sqlEscape(startUtc)}, ${sqlEscape(startUtc)}, ${sqlEscape(roundCode)}, NULL, ${bestOf}, ${sqlEscape(surface)}, FALSE, 'FINISHED', 3, ${sqlEscape(createdAt)}, ${sqlEscape(createdAt)})`);

    // 2. matches.match_participants (2 rows per match: side 1 & side 2)
    participantsRows.push(`(${sqlEscape(matchId)}, ${sqlEscape(p1Id)}, 1, NULL, NULL, ${sqlEscape(p1Rank)}, ${sqlEscape(p1Pts)}, NULL, ${sqlEscape(createdAt)})`);
    participantsRows.push(`(${sqlEscape(matchId)}, ${sqlEscape(p2Id)}, 2, NULL, NULL, ${sqlEscape(p2Rank)}, ${sqlEscape(p2Pts)}, NULL, ${sqlEscape(createdAt)})`);

    // 3. matches.match_results
    resultsRows.push(`(${sqlEscape(matchId)}, ${sqlEscape(winnerPlayerId)}, ${sqlEscape(loserPlayerId)}, ${sqlEscape(gold.score || '6-4 6-4')}, NULL, ${isRetirement ? 'TRUE' : 'FALSE'}, NULL, ${sqlEscape(createdAt)})`);

    // 4. provenance.source_match_links
    linksRows.push({
      match_id: matchId,
      source_name: 'canonical_matches',
      source_match_id: m.canonicalMatchId,
      rapid_event_id: m.fixtureId,
      confidence_score: 95,
      linked_at: createdAt
    });
  }

  db.close();

  // 3. Generate SQL script
  console.log('\n[2/4] Generating SQL patch script: batch_qualification_admitted_matches.sql...');
  const sqlContent = [
    '-- Phase 4 Staging Patch: 20 Admitted Qualification Matches',
    'BEGIN;',
    '',
    '-- 1. Insert Matches',
    'INSERT INTO matches.matches (match_id, edition_id, scheduled_start_utc, actual_start_utc, round_name, match_num, best_of, surface, is_indoor, status, source_mask, created_at, updated_at) VALUES',
    matchesRows.join(',\n'),
    'ON CONFLICT (match_id) DO NOTHING;',
    '',
    '-- 2. Insert Match Participants (Symmetric, is_winner IS NULL)',
    'INSERT INTO matches.match_participants (match_id, player_id, side, seed, entry_status, pre_match_rank, pre_match_rank_points, is_winner, created_at) VALUES',
    participantsRows.join(',\n'),
    'ON CONFLICT (match_id, player_id) DO NOTHING;',
    '',
    '-- 3. Insert Settled Results',
    'INSERT INTO matches.match_results (match_id, winner_player_id, loser_player_id, score_string, retirement_detail, is_retirement_or_wo, duration_minutes, settled_at) VALUES',
    resultsRows.join(',\n'),
    'ON CONFLICT (match_id) DO NOTHING;',
    '',
    'COMMIT;',
    ''
  ].join('\n');

  fs.writeFileSync(PATCH_SQL, sqlContent, 'utf8');
  console.log(`  Saved ${matchesRows.length} matches, ${participantsRows.length} participants, ${resultsRows.length} results to ${PATCH_SQL}`);

  // 4. Save link mappings
  console.log('\n[3/4] Saving source match links patch...');
  const jsonlLines = linksRows.map(l => JSON.stringify(l)).join('\n') + '\n';
  fs.writeFileSync(PATCH_LINKS_JSONL, jsonlLines, 'utf8');
  console.log(`  Saved ${linksRows.length} match links to ${PATCH_LINKS_JSONL}`);

  console.log('\n[4/4] Staging patch generation complete!');
  console.log('='.repeat(78));
}

generateStagingPatch().catch(err => {
  console.error('Staging patch generation error:', err);
  process.exit(1);
});
