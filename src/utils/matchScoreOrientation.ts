/**
 * Tennis match scores in our DB may be stored as:
 * - winner-loser per set (Sackmann / ATP standard), or
 * - home-away per set (season CSV when away player won).
 * Orient sets so the first number in each set is always the winner's games.
 */

export interface OrientedSet {
  winnerGames: number;
  loserGames: number;
}

export function parseSetParts(score: string | null | undefined): Array<{ a: number; b: number }> {
  if (!score) return [];
  const parts: Array<{ a: number; b: number }> = [];
  for (const token of score.split(/\s+/)) {
    const m = token.match(/(\d+)-(\d+)/);
    if (!m) continue;
    parts.push({ a: Number(m[1]), b: Number(m[2]) });
  }
  return parts;
}

export function orientSetsForWinner(score: string | null | undefined): OrientedSet[] {
  const raw = parseSetParts(score);
  if (!raw.length) return [];

  let aWins = 0;
  let bWins = 0;
  for (const part of raw) {
    if (part.a > part.b) aWins += 1;
    else if (part.b > part.a) bWins += 1;
  }

  const swap = bWins > aWins;
  return raw.map((part) =>
    swap
      ? { winnerGames: part.b, loserGames: part.a }
      : { winnerGames: part.a, loserGames: part.b },
  );
}

export function orientedSetsForFocusPlayer(
  score: string | null | undefined,
  focusWon: boolean,
): Array<{ home: number; away: number }> {
  return orientSetsForWinner(score).map((set) =>
    focusWon
      ? { home: set.winnerGames, away: set.loserGames }
      : { home: set.loserGames, away: set.winnerGames },
  );
}
