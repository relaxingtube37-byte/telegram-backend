/**
 * Script: audit-45-unstaged-qualification-matches.cjs
 * Role: Forensic diagnostic of the 45 multi-agent traces quarantined under MATCH_NOT_STAGED_IN_POSTGRES
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CROSSWALK_JSON = path.join(PROJECT_ROOT, 'scratch', 'postgres-phase-7-ai-migration', 'canonical-match-crosswalk-for-legacy-outputs.json');
const DB_PATH = path.join(PROJECT_ROOT, 'data', 'database.sqlite');
const P3_PLAYERS = path.join(PROJECT_ROOT, 'scratch', 'phase-3-identity-output', 'identity_players.jsonl');
const P3_ALIASES = path.join(PROJECT_ROOT, 'scratch', 'phase-3-identity-output', 'identity_player_aliases.jsonl');
const P4_EDITIONS = path.join(PROJECT_ROOT, 'scratch', 'phase-4-competition-editions-output', 'competition_tournament_editions.jsonl');
const OUTPUT_JSON = path.join(PROJECT_ROOT, 'scratch', 'postgres-phase-7-ai-migration', 'qualification-matches-audit.json');

function norm(s) {
  if (!s) return '';
  return s.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function audit() {
  console.log('='.repeat(78));
  console.log(' AUDIT OF 45 UNSTAGED QUALIFICATION MATCHES');
  console.log(' Timestamp: ' + new Date().toISOString());
  console.log('='.repeat(78));

  // 1. Load the 45 crosswalk items
  const crosswalkData = JSON.parse(fs.readFileSync(CROSSWALK_JSON, 'utf8'));
  const unstagedItems = crosswalkData.crosswalk.filter(m => m.unresolvableReason === 'MATCH_NOT_STAGED_IN_POSTGRES');
  console.log(`\n[1/5] Loaded ${unstagedItems.length} candidate unstaged traces from crosswalk.`);

  // 2. Load SQLite match database
  const db = new Database(DB_PATH, { readonly: true });

  // 3. Load Phase 3 Player identities and aliases
  console.log('\n[2/5] Loading Phase 3 player registry...');
  const playerById = new Map();
  const playerByName = new Map();
  const aliasToPlayerId = new Map();

  if (fs.existsSync(P3_PLAYERS)) {
    const lines = fs.readFileSync(P3_PLAYERS, 'utf8').trim().split('\n');
    for (const l of lines) {
      if (!l.trim()) continue;
      const p = JSON.parse(l);
      playerById.set(p.player_id, p);
      playerByName.set(norm(p.full_name_standard), p.player_id);
    }
  }

  if (fs.existsSync(P3_ALIASES)) {
    const lines = fs.readFileSync(P3_ALIASES, 'utf8').trim().split('\n');
    for (const l of lines) {
      if (!l.trim()) continue;
      const a = JSON.parse(l);
      aliasToPlayerId.set(norm(a.alias_name || a.normalized_token), a.player_id);
      if (a.normalized_token) {
        aliasToPlayerId.set(norm(a.normalized_token), a.player_id);
      }
    }
  }
  console.log(`  Players indexed: ${playerById.size}, Name lookups: ${playerByName.size}, Aliases: ${aliasToPlayerId.size}`);

  function resolvePlayer(rawName) {
    if (!rawName) return null;
    const n = norm(rawName);
    if (playerByName.has(n)) return { playerId: playerByName.get(n), matchedBy: 'EXACT_STANDARD_NAME' };
    if (aliasToPlayerId.has(n)) return { playerId: aliasToPlayerId.get(n), matchedBy: 'ALIAS' };

    // Try last name + first initial or reverse
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

  // 4. Load Phase 4 Tournament Editions
  console.log('\n[3/5] Loading Phase 4 tournament editions...');
  const editions = [];
  if (fs.existsSync(P4_EDITIONS)) {
    const lines = fs.readFileSync(P4_EDITIONS, 'utf8').trim().split('\n');
    for (const l of lines) {
      if (!l.trim()) continue;
      editions.push(JSON.parse(l));
    }
  }
  console.log(`  Editions loaded: ${editions.length}`);

  function findEdition(tourneyName, matchDate) {
    if (!tourneyName) return null;
    const tNorm = norm(tourneyName);
    const year = matchDate ? matchDate.substring(0, 4) : '2026';

    for (const ed of editions) {
      const edName = norm(ed.edition_name || ed.tournament_name || ed.official_name || '');
      const edSeason = String(ed.season_year || (ed.start_date ? ed.start_date.substring(0, 4) : ''));
      if (edSeason === year) {
        if (tNorm.includes('us open') && edName.includes('us open')) return ed;
        if (tNorm.includes('cincinnati') && edName.includes('cincinnati')) return ed;
        if (tNorm.includes('winston') && edName.includes('winston')) return ed;
        if (tNorm.includes('monterrey') && edName.includes('monterrey')) return ed;
        if (tNorm.includes('prague') && edName.includes('prague')) return ed;
        if (tNorm.includes('como') && edName.includes('como')) return ed;
        if (tNorm.includes('porto') && edName.includes('porto')) return ed;
        if (tNorm.includes('manacor') && edName.includes('manacor')) return ed;
      }
    }
    return null;
  }

  // 5. Audit each of the 45 matches
  console.log('\n[4/5] Auditing 45 matches against evidence...');
  const auditedMatches = [];

  for (const item of unstagedItems) {
    const fId = Number(item.sourceMatchId);
    const gold = db.prepare('SELECT * FROM gold_matches_validated WHERE rapid_event_id = ?').get(fId);
    const cm = db.prepare('SELECT * FROM canonical_matches WHERE source_b_rapid_event_id = ?').get(fId);

    const winnerName = gold ? gold.winner_name : item.player1;
    const loserName = gold ? gold.loser_name : item.player2;
    const tourneyName = gold ? gold.tourney_name : item.tournamentEdition;
    const matchDate = gold ? gold.match_date : null;
    const score = gold ? gold.score : null;

    const winnerRes = resolvePlayer(winnerName);
    const loserRes = resolvePlayer(loserName);
    const editionRes = findEdition(tourneyName, matchDate);

    const isResolvable = !!(winnerRes && loserRes && editionRes);

    auditedMatches.push({
      traceId: item.sourceRecordId,
      fixtureId: fId,
      canonicalMatchId: item.canonicalMatchId || (cm ? cm.canonical_match_id : null),
      matchDate,
      score,
      tourneyNameRaw: tourneyName,
      matchedEditionId: editionRes ? editionRes.edition_id : null,
      matchedEditionName: editionRes ? (editionRes.edition_name || editionRes.official_name) : null,
      winnerRaw: winnerName,
      winnerResolution: winnerRes,
      loserRaw: loserName,
      loserResolution: loserRes,
      verdict: isResolvable ? 'CANONICAL_RESOLVABLE' : 'REMAIN_QUARANTINED'
    });
  }

  db.close();

  // 6. Output Summary & Save Manifest
  console.log('\n[5/5] Audit Evaluation Summary:');
  const resolvable = auditedMatches.filter(m => m.verdict === 'CANONICAL_RESOLVABLE');
  const remainQuarantined = auditedMatches.filter(m => m.verdict === 'REMAIN_QUARANTINED');

  console.log(`  Total Evaluated:        ${auditedMatches.length}`);
  console.log(`  CANONICAL_RESOLVABLE:   ${resolvable.length}`);
  console.log(`  REMAIN_QUARANTINED:     ${remainQuarantined.length}`);

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify({
    timestamp: new Date().toISOString(),
    total_evaluated: auditedMatches.length,
    canonical_resolvable_count: resolvable.length,
    remain_quarantined_count: remainQuarantined.length,
    matches: auditedMatches
  }, null, 2));

  console.log(`\nAudit manifest saved to: ${OUTPUT_JSON}`);
  console.log('='.repeat(78));
}

audit().catch(err => {
  console.error('Audit fatal error:', err);
  process.exit(1);
});
