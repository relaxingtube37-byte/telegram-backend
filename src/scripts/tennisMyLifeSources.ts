const TML_BASE = 'https://stats.tennismylife.org/data';

export function getTennisMyLifeWtaYearUrl(year: number): string {
  return `${TML_BASE}/${year}_wta.csv`;
}

export function getTennisMyLifeAtpYearUrl(year: number): string {
  return `${TML_BASE}/${year}.csv`;
}

export function getTennisMyLifeWtaMirrors(year: number): string[] {
  return [getTennisMyLifeWtaYearUrl(year)];
}

export function getTennisMyLifeAtpMirrors(year: number): string[] {
  return [getTennisMyLifeAtpYearUrl(year)];
}
