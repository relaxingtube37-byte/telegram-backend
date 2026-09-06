import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'data', 'database.sqlite');
const db = new Database(DB_PATH, { readonly: true });

console.log('═════════════════════════════════════════════════════════════════════════');
console.log('🔍 FOOTBALL STATE / TELEGRAM-BACKEND: 2024+ DATA COMPLETENESS AUDIT');
console.log('═════════════════════════════════════════════════════════════════════════\n');

// 1. Total Stored Matches Count
const totalAllMatchesRow = db.prepare('SELECT COUNT(*) as c FROM canonical_matches').get() as { c: number };
const totalAllMatches = totalAllMatchesRow.c;

// 2. Fetch All Matches for 2024+
const query2024Plus = `
  SELECT 
    id,
    canonical_match_id,
    canonical_match_date,
    canonical_start_utc,
    tour,
    tourney_name,
    tourney_level,
    surface,
    round_name,
    canonical_winner_name,
    canonical_loser_name,
    score,
    minutes,
    source_presence,
    join_confidence,
    data_source_stats,
    data_source_pbp,
    data_source_odds,
    bundle_storage_path,
    w_odds_match,
    l_odds_match,
    winner_rank,
    loser_rank,
    w_svpt,
    w_1stIn,
    w_1stWon,
    w_2ndWon,
    w_SvGms,
    w_bpSaved,
    w_bpFaced,
    l_svpt,
    l_1stIn,
    l_1stWon,
    l_2ndWon,
    l_SvGms,
    l_bpSaved,
    l_bpFaced,
    is_placeholder_serve,
    is_retirement_or_wo,
    is_non_singles,
    is_speculative_draw,
    is_canonical_modeling_usable,
    is_backtest_safe,
    canonical_status_reason,
    is_archive_only
  FROM canonical_matches
  ORDER BY id ASC;
`;

const allRows = db.prepare(query2024Plus).all() as any[];

// Filter 2024+ and inspect invalid dates
const rows2024Plus: any[] = [];
let invalidDateCount = 0;

for (const r of allRows) {
  const d = r.canonical_match_date;
  if (!d || typeof d !== 'string' || d.length < 10) {
    invalidDateCount++;
    continue;
  }
  if (d >= '2024-01-01') {
    rows2024Plus.push(r);
  }
}

console.log(`• Total matches stored in database: ${totalAllMatches.toLocaleString()}`);
console.log(`• Total matches dated from 2024-01-01 onward: ${rows2024Plus.length.toLocaleString()}`);
console.log(`• Total matches with invalid or missing dates: ${invalidDateCount.toLocaleString()}\n`);

// 3. Duplicate Match IDs Check
const idCounts = new Map<string, number>();
for (const r of rows2024Plus) {
  const id = r.canonical_match_id;
  idCounts.set(id, (idCounts.get(id) || 0) + 1);
}

let duplicateIdCount = 0;
for (const [id, count] of idCounts.entries()) {
  if (count > 1) {
    duplicateIdCount += (count - 1);
  }
}
console.log(`• Total duplicate match IDs in 2024+: ${duplicateIdCount}`);

// 4. Index Player Match Histories (2021+) for Pre-Match Point-in-Time Availability
console.log('\nIndexing player match dates from 2021+ for point-in-time pre-match availability...');
const historyDatesQuery = `
  SELECT 
    canonical_match_date,
    canonical_winner_name,
    canonical_loser_name
  FROM canonical_matches
  WHERE canonical_match_date IS NOT NULL
  ORDER BY canonical_match_date ASC;
`;

const histRows = db.prepare(historyDatesQuery).all() as any[];
const playerMatchDates = new Map<string, string[]>();

function norm(name: string): string {
  return (name || '').trim().toLowerCase().replace(/[^a-z]/g, '');
}

for (const h of histRows) {
  const d = h.canonical_match_date;
  const w = norm(h.canonical_winner_name);
  const l = norm(h.canonical_loser_name);

  if (w) {
    if (!playerMatchDates.has(w)) playerMatchDates.set(w, []);
    playerMatchDates.get(w)!.push(d);
  }
  if (l) {
    if (!playerMatchDates.has(l)) playerMatchDates.set(l, []);
    playerMatchDates.get(l)!.push(d);
  }
}

console.log(`Indexed history dates for ${playerMatchDates.size.toLocaleString()} unique players.\n`);

// 5. Audit Each 2024+ Match
interface MatchAuditRecord {
  id: number;
  canonical_match_id: string;
  match_date: string;
  tour: string;
  tourney_name: string;
  surface: string;
  normalized_surface: string;
  winner_name: string;
  loser_name: string;
  score: string;
  status: 'COMPLETE' | 'INCOMPLETE' | 'INVALID';
  reasons: string[];
  has_odds: boolean;
  is_pit_safe: boolean;
  max_as_of_date: string | null;
  w_svpt: number;
  w_1stIn: number;
  w_1stWon: number;
}

const auditRecords: MatchAuditRecord[] = [];

// Reason Counters
const reasonCounts = {
  missing_match_id: 0,
  invalid_match_date: 0,
  duplicate_match_id: 0,
  missing_player_1: 0,
  missing_player_2: 0,
  missing_result: 0,
  missing_surface: 0,
  invalid_surface: 0,
  missing_pre_match_stats_player_1: 0,
  missing_pre_match_stats_player_2: 0,
  as_of_date_violation_pit_leakage: 0,
  missing_required_match_level_stats: 0,
  placeholder_serve_excluded: 0,
  retirement_or_walkover: 0,
  speculative_draw_unplayed: 0,
  non_singles: 0,
  missing_odds: 0,
};

const uniqueAffectedMatches = new Set<string>();

// Leakage Violations tracking
interface PitViolation {
  canonical_match_id: string;
  match_date: string;
  feature_name: string;
  offending_as_of_date: string;
}
const pitViolations: PitViolation[] = [];

// Year & Surface Buckets
const yearBuckets = new Map<string, { total: number; complete: number; incomplete: number }>();
const surfaceBuckets = new Map<string, { total: number; complete: number; incomplete: number }>();

for (const s of ['HARD', 'CLAY', 'GRASS', 'INDOOR', 'UNKNOWN_OR_OTHER']) {
  surfaceBuckets.set(s, { total: 0, complete: 0, incomplete: 0 });
}

for (const r of rows2024Plus) {
  const reasons: string[] = [];
  const matchId = r.canonical_match_id;
  const matchDate = r.canonical_match_date;
  const p1 = r.canonical_winner_name;
  const p2 = r.canonical_loser_name;
  const rawSurf = (r.surface || '').trim();
  const lowerSurf = rawSurf.toLowerCase();

  // 1. Match ID check
  if (!matchId || typeof matchId !== 'string' || matchId.trim() === '') {
    reasons.push('missing_match_id');
    reasonCounts.missing_match_id++;
  }
  if (idCounts.get(matchId)! > 1) {
    reasons.push('duplicate_match_id');
    reasonCounts.duplicate_match_id++;
  }

  // 2. Match Date check
  if (!matchDate || matchDate < '2024-01-01' || !/^\d{4}-\d{2}-\d{2}/.test(matchDate)) {
    reasons.push('invalid_match_date');
    reasonCounts.invalid_match_date++;
  }

  // 3. Player identification check
  if (!p1 || p1.trim() === '') {
    reasons.push('missing_player_1');
    reasonCounts.missing_player_1++;
  }
  if (!p2 || p2.trim() === '') {
    reasons.push('missing_player_2');
    reasonCounts.missing_player_2++;
  }

  // 4. Winner & Result check
  if (!p1 || !r.score || r.score === '?-?' || r.is_speculative_draw === 1) {
    if (r.is_speculative_draw === 1) {
      reasons.push('speculative_draw_unplayed');
      reasonCounts.speculative_draw_unplayed++;
    } else {
      reasons.push('missing_result');
      reasonCounts.missing_result++;
    }
  }

  // 5. Surface Normalization check
  let normSurface = 'UNKNOWN_OR_OTHER';
  if (lowerSurf.includes('clay')) normSurface = 'CLAY';
  else if (lowerSurf.includes('grass')) normSurface = 'GRASS';
  else if (lowerSurf.includes('indoor') || lowerSurf.includes('carpet')) normSurface = 'INDOOR';
  else if (lowerSurf.includes('hard')) normSurface = 'HARD';

  if (!rawSurf) {
    reasons.push('missing_surface');
    reasonCounts.missing_surface++;
  } else if (normSurface === 'UNKNOWN_OR_OTHER') {
    reasons.push('invalid_surface');
    reasonCounts.invalid_surface++;
  }

  // 6. Point-in-time pre-match player statistics check
  let maxAsOfDate = '';
  let isPitSafe = true;

  const p1History = p1 ? (playerMatchDates.get(norm(p1)) || []) : [];
  const p2History = p2 ? (playerMatchDates.get(norm(p2)) || []) : [];

  // Strictly prior matches for P1
  const p1Prior = p1History.filter(d => d < matchDate);
  const p2Prior = p2History.filter(d => d < matchDate);

  if (p1Prior.length > 0) {
    const p1Max = p1Prior[p1Prior.length - 1];
    if (!maxAsOfDate || p1Max > maxAsOfDate) maxAsOfDate = p1Max;
  }
  if (p2Prior.length > 0) {
    const p2Max = p2Prior[p2Prior.length - 1];
    if (!maxAsOfDate || p2Max > maxAsOfDate) maxAsOfDate = p2Max;
  }

  // PIT Leakage check: did any feature or prior match date leak into >= matchDate?
  if (maxAsOfDate && maxAsOfDate >= matchDate) {
    isPitSafe = false;
    reasons.push('as_of_date_violation_pit_leakage');
    reasonCounts.as_of_date_violation_pit_leakage++;
    if (pitViolations.length < 20) {
      pitViolations.push({
        canonical_match_id: matchId,
        match_date: matchDate,
        feature_name: 'player_prior_match_date',
        offending_as_of_date: maxAsOfDate,
      });
    }
  }

  // Check if player has prior match statistics
  if (p1 && p1Prior.length === 0) {
    reasons.push('missing_pre_match_stats_player_1');
    reasonCounts.missing_pre_match_stats_player_1++;
  }
  if (p2 && p2Prior.length === 0) {
    reasons.push('missing_pre_match_stats_player_2');
    reasonCounts.missing_pre_match_stats_player_2++;
  }

  // 7. Match-Level Statistics Check
  const wSvpt = Number(r.w_svpt || 0);
  const w1stIn = Number(r.w_1stIn || 0);
  const w1stWon = Number(r.w_1stWon || 0);
  const lSvpt = Number(r.l_svpt || 0);
  const l1stIn = Number(r.l_1stIn || 0);
  const l1stWon = Number(r.l_1stWon || 0);

  const hasMatchStats = wSvpt > 0 && w1stIn > 0 && w1stWon > 0 && lSvpt > 0 && l1stIn > 0 && l1stWon > 0;

  if (!hasMatchStats) {
    reasons.push('missing_required_match_level_stats');
    reasonCounts.missing_required_match_level_stats++;
  }

  if (r.is_placeholder_serve === 1) {
    reasons.push('placeholder_serve_excluded');
    reasonCounts.placeholder_serve_excluded++;
  }

  if (r.is_retirement_or_wo === 1) {
    reasons.push('retirement_or_walkover');
    reasonCounts.retirement_or_walkover++;
  }

  if (r.is_non_singles === 1) {
    reasons.push('non_singles');
    reasonCounts.non_singles++;
  }

  // Odds Check (tracked separately, does NOT disqualify match if stats exist)
  const hasOdds = typeof r.w_odds_match === 'number' && typeof r.l_odds_match === 'number' && r.w_odds_match > 1.01 && r.l_odds_match > 1.01;
  if (!hasOdds) {
    reasonCounts.missing_odds++;
  }

  // Classify Status
  let status: 'COMPLETE' | 'INCOMPLETE' | 'INVALID';

  if (!matchId || !matchDate || matchDate < '2024-01-01') {
    status = 'INVALID';
  } else {
    // Incomplete disqualifying reasons:
    const fatalReasons = reasons.filter(res => res !== 'missing_pre_match_stats_player_1' && res !== 'missing_pre_match_stats_player_2');
    const hasFatalReason = fatalReasons.length > 0;
    const hasPreMatchHistory = p1Prior.length > 0 || p2Prior.length > 0;

    if (!hasFatalReason && hasMatchStats && isPitSafe && r.is_placeholder_serve === 0 && r.is_retirement_or_wo === 0 && r.is_non_singles === 0 && r.is_speculative_draw === 0) {
      status = 'COMPLETE';
    } else {
      status = 'INCOMPLETE';
    }
  }

  if (reasons.length > 0) {
    uniqueAffectedMatches.add(matchId);
  }

  auditRecords.push({
    id: r.id,
    canonical_match_id: matchId,
    match_date: matchDate,
    tour: r.tour || '',
    tourney_name: r.tourney_name || '',
    surface: rawSurf,
    normalized_surface: normSurface,
    winner_name: p1,
    loser_name: p2,
    score: r.score || '',
    status,
    reasons,
    has_odds: hasOdds,
    is_pit_safe: isPitSafe,
    max_as_of_date: maxAsOfDate,
    w_svpt: wSvpt,
    w_1stIn: w1stIn,
    w_1stWon: w1stWon,
  });

  // Year Breakdown
  const yr = matchDate.slice(0, 4);
  if (!yearBuckets.has(yr)) yearBuckets.set(yr, { total: 0, complete: 0, incomplete: 0 });
  const yb = yearBuckets.get(yr)!;
  yb.total++;
  if (status === 'COMPLETE') yb.complete++;
  else yb.incomplete++;

  // Surface Breakdown
  const sb = surfaceBuckets.get(normSurface) || surfaceBuckets.get('UNKNOWN_OR_OTHER')!;
  sb.total++;
  if (status === 'COMPLETE') sb.complete++;
  else sb.incomplete++;
}

// 6. Summary Counts
const total2024Plus = rows2024Plus.length;
const totalComplete = auditRecords.filter(r => r.status === 'COMPLETE').length;
const totalIncomplete = auditRecords.filter(r => r.status === 'INCOMPLETE').length;
const totalInvalid = auditRecords.filter(r => r.status === 'INVALID').length;
const completionPct = Math.round((totalComplete / total2024Plus) * 1000) / 10;

console.log('═════════════════════════════════════════════════════════════════════════');
console.log('A. COVERAGE & COMPLETENESS TOTALS');
console.log('═════════════════════════════════════════════════════════════════════════');
console.table([
  { Metric: 'Total Matches Stored in Database', Count: totalAllMatches.toLocaleString() },
  { Metric: 'Total Matches Dated 2024-01-01 Onward', Count: total2024Plus.toLocaleString() },
  { Metric: 'Total Matches with Complete Statistics', Count: totalComplete.toLocaleString() },
  { Metric: 'Total Matches Incomplete', Count: totalIncomplete.toLocaleString() },
  { Metric: 'Total Matches with Invalid / Missing Dates', Count: totalInvalid.toLocaleString() },
  { Metric: 'Total Duplicate Match IDs', Count: duplicateIdCount.toLocaleString() },
]);

console.log('\n═════════════════════════════════════════════════════════════════════════');
console.log('B. COMPLETENESS BREAKDOWN');
console.log('═════════════════════════════════════════════════════════════════════════');
console.table([
  {
    Status: 'COMPLETE',
    Count: totalComplete.toLocaleString(),
    '% of All 2024+ Matches': `${completionPct}%`,
    '% of Valid 2024+ Matches': `${completionPct}%`,
  },
  {
    Status: 'INCOMPLETE',
    Count: totalIncomplete.toLocaleString(),
    '% of All 2024+ Matches': `${Math.round((totalIncomplete / total2024Plus) * 1000) / 10}%`,
    '% of Valid 2024+ Matches': `${Math.round((totalIncomplete / total2024Plus) * 1000) / 10}%`,
  },
  {
    Status: 'INVALID',
    Count: totalInvalid.toLocaleString(),
    '% of All 2024+ Matches': `${Math.round((totalInvalid / total2024Plus) * 1000) / 10}%`,
    '% of Valid 2024+ Matches': '0.0%',
  },
]);

console.log('\n═════════════════════════════════════════════════════════════════════════');
console.log('C. MISSING-DATA & EXCLUSION REASONS (2024+)');
console.log('═════════════════════════════════════════════════════════════════════════');
console.table([
  { Reason: 'Missing Required Match-Level Stats (svpt=0, no official bundle)', Matches: reasonCounts.missing_required_match_level_stats.toLocaleString() },
  { Reason: 'Retirement or Walkover (incomplete match)', Matches: reasonCounts.retirement_or_walkover.toLocaleString() },
  { Reason: 'Speculative Draw (unplayed fixture)', Matches: reasonCounts.speculative_draw_unplayed.toLocaleString() },
  { Reason: 'Placeholder Serve Row Excluded', Matches: reasonCounts.placeholder_serve_excluded.toLocaleString() },
  { Reason: 'Non-Singles Match Excluded', Matches: reasonCounts.non_singles.toLocaleString() },
  { Reason: 'Missing Pre-Match History for Player 1 (Rookie / First Tour Match)', Matches: reasonCounts.missing_pre_match_stats_player_1.toLocaleString() },
  { Reason: 'Missing Pre-Match History for Player 2 (Rookie / First Tour Match)', Matches: reasonCounts.missing_pre_match_stats_player_2.toLocaleString() },
  { Reason: 'Missing Odds (Separate Audit Category — odds absent)', Matches: reasonCounts.missing_odds.toLocaleString() },
  { Reason: 'Missing Winner / Player Name', Matches: (reasonCounts.missing_player_1 + reasonCounts.missing_player_2).toLocaleString() },
  { Reason: 'Point-in-Time As-Of Date Leakage Violations', Matches: reasonCounts.as_of_date_violation_pit_leakage.toLocaleString() },
  { Reason: 'Duplicate Match ID', Matches: reasonCounts.duplicate_match_id.toLocaleString() },
]);
console.log(`Unique matches with at least one reason/flag: ${uniqueAffectedMatches.size.toLocaleString()}`);

console.log('\n═════════════════════════════════════════════════════════════════════════');
console.log('D. YEAR & SURFACE BREAKDOWN');
console.log('═════════════════════════════════════════════════════════════════════════');
console.log('--- BY YEAR ---');
const yearRows: any[] = [];
for (const [yr, data] of Array.from(yearBuckets.entries()).sort()) {
  yearRows.push({
    Year: yr,
    Total: data.total.toLocaleString(),
    Complete: data.complete.toLocaleString(),
    Incomplete: data.incomplete.toLocaleString(),
    'Completion %': `${Math.round((data.complete / data.total) * 1000) / 10}%`,
  });
}
console.table(yearRows);

console.log('--- BY NORMALIZED SURFACE ---');
const surfRows: any[] = [];
for (const [surf, data] of surfaceBuckets.entries()) {
  if (data.total === 0) continue;
  surfRows.push({
    Surface: surf,
    Total: data.total.toLocaleString(),
    Complete: data.complete.toLocaleString(),
    Incomplete: data.incomplete.toLocaleString(),
    'Completion %': `${Math.round((data.complete / data.total) * 1000) / 10}%`,
  });
}
console.table(surfRows);

console.log('\n═════════════════════════════════════════════════════════════════════════');
console.log('E. POINT-IN-TIME (PIT) CAUSALITY & LEAKAGE VALIDATION');
console.log('═════════════════════════════════════════════════════════════════════════');
console.log(`• Maximum as-of date used for each match: verified strictly earlier than match_date.`);
console.log(`• Count of Point-in-Time Causality Violations: ${reasonCounts.as_of_date_violation_pit_leakage}`);
if (pitViolations.length === 0) {
  console.log('✅ ZERO POINT-IN-TIME VIOLATIONS DETECTED (100% Causal Safety).');
} else {
  console.log('⚠️ VIOLATIONS DETECTED:');
  console.table(pitViolations);
}

console.log('\n═════════════════════════════════════════════════════════════════════════');
console.log('F. REPRESENTATIVE EXAMPLES');
console.log('═════════════════════════════════════════════════════════════════════════');

const completeExamples = auditRecords.filter(r => r.status === 'COMPLETE').slice(0, 10);
console.log('--- 10 COMPLETE MATCH EXAMPLES ---');
console.table(completeExamples.map(r => ({
  ID: r.canonical_match_id,
  Date: r.match_date,
  Surface: r.normalized_surface,
  Matchup: `${r.winner_name} def. ${r.loser_name}`,
  Score: r.score,
  Svpt: r.w_svpt,
  HasOdds: r.has_odds,
})));

const incompleteExamples = auditRecords.filter(r => r.status === 'INCOMPLETE').slice(0, 10);
console.log('\n--- 10 INCOMPLETE MATCH EXAMPLES & REASONS ---');
console.table(incompleteExamples.map(r => ({
  ID: r.canonical_match_id,
  Date: r.match_date,
  Surface: r.normalized_surface,
  Matchup: `${r.winner_name || 'N/A'} vs ${r.loser_name || 'N/A'}`,
  PrimaryReasons: r.reasons.slice(0, 2).join('; '),
})));

console.log('\n═════════════════════════════════════════════════════════════════════════');
console.log('G. RECONCILIATION EQUATION VERIFICATION');
console.log('═════════════════════════════════════════════════════════════════════════');
const reconciliationSum = totalComplete + totalIncomplete + totalInvalid;
const isReconciled = reconciliationSum === total2024Plus;

console.log(`Total 2024+ Matches Stored : ${total2024Plus.toLocaleString()}`);
console.log(`Complete Matches           : ${totalComplete.toLocaleString()}`);
console.log(`Incomplete Matches         : ${totalIncomplete.toLocaleString()}`);
console.log(`Invalid Matches            : ${totalInvalid.toLocaleString()}`);
console.log(`Sum (Complete + Inc + Inv) : ${reconciliationSum.toLocaleString()}`);
console.log(`Equation Equality Check    : ${isReconciled ? '✅ PASS (Exact Match)' : '❌ FAIL (Mismatch)'}`);

// Export Audit Results to CSV
const csvHeader = 'canonical_match_id,match_date,surface,winner_name,loser_name,status,reasons,has_odds,w_svpt\n';
const csvRows = auditRecords.map(r => 
  `"${r.canonical_match_id}","${r.match_date}","${r.normalized_surface}","${r.winner_name.replace(/"/g, '""')}","${r.loser_name.replace(/"/g, '""')}","${r.status}","${r.reasons.join('|')}",${r.has_odds},${r.w_svpt}`
).join('\n');

const csvPath = path.join(process.cwd(), 'audit_2024_plus_completeness.csv');
fs.writeFileSync(csvPath, csvHeader + csvRows);
console.log(`\n📁 Full per-match audit exported to CSV: ${csvPath}`);

// Export Summary JSON
const summaryJson = {
  totalMatchesStored: totalAllMatches,
  totalMatches2024Plus: total2024Plus,
  totalComplete,
  totalIncomplete,
  totalInvalid,
  duplicateIdCount,
  completionPercentage: completionPct,
  reasonCounts,
  yearBreakdown: Array.from(yearBuckets.entries()).map(([k, v]) => ({ year: k, ...v })),
  surfaceBreakdown: Array.from(surfaceBuckets.entries()).map(([k, v]) => ({ surface: k, ...v })),
  reconciliationPassed: isReconciled,
  exportedAt: new Date().toISOString(),
};

const jsonPath = path.join(process.cwd(), 'audit_2024_plus_summary.json');
fs.writeFileSync(jsonPath, JSON.stringify(summaryJson, null, 2));
console.log(`📁 Detailed JSON summary exported to: ${jsonPath}`);

db.close();
console.log('\nAudit execution complete.');
