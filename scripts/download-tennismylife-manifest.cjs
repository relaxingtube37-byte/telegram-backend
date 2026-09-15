/**
 * scripts/download-tennismylife-manifest.cjs
 *
 * TennisMyLife Source Adapter: Manifest Downloader & Normalizer
 *
 * SAFETY INVARIANTS:
 * - Read-only / Dry-run only.
 * - FAIL CLOSED if mandatory `--dry-run` flag is missing.
 * - Zero database writes.
 * - Saves exact raw response to manifest.raw.json.
 * - Normalizes advertised files into manifest.json.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

// --- 1. CLI & FAIL-CLOSED ENFORCEMENT ---
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

if (!isDryRun) {
  console.error('\n================================================================================');
  console.error(' [SECURITY VIOLATION] FAIL-CLOSED EXECUTION HALTED');
  console.error(' Missing mandatory flag: --dry-run');
  console.error(' To prevent accidental execution or unintended side-effects, this script requires');
  console.error(' explicit invocation with:');
  console.error('   node scripts/download-tennismylife-manifest.cjs --dry-run');
  console.error('================================================================================\n');
  process.exit(1);
}

const outDirIdx = args.indexOf('--output-dir');
const outputDir = outDirIdx !== -1 && args[outDirIdx + 1]
  ? path.resolve(args[outDirIdx + 1])
  : path.resolve(__dirname, '../scratch/tennismylife-source-output');

const MANIFEST_URL = 'https://stats.tennismylife.org/api/data-files';

function fetchUrlWithRetry(url, maxRetries = 3, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    function attemptFetch() {
      attempts++;
      const req = https.get(url, { headers: { 'User-Agent': 'TennisMyLife-Source-Adapter/1.0' } }, (res) => {
        const { statusCode, headers } = res;
        const contentType = headers['content-type'] || '';

        if (statusCode < 200 || statusCode >= 300) {
          res.resume(); // consume response data to free up memory
          if (attempts < maxRetries) {
            const delay = Math.pow(2, attempts) * 500;
            setTimeout(attemptFetch, delay);
            return;
          }
          return reject(new Error(`HTTP request failed with status code ${statusCode} after ${attempts} attempts`));
        }

        let rawData = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          resolve({
            statusCode,
            contentType,
            rawBody: rawData
          });
        });
      });

      req.on('error', (err) => {
        if (attempts < maxRetries) {
          const delay = Math.pow(2, attempts) * 500;
          setTimeout(attemptFetch, delay);
          return;
        }
        reject(new Error(`Network error during fetch: ${err.message}`));
      });

      req.setTimeout(timeoutMs, () => {
        req.destroy();
        if (attempts < maxRetries) {
          const delay = Math.pow(2, attempts) * 500;
          setTimeout(attemptFetch, delay);
          return;
        }
        reject(new Error(`Request timeout (${timeoutMs}ms) after ${attempts} attempts`));
      });
    }

    attemptFetch();
  });
}

function categorizeFile(filename) {
  const lower = filename.toLowerCase();

  if (lower.includes('backup')) {
    return { category: 'backup', tour: 'OTHER', year: null };
  }
  if (lower.includes('ongoing')) {
    let tour = 'ATP';
    if (lower.includes('wta')) tour = 'WTA';
    else if (lower.includes('challenger')) tour = 'CHALLENGER';
    return { category: 'ongoing', tour, year: 2026 };
  }
  if (lower.startsWith('atp_quali/')) {
    const match = lower.match(/(\d{4})_atp_quali\.csv/);
    return {
      category: 'qualifying_yearly',
      tour: 'ATP',
      year: match ? parseInt(match[1], 10) : null
    };
  }
  if (lower.endsWith('_challenger.csv')) {
    const match = lower.match(/^(\d{4})_challenger\.csv/);
    return {
      category: 'challenger_yearly',
      tour: 'CHALLENGER',
      year: match ? parseInt(match[1], 10) : null
    };
  }
  if (lower.endsWith('_wta.csv')) {
    const match = lower.match(/^(\d{4})_wta\.csv/);
    return {
      category: 'wta_yearly',
      tour: 'WTA',
      year: match ? parseInt(match[1], 10) : null
    };
  }
  const yearMatch = lower.match(/^(\d{4})\.csv$/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    return {
      category: year < 2021 ? 'archive' : 'atp_yearly',
      tour: 'ATP',
      year
    };
  }

  return { category: 'other', tour: 'OTHER', year: null };
}

async function downloadAndNormalizeManifest() {
  console.log('================================================================================');
  console.log(' TENNISMYLIFE SOURCE ADAPTER: MANIFEST ACQUISITION');
  console.log(` Target Endpoint: ${MANIFEST_URL}`);
  console.log(` Output Directory: ${outputDir}`);
  console.log('================================================================================\n');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const retrievalTimestampUtc = new Date().toISOString();
  console.log(`[1/3] Fetching live manifest (retrieval timestamp: ${retrievalTimestampUtc})...`);

  const response = await fetchUrlWithRetry(MANIFEST_URL);
  console.log(`  Received response: HTTP ${response.statusCode}, Content-Type: ${response.contentType}`);

  // Write exact raw response
  const rawPath = path.join(outputDir, 'manifest.raw.json');
  fs.writeFileSync(rawPath, response.rawBody, 'utf8');
  console.log(`[2/3] Saved exact raw response to ${rawPath} (${response.rawBody.length} bytes)`);

  // Parse JSON
  let parsed;
  try {
    parsed = JSON.parse(response.rawBody);
  } catch (err) {
    console.error(`[ERROR] Fail-closed: Malformed JSON received from manifest endpoint: ${err.message}`);
    process.exit(1);
  }

  if (!parsed || !Array.isArray(parsed.files)) {
    console.error('[ERROR] Fail-closed: Manifest does not contain a "files" array.');
    process.exit(1);
  }

  console.log(`[3/3] Normalizing manifest (${parsed.files.length} advertised files)...`);

  const seenNames = new Set();
  const normalizedFiles = [];

  for (const item of parsed.files) {
    if (!item.name || typeof item.name !== 'string') {
      console.error(`[ERROR] Fail-closed: Advertised item missing valid name: ${JSON.stringify(item)}`);
      process.exit(1);
    }
    if (!item.url || typeof item.url !== 'string') {
      console.error(`[ERROR] Fail-closed: Advertised file ${item.name} has no valid download URL.`);
      process.exit(1);
    }
    if (seenNames.has(item.name)) {
      console.error(`[ERROR] Fail-closed: Duplicate advertised filename encountered: ${item.name}`);
      process.exit(1);
    }
    seenNames.add(item.name);

    const meta = categorizeFile(item.name);

    normalizedFiles.push({
      name: item.name,
      download_url: item.url,
      advertised_size_bytes: typeof item.size === 'number' ? item.size : null,
      mtime_utc: item.mtime ? new Date(item.mtime).toISOString() : null,
      category: meta.category,
      tour: meta.tour,
      year: meta.year
    });
  }

  // Sort files by stable manifest identity (name)
  normalizedFiles.sort((a, b) => a.name.localeCompare(b.name));

  const normalizedManifest = {
    source_name: 'TENNISMYLIFE',
    source_url: MANIFEST_URL,
    http_status: response.statusCode,
    content_type: response.contentType,
    retrieval_timestamp_utc: retrievalTimestampUtc,
    total_advertised_files: normalizedFiles.length,
    files: normalizedFiles
  };

  const normPath = path.join(outputDir, 'manifest.json');
  fs.writeFileSync(normPath, JSON.stringify(normalizedManifest, null, 2) + '\n', 'utf8');
  console.log(`  Saved normalized manifest to ${normPath}`);
  console.log(`\nManifest acquisition completed successfully: ${normalizedFiles.length} files cataloged.`);

  return normalizedManifest;
}

if (require.main === module) {
  downloadAndNormalizeManifest().catch((err) => {
    console.error(`\n[FATAL] Manifest acquisition failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  downloadAndNormalizeManifest,
  categorizeFile,
  fetchUrlWithRetry
};
