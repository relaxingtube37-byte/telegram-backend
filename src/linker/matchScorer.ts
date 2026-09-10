import type { CanonicalMatchCandidate, ResolvedMatchContext, ScoredCandidate } from './types';
import { evaluateVetoes } from './vetoEngine';

export function scoreCandidate(
  ctx: ResolvedMatchContext,
  candidate: CanonicalMatchCandidate
): ScoredCandidate {
  // 1. Mandatory player pair baseline
  const playerPair = 35;

  // 2. Date scoring (Max 20)
  let date = 0;
  const dtDays = Math.abs(
    (new Date(ctx.incoming.matchDate).getTime() - new Date(candidate.matchDate).getTime()) /
      (1000 * 60 * 60 * 24)
  );
  if (dtDays === 0) {
    date = 20;
  } else if (dtDays <= 1.0) {
    date = 12;
  }

  // 3. Score compatibility (Max 20)
  let score = 0;
  if (ctx.incoming.rawScore && candidate.canonicalScore) {
    const rawClean = ctx.incoming.rawScore.replace(/[\(\)\[\]]/g, '').trim();
    const canClean = candidate.canonicalScore.replace(/[\(\)\[\]]/g, '').trim();
    if (rawClean === canClean) {
      score = 20;
    } else {
      const s1Sets = rawClean.split(' ').filter(Boolean);
      const s2Sets = canClean.split(' ').filter(Boolean);
      const setDiff = Math.abs(s1Sets.length - s2Sets.length);
      score = setDiff <= 1 ? 10 : 0;
    }
  } else if (!ctx.incoming.rawScore) {
    score = 6; // Non-fatal if incoming telemetry source lacks score line
  }

  // 4. Tournament compatibility (Max 15)
  let tournament = 0;
  if (ctx.canonicalTourneyId && candidate.canonicalTourneyId && ctx.canonicalTourneyId === candidate.canonicalTourneyId) {
    tournament = 15;
  } else if (
    ctx.incoming.rawTournamentName.toLowerCase().includes(candidate.canonicalTourneyId.slice(3)) ||
    candidate.canonicalTourneyId.toLowerCase().includes(ctx.incoming.rawTournamentName.toLowerCase())
  ) {
    tournament = 8;
  } else if (!ctx.canonicalTourneyId) {
    tournament = 4;
  }

  // 5. Surface compatibility (Max 5, Conflict = -30 penalty)
  let surface = 0;
  if (ctx.surface === candidate.surface) {
    surface = 5;
  } else if (ctx.surface === 'HARD' && candidate.surface === 'CLAY') {
    surface = -30;
  } else {
    surface = 0;
  }

  // 6. Round compatibility (Max 5)
  let round = 0;
  if (ctx.roundName === candidate.roundName) {
    round = 5;
  } else if (!ctx.incoming.rawRound) {
    round = 2;
  }

  const rawSum = playerPair + date + score + tournament + surface + round;
  const totalScore = Math.max(0, Math.min(100, rawSum));
  const vetoes = evaluateVetoes(ctx, candidate);

  return {
    candidate,
    totalScore,
    breakdown: { playerPair, date, score, tournament, surface, round },
    vetoes,
  };
}
