export const SCORER_VERSION = 'v2.1.0';
export const RULE_VERSION = 'v2.1.0';

export type Tour = 'ATP' | 'WTA' | 'CHALLENGER' | 'ITF';
export type Surface = 'HARD' | 'CLAY' | 'GRASS' | 'CARPET';
export type Round = 'F' | 'SF' | 'QF' | 'R16' | 'R32' | 'R64' | 'R128' | 'RR' | 'Q1' | 'Q2' | 'Q3';
export type MatchStatus = 'SCHEDULED' | 'FINISHED' | 'RETIRED' | 'WALKOVER' | 'ABANDONED' | 'CANCELLED';

export type SourceName = 'sackmann' | 'pbp' | 'slam_pbp' | 'mcp' | 'visuals';

export const SOURCE_BITMASKS: Record<SourceName, number> = {
  sackmann: 1,
  pbp: 2,
  slam_pbp: 4,
  mcp: 8,
  visuals: 16,
};

export const SOURCE_PRIORITIES: Record<SourceName, number> = {
  sackmann: 50,
  pbp: 40,
  slam_pbp: 30,
  mcp: 20,
  visuals: 10,
};

export interface IncomingRawMatch {
  sourceName: SourceName;
  sourceMatchId: string;
  matchDate: string; // YYYY-MM-DD
  tour: Tour;
  gender?: 'M' | 'F';
  rawTournamentName: string;
  rawSurface?: string;
  rawRound?: string;
  rawPlayer1: string;
  rawPlayer2: string;
  rawWinnerName?: string;
  rawScore?: string;
  rawPayload?: Record<string, unknown>;
}

export interface ResolvedMatchContext {
  incoming: IncomingRawMatch;
  evidenceId: number;
  playerLowId: string;
  playerHighId: string;
  player1CanonicalId: string;
  player2CanonicalId: string;
  winnerCanonicalId?: string;
  loserCanonicalId?: string;
  canonicalTourneyId?: string;
  surface: Surface;
  roundName: Round;
  hasSiblingAmbiguity: boolean;
  hasUnclearTournament: boolean;
}

export interface CanonicalMatchCandidate {
  canonicalMatchId: string;
  matchDate: string;
  tour: Tour;
  canonicalTourneyId: string;
  surface: Surface;
  roundName: Round;
  playerLowId: string;
  playerHighId: string;
  matchStatus: MatchStatus;
  winnerCanonicalId?: string;
  loserCanonicalId?: string;
  canonicalScore?: string;
  sourceMask: number;
  evidenceCount: number;
  version: number;
}

export type VetoCode =
  | 'VETO_WINNER_CONFLICT'
  | 'VETO_INVERTED_SCORE'
  | 'VETO_TOUR_GENDER_MISMATCH'
  | 'VETO_DATE_WINDOW_EXCEEDED'
  | 'VETO_DOUBLE_BOOKING'
  | 'VETO_SIBLING_AMBIGUITY'
  | 'VETO_ROUND_HIERARCHY_PARADOX'
  | 'VETO_UNCLEAR_TOURNAMENT';

export interface ScoredCandidate {
  candidate: CanonicalMatchCandidate;
  totalScore: number;
  breakdown: {
    playerPair: number;
    date: number;
    score: number;
    tournament: number;
    surface: number;
    round: number;
  };
  vetoes: VetoCode[];
}

export type LinkAction = 'AUTO_LINK' | 'REVIEW_QUEUE' | 'CREATE_NEW_CANONICAL';

export interface LinkDecision {
  action: LinkAction;
  canonicalMatchId?: string;
  reviewId?: number;
  confidenceScore: number;
  scorerVersion: string;
  ruleVersion: string;
  vetoTriggers: VetoCode[];
  divergentFields?: Record<string, unknown>;
}
