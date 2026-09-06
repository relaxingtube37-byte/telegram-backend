import type { HistoricalMatchRecord } from './historicalMatchInsert';

const NAME_PARTICLES = new Set([
  'de',
  'da',
  'del',
  'della',
  'di',
  'du',
  'van',
  'von',
  'der',
  'la',
  'le',
  'san',
  'st',
  'st.',
  'mc',
  'mac',
]);

export function normalizePlayerName(name: string): string {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeTourneyName(name: string): string {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function buildMatchFingerprint(record: Pick<
  HistoricalMatchRecord,
  'tour' | 'match_date' | 'winner_name' | 'loser_name' | 'tourney_name'
>): string {
  return [
    record.tour,
    record.match_date,
    normalizePlayerName(record.winner_name),
    normalizePlayerName(record.loser_name),
    normalizeTourneyName(record.tourney_name),
  ].join('|');
}

/** Higher score = richer match row (prefer when merging duplicates). */
export function matchRichnessScore(
  record: Pick<
    HistoricalMatchRecord,
    | 'w_svpt'
    | 'l_svpt'
    | 'minutes'
    | 'winner_rank'
    | 'loser_rank'
    | 'w_ace'
    | 'l_ace'
    | 'w_bpFaced'
    | 'l_bpFaced'
    | 'winner_rank_points'
    | 'loser_rank_points'
    | 'w_odds_match'
    | 'w_serve_won_pct'
  >,
): number {
  return (
    (record.w_svpt > 0 ? 1000 : 0) +
    (record.l_svpt > 0 ? 500 : 0) +
    (record.w_odds_match != null && record.w_odds_match > 0 ? 300 : 0) +
    (record.w_serve_won_pct != null && record.w_serve_won_pct > 0 ? 200 : 0) +
    (record.winner_rank > 0 && record.loser_rank > 0 ? 200 : 0) +
    record.minutes +
    record.w_ace +
    record.l_ace +
    record.w_bpFaced +
    record.l_bpFaced +
    Math.floor((record.winner_rank_points + record.loser_rank_points) / 100)
  );
}

type ParsedName = {
  tokens: string[];
  familyTokens: string[];
  familyKey: string;
  givenTokens: string[];
  givenKey: string;
  givenInitials: string[];
  /** True when CSV uses "Last I." or "Last I. J." style */
  csvStyle: boolean;
};

function tokenizeName(name: string): string[] {
  return normalizePlayerName(name).split(/\s+/).filter(Boolean);
}

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

function stripNameSuffixes(tokens: string[]): string[] {
  if (tokens.length > 1 && NAME_SUFFIXES.has(tokens[tokens.length - 1])) {
    return tokens.slice(0, -1);
  }
  return tokens;
}

function expandGivenTokens(givenTokens: string[]): string[] {
  const out: string[] = [];
  for (const token of givenTokens) {
    if (token.includes('-') && token.split('-').every((part) => part.length >= 4)) {
      out.push(...token.split('-').filter(Boolean));
    } else {
      out.push(token);
    }
  }
  return out;
}

function givenInitialsFromTokens(givenTokens: string[]): string[] {
  return expandGivenTokens(givenTokens)
    .map((t) => t[0])
    .filter(Boolean);
}

function isInitialToken(token: string): boolean {
  return token.length === 1;
}

function familyStartIndex(tokens: string[]): number {
  if (tokens.length <= 1) return 0;
  let start = tokens.length - 1;
  while (start > 0 && NAME_PARTICLES.has(tokens[start - 1])) {
    start -= 1;
  }
  return start;
}

function hyphenPrefixes(value: string): string[] {
  if (!value.includes('-')) return [];
  const parts = value.split('-');
  const prefixes: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    prefixes.push(parts.slice(0, i).join('-'));
  }
  return prefixes;
}

/** Last two tokens as compound surname (e.g. "Haddad Maia", "Davidovich Fokina"). */
function compoundFamilyKey(tokens: string[]): string {
  if (tokens.length >= 3) return tokens.slice(-2).join(' ');
  return tokens[tokens.length - 1] || '';
}

function parsePlayerName(raw: string): ParsedName {
  const rawTokens = raw.trim().split(/\s+/).filter(Boolean);
  const tokens = stripNameSuffixes(tokenizeName(raw));
  if (!tokens.length) {
    return {
      tokens: [],
      familyTokens: [],
      familyKey: '',
      givenTokens: [],
      givenKey: '',
      givenInitials: [],
      csvStyle: false,
    };
  }

  const trailingInitials: string[] = [];
  let end = tokens.length;
  while (end > 1 && isInitialToken(tokens[end - 1])) {
    trailingInitials.unshift(tokens[end - 1]);
    end -= 1;
  }

  if (trailingInitials.length > 0 && end >= 1) {
    const familyTokens = tokens.slice(0, end);
    const givenInitials = trailingInitials;
    return {
      tokens,
      familyTokens,
      familyKey: familyTokens.join(' '),
      givenTokens: [],
      givenKey: '',
      givenInitials,
      csvStyle: true,
    };
  }

  if (tokens.length === 2 && tokens[1].includes('-')) {
    const parts = tokens[1].split('-').filter((part) => part.length === 1);
    if (parts.length >= 2) {
      return {
        tokens,
        familyTokens: [tokens[0]],
        familyKey: tokens[0],
        givenTokens: [],
        givenKey: '',
        givenInitials: parts,
        csvStyle: true,
      };
    }
  }

  // Two-letter token after a long token — only when both chars are uppercase in source (e.g. region codes), not surnames like "Ku".
  const rawSecond = rawTokens[1] || '';
  if (
    tokens.length === 2 &&
    tokens[0].length >= 7 &&
    tokens[1].length === 2 &&
    /^[a-z]{2}$/.test(tokens[1]) &&
    rawSecond.length === 2 &&
    rawSecond === rawSecond.toUpperCase() &&
    rawSecond !== rawSecond.toLowerCase()
  ) {
    return {
      tokens,
      familyTokens: [tokens[0]],
      familyKey: tokens[0],
      givenTokens: [],
      givenKey: '',
      givenInitials: [tokens[1][0], tokens[1][1]],
      csvStyle: true,
    };
  }

  const familyStart = familyStartIndex(tokens);
  const familyTokens = tokens.slice(familyStart);
  const givenTokens = tokens.slice(0, familyStart);
  const expandedGiven = expandGivenTokens(givenTokens);
  return {
    tokens,
    familyTokens,
    familyKey: familyTokens.join(' '),
    givenTokens,
    givenKey: givenTokens.join(''),
    givenInitials: expandedGiven.map((t) => t[0]).filter(Boolean),
    csvStyle: false,
  };
}

function familyKeysMatch(a: ParsedName, b: ParsedName): boolean {
  const keyA = a.familyKey.replace(/[\s-]/g, '');
  const keyB = b.familyKey.replace(/[\s-]/g, '');
  if (!keyA || !keyB) return false;
  if (keyA === keyB) return true;

  const compoundA = compoundFamilyKey(a.tokens).replace(/[\s-]/g, '');
  const compoundB = compoundFamilyKey(b.tokens).replace(/[\s-]/g, '');
  if (compoundA.length >= 4 && compoundB.length >= 4 && compoundA === compoundB) return true;
  if (compoundA.length >= 4 && (keyA === compoundB || keyB === compoundA)) return true;
  if (compoundB.length >= 4 && (keyA === compoundB || keyB === compoundA)) return true;
  if (compoundB.length >= 4 && keyA.length >= 4 && compoundB.startsWith(keyA)) return true;
  if (compoundA.length >= 4 && keyB.length >= 4 && compoundA.startsWith(keyB)) return true;

  if (keyA.startsWith(keyB) || keyB.startsWith(keyA)) {
    const shorter = keyA.length < keyB.length ? keyA : keyB;
    if (shorter.length >= 4) return true;
  }

  const prefixesA = hyphenPrefixes(a.familyKey);
  const prefixesB = hyphenPrefixes(b.familyKey);
  for (const prefix of prefixesA) {
    const compact = prefix.replace(/[\s-]/g, '');
    if (compact.length >= 4 && (compact === keyB || keyB.startsWith(compact))) return true;
  }
  for (const prefix of prefixesB) {
    const compact = prefix.replace(/[\s-]/g, '');
    if (compact.length >= 4 && (compact === keyA || keyA.startsWith(compact))) return true;
  }

  return false;
}

function initialsCompatible(a: ParsedName, b: ParsedName): boolean {
  const initialsA = a.givenInitials.length
    ? a.givenInitials
    : givenInitialsFromTokens(a.givenTokens);
  const initialsB = b.givenInitials.length
    ? b.givenInitials
    : givenInitialsFromTokens(b.givenTokens);

  if (!initialsA.length || !initialsB.length) return true;

  if (initialsA.length === 1 && initialsB.length > 1) {
    return initialsB.includes(initialsA[0]);
  }
  if (initialsB.length === 1 && initialsA.length > 1) {
    return initialsA.includes(initialsB[0]);
  }

  if (initialsA.length === 1 && initialsB.length === 1) {
    return initialsA[0] === initialsB[0];
  }

  if (initialsA.length >= 2 || initialsB.length >= 2) {
    const longer = initialsA.length >= initialsB.length ? initialsA : initialsB;
    const shorter = initialsA.length < initialsB.length ? initialsA : initialsB;
    return shorter.every((ch, idx) => longer[idx] === ch);
  }

  return initialsA[0] === initialsB[0];
}

function givenNamesCompatible(a: ParsedName, b: ParsedName): boolean {
  if (!initialsCompatible(a, b)) return false;

  const givenA = a.givenKey.replace(/[\s-]/g, '');
  const givenB = b.givenKey.replace(/[\s-]/g, '');
  if (!givenA || !givenB) return true;
  if (givenA === givenB) return true;
  if (givenA.startsWith(givenB) || givenB.startsWith(givenA)) return true;
  return givenA[0] === givenB[0];
}

function shortFamilyNameGuard(a: ParsedName, b: ParsedName): boolean {
  const shorterFamily = Math.min(a.familyKey.length, b.familyKey.length);
  if (shorterFamily > 2) return true;
  return initialsCompatible(a, b) && givenNamesCompatible(a, b);
}

export function namesLikelyMatch(a: string, b: string): boolean {
  return namesStrictMatch(a, b);
}

/** CSV uses elongated disambiguation suffixes like "Wang Xin." / "Wang Xiy." */
function csvDisambiguationMatch(csvRaw: string, fullRaw: string): boolean {
  const csvTokens = tokenizeName(csvRaw);
  const fullTokens = stripNameSuffixes(tokenizeName(fullRaw));
  if (csvTokens.length !== 2 || fullTokens.length < 2) return false;

  const [family, suffix] = csvTokens;
  if (suffix.length < 3) return false;
  if (family !== fullTokens[fullTokens.length - 1]) return false;

  const given = fullTokens.slice(0, -1).join('');
  if (given === suffix) return true;
  if (given.startsWith(suffix)) return true;
  return given.includes(suffix);
}

/** Strict CSV-safe player name match (handles "Last I." and "First Last"). */
export function namesStrictMatch(a: string, b: string): boolean {
  const na = normalizePlayerName(a);
  const nb = normalizePlayerName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (csvDisambiguationMatch(a, b) || csvDisambiguationMatch(b, a)) return true;

  const parsedA = parsePlayerName(a);
  const parsedB = parsePlayerName(b);
  if (!parsedA.familyKey || !parsedB.familyKey) return false;
  if (!familyKeysMatch(parsedA, parsedB)) return false;
  if (!shortFamilyNameGuard(parsedA, parsedB)) return false;
  return givenNamesCompatible(parsedA, parsedB);
}

function dottedCsvForms(familyKey: string, initials: string[]): string[] {
  const forms = new Set<string>();
  const family = familyKey.trim();
  if (!family) return [];

  if (!initials.length) {
    forms.add(family);
    return [...forms];
  }

  if (initials.length === 1) {
    forms.add(`${family} ${initials[0]}`);
    forms.add(`${family} ${initials[0]}.`);
    return [...forms];
  }

  const joined = initials.join(' ');
  const dotted = initials.map((i) => `${i}.`).join(' ');
  forms.add(`${family} ${joined}`);
  forms.add(`${family} ${dotted}`);
  forms.add(`${family} ${initials.join('.')}.`);
  forms.add(`${family} ${initials.join('')}`);
  return [...forms];
}

function addPatternForms(patterns: Set<string>, family: string, initials: string[]): void {
  for (const form of dottedCsvForms(family, initials)) {
    patterns.add(normalizePlayerName(form));
    if (family.includes(' ')) {
      patterns.add(normalizePlayerName(form.replace(family, family.replace(/ /g, '-'))));
    }
  }
}

export function buildCsvNamePatterns(fullName: string): string[] {
  const tokens = stripNameSuffixes(tokenizeName(fullName));
  const parsed = parsePlayerName(fullName);
  const patterns = new Set<string>();

  patterns.add(normalizePlayerName(fullName));

  // Western-order Asian names: "Yeonwoo Ku" → CSV "Ku Y."
  if (tokens.length === 2 && tokens[0].length >= 2 && tokens[1].length >= 2) {
    addPatternForms(patterns, tokens[1], [tokens[0][0]]);
  }

  if (parsed.givenTokens.length && parsed.familyTokens.length) {
    patterns.add(`${parsed.givenTokens.join(' ')} ${parsed.familyKey}`);
    patterns.add(`${parsed.givenKey} ${parsed.familyTokens[parsed.familyTokens.length - 1]}`);
  }

  const familyLast = parsed.familyTokens[parsed.familyTokens.length - 1] || parsed.familyKey;
  const initials = parsed.givenInitials.length
    ? parsed.givenInitials
    : givenInitialsFromTokens(parsed.givenTokens);

  addPatternForms(patterns, parsed.familyKey, initials);
  addPatternForms(patterns, familyLast, initials);

  for (const initial of initials) {
    addPatternForms(patterns, familyLast, [initial]);
    addPatternForms(patterns, parsed.familyKey, [initial]);
  }

  if (initials.length === 1 && familyLast.length >= 10) {
    addPatternForms(patterns, familyLast, [initials[0], initials[0]]);
  }

  for (const prefix of hyphenPrefixes(parsed.familyKey)) {
    addPatternForms(patterns, prefix, initials);
  }

  if (parsed.givenTokens.length >= 2) {
    const spacedGiven = parsed.givenTokens.join(' ');
    patterns.add(`${spacedGiven} ${familyLast}`);
    patterns.add(`${spacedGiven} ${parsed.familyKey}`);
    for (const form of dottedCsvForms(familyLast, initials)) {
      patterns.add(normalizePlayerName(`${spacedGiven} ${form}`));
    }
  }

  const expandedGiven = expandGivenTokens(
    tokens.length >= 3 ? tokens.slice(0, tokens.length - 2) : parsed.givenTokens,
  );
  const firstGiven = expandedGiven[0] || tokens[0] || '';
  if (firstGiven.length >= 2) {
    addPatternForms(patterns, familyLast, [firstGiven[0], firstGiven[1]]);
    addPatternForms(patterns, parsed.familyKey, [firstGiven[0], firstGiven[1]]);
  }

  if (familyLast === 'wang' && firstGiven) {
    if (firstGiven.startsWith('xinyu')) patterns.add('wang xin');
    if (firstGiven === 'xiyu') patterns.add('wang xiy');
  }

  const hyphenGivenInitials = parsed.givenTokens
    .flatMap((token) => (token.includes('-') ? token.split('-') : [token]))
    .map((token) => token[0])
    .filter(Boolean);
  if (hyphenGivenInitials.length >= 2) {
    addPatternForms(patterns, familyLast, hyphenGivenInitials);
    patterns.add(`${familyLast} ${hyphenGivenInitials.join('-')}`);
    patterns.add(`${familyLast} ${hyphenGivenInitials.join('')}`);
  }

  if (tokens.length >= 3) {
    addPatternForms(patterns, tokens[1], [tokens[0][0]]);
    const compoundFamily = tokens.slice(-2).join(' ');
    const givenTokens = expandGivenTokens(tokens.slice(0, tokens.length - 2));
    const initialSets = new Set<string>();
    if (givenTokens[0]?.[0]) initialSets.add(givenTokens[0][0]);
    initialSets.add(givenTokens.map((t) => t[0]).filter(Boolean).join(' '));
    const lastGivenInitial = givenTokens[givenTokens.length - 1]?.[0];
    if (lastGivenInitial) initialSets.add(lastGivenInitial);

    for (const initialKey of initialSets) {
      const initialList = initialKey.includes(' ') ? initialKey.split(' ') : [initialKey];
      addPatternForms(patterns, compoundFamily, initialList);
    }

    if (lastGivenInitial) {
      addPatternForms(patterns, familyLast, [lastGivenInitial]);
    }
  }

  return [...patterns].filter(Boolean);
}
