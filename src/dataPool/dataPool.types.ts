export interface BackendMatchStats {
  aces1: number;
  aces2: number;
  doubleFaults1: number;
  doubleFaults2: number;
  firstServePct1: number;
  firstServePct2: number;
  breakPointsWon1: number;
  breakPointsTotal1: number;
  breakPointsWon2: number;
  breakPointsTotal2: number;
  winProbability1: number;
  winProbability2: number;
  h2hWins1: number;
  h2hWins2: number;
  aiVerdict: string;
}

export interface BackendMatchRowItem {
  id: number;
  playerId1?: number;
  playerId2?: number;
  player1: string;
  player2: string;
  country1: string;
  country2: string;
  rank1?: number;
  rank2?: number;
  serve1: boolean;
  serve2: boolean;
  sets1: string[];
  sets2: string[];
  point: string;
  statusText: string;
  isLive: boolean;
  winnerCode?: number;
  time: string;
  startTimestamp?: number;
  stats: BackendMatchStats;
  analytics?: any;
  homeOdds?: string;
  awayOdds?: string;
  courtSpeed?: string;
  cpi?: number;
  sessionType?: string;
  thrillerTag?: string;
  homeFormBadge?: string;
  awayFormBadge?: string;
  homeStamina?: number;
  awayStamina?: number;
  homePureWinChance?: number;
  awayPureWinChance?: number;
  homeHoldRate?: number;
  awayHoldRate?: number;
  homeBreakRate?: number;
  awayBreakRate?: number;
  homeClutchVerdict?: string;
  awayClutchVerdict?: string;
  expectedTotalGames?: number;
}

export interface BackendTournamentGroup {
  tournamentId: string;
  name: string;
  category: string;
  country: string;
  surface: string;
  matches: BackendMatchRowItem[];
}