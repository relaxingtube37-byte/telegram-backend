import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { SEED_PLAYERS } from '../data/seedPlayers';
import { normalizeToken, resolveSurface } from '../linker/entityResolver';

export interface SeedingReport {
  targetDbPath: string;
  playersInserted: number;
  playerAliasesInserted: number;
  tournamentsInserted: number;
  tournamentAliasesInserted: number;
  ambiguousAliasesFlagged: number;
  executionTimeMs: number;
  status: 'SUCCESS' | 'FAILED';
  error?: string;
}

const KNOWN_SIBLINGS = new Set([
  'cerundolo',
  'zverev',
  'williams',
  'tsitsipas',
  'ymer',
  'murray',
  'pliskova',
  'korda',
  'berrettini',
  'ruud',
  'fruhvirtova',
  'andreeva',
  'sabalenka',
  'van assche',
  'djokovic',
  'alcaraz'
]);

// Map raw tourney_level to canonical tour_level
function mapTourLevel(
  tour: 'ATP' | 'WTA' | 'CHALLENGER' | 'ITF',
  rawLevel?: string,
  tourneyName: string = ''
): 'GRAND_SLAM' | 'MASTERS_1000' | 'WTA_1000' | 'ATP_500' | 'ATP_250' | 'CHALLENGER' | 'ITF' {
  const normName = tourneyName.toLowerCase();

  // Grand Slams
  if (
    normName.includes('wimbledon') ||
    normName.includes('us open') ||
    normName.includes('french open') ||
    normName.includes('roland garros') ||
    normName.includes('australian open')
  ) {
    return 'GRAND_SLAM';
  }

  // 1000s / Masters
  const is1000 =
    normName.includes('indian wells') ||
    normName.includes('miami') ||
    normName.includes('madrid') ||
    normName.includes('rome') ||
    normName.includes('monte carlo') ||
    normName.includes('cincinnati') ||
    normName.includes('shanghai') ||
    normName.includes('paris') ||
    normName.includes('canada') ||
    normName.includes('toronto') ||
    normName.includes('montreal') ||
    normName.includes('beijing') ||
    normName.includes('wuhan') ||
    rawLevel === 'M' ||
    rawLevel === 'PM' ||
    rawLevel === '1000';

  if (is1000) {
    return tour === 'WTA' ? 'WTA_1000' : 'MASTERS_1000';
  }

  // 500s
  if (
    rawLevel === '500' ||
    normName.includes('500') ||
    normName.includes('dubai') ||
    normName.includes('barcelona') ||
    normName.includes('queen') ||
    normName.includes('halle') ||
    normName.includes('washington') ||
    normName.includes('tokyo') ||
    normName.includes('vienna') ||
    normName.includes('basel')
  ) {
    return 'ATP_500';
  }

  // Challengers
  if (tour === 'CHALLENGER' || rawLevel === 'C' || rawLevel === '125' || normName.includes('challenger')) {
    return 'CHALLENGER';
  }

  // ITF
  if (tour === 'ITF' || rawLevel === 'D' || rawLevel === 'O' || rawLevel === 'W') {
    return 'ITF';
  }

  return 'ATP_250';
}

export function seedCanonicalRegistries(
  targetDbPath: string = path.resolve('data/database.linker_dryrun.sqlite'),
  sourceDbPath: string = path.resolve('data/database.dryrun.sqlite')
): SeedingReport {
  const startTime = Date.now();

  // Safety verification
  const resolvedTarget = path.resolve(targetDbPath);
  const liveDbPath = path.resolve('data/database.sqlite');
  if (resolvedTarget === liveDbPath) {
    throw new Error('SECURITY VIOLATION: Cannot seed against live production data/database.sqlite');
  }

  if (!fs.existsSync(resolvedTarget)) {
    throw new Error(`Target database file does not exist: ${resolvedTarget}`);
  }

  const targetDb = new Database(resolvedTarget);
  targetDb.pragma('foreign_keys = ON');
  targetDb.pragma('busy_timeout = 5000');

  let sourceDb: Database.Database | null = null;
  if (fs.existsSync(sourceDbPath)) {
    sourceDb = new Database(sourceDbPath, { readonly: true });
  }

  let playersCount = 0;
  let playerAliasesCount = 0;
  let tournamentsCount = 0;
  let tournamentAliasesCount = 0;
  let ambiguousAliasesCount = 0;

  try {
    const insertPlayerStmt = targetDb.prepare(`
      INSERT OR IGNORE INTO canonical_players (
        canonical_player_id, full_name_standard, first_name, last_name, birth_date, ioc_country, gender, hand
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertPlayerAliasStmt = targetDb.prepare(`
      INSERT OR IGNORE INTO player_aliases (
        canonical_player_id, source_name, raw_name, normalized_token, is_verified, has_sibling_conflict
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertTourneyStmt = targetDb.prepare(`
      INSERT OR IGNORE INTO canonical_tournaments (
        canonical_tourney_id, name_standard, tour, tour_level, default_surface, country_ioc, city
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertTourneyAliasStmt = targetDb.prepare(`
      INSERT OR IGNORE INTO tournament_aliases (
        canonical_tourney_id, source_name, raw_name, normalized_token, is_verified
      ) VALUES (?, ?, ?, ?, ?)
    `);

    // In-memory track sets to prevent duplicates
    const seededPlayerIds = new Set<string>();
    const playerLastNameCounts = new Map<string, number>();

    // =========================================================================
    // 1. SEED CANONICAL PLAYERS (from SEED_PLAYERS + historical_matches)
    // =========================================================================
    console.log('1. Seeding canonical players from SEED_PLAYERS...');

    targetDb.transaction(() => {
      for (const sp of SEED_PLAYERS) {
        const norm = normalizeToken(sp.full_name);
        if (!norm) continue;

        const canonId = `cp_${norm.replace(/\s+/g, '_')}`;
        const parts = sp.full_name.trim().split(/\s+/);
        const lastName = parts.length > 1 ? parts[parts.length - 1] : parts[0];
        const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : null;

        insertPlayerStmt.run(
          canonId,
          sp.full_name,
          firstName,
          lastName,
          null, // birth_date
          sp.country_code || null,
          sp.gender === 'F' ? 'F' : 'M',
          'R' // default hand
        );

        seededPlayerIds.add(canonId);
        playersCount++;

        const lNorm = normalizeToken(lastName);
        playerLastNameCounts.set(lNorm, (playerLastNameCounts.get(lNorm) || 0) + 1);
      }
    })();

    // Merge active tour players from historical_matches (>= 3 matches)
    if (sourceDb) {
      console.log('2. Supplementing players from local historical_matches...');
      const histPlayers = sourceDb
        .prepare(`
          SELECT 
            winner_name AS full_name,
            winner_ioc AS ioc,
            winner_hand AS hand,
            tour,
            COUNT(*) AS match_count
          FROM historical_matches
          WHERE winner_name IS NOT NULL AND TRIM(winner_name) != ''
          GROUP BY winner_name
          HAVING COUNT(*) >= 3
          ORDER BY match_count DESC
        `)
        .all() as Array<{ full_name: string; ioc: string; hand: string; tour: string; match_count: number }>;

      targetDb.transaction(() => {
        for (const hp of histPlayers) {
          const norm = normalizeToken(hp.full_name);
          if (!norm) continue;

          const parts = hp.full_name.trim().split(/\s+/);

          // Check if hp.full_name is an abbreviated CSV name like "Lastname I." or "Lastname I. J."
          const isAbbreviated = /\b[A-Z]\.?(\s+[A-Z]\.?)?$/.test(hp.full_name.trim());
          if (isAbbreviated) {
            // Do not insert abbreviated names as canonical players
            const surname = parts[0];
            const surnameNorm = normalizeToken(surname);
            const initial = parts[parts.length - 1].replace(/\./g, '').charAt(0).toLowerCase();

            // Find canonical player matching surname
            const match = Array.from(seededPlayerIds).find(id => {
              return id.startsWith(`cp_${initial}`) && id.endsWith(`_${surnameNorm}`) || id.includes(surnameNorm);
            });

            if (match) {
              const isSibling = KNOWN_SIBLINGS.has(surnameNorm) || (playerLastNameCounts.get(surnameNorm) || 0) > 1;
              insertPlayerAliasStmt.run(
                match,
                'csv_style',
                hp.full_name,
                norm,
                isSibling ? 0 : 1,
                isSibling ? 1 : 0
              );
              playerAliasesCount++;
              if (isSibling) ambiguousAliasesCount++;
            }
            continue;
          }

          const canonId = `cp_${norm.replace(/\s+/g, '_')}`;
          if (seededPlayerIds.has(canonId)) continue;

          const lastName = parts.length > 1 ? parts[parts.length - 1] : parts[0];
          const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : null;
          const gender = hp.tour === 'WTA' ? 'F' : 'M';
          let hand: 'R' | 'L' | 'A' | 'U' = 'R';
          if (hp.hand === 'L') hand = 'L';
          else if (hp.hand === 'A') hand = 'A';
          else if (hp.hand === 'U') hand = 'U';

          const res = insertPlayerStmt.run(
            canonId,
            hp.full_name,
            firstName,
            lastName,
            null,
            hp.ioc || null,
            gender,
            hand
          );

          if (res.changes > 0) {
            seededPlayerIds.add(canonId);
            playersCount++;
            const lNorm = normalizeToken(lastName);
            playerLastNameCounts.set(lNorm, (playerLastNameCounts.get(lNorm) || 0) + 1);
          }
        }
      })();
    }

    // =========================================================================
    // 2. SEED PLAYER ALIASES (with strict sibling ambiguity checks)
    // =========================================================================
    console.log('3. Seeding player aliases and evaluating sibling ambiguity...');

    const allPlayers = targetDb
      .prepare('SELECT canonical_player_id, full_name_standard, first_name, last_name FROM canonical_players')
      .all() as Array<{
        canonical_player_id: string;
        full_name_standard: string;
        first_name: string | null;
        last_name: string;
      }>;

    targetDb.transaction(() => {
      for (const p of allPlayers) {
        const lastNameNorm = normalizeToken(p.last_name);
        const isSiblingConflict =
          KNOWN_SIBLINGS.has(lastNameNorm) || (playerLastNameCounts.get(lastNameNorm) || 0) > 1;

        // Alias 1: Full standard name (Verified, No Conflict)
        const fullToken = normalizeToken(p.full_name_standard);
        insertPlayerAliasStmt.run(
          p.canonical_player_id,
          'canonical',
          p.full_name_standard,
          fullToken,
          1, // is_verified
          0  // has_sibling_conflict
        );
        playerAliasesCount++;

        // Alias 2: Normalized full name token
        if (fullToken !== p.full_name_standard.toLowerCase()) {
          insertPlayerAliasStmt.run(
            p.canonical_player_id,
            'normalized',
            fullToken,
            fullToken,
            1,
            0
          );
          playerAliasesCount++;
        }

        // Alias 3: Lastname Firstname
        if (p.first_name) {
          const reversed = `${p.last_name} ${p.first_name}`;
          const revToken = normalizeToken(reversed);
          insertPlayerAliasStmt.run(
            p.canonical_player_id,
            'reversed',
            reversed,
            revToken,
            1,
            0
          );
          playerAliasesCount++;

          // Alias 4: Initial + Lastname (e.g. "C. Alcaraz" or "Alcaraz C.")
          const firstInitial = p.first_name.trim().charAt(0);
          const initialVariant = `${firstInitial}. ${p.last_name}`;
          const initialToken = normalizeToken(initialVariant);

          // If there is sibling conflict on this surname, mark ambiguous & unverified
          if (isSiblingConflict) {
            insertPlayerAliasStmt.run(
              p.canonical_player_id,
              'abbreviated',
              initialVariant,
              initialToken,
              0, // UNVERIFIED
              1  // SIBLING CONFLICT
            );
            ambiguousAliasesCount++;
            playerAliasesCount++;
          } else {
            insertPlayerAliasStmt.run(
              p.canonical_player_id,
              'abbreviated',
              initialVariant,
              initialToken,
              1, // VERIFIED
              0
            );
            playerAliasesCount++;
          }

          // Alias 5: CSV format "Lastname I."
          const csvVariant = `${p.last_name} ${firstInitial}.`;
          const csvToken = normalizeToken(csvVariant);
          insertPlayerAliasStmt.run(
            p.canonical_player_id,
            'csv_style',
            csvVariant,
            csvToken,
            isSiblingConflict ? 0 : 1,
            isSiblingConflict ? 1 : 0
          );
          playerAliasesCount++;
        }
      }
    })();

    // =========================================================================
    // 3. SEED CANONICAL TOURNAMENTS & ALIASES
    // =========================================================================
    console.log('4. Seeding canonical tournaments and aliases...');

    // Core authoritative tournaments catalog
    const CORE_TOURNAMENTS: Array<{
      id: string;
      name: string;
      tour: 'ATP' | 'WTA';
      level: 'GRAND_SLAM' | 'MASTERS_1000' | 'WTA_1000' | 'ATP_500' | 'ATP_250';
      surface: 'HARD' | 'CLAY' | 'GRASS' | 'CARPET';
      ioc: string;
      city: string;
      aliases: string[];
    }> = [
      {
        id: 'ct_atp_wimbledon',
        name: 'Wimbledon',
        tour: 'ATP',
        level: 'GRAND_SLAM',
        surface: 'GRASS',
        ioc: 'GBR',
        city: 'London',
        aliases: ['Wimbledon ATP', 'The Championships', 'Wimbledon - London', 'SW19', 'Wimbledon Gentlemen Singles']
      },
      {
        id: 'ct_wta_wimbledon',
        name: 'Wimbledon',
        tour: 'WTA',
        level: 'GRAND_SLAM',
        surface: 'GRASS',
        ioc: 'GBR',
        city: 'London',
        aliases: ['Wimbledon WTA', 'Wimbledon Ladies Singles', 'The Championships WTA']
      },
      {
        id: 'ct_atp_roland_garros',
        name: 'Roland Garros',
        tour: 'ATP',
        level: 'GRAND_SLAM',
        surface: 'CLAY',
        ioc: 'FRA',
        city: 'Paris',
        aliases: ['French Open ATP', 'Roland Garros ATP', 'French Open', 'Paris Grand Slam', 'Internationaux de France']
      },
      {
        id: 'ct_wta_roland_garros',
        name: 'Roland Garros',
        tour: 'WTA',
        level: 'GRAND_SLAM',
        surface: 'CLAY',
        ioc: 'FRA',
        city: 'Paris',
        aliases: ['French Open WTA', 'Roland Garros WTA', 'French Open Women']
      },
      {
        id: 'ct_atp_us_open',
        name: 'US Open',
        tour: 'ATP',
        level: 'GRAND_SLAM',
        surface: 'HARD',
        ioc: 'USA',
        city: 'New York',
        aliases: ['US Open ATP', 'US Open Men', 'Flushing Meadows', 'USTA Billie Jean King NTC', 'US Open, New York, USA']
      },
      {
        id: 'ct_wta_us_open',
        name: 'US Open',
        tour: 'WTA',
        level: 'GRAND_SLAM',
        surface: 'HARD',
        ioc: 'USA',
        city: 'New York',
        aliases: ['US Open WTA', 'US Open Women', 'US Open, New York, USA, Qualifying']
      },
      {
        id: 'ct_atp_australian_open',
        name: 'Australian Open',
        tour: 'ATP',
        level: 'GRAND_SLAM',
        surface: 'HARD',
        ioc: 'AUS',
        city: 'Melbourne',
        aliases: ['Australian Open ATP', 'AO ATP', 'Melbourne Park', 'Australian Open Men']
      },
      {
        id: 'ct_wta_australian_open',
        name: 'Australian Open',
        tour: 'WTA',
        level: 'GRAND_SLAM',
        surface: 'HARD',
        ioc: 'AUS',
        city: 'Melbourne',
        aliases: ['Australian Open WTA', 'AO WTA', 'Australian Open Women']
      },
      {
        id: 'ct_atp_indian_wells',
        name: 'Indian Wells Masters',
        tour: 'ATP',
        level: 'MASTERS_1000',
        surface: 'HARD',
        ioc: 'USA',
        city: 'Indian Wells',
        aliases: ['Indian Wells ATP', 'BNP Paribas Open', 'Indian Wells, CA', 'Indian Wells Masters ATP']
      },
      {
        id: 'ct_wta_indian_wells',
        name: 'Indian Wells',
        tour: 'WTA',
        level: 'WTA_1000',
        surface: 'HARD',
        ioc: 'USA',
        city: 'Indian Wells',
        aliases: ['Indian Wells WTA', 'BNP Paribas Open WTA']
      },
      {
        id: 'ct_atp_miami',
        name: 'Miami Open',
        tour: 'ATP',
        level: 'MASTERS_1000',
        surface: 'HARD',
        ioc: 'USA',
        city: 'Miami',
        aliases: ['Miami ATP', 'Miami Masters', 'Hard Rock Stadium Open', 'Miami Open presented by Itaú']
      },
      {
        id: 'ct_wta_miami',
        name: 'Miami Open',
        tour: 'WTA',
        level: 'WTA_1000',
        surface: 'HARD',
        ioc: 'USA',
        city: 'Miami',
        aliases: ['Miami WTA', 'Miami Open WTA']
      },
      {
        id: 'ct_atp_madrid',
        name: 'Madrid Masters',
        tour: 'ATP',
        level: 'MASTERS_1000',
        surface: 'CLAY',
        ioc: 'ESP',
        city: 'Madrid',
        aliases: ['Madrid ATP', 'Mutua Madrid Open', 'Caja Mágica']
      },
      {
        id: 'ct_wta_madrid',
        name: 'Madrid Open',
        tour: 'WTA',
        level: 'WTA_1000',
        surface: 'CLAY',
        ioc: 'ESP',
        city: 'Madrid',
        aliases: ['Madrid WTA', 'Mutua Madrid Open WTA']
      },
      {
        id: 'ct_atp_rome',
        name: 'Italian Open',
        tour: 'ATP',
        level: 'MASTERS_1000',
        surface: 'CLAY',
        ioc: 'ITA',
        city: 'Rome',
        aliases: ['Rome ATP', 'Internazionali BNL d’Italia', 'Foro Italico', 'Rome Masters']
      },
      {
        id: 'ct_wta_rome',
        name: 'Italian Open',
        tour: 'WTA',
        level: 'WTA_1000',
        surface: 'CLAY',
        ioc: 'ITA',
        city: 'Rome',
        aliases: ['Rome WTA', 'Internazionali BNL d’Italia WTA']
      },
      {
        id: 'ct_atp_monte_carlo',
        name: 'Monte-Carlo Masters',
        tour: 'ATP',
        level: 'MASTERS_1000',
        surface: 'CLAY',
        ioc: 'MON',
        city: 'Roquebrune-Cap-Martin',
        aliases: ['Monte Carlo ATP', 'Rolex Monte-Carlo Masters', 'Monte Carlo Masters']
      },
      {
        id: 'ct_atp_cincinnati',
        name: 'Cincinnati Masters',
        tour: 'ATP',
        level: 'MASTERS_1000',
        surface: 'HARD',
        ioc: 'USA',
        city: 'Mason / Cincinnati',
        aliases: ['Cincinnati ATP', 'Western & Southern Open', 'Cincinnati Open']
      },
      {
        id: 'ct_wta_cincinnati',
        name: 'Cincinnati Open',
        tour: 'WTA',
        level: 'WTA_1000',
        surface: 'HARD',
        ioc: 'USA',
        city: 'Mason / Cincinnati',
        aliases: ['Cincinnati WTA', 'Western & Southern Open WTA']
      }
    ];

    targetDb.transaction(() => {
      for (const ct of CORE_TOURNAMENTS) {
        insertTourneyStmt.run(
          ct.id,
          ct.name,
          ct.tour,
          ct.level,
          ct.surface,
          ct.ioc,
          ct.city
        );
        tournamentsCount++;

        // Insert canonical name as alias
        insertTourneyAliasStmt.run(
          ct.id,
          'canonical',
          ct.name,
          normalizeToken(ct.name),
          1 // is_verified
        );
        tournamentAliasesCount++;

        // Insert alias variations
        for (const al of ct.aliases) {
          const normAl = normalizeToken(al);
          insertTourneyAliasStmt.run(
            ct.id,
            'catalog',
            al,
            normAl,
            1
          );
          tournamentAliasesCount++;
        }
      }
    })();

    // Supplement additional tournaments from historical_matches
    if (sourceDb) {
      console.log('5. Supplementing tournaments from historical_matches...');
      const histTourneys = sourceDb
        .prepare(`
          SELECT 
            tourney_name,
            tour,
            surface,
            tourney_level,
            COUNT(*) AS match_count
          FROM historical_matches
          WHERE tourney_name IS NOT NULL AND TRIM(tourney_name) != ''
          GROUP BY tourney_name, tour
          HAVING COUNT(*) >= 20
          ORDER BY match_count DESC
        `)
        .all() as Array<{
          tourney_name: string;
          tour: string;
          surface: string;
          tourney_level: string;
          match_count: number;
        }>;

      targetDb.transaction(() => {
        for (const ht of histTourneys) {
          const tour: 'ATP' | 'WTA' | 'CHALLENGER' | 'ITF' =
            ht.tour === 'WTA' ? 'WTA' : ht.tour === 'CHALLENGER' ? 'CHALLENGER' : 'ATP';

          const surface = resolveSurface(ht.surface);
          const cleanName = ht.tourney_name
            .replace(/\s+(ATP|WTA|Challenger|ITF)(\s*-\s*Qualification|\s*Qualifying)?$/i, '')
            .trim();

          const norm = normalizeToken(cleanName);
          if (!norm) continue;

          const canonTourneyId = `ct_${tour.toLowerCase()}_${norm.replace(/\s+/g, '_')}`;
          const level = mapTourLevel(tour, ht.tourney_level, ht.tourney_name);

          const res = insertTourneyStmt.run(
            canonTourneyId,
            cleanName,
            tour,
            level,
            surface,
            null,
            null
          );

          if (res.changes > 0) {
            tournamentsCount++;
          }

          // Insert raw historical name as alias
          insertTourneyAliasStmt.run(
            canonTourneyId,
            'historical',
            ht.tourney_name,
            normalizeToken(ht.tourney_name),
            1 // Verified match to canonical tourney
          );
          tournamentAliasesCount++;
        }
      })();
    }

    const elapsed = Date.now() - startTime;
    return {
      targetDbPath: resolvedTarget,
      playersInserted: playersCount,
      playerAliasesInserted: playerAliasesCount,
      tournamentsInserted: tournamentsCount,
      tournamentAliasesInserted: tournamentAliasesCount,
      ambiguousAliasesFlagged: ambiguousAliasesCount,
      executionTimeMs: elapsed,
      status: 'SUCCESS'
    };
  } catch (err: any) {
    return {
      targetDbPath: resolvedTarget,
      playersInserted: playersCount,
      playerAliasesInserted: playerAliasesCount,
      tournamentsInserted: tournamentsCount,
      tournamentAliasesInserted: tournamentAliasesCount,
      ambiguousAliasesFlagged: ambiguousAliasesCount,
      executionTimeMs: Date.now() - startTime,
      status: 'FAILED',
      error: err.message
    };
  } finally {
    if (sourceDb) {
      sourceDb.close();
    }
    targetDb.close();
  }
}

// Direct execution entrypoint
if (require.main === module) {
  try {
    console.log('================================================================');
    console.log('SEEDING CANONICAL REGISTRIES (PLAYERS & TOURNAMENTS)');
    console.log('================================================================');

    const report = seedCanonicalRegistries();

    console.log(`Database:               ${report.targetDbPath}`);
    console.log(`Status:                 ${report.status}`);
    console.log(`Execution Time:         ${report.executionTimeMs} ms`);
    console.log(`Players Inserted:       ${report.playersInserted.toLocaleString()}`);
    console.log(`Player Aliases:         ${report.playerAliasesInserted.toLocaleString()}`);
    console.log(`Tournaments Inserted:   ${report.tournamentsInserted.toLocaleString()}`);
    console.log(`Tournament Aliases:     ${report.tournamentAliasesInserted.toLocaleString()}`);
    console.log(`Ambiguous Flagged:      ${report.ambiguousAliasesFlagged.toLocaleString()}`);

    if (report.status !== 'SUCCESS') {
      console.error('SEEDING FAILED:', report.error);
      process.exit(1);
    }

    console.log('================================================================');
    console.log('CANONICAL REGISTRY SEEDING COMPLETED SUCCESSFULLY');
    console.log('================================================================');
  } catch (err: any) {
    console.error('FATAL SEEDING ERROR:', err.message);
    process.exit(1);
  }
}
