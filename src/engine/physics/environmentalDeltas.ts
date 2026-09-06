import type { MatchWeather } from '../types';
import { TOURNAMENT_VENUE_DATA } from '../venue/tournamentVenueData';
import type { PlayerFatigueMetrics } from './fatigueEngine';

export interface MatchEnvironmentContext {
  weather?: MatchWeather;
  tournamentName: string;
  tournamentCountry?: string;
  matchDate?: string;
  currentSurface?: string;
}

export interface EnvironmentalDeltas {
  airDensityKgm3: number;
  airDensityDeltaPct: number;
  altitudeM: number;
  venueSpeedBias: 'serve-dominant' | 'neutral' | 'rally-dominant';
  homeAltitudeM: number;
  altitudeAdaptationDeltaM: number;
  isAltitudeAdapted: boolean;
  altitudeAdaptationImpact: 'ADVANTAGE' | 'NEUTRAL' | 'DISADVANTAGE';
  jetLagHours: number;
  jetLagIndex: number;
  travelDirection: 'east-to-west' | 'west-to-east' | 'none' | 'unknown';
  daysSinceTravel: number;
  jetLagImpact: 'HIGH' | 'MODERATE' | 'LOW' | 'NONE';
  previousVenueCity?: string;
  currentVenueCity?: string;
  previousSurface: string;
  currentSurface: string;
  surfaceTransitionPenalty: number;
  surfaceTransitionImpact: 'HIGH' | 'MODERATE' | 'LOW' | 'NONE';
  ageRecoveryFactor: number;
  ageGroup: string;
  fatiguePenalty: number;
  fatigueImpact: 'HIGH' | 'MODERATE' | 'LOW';
  environmentalBias: number;
}

export const HOME_COUNTRY_ALTITUDE: Record<string, number> = {
  AU: 30, AR: 25, GB: 20, NL: 5, BE: 10, DK: 15, SE: 20, NO: 30,
  FI: 50, JP: 40, KR: 40, TH: 10, EG: 25, QA: 10, AE: 5, SA: 30,
  TN: 25, PT: 50, HK: 50, SG: 15, HR: 10, BA: 150,
  DE: 120, FR: 100, IT: 80, PL: 120, CZ: 220, HU: 110, RO: 90,
  RS: 120, GR: 80, TR: 80, RU: 160, UA: 150, BY: 145, CA: 100,
  US: 100, MA: 150, CN: 50, BR: 120, ES: 250,
  CH: 500, AT: 430, CO: 2580, EC: 2200, CL: 556, KZ: 760,
  UZ: 425, GE: 430, IN: 300, ZA: 1400, MX: 500, BG: 550,
  AD: 1040,
};

export const SURFACE_TRANSITION_PENALTY: Record<string, Record<string, number>> = {
  clay:   { clay: 0,    hard: 0.30, grass: 0.65, indoor: 0.25 },
  hard:   { clay: 0.35, hard: 0,    grass: 0.40, indoor: 0.10 },
  grass:  { clay: 0.60, hard: 0.35, grass: 0,    indoor: 0.30 },
  indoor: { clay: 0.20, hard: 0.10, grass: 0.45, indoor: 0    },
};

export const normalizeSurface = (groundType?: string): 'clay' | 'grass' | 'hard' | 'indoor' => {
  if (!groundType) return 'hard';
  const g = groundType.toLowerCase();
  if (g.includes('clay')) return 'clay';
  if (g.includes('grass')) return 'grass';
  if (g.includes('indoor')) return 'indoor';
  return 'hard';
};

export const getAgeRecoveryFactor = (age?: number | string | null): number => {
  const a = typeof age === 'string' ? parseInt(age, 10) : (age ?? null);
  if (!a || isNaN(Number(a))) return 1.0;
  if (a < 22) return 0.75;
  if (a < 26) return 0.85;
  if (a < 30) return 1.00;
  if (a < 34) return 1.20;
  if (a < 38) return 1.50;
  return 1.80;
};

export const getAgeGroup = (age?: number | string | null): string => {
  const a = typeof age === 'string' ? parseInt(age, 10) : (age ?? null);
  if (!a || isNaN(Number(a))) return 'Unknown';
  if (a < 22) return 'Young (<22)';
  if (a < 26) return 'Young Adult (22–25)';
  if (a < 30) return 'Prime (26–29)';
  if (a < 34) return 'Experienced (30–33)';
  if (a < 38) return 'Veteran (34–37)';
  return 'Elder Statesman (38+)';
};

export const lookupVenueData = (tournamentName: string, country?: string) => {
  const text = `${tournamentName} ${country || ''}`.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const key of Object.keys(TOURNAMENT_VENUE_DATA)) {
    if (text.includes(key)) return TOURNAMENT_VENUE_DATA[key];
  }
  return { lat: 0, lon: 0, altitude: 50, timezone: 'UTC', city: 'Standard Venue' };
};

export const calculateEnvironmentalDeltas = (
  context: MatchEnvironmentContext,
  fatigue?: PlayerFatigueMetrics,
  playerCountry?: string,
  playerAge?: number | string | null
): EnvironmentalDeltas => {
  const venue = lookupVenueData(context.tournamentName, context.tournamentCountry);
  const altM = venue.altitude || 50;
  const tempC = context.weather?.temperatureC ?? 22;
  const humidityPct = context.weather?.humidityPct ?? 55;

  const tempK = tempC + 273.15;
  const pressureHpa = 1013.25 * Math.pow(1 - (0.0065 * altM) / 288.15, 5.255);
  const airDensity = (pressureHpa * 100) / (287.05 * tempK);
  const baseDensity = 1.225;
  const airDensityDeltaPct = Math.round(((airDensity - baseDensity) / baseDensity) * 1000) / 10;

  const venueSpeedBias = altM > 500 ? 'serve-dominant' : altM < 100 ? 'rally-dominant' : 'neutral';

  const homeAlt = playerCountry && HOME_COUNTRY_ALTITUDE[playerCountry.toUpperCase()]
    ? HOME_COUNTRY_ALTITUDE[playerCountry.toUpperCase()]
    : 100;

  const altDelta = Math.abs(altM - homeAlt);
  const isAltitudeAdapted = altDelta < 400 || (homeAlt > 400 && altM > 400);

  const curSurf = normalizeSurface(context.currentSurface);
  const prevSurf = curSurf; // default fallback
  const surfTrans = SURFACE_TRANSITION_PENALTY[prevSurf]?.[curSurf] ?? 0;

  const ageFactor = getAgeRecoveryFactor(playerAge);
  const ageGrp = getAgeGroup(playerAge);

  const fatiguePen = fatigue ? Math.min(20, (fatigue.tournamentFatigueLoad || 0) * 0.15) : 0;

  return {
    airDensityKgm3: Math.round(airDensity * 1000) / 1000,
    airDensityDeltaPct,
    altitudeM: altM,
    venueSpeedBias,
    homeAltitudeM: homeAlt,
    altitudeAdaptationDeltaM: altDelta,
    isAltitudeAdapted,
    altitudeAdaptationImpact: isAltitudeAdapted ? 'ADVANTAGE' : altDelta > 800 ? 'DISADVANTAGE' : 'NEUTRAL',
    jetLagHours: 0,
    jetLagIndex: 0,
    travelDirection: 'none',
    daysSinceTravel: 7,
    jetLagImpact: 'NONE',
    currentVenueCity: venue.city,
    previousSurface: prevSurf,
    currentSurface: curSurf,
    surfaceTransitionPenalty: surfTrans,
    surfaceTransitionImpact: surfTrans > 0.4 ? 'HIGH' : surfTrans > 0.2 ? 'MODERATE' : 'LOW',
    ageRecoveryFactor: ageFactor,
    ageGroup: ageGrp,
    fatiguePenalty: fatiguePen,
    fatigueImpact: fatiguePen > 10 ? 'HIGH' : fatiguePen > 5 ? 'MODERATE' : 'LOW',
    environmentalBias: Math.round((airDensityDeltaPct * -0.5) * 10) / 10,
  };
};
