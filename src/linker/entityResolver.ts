import type Database from 'better-sqlite3';
import type {
  IncomingRawMatch,
  ResolvedMatchContext,
  Round,
  Surface,
} from './types';

export function normalizeToken(name: string): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0)
    .join(' ');
}

export function resolveSurface(rawSurface?: string): Surface {
  const clean = (rawSurface || '').toLowerCase();
  if (clean.includes('clay')) return 'CLAY';
  if (clean.includes('grass')) return 'GRASS';
  if (clean.includes('carpet')) return 'CARPET';
  return 'HARD';
}

export function resolveRound(rawRound?: string): Round {
  const r = (rawRound || '').trim().toUpperCase();
  if (r === 'F' || r === 'FINAL' || r === 'FINALS') return 'F';
  if (r === 'SF' || r === 'SEMIFINAL' || r === 'SEMIFINALS' || r === 'SEMI-FINALS') return 'SF';
  if (r === 'QF' || r === 'QUARTERFINAL' || r === 'QUARTERFINALS' || r === 'QUARTER-FINALS') return 'QF';
  if (r === 'R16' || r === 'ROUND OF 16' || r === '4TH ROUND') return 'R16';
  if (r === 'R32' || r === 'ROUND OF 32' || r === '3RD ROUND') return 'R32';
  if (r === 'R64' || r === 'ROUND OF 64' || r === '2ND ROUND') return 'R64';
  if (r === 'R128' || r === 'ROUND OF 128' || r === '1ST ROUND') return 'R128';
  if (r === 'RR' || r === 'ROUND ROBIN') return 'RR';
  if (r === 'Q3' || r.includes('QUALIFYING 3')) return 'Q3';
  if (r === 'Q2' || r.includes('QUALIFYING 2')) return 'Q2';
  if (r === 'Q1' || r.includes('QUALIFYING')) return 'Q1';
  return 'R32';
}

export interface PlayerResolutionResult {
  canonicalPlayerId?: string;
  hasSiblingAmbiguity: boolean;
  isVerified: boolean;
}

export function resolvePlayer(
  db: Database.Database,
  sourceName: string,
  rawName: string
): PlayerResolutionResult {
  const clean = normalizeToken(rawName);
  if (!clean) {
    return { hasSiblingAmbiguity: false, isVerified: false };
  }

  // 1. Direct alias match (source-specific first, then catalog/canonical aliases)
  const alias = db
    .prepare(
      `SELECT canonical_player_id, is_verified, has_sibling_conflict
       FROM player_aliases
       WHERE (source_name = ? OR source_name IN ('canonical', 'catalog', 'historical', 'normalized', 'reversed', 'abbreviated', 'csv_style'))
         AND (raw_name = ? OR normalized_token = ?)
       ORDER BY CASE WHEN source_name = ? THEN 1 ELSE 2 END, is_verified DESC
       LIMIT 1`
    )
    .get(sourceName, rawName, clean, sourceName) as any;

  if (alias) {
    return {
      canonicalPlayerId: alias.canonical_player_id,
      hasSiblingAmbiguity: alias.has_sibling_conflict === 1,
      isVerified: alias.is_verified === 1,
    };
  }

  // 2. Fallback to canonical_players exact standard name or token match
  const canon = db
    .prepare(
      `SELECT canonical_player_id, last_name
       FROM canonical_players
       WHERE lower(full_name_standard) = ?
       LIMIT 2`
    )
    .all(rawName.toLowerCase()) as any[];

  if (canon.length === 1) {
    return {
      canonicalPlayerId: canon[0].canonical_player_id,
      hasSiblingAmbiguity: false,
      isVerified: false,
    };
  }

  // 3. Sibling ambiguity check across name tokens (handles "First Last", "Last First", and "Last Initial")
  const tokens = clean.split(' ');
  for (const tok of tokens) {
    if (tok.length >= 4) {
      const siblings = db
        .prepare(
          `SELECT canonical_player_id FROM canonical_players WHERE lower(last_name) = ?`
        )
        .all(tok) as any[];

      if (siblings.length > 1) {
        return { hasSiblingAmbiguity: true, isVerified: false };
      }
    }
  }

  return { hasSiblingAmbiguity: false, isVerified: false };
}

export interface TournamentResolutionResult {
  canonicalTourneyId?: string;
  isVerified: boolean;
  hasAmbiguity: boolean;
}

export function resolveTournament(
  db: Database.Database,
  sourceName: string,
  rawName: string
): TournamentResolutionResult {
  const clean = normalizeToken(rawName);
  if (!clean) {
    return { isVerified: false, hasAmbiguity: true };
  }

  // 1. Direct alias match (source-specific first, then catalog/canonical aliases)
  const alias = db
    .prepare(
      `SELECT canonical_tourney_id, is_verified
       FROM tournament_aliases
       WHERE (source_name = ? OR source_name IN ('canonical', 'catalog', 'historical'))
         AND (raw_name = ? OR normalized_token = ?)
       ORDER BY CASE WHEN source_name = ? THEN 1 ELSE 2 END, is_verified DESC
       LIMIT 1`
    )
    .get(sourceName, rawName, clean, sourceName) as any;

  if (alias) {
    return {
      canonicalTourneyId: alias.canonical_tourney_id,
      isVerified: alias.is_verified === 1,
      hasAmbiguity: false,
    };
  }

  // 2. Stripped alias match (remove common qualifiers like "- Paris, FRA" or "ATP")
  const stripped = rawName
    .replace(/\s*,\s*.*$/, '')
    .replace(/\s*-\s*.*$/, '')
    .replace(/\s+(ATP|WTA|Challenger|ITF)$/i, '')
    .trim();
  const cleanStripped = normalizeToken(stripped);

  if (cleanStripped && cleanStripped !== clean) {
    const strippedAlias = db
      .prepare(
        `SELECT canonical_tourney_id, is_verified
         FROM tournament_aliases
         WHERE (source_name = ? OR source_name IN ('canonical', 'catalog', 'historical'))
           AND (raw_name = ? OR normalized_token = ?)
         ORDER BY CASE WHEN source_name = ? THEN 1 ELSE 2 END, is_verified DESC
         LIMIT 1`
      )
      .get(sourceName, stripped, cleanStripped, sourceName) as any;

    if (strippedAlias) {
      return {
        canonicalTourneyId: strippedAlias.canonical_tourney_id,
        isVerified: strippedAlias.is_verified === 1,
        hasAmbiguity: false,
      };
    }
  }

  // 3. Canonical tournaments standard name match
  const canon = db
    .prepare(
      `SELECT canonical_tourney_id FROM canonical_tournaments WHERE lower(name_standard) = ?`
    )
    .all(rawName.toLowerCase()) as any[];

  if (canon.length === 1) {
    return {
      canonicalTourneyId: canon[0].canonical_tourney_id,
      isVerified: false,
      hasAmbiguity: false,
    };
  }

  return {
    isVerified: false,
    hasAmbiguity: canon.length > 1 || rawName.length < 3,
  };
}

export function buildResolvedContext(
  db: Database.Database,
  incoming: IncomingRawMatch,
  evidenceId: number
): ResolvedMatchContext {
  const p1Res = resolvePlayer(db, incoming.sourceName, incoming.rawPlayer1);
  const p2Res = resolvePlayer(db, incoming.sourceName, incoming.rawPlayer2);
  const tourneyRes = resolveTournament(db, incoming.sourceName, incoming.rawTournamentName);

  const p1Id = p1Res.canonicalPlayerId || `cp_${normalizeToken(incoming.rawPlayer1).replace(/\s+/g, '_')}`;
  const p2Id = p2Res.canonicalPlayerId || `cp_${normalizeToken(incoming.rawPlayer2).replace(/\s+/g, '_')}`;

  // Symmetric, order-independent pair
  const [playerLowId, playerHighId] = p1Id < p2Id ? [p1Id, p2Id] : [p2Id, p1Id];

  // Resolve winner/loser canonical IDs if available
  let winnerCanonicalId: string | undefined;
  let loserCanonicalId: string | undefined;

  if (incoming.rawWinnerName) {
    const winClean = normalizeToken(incoming.rawWinnerName);
    const p1Clean = normalizeToken(incoming.rawPlayer1);
    const p2Clean = normalizeToken(incoming.rawPlayer2);

    if (winClean === p1Clean || winClean.includes(p1Clean) || p1Clean.includes(winClean)) {
      winnerCanonicalId = p1Id;
      loserCanonicalId = p2Id;
    } else if (winClean === p2Clean || winClean.includes(p2Clean) || p2Clean.includes(winClean)) {
      winnerCanonicalId = p2Id;
      loserCanonicalId = p1Id;
    }
  }

  return {
    incoming,
    evidenceId,
    playerLowId,
    playerHighId,
    player1CanonicalId: p1Id,
    player2CanonicalId: p2Id,
    winnerCanonicalId,
    loserCanonicalId,
    canonicalTourneyId: tourneyRes.canonicalTourneyId,
    surface: resolveSurface(incoming.rawSurface),
    roundName: resolveRound(incoming.rawRound),
    hasSiblingAmbiguity: p1Res.hasSiblingAmbiguity || p2Res.hasSiblingAmbiguity,
    hasUnclearTournament: tourneyRes.hasAmbiguity,
  };
}
