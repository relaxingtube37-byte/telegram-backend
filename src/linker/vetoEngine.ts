import type { CanonicalMatchCandidate, ResolvedMatchContext, VetoCode } from './types';
import { SOURCE_BITMASKS } from './types';

const ROUND_HIERARCHY: Record<string, number> = {
  F: 1,
  SF: 2,
  QF: 3,
  R16: 4,
  R32: 5,
  R64: 6,
  R128: 7,
  RR: 8,
  Q3: 9,
  Q2: 10,
  Q1: 11,
};

export function evaluateVetoes(
  ctx: ResolvedMatchContext,
  candidate: CanonicalMatchCandidate
): VetoCode[] {
  const vetoes: VetoCode[] = [];

  // 1. Date window exceeded (> 1 day delta)
  const dtDays = Math.abs(
    (new Date(ctx.incoming.matchDate).getTime() - new Date(candidate.matchDate).getTime()) /
      (1000 * 60 * 60 * 24)
  );
  if (dtDays > 1.0) {
    vetoes.push('VETO_DATE_WINDOW_EXCEEDED');
  }

  // 2. Conflicting confirmed winners
  if (
    ctx.winnerCanonicalId &&
    candidate.winnerCanonicalId &&
    ctx.winnerCanonicalId !== candidate.winnerCanonicalId
  ) {
    vetoes.push('VETO_WINNER_CONFLICT');
  }

  // 3. Tour or gender mismatch
  if (
    ctx.incoming.tour !== candidate.tour ||
    (ctx.incoming.gender === 'M' && candidate.tour === 'WTA') ||
    (ctx.incoming.gender === 'F' && candidate.tour === 'ATP')
  ) {
    vetoes.push('VETO_TOUR_GENDER_MISMATCH');
  }

  // 4. Double-booking by same source
  const incomingBit = SOURCE_BITMASKS[ctx.incoming.sourceName] || 0;
  if ((candidate.sourceMask & incomingBit) !== 0) {
    vetoes.push('VETO_DOUBLE_BOOKING');
  }

  // 5. Sibling ambiguity flag
  if (ctx.hasSiblingAmbiguity) {
    vetoes.push('VETO_SIBLING_AMBIGUITY');
  }

  // 6. Unclear tournament identity
  if (
    ctx.hasUnclearTournament ||
    !ctx.canonicalTourneyId ||
    !candidate.canonicalTourneyId ||
    ctx.canonicalTourneyId !== candidate.canonicalTourneyId
  ) {
    vetoes.push('VETO_UNCLEAR_TOURNAMENT');
  }

  // 7. Impossible round hierarchy jump (e.g. Qualifying vs Main Draw, or level delta >= 2)
  const isIncomingQ = ctx.roundName.startsWith('Q');
  const isCandidateQ = candidate.roundName.startsWith('Q');
  if (isIncomingQ !== isCandidateQ) {
    vetoes.push('VETO_ROUND_HIERARCHY_PARADOX');
  } else {
    const r1 = ROUND_HIERARCHY[ctx.roundName] ?? 99;
    const r2 = ROUND_HIERARCHY[candidate.roundName] ?? 99;
    if (Math.abs(r1 - r2) >= 2) {
      vetoes.push('VETO_ROUND_HIERARCHY_PARADOX');
    }
  }

  // 8. Inverted score line without reverse winner mapping
  if (ctx.incoming.rawScore && candidate.canonicalScore) {
    const s1 = ctx.incoming.rawScore.trim();
    const s2 = candidate.canonicalScore.trim();
    if (s1.length >= 3 && s2.length >= 3 && s1 !== s2) {
      const reversedS1 = s1.replace(/(\d+)-(\d+)/g, '$2-$1');
      if (reversedS1 === s2) {
        // Reversed score without opposite winner assignment is suspicious
        const isLegitReversal =
          ctx.winnerCanonicalId &&
          candidate.winnerCanonicalId &&
          ctx.winnerCanonicalId !== candidate.winnerCanonicalId;
        if (!isLegitReversal) {
          vetoes.push('VETO_INVERTED_SCORE');
        }
      }
    }
  }

  return vetoes;
}
