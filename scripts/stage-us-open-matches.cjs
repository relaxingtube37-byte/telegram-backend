/**
 * Script: stage-us-open-matches.cjs
 * Role: Generate deterministic Phase 4 staging patch for the 36 authentic US Open matches
 *       corresponding to the resolved IndexedDB prediction traces, outputting SQL batch and link mapping files.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const Database = require('better-sqlite3');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(PROJECT_ROOT, 'data', 'database.sqlite');
const P4_SCRATCH = path.join(PROJECT_ROOT, 'scratch', 'postgres-phase-4-matches');
const PATCH_SQL = path.join(P4_SCRATCH, 'batch_us_open_admitted_matches.sql');
const PATCH_LINKS_JSONL = path.join(PROJECT_ROOT, 'scratch', 'postgres-phase-7-ai-migration', 'us_open_match_links.jsonl');
const EXPORT_PATH = path.join(PROJECT_ROOT, 'scratch', 'postgres-phase-7-ai-migration', 'authentic_prediction_traces_export.json');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'scratch', 'postgres-phase-7-ai-migration', 'trace-crosswalk-manifest.json');

const NAMESPACE_MATCHES = '6ba7b815-9dad-11d1-80b4-00c04fd430c8';
const US_OPEN_ATP_EDITION_ID = '4c111dff-fce0-5e96-bccd-0657253a9be3'; // US Open 2026 (ATP)
const US_OPEN_WTA_EDITION_ID = '25909d80-2f5e-5b00-9211-71269dfebb23'; // US Open 2026 (WTA)

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

function norm(s) {
  if (!s) return '';
  return s.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function normalizeSurface(s) {
  if (!s) return 'Hard';
  const str = String(s).toLowerCase().trim();
  if (str.includes('clay')) return 'Clay';
  if (str.includes('grass')) return 'Grass';
  if (str.includes('carpet')) return 'Carpet';
  return 'Hard';
}

function sqlEscape(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function stageUsOpenMatches() {
  console.log('='.repeat(78));
  console.log(' GENERATING PHASE 4 STAGING PATCH FOR 36 AUTHENTIC US OPEN MATCHES');
  console.log(' Timestamp: ' + new Date().toISOString());
  console.log('='.repeat(78));

  // 1. Load Phase 3 players
  console.log('\n[1/5] Loading Phase 3 player registry...');
  const playerByName = new Map();
  const aliasToPlayerId = new Map();

  const p3PlayersPath = path.join(PROJECT_ROOT, 'scratch', 'phase-3-identity-output', 'identity_players.jsonl');
  const p3AliasesPath = path.join(PROJECT_ROOT, 'scratch', 'phase-3-identity-output', 'identity_player_aliases.jsonl');

  if (fs.existsSync(p3PlayersPath)) {
    const lines = fs.readFileSync(p3PlayersPath, 'utf8').trim().split('\n');
    for (const l of lines) {
      if (!l.trim()) continue;
      const p = JSON.parse(l);
      playerByName.set(norm(p.full_name_standard), p.player_id);
    }
  }

  if (fs.existsSync(p3AliasesPath)) {
    const lines = fs.readFileSync(p3AliasesPath, 'utf8').trim().split('\n');
    for (const l of lines) {
      if (!l.trim()) continue;
      const a = JSON.parse(l);
      aliasToPlayerId.set(norm(a.alias_name || a.normalized_token), a.player_id);
      if (a.normalized_token) aliasToPlayerId.set(norm(a.normalized_token), a.player_id);
    }
  }
  console.log(`  Players indexed: ${playerByName.size}, Aliases: ${aliasToPlayerId.size}`);

  function resolvePlayer(rawName) {
    if (!rawName) return null;
    const n = norm(rawName);
    if (playerByName.has(n)) return { playerId: playerByName.get(n), matchedBy: 'EXACT_STANDARD_NAME' };
    if (aliasToPlayerId.has(n)) return { playerId: aliasToPlayerId.get(n), matchedBy: 'ALIAS' };

    const parts = n.split(' ');
    if (parts.length >= 2) {
      for (const [name, pid] of playerByName.entries()) {
        if (name.includes(parts[0]) && (parts.length === 1 || name.includes(parts[parts.length - 1]))) {
          return { playerId: pid, matchedBy: 'FUZZY_NAME_INCLUSION', candidateName: name };
        }
      }
    }
    return null;
  }

  // 2. Identify currently staged matches to ensure we only stage the unstaged ones
  console.log('\n[2/5] Loading existing match links to identify already-staged matches...');
  const cmToMatchId = new Map();
  const rapidToMatchId = new Map();

  const rlLinks = readline.createInterface({ input: fs.createReadStream(path.join(PROJECT_ROOT, 'scratch', 'phase-5-matches-outcomes-output', 'source_match_links.jsonl')) });
  for await (const l of rlLinks) {
    if (!l.trim()) continue;
    const link = JSON.parse(l);
    if (link.source_name && link.source_name.startsWith('canonical_matches')) {
      cmToMatchId.set(link.source_match_id, link.match_id);
    }
  }

  const qualLinksPath = path.join(PROJECT_ROOT, 'scratch', 'postgres-phase-7-ai-migration', 'qualification_match_links.jsonl');
  if (fs.existsSync(qualLinksPath)) {
    const qLines = fs.readFileSync(qualLinksPath, 'utf8').trim().split('\n');
    for (const ql of qLines) {
      if (!ql.trim()) continue;
      const qlink = JSON.parse(ql);
      if (qlink.source_match_id) cmToMatchId.set(qlink.source_match_id, qlink.match_id);
      if (qlink.rapid_event_id) rapidToMatchId.set(Number(qlink.rapid_event_id), qlink.match_id);
    }
  }

  const db = new Database(DB_PATH, { readonly: true });
  const cmRows = db.prepare('SELECT canonical_match_id, source_a_historical_match_id, source_b_rapid_event_id FROM canonical_matches').all();
  for (const r of cmRows) {
    if (r.canonical_match_id && cmToMatchId.has(r.canonical_match_id)) {
      const pgmId = cmToMatchId.get(r.canonical_match_id);
      if (r.source_b_rapid_event_id) rapidToMatchId.set(Number(r.source_b_rapid_event_id), pgmId);
      if (r.source_a_historical_match_id) rapidToMatchId.set(Number(r.source_a_historical_match_id), pgmId);
    }
  }

  const goldRows = db.prepare('SELECT rapid_event_id, canonical_match_id FROM gold_matches_validated').all();
  for (const r of goldRows) {
    if (r.canonical_match_id && cmToMatchId.has(r.canonical_match_id)) {
      rapidToMatchId.set(Number(r.rapid_event_id), cmToMatchId.get(r.canonical_match_id));
    }
  }

  // 3. Extract traces and find unstaged US Open matches
  console.log('\n[3/5] Extracting unstaged US Open matches from export & SQLite...');
  const exportRaw = JSON.parse(fs.readFileSync(EXPORT_PATH, 'utf8'));
  const traces = exportRaw.traces || exportRaw;
  const manifestItems = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const manMap = new Map();
  for (const m of manifestItems) manMap.set(m.traceId, m);

  const qGold = db.prepare('SELECT * FROM gold_matches_validated WHERE rapid_event_id = ? OR canonical_match_id = ? LIMIT 1');

  const matchesToStage = new Map();

  for (const t of traces) {
    const man = manMap.get(t.traceId);
    if (!man || man.resolutionStatus !== 'RESOLVED') continue;
    const mIdNum = Number(man.sourceMatchId);
    const alreadyStaged = rapidToMatchId.has(mIdNum) || (man.canonicalMatchId && cmToMatchId.has(man.canonicalMatchId));
    if (alreadyStaged) continue; // already staged

    const gold = qGold.get(mIdNum, String(man.sourceMatchId));
    if (gold && gold.tourney_name && gold.tourney_name.includes('US Open') && gold.match_date >= '2026-09-01') {
      if (!matchesToStage.has(mIdNum)) {
        matchesToStage.set(mIdNum, {
          fixtureId: mIdNum,
          gold,
          traces: [t.traceId]
        });
      } else {
        matchesToStage.get(mIdNum).traces.push(t.traceId);
      }
    }
  }

  console.log(`  Identified ${matchesToStage.size} distinct unstaged US Open matches.`);

  // 4. Build SQL patch rows
  console.log('\n[4/5] Building SQL patch and link structures...');
  const matchesRows = [];
  const participantsRows = [];
  const resultsRows = [];
  const linksRows = [];

  const createdAt = '2026-09-11T16:00:00.000Z';

  for (const [mIdNum, item] of matchesToStage.entries()) {
    const gold = item.gold;
    const wRes = resolvePlayer(gold.winner_name);
    const lRes = resolvePlayer(gold.loser_name);

    if (!wRes || !lRes) {
      throw new Error(`Cannot resolve players for match ${mIdNum}: winner=${gold.winner_name} (res=${!!wRes}), loser=${gold.loser_name} (res=${!!lRes})`);
    }

    const winnerPlayerId = wRes.playerId;
    const loserPlayerId = lRes.playerId;

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

    const isWta = (gold.tour === 'WTA') || (gold.canonical_match_id && gold.canonical_match_id.startsWith('cm_wta_'));
    const editionId = isWta ? US_OPEN_WTA_EDITION_ID : US_OPEN_ATP_EDITION_ID;
    const bestOf = isWta ? 3 : 5;
    const roundCode = normalizeRound(gold.round_name);
    const matchId = uuidv5(`${editionId}:${roundCode}:${p1Id}:${p2Id}`, NAMESPACE_MATCHES);
    const startUtc = gold.start_utc || (gold.match_date ? `${gold.match_date}T15:00:00.000Z` : '2026-09-05T15:00:00.000Z');
    const surface = normalizeSurface(gold.surface);
    const isRetirement = gold.score && (gold.score.includes('RET') || gold.score.includes('W/O')) ? true : false;

    // 1. matches.matches
    matchesRows.push(`(${sqlEscape(matchId)}, ${sqlEscape(editionId)}, ${sqlEscape(startUtc)}, ${sqlEscape(startUtc)}, ${sqlEscape(roundCode)}, NULL, ${bestOf}, ${sqlEscape(surface)}, FALSE, 'FINISHED', 3, ${sqlEscape(createdAt)}, ${sqlEscape(createdAt)})`);

    // 2. matches.match_participants (Symmetric, is_winner IS NULL per schema convention)
    participantsRows.push(`(${sqlEscape(matchId)}, ${sqlEscape(p1Id)}, 1, NULL, NULL, ${sqlEscape(p1Rank)}, ${sqlEscape(p1Pts)}, NULL, ${sqlEscape(createdAt)})`);
    participantsRows.push(`(${sqlEscape(matchId)}, ${sqlEscape(p2Id)}, 2, NULL, NULL, ${sqlEscape(p2Rank)}, ${sqlEscape(p2Pts)}, NULL, ${sqlEscape(createdAt)})`);

    // 3. matches.match_results
    resultsRows.push(`(${sqlEscape(matchId)}, ${sqlEscape(winnerPlayerId)}, ${sqlEscape(loserPlayerId)}, ${sqlEscape(gold.score || 'Finished')}, NULL, ${isRetirement ? 'TRUE' : 'FALSE'}, NULL, ${sqlEscape(createdAt)})`);

    // 4. provenance links
    linksRows.push({
      match_id: matchId,
      source_name: 'canonical_matches',
      source_match_id: gold.canonical_match_id || `cm_us_open_${mIdNum}`,
      rapid_event_id: mIdNum,
      confidence_score: 95,
      linked_at: createdAt
    });
  }

  db.close();

  // 5. Write SQL batch and JSONL link files
  console.log('\n[5/5] Writing SQL and JSONL artifacts...');
  const sqlContent = [
    '-- Phase 4 Staging Patch: 36 Admitted US Open 2026 Matches',
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
  console.log(`  Saved SQL patch to: ${PATCH_SQL} (${matchesRows.length} matches)`);

  const jsonlLines = linksRows.map(l => JSON.stringify(l)).join('\n') + '\n';
  fs.writeFileSync(PATCH_LINKS_JSONL, jsonlLines, 'utf8');
  console.log(`  Saved links JSONL to: ${PATCH_LINKS_JSONL} (${linksRows.length} links)`);

  console.log('\nUS Open staging patch successfully created!');
  console.log('='.repeat(78));
}

stageUsOpenMatches().catch(err => {
  console.error('Fatal error staging US Open matches:', err);
  process.exit(1);
});
