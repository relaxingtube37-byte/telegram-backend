export interface BaseMatchPlayer {
  id?: number;
  name: string;
  country?: string;
  ranking?: number;
  seed?: number;
}

export interface PlayerEnrichedProfile {
  name?: string;
  ranking?: number;
  hand?: 'L' | 'R';
  backhand?: '1H' | '2H';
  playstyle?: string;
  dominantSurface?: string;
  mentalProfile?: string;
  decidingSetWinRate?: number;
  tiebreakWinRate?: number;
  breakPointConversionRate?: number;
  firstServePointsWonPct?: number;
  secondServePointsWonPct?: number;
  serviceGamesWonPct?: number;
  returnGamesWonPct?: number;
  hardCourtWinPct?: number;
  clayCourtWinPct?: number;
  grassCourtWinPct?: number;
  indoorCourtWinPct?: number;
}

export interface PlayerYearSurfaceStats {
  year?: number;
  surface?: string;
  matches: number;
  wins: number;
  losses: number;
  winRatePct?: number;
  acesTotal?: number;
  doubleFaultsTotal?: number;
  firstServeTotal?: number;
  firstServePointsScored?: number;
  secondServeTotal?: number;
  secondServePointsScored?: number;
  serviceGamesTotal?: number;
  serviceGamesWon?: number;
  breakPointsFaced?: number;
  breakPointsSaved?: number;
  breakPointsTotal?: number;
  breakPointsConverted?: number;
  returnGamesTotal?: number;
  returnGamesWon?: number;
}

export interface MatchScoreSet {
  setNumber: number;
  homeScore: number;
  awayScore: number;
  tiebreakHome?: number;
  tiebreakAway?: number;
}

export interface HistoricalMatchItem {
  id: number | string;
  date: string;
  tournamentName?: string;
  surface?: string;
  homePlayer: BaseMatchPlayer;
  awayPlayer: BaseMatchPlayer;
  winnerHome: boolean;
  score?: string;
  sets?: MatchScoreSet[];
  durationMinutes?: number;
  isRetirement?: boolean;
}

export interface TennisH2HSummary {
  homeWins: number;
  awayWins: number;
  draws?: number;
  matchesAnalyzed?: number;
  previousEvents?: Array<{
    date?: string;
    surface?: string;
    winnerHome?: boolean;
    score?: string;
  }>;
}

export interface MatchWeather {
  temperatureC?: number;
  humidityPct?: number;
  windSpeedKmh?: number;
  windGustKmh?: number;
  conditions?: string;
  isOutdoor?: boolean;
}

export interface MatchAnalyticsInput {
  fixtureId: number;
  tournamentName: string;
  roundName?: string;
  surface: string;
  matchDate?: string;
  homePlayer: BaseMatchPlayer;
  awayPlayer: BaseMatchPlayer;
  homeProfile?: PlayerEnrichedProfile | null;
  awayProfile?: PlayerEnrichedProfile | null;
  homeSurfaceStats?: PlayerYearSurfaceStats | null;
  awaySurfaceStats?: PlayerYearSurfaceStats | null;
  homeRecentMatches?: HistoricalMatchItem[];
  awayRecentMatches?: HistoricalMatchItem[];
  h2hSummary?: TennisH2HSummary | null;
  weather?: MatchWeather | null;
  isWTA?: boolean;
}

export interface MatchAnalyticsResult {
  fixtureId: number;
  tournamentName: string;
  matchDate?: string;
  homeName: string;
  awayName: string;
  surface: string;
  computedAt: string;
  
  energy: {
    home: any;
    away: any;
    diffTankPct: number;
  };
  environmental: any;
  surfaceKpis: {
    cpi: number;
    homeKpis: any;
    awayKpis: any;
    homeSurfaceElo: number;
    awaySurfaceElo: number;
  };
  synergy: {
    homeSynergy: any;
    awaySynergy: any;
    homeSetDynamics: any;
    awaySetDynamics: any;
  };
  tactical: {
    homeTactical: any;
    awayTactical: any;
    handedness: any;
    homePointsDefense: any;
    awayPointsDefense: any;
    homeTournamentTransition: any;
    awayTournamentTransition: any;
    kryptoniteHomeAdvantage: boolean;
    kryptoniteAwayAdvantage: boolean;
    homeTilt?: any;
    awayTilt?: any;
    homePressureProfile?: any;
    awayPressureProfile?: any;
  };
  markovOdds: any;
  diagnostics?: any;
}
