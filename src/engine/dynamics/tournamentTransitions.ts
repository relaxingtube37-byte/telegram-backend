export type TournamentTierType =
  | 'Grand Slam'
  | 'ATP Masters 1000'
  | 'ATP 500'
  | 'ATP 250'
  | 'Challenger'
  | 'ITF'
  | 'WTA 1000'
  | 'WTA 500'
  | 'WTA 250';

export interface TournamentTransitionMetrics {
  isDeepRunHangover: boolean;
  hangoverFatiguePenalty: number;
  hangoverSummary: string;
  stepUpPenalty: number;
  stepUpSummary: string;
}

export const classifyTournamentTier = (tourneyName: string, isWTA = false): TournamentTierType => {
  const n = (tourneyName || '').toLowerCase();
  if (n.includes('us open') || n.includes('wimbledon') || n.includes('roland garros') || n.includes('australian open') || n.includes('grand slam')) {
    return 'Grand Slam';
  }
  if (n.includes('1000') || n.includes('masters') || n.includes('indian wells') || n.includes('miami') || n.includes('madrid') || n.includes('rome') || n.includes('canada') || n.includes('cincinnati') || n.includes('shanghai') || n.includes('paris')) {
    return isWTA ? 'WTA 1000' : 'ATP Masters 1000';
  }
  if (n.includes('500') || n.includes('rotterdam') || n.includes('dubai') || n.includes('rio') || n.includes('barcelona') || n.includes('halle') || n.includes('queen') || n.includes('beijing') || n.includes('tokyo') || n.includes('vienna') || n.includes('basel')) {
    return isWTA ? 'WTA 500' : 'ATP 500';
  }
  if (n.includes('challenger')) return 'Challenger';
  if (n.includes('itf') || n.includes('utr')) return 'ITF';
  return isWTA ? 'WTA 250' : 'ATP 250';
};

export const calculateTournamentTransition = (
  daysSinceLastMatch = 5,
  lastTournamentTier = 'ATP 250',
  currentTournamentTier = 'ATP 500',
  reachedDeepLastWeek = false
): TournamentTransitionMetrics => {
  const isDeepRunHangover = reachedDeepLastWeek && daysSinceLastMatch <= 4;
  const hangoverPenalty = isDeepRunHangover ? 8 : 0;
  const hangoverSummary = isDeepRunHangover
    ? 'High Post-Final/Deep-Run Hangover risk (short turnaround)'
    : 'Normal tournament schedule transition';

  const isStepUp = lastTournamentTier.includes('Challenger') && (currentTournamentTier.includes('1000') || currentTournamentTier.includes('Grand Slam'));
  const stepUpPenalty = isStepUp ? 5 : 0;
  const stepUpSummary = isStepUp
    ? 'Challenger to Tour Tier step-up caliber hurdle'
    : 'Stable competition tier';

  return {
    isDeepRunHangover,
    hangoverFatiguePenalty: hangoverPenalty,
    hangoverSummary,
    stepUpPenalty,
    stepUpSummary,
  };
};
