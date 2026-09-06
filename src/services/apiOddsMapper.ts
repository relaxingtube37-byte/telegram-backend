import { namesLikelyMatch } from '../scripts/historicalMatchKeys';

export type OddsMarket = {
  marketName?: string;
  marketPeriod?: string;
  marketGroup?: string;
  choices?: Array<{ name?: string; fractionalValue?: string; initialFractionalValue?: string }>;
};

export function fractionalToDecimal(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  if (raw.includes('/')) {
    const [num, den] = raw.split('/').map((part) => Number(part.trim()));
    if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
    return Math.round((1 + num / den) * 1000) / 1000;
  }

  const n = Number(raw);
  return Number.isFinite(n) && n > 1 ? Math.round(n * 1000) / 1000 : null;
}

export function extractHomeAwayOdds(
  oddsPayload: { markets?: OddsMarket[] } | null | undefined,
): { home: number | null; away: number | null; set1Home: number | null; set1Away: number | null } {
  const markets = Array.isArray(oddsPayload?.markets) ? oddsPayload!.markets! : [];
  let home: number | null = null;
  let away: number | null = null;
  let set1Home: number | null = null;
  let set1Away: number | null = null;

  for (const market of markets) {
    const period = String(market.marketPeriod || market.marketName || '').toLowerCase();
    const isMatch = period.includes('match') || String(market.marketName || '').toLowerCase().includes('full time');
    const isSet1 = period.includes('1st set') || period.includes('first set');

    const choices = Array.isArray(market.choices) ? market.choices : [];
    const homeChoice = choices.find((c) => String(c.name) === '1');
    const awayChoice = choices.find((c) => String(c.name) === '2');
    const homeOdds = fractionalToDecimal(homeChoice?.fractionalValue || homeChoice?.initialFractionalValue);
    const awayOdds = fractionalToDecimal(awayChoice?.fractionalValue || awayChoice?.initialFractionalValue);

    if (isMatch && home == null && away == null) {
      home = homeOdds;
      away = awayOdds;
    }
    if (isSet1 && set1Home == null && set1Away == null) {
      set1Home = homeOdds;
      set1Away = awayOdds;
    }
  }

  return { home, away, set1Home, set1Away };
}

export function mapOddsToWinnerLoser(
  oddsPayload: { markets?: OddsMarket[] } | null | undefined,
  winnerName: string,
  loserName: string,
  homeName: string,
  awayName: string,
): { w_odds_match: number; l_odds_match: number; w_odds_set1?: number; l_odds_set1?: number } | null {
  const { home, away, set1Home, set1Away } = extractHomeAwayOdds(oddsPayload);
  if (home == null || away == null) return null;

  const winnerIsHome = namesLikelyMatch(winnerName, homeName) || namesLikelyMatch(loserName, awayName);
  const winnerIsAway = namesLikelyMatch(winnerName, awayName) || namesLikelyMatch(loserName, homeName);

  if (winnerIsHome && !winnerIsAway) {
    return {
      w_odds_match: home,
      l_odds_match: away,
      ...(set1Home != null && set1Away != null ? { w_odds_set1: set1Home, l_odds_set1: set1Away } : {}),
    };
  }
  if (winnerIsAway && !winnerIsHome) {
    return {
      w_odds_match: away,
      l_odds_match: home,
      ...(set1Home != null && set1Away != null ? { w_odds_set1: set1Away, l_odds_set1: set1Home } : {}),
    };
  }

  return null;
}

export function resolveEventSides(
  eventPayload: { event?: Record<string, unknown> } | Record<string, unknown> | null | undefined,
  winnerName: string,
  loserName: string,
): { home: string; away: string } {
  const raw = (eventPayload as { event?: Record<string, unknown> })?.event || eventPayload;
  const ev = (raw || {}) as Record<string, unknown>;
  const homeTeam = ev.homeTeam as { name?: string } | undefined;
  const awayTeam = ev.awayTeam as { name?: string } | undefined;
  const home = String(homeTeam?.name || (ev.home as { name?: string } | undefined)?.name || '').trim();
  const away = String(awayTeam?.name || (ev.away as { name?: string } | undefined)?.name || '').trim();
  if (home && away) return { home, away };
  return { home: winnerName, away: loserName };
}
