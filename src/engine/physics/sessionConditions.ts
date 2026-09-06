import type { MatchWeather } from '../types';

export interface MatchSessionConditions {
  sessionType: 'Day' | 'Night' | 'Twilight';
  temperatureC: number;
  humidityPct: number;
  windSpeedKmh: number;
  dewPointC: number;
  ballBouncinessModifier: number; // 0.85 (heavy/dead) to 1.15 (lively/high bounce)
  conditionsSummary: string;
}

export const calculateMatchSessionConditions = (
  weather?: MatchWeather | null,
  matchTimeStr?: string
): MatchSessionConditions => {
  const temp = weather?.temperatureC ?? 22;
  const hum = weather?.humidityPct ?? 50;
  const wind = weather?.windSpeedKmh ?? 10;

  let sessionType: 'Day' | 'Night' | 'Twilight' = 'Day';
  if (matchTimeStr) {
    const hour = parseInt(matchTimeStr.split(':')[0], 10);
    if (hour >= 19 || hour < 6) sessionType = 'Night';
    else if (hour >= 17) sessionType = 'Twilight';
  }

  // Dew point approximation (Magnus formula)
  const a = 17.27;
  const b = 237.7;
  const alpha = ((a * temp) / (b + temp)) + Math.log(hum / 100.0);
  const dewPoint = (b * alpha) / (a - alpha);

  // Ball bounciness modifier: Hot + Low humidity = higher livelier bounce
  let bounciness = 1.0;
  if (temp > 28 && hum < 45) bounciness = 1.10;
  else if (temp < 16 || hum > 75 || sessionType === 'Night') bounciness = 0.92;

  return {
    sessionType,
    temperatureC: temp,
    humidityPct: hum,
    windSpeedKmh: wind,
    dewPointC: Math.round(dewPoint * 10) / 10,
    ballBouncinessModifier: Math.round(bounciness * 100) / 100,
    conditionsSummary: `${sessionType} session, ${temp}°C, ${hum}% hum, bounciness: ${bounciness > 1 ? 'High' : bounciness < 1 ? 'Heavy' : 'Normal'}`,
  };
};
