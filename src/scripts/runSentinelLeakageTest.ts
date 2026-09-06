/**
 * Sentinel metamorphic leakage test for the historical feature pipeline.
 *
 * Run:
 *   npx tsx src/scripts/runSentinelLeakageTest.ts --cutoff 2024-06-01
 *   npx tsx src/scripts/runSentinelLeakageTest.ts --cutoff 2024-06-01 --mode mutate_future_rows_extreme_values
 *   npx tsx src/scripts/runSentinelLeakageTest.ts --cutoff 2024-06-01 --player "Novak Djokovic" --limit 20
 *   npx tsx src/scripts/runSentinelLeakageTest.ts --cutoff 2024-06-01 --match 12345
 *   npx tsx src/scripts/runSentinelLeakageTest.ts --cutoff 2024-06-01 --also-target-zero
 */
import { db } from '../db/connection';
import { initSchema } from '../db/schema';

initSchema();
void db;

type Verdict = 'PASS' | 'FAIL' | 'PASS WITH WARNINGS';

type SentinelMutationMode =
  | 'remove_future_rows'
  | 'mutate_future_rows_extreme_values'
  | 'target_zero_future_outcomes';

interface CliOptions {
  cutoff: string;
  mode: SentinelMutationMode;
  since: string;
  limit: number;
  player?: string;
  matchId?: number;
  alsoTargetZero: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };

  const cutoff = get('--cutoff') || get('--cutoff-date') || '2024-06-01';
  const modeRaw = get('--mode') || 'remove_future_rows';
  const allowed: SentinelMutationMode[] = [
    'remove_future_rows',
    'mutate_future_rows_extreme_values',
    'target_zero_future_outcomes',
  ];
  const mode = allowed.includes(modeRaw as SentinelMutationMode)
    ? (modeRaw as SentinelMutationMode)
    : 'remove_future_rows';

  return {
    cutoff: cutoff.slice(0, 10),
    mode,
    since: (get('--since') || '2024-01-01').slice(0, 10),
    limit: Number(get('--limit') || 50),
    player: get('--player'),
    matchId: get('--match') != null ? Number(get('--match')) : undefined,
    alsoTargetZero: argv.includes('--also-target-zero'),
  };
}

function printSection(title: string): void {
  console.log(`\n── ${title} ──`);
}

function overallVerdict(modeResults: Array<{ mode: SentinelMutationMode; failed: number; warnings: number }>): Verdict {
  const anyFail = modeResults.some((r) => r.failed > 0);
  if (anyFail) return 'FAIL';
  const anyWarn = modeResults.some((r) => r.warnings > 0);
  if (anyWarn) return 'PASS WITH WARNINGS';
  return 'PASS';
}

async function main(): Promise<void> {
  const { runWithSentinelStore } = await import('../sentinel/sentinelRowProvider');
  const {
    listSentinelTargetMatches,
    SentinelValidatedStore,
    verifyStoreParity,
  } = await import('../sentinel/sentinelValidatedStore');
  const { buildSentinelFeatureSnapshot } = await import('../sentinel/sentinelFeatureSnapshot');
  const { diffSentinelSnapshots, summarizeDiffs } = await import('../sentinel/sentinelDiff');

  const options = parseArgs(process.argv.slice(2));
  const modes: SentinelMutationMode[] = [options.mode];
  if (options.alsoTargetZero && options.mode !== 'target_zero_future_outcomes') {
    modes.push('target_zero_future_outcomes');
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(' SENTINEL LEAKAGE TEST — historical feature pipeline');
  console.log('══════════════════════════════════════════════════════════════');

  printSection('Test configuration');
  console.log({
    cutoff: options.cutoff,
    mutationModes: modes,
    since: options.since,
    limit: options.limit,
    playerFilter: options.player || null,
    matchFilter: options.matchId ?? null,
    dataSource: 'player_matches_validated (in-memory sentinel store)',
    readOnly: true,
  });

  const baseStore = SentinelValidatedStore.loadFromDb(options.since);
  const targets = listSentinelTargetMatches({
    cutoff: options.cutoff,
    since: options.since,
    playerFilter: options.player,
    matchFilter: options.matchId,
    limit: options.limit,
  });

  printSection('Rows evaluated');
  console.log({
    eligibleTargets: targets.length,
    sample: targets.slice(0, 3).map((t) => ({
      matchId: t.matchId,
      date: t.matchDate,
      matchup: `${t.homePlayer} vs ${t.awayPlayer}`,
    })),
  });

  if (targets.length === 0) {
    console.log('\nPASS WITH WARNINGS — no eligible target rows found for this cutoff/filter window');
    process.exit(0);
  }

  const parityPlayer = targets[0].homePlayer;
  const parityOk = verifyStoreParity(baseStore, parityPlayer, options.cutoff);
  if (!parityOk) {
    console.warn('WARNING: sentinel store parity check failed for sample player — results may be unreliable');
  }

  const modeResults: Array<{ mode: SentinelMutationMode; failed: number; warnings: number }> = [];

  for (const mode of modes) {
    printSection(`Mutation mode: ${mode}`);

    const baselineSnapshots = runWithSentinelStore(baseStore.clone(), () =>
      targets.map((target) => buildSentinelFeatureSnapshot(target)),
    );

    const mutatedStore = baseStore.clone();
    mutatedStore.applyMutation(options.cutoff, mode);

    const mutatedSnapshots = runWithSentinelStore(mutatedStore, () =>
      targets.map((target) => buildSentinelFeatureSnapshot(target)),
    );

    const results = baselineSnapshots.map((baseline, idx) =>
      diffSentinelSnapshots(baseline, mutatedSnapshots[idx]),
    );
    const summary = summarizeDiffs(results);
    modeResults.push({ mode, failed: summary.totalRowsFailed, warnings: parityOk ? 0 : 1 });

    printSection('Diff summary');
    console.log({
      totalRowsTested: summary.totalRowsTested,
      totalRowsFailed: summary.totalRowsFailed,
      changedFeatureCount: summary.changedFeatures.length,
      affectedMatchIds: summary.affectedMatchIds.slice(0, 10),
    });

    if (summary.findings.length > 0) {
      printSection('Leak findings (first 15)');
      for (const finding of summary.findings.slice(0, 15)) {
        console.log({
          path: finding.path,
          category: finding.category,
          suspectedSource: finding.suspectedSource,
          baseline: finding.baseline,
          mutated: finding.mutated,
        });
      }
    }

    printSection(`Verdict for mode: ${mode}`);
    if (summary.totalRowsFailed === 0) {
      console.log('PASS — no pre-cutoff feature drift detected');
    } else {
      console.log(`FAIL — ${summary.totalRowsFailed} row(s) changed after future-row mutation`);
    }
  }

  printSection('Features compared');
  console.log([
    'historical-match-features bundle (home/away prior counts, surfaces, flags, validation)',
    'analysis-bundle rankAtDate and surface aggregates',
    'recent match counts / wins / losses',
    'days since last match',
    'matches in last 7/14/30 days',
    'H2H wins / losses / last meeting date',
    'quarantine and validation flags',
  ]);

  const verdict = overallVerdict(modeResults);
  printSection('Final verdict');
  console.log(verdict);

  if (verdict === 'FAIL') {
    console.log(
      'Historical feature pipeline is NOT leakage-safe for the tested window. Inspect suspected sources above.',
    );
    process.exit(1);
  }

  if (verdict === 'PASS WITH WARNINGS') {
    console.log('No leakage detected, but review warnings (empty sample or store parity).');
    process.exit(0);
  }

  console.log('Historical feature pipeline appears leakage-safe for the tested metamorphic invariant.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
