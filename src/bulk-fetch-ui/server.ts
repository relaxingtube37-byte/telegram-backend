/**
 * Standalone UI for bulk player history fetch (start / pause / resume).
 *
 * Run: npm run bulk:ui
 * Open: http://localhost:3099
 */

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bulkPlayerHistoryJob } from '../services/bulkPlayerHistoryJob.service';
import { BulkPlayerHistoryStore, defaultBundlesDir, readDistinctEventCount } from '../services/bulkPlayerHistoryFetch.service';

const PORT = Number(process.env.BULK_FETCH_UI_PORT || 3099);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = path.resolve(process.env.BULK_FETCH_OUT_DIR || path.join(ROOT, 'data', 'bulk-player-history'));
const BUNDLES_DIR = path.resolve(process.env.BULK_BUNDLES_OUT_DIR || defaultBundlesDir(OUT_DIR));

const app = express();
app.use(express.json());

app.get('/api/status', (_req, res) => {
  const state = bulkPlayerHistoryJob.getState();
  const historyStore = new BulkPlayerHistoryStore(OUT_DIR);
  const completedOnDisk = historyStore.loadCompletedPlayerIds().size;
  const eventsOnDisk = readDistinctEventCount(OUT_DIR);
  // Use saved progress instead of scanning 57k manifests on every poll
  const bundlesOnDisk = state.progress?.bundlesDone ?? 0;
  const totalPlayers = (state.config?.rankLimit || 200) * 2;
  const bundlesRemaining = Math.max(0, eventsOnDisk - bundlesOnDisk);
  const bundlesPending = bundlesRemaining > 0 && completedOnDisk >= totalPlayers;
  const phase =
    bundlesPending && state.status !== 'running'
      ? 'bundles'
      : state.progress?.phase || (completedOnDisk >= totalPlayers ? 'bundles' : 'players');
  const effectiveStatus =
    state.status === 'completed' && bundlesPending ? 'idle' : state.status;

  res.json({
    ...state,
    status: effectiveStatus,
    rawStatus: state.status,
    outDir: OUT_DIR,
    bundlesDir: BUNDLES_DIR,
    completedOnDisk,
    playersCompletedTotal: completedOnDisk,
    playersRemaining: Math.max(0, totalPlayers - completedOnDisk),
    eventsOnDisk,
    bundlesOnDisk,
    bundlesRemaining,
    bundlesPending,
    phase,
    phaseLabel:
      phase === 'bundles'
        ? bundlesPending && effectiveStatus !== 'running'
          ? 'دریافت دیتای بازی‌ها (باقی‌مانده)'
          : 'دریافت دیتای بازی‌ها'
        : phase === 'done'
          ? 'تمام شد'
          : 'دریافت لیست بازیکنان',
    estimate: bulkPlayerHistoryJob.getEstimate(state.config || undefined),
  });
});

app.post('/api/start', (req, res) => {
  const body = req.body || {};
  const result = bulkPlayerHistoryJob.start({
    fromDate: body.fromDate || '2024-01-01',
    toDate: body.toDate || '2026-12-31',
    rankLimit: Number(body.rankLimit || 200),
    reqPerSec: Number(body.reqPerSec || 8),
    outDir: OUT_DIR,
    bundlesDir: BUNDLES_DIR,
    saveRawPages: Boolean(body.saveRawPages),
    maxPages: Number(body.maxPages || 120),
    resume: body.resume !== false,
    autoBundles: body.autoBundles !== false,
    bundlesOnly: Boolean(body.bundlesOnly),
    bundleTestLimit: Number(body.bundleTestLimit || 0),
  });
  res.json(result);
});

app.post('/api/pause', (_req, res) => {
  res.json(bulkPlayerHistoryJob.requestPause());
});

app.get('/', (_req, res) => {
  res.type('html').send(HTML);
});

app.listen(PORT, () => {
  console.log(`\n🎾 Bulk Fetch UI → http://localhost:${PORT}`);
  console.log(`   Data folder: ${OUT_DIR}\n`);
}).on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use.`);
    console.error('   Run: npm run bulk:ui:restart\n');
    process.exit(1);
  }
  throw err;
});

const HTML = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>دریافت تاریخچه بازی‌ها</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: Tahoma, "Segoe UI", sans-serif;
      background: #0f1419;
      color: #e7e9ea;
      margin: 0;
      padding: 24px;
      line-height: 1.5;
    }
    .wrap { max-width: 640px; margin: 0 auto; }
    h1 { font-size: 1.35rem; margin: 0 0 8px; }
    .sub { color: #8b98a5; font-size: 0.9rem; margin-bottom: 24px; }
    .card {
      background: #16202a;
      border: 1px solid #2f3336;
      border-radius: 12px;
      padding: 16px 18px;
      margin-bottom: 16px;
    }
    .status {
      font-size: 1.1rem;
      font-weight: bold;
      margin-bottom: 12px;
    }
    .status.running { color: #00ba7c; }
    .status.paused { color: #ffad1f; }
    .status.completed { color: #1d9bf0; }
    .status.error { color: #f4212e; }
    .status.idle { color: #8b98a5; }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px 16px;
      font-size: 0.9rem;
    }
    .grid span { color: #8b98a5; }
    label { display: block; font-size: 0.85rem; color: #8b98a5; margin-bottom: 4px; }
    input, select {
      width: 100%;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid #2f3336;
      background: #0f1419;
      color: #e7e9ea;
      margin-bottom: 12px;
    }
    .row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
    button {
      flex: 1;
      min-width: 120px;
      padding: 12px 16px;
      border: none;
      border-radius: 999px;
      font-size: 0.95rem;
      font-weight: bold;
      cursor: pointer;
    }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn-start { background: #1d9bf0; color: #fff; }
  .btn-resume { background: #00ba7c; color: #fff; }
  .btn-pause { background: #f4212e; color: #fff; }
    .log {
      font-size: 0.8rem;
      color: #8b98a5;
      max-height: 120px;
      overflow-y: auto;
      white-space: pre-wrap;
    }
    .bar-bg {
      height: 8px;
      background: #2f3336;
      border-radius: 4px;
      overflow: hidden;
      margin: 12px 0 6px;
    }
    .bar-fill {
      height: 100%;
      background: #1d9bf0;
      transition: width 0.3s;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>دریافت داده تنیس (تاپ ۲۰۰)</h1>
    <p class="sub">مرحله ۲: هر بازی ۳ درخواست — تا ۸ درخواست هم‌زمان در ثانیه (چند بازی موازی)</p>

    <div class="card">
      <div id="phaseLabel" style="color:#8b98a5;font-size:0.85rem;margin-bottom:6px">مرحله: —</div>
      <div id="statusLabel" class="status idle">وضعیت: آماده</div>
      <div class="bar-bg"><div id="bar" class="bar-fill" style="width:0%"></div></div>
      <div class="grid">
        <div><span>بازیکنان</span><br><strong id="done">—</strong></div>
        <div><span>کل بازیکنان</span><br><strong id="total">400</strong></div>
        <div><span>بازی‌ها در لیست</span><br><strong id="eventsListed">—</strong></div>
        <div><span>دیتای بازی (stat+PBP)</span><br><strong id="bundlesDone">—</strong></div>
        <div><span>درخواست API</span><br><strong id="api">—</strong></div>
        <div style="grid-column: 1 / -1"><span>الان روی</span><br><strong id="current">—</strong></div>
      </div>
    </div>

    <div class="card">
      <label>از تاریخ</label>
      <input type="date" id="fromDate" value="2024-01-01" />
      <label>تا تاریخ</label>
      <input type="date" id="toDate" value="2026-12-31" />
      <label>سرعت (درخواست در ثانیه)</label>
      <input type="number" id="reqPerSec" min="1" max="10" value="8" />
      <label>تعداد هر تور (تاپ N)</label>
      <input type="number" id="rankLimit" min="10" max="300" value="200" />
      <div class="row">
        <button type="button" class="btn-start" id="btnStart">شروع / ادامه</button>
        <button type="button" class="btn-pause" id="btnPause" disabled>توقف</button>
      </div>
      <p class="log" id="message"></p>
    </div>
  </div>

  <script>
    const $ = (id) => document.getElementById(id);
    const statusFa = {
      idle: 'آماده — مرحله ۲ باقی مانده',
      running: 'در حال اجرا…',
      paused: 'متوقف — می‌توانید ادامه دهید',
      completed: 'تمام شد',
      error: 'خطا',
    };

    async function refresh() {
      try {
        const res = await fetch('/api/status');
        const s = await res.json();
        const total = (s.config?.rankLimit || Number($('rankLimit').value) || 200) * 2;
        const done = s.completedOnDisk ?? 0;
        const phase = s.phase || s.progress?.phase || 'players';
        const eventsListed = s.eventsOnDisk ?? s.progress?.eventsListed ?? 0;
        const bundlesDone = s.bundlesOnDisk ?? s.progress?.bundlesDone ?? 0;
        const bundlesPending = Boolean(s.bundlesPending);

        let pct = 0;
        if (phase === 'bundles' || phase === 'done' || bundlesPending) {
          pct = eventsListed ? Math.min(100, Math.round((bundlesDone / eventsListed) * 100)) : 0;
        } else {
          pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
        }

        const statusKey = s.status || 'idle';
        $('phaseLabel').textContent = 'مرحله: ' + (s.phaseLabel || phase);
        $('statusLabel').className = 'status ' + statusKey;
        $('statusLabel').textContent = 'وضعیت: ' + (statusFa[statusKey] || statusKey);
        $('bar').style.width = pct + '%';
        $('done').textContent = done + ' / ' + total;
        $('total').textContent = total;
        $('eventsListed').textContent = eventsListed.toLocaleString('fa-IR');
        $('bundlesDone').textContent = bundlesDone.toLocaleString('fa-IR') + ' / ' + eventsListed.toLocaleString('fa-IR');
        $('api').textContent = s.progress?.apiCalls ?? '—';
        $('current').textContent = s.progress?.currentPlayer || (s.progress?.currentEventId ? 'بازی ' + s.progress.currentEventId : '—');

        const running = s.rawStatus === 'running' || s.status === 'running';
        $('btnStart').textContent = bundlesPending && !running ? 'شروع مرحله ۲' : 'شروع / ادامه';
        $('btnStart').disabled = running;
        $('btnPause').disabled = !running;
        if (bundlesPending && !running && !s.progress?.lastError) {
          $('message').textContent = 'لیست بازیکنان کامل است. برای دریافت stat و PBP دکمه بالا را بزنید.';
        } else if (s.progress?.lastError) {
          $('message').textContent = s.progress.lastError;
        }
      } catch (e) {
        $('message').textContent = 'خطا در اتصال به سرور';
      }
    }

    $('btnStart').onclick = async () => {
      $('message').textContent = 'در حال شروع…';
      const res = await fetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromDate: $('fromDate').value,
          toDate: $('toDate').value,
          reqPerSec: Number($('reqPerSec').value),
          rankLimit: Number($('rankLimit').value),
          resume: true,
        }),
      });
      const j = await res.json();
      $('message').textContent = j.message || (j.ok ? 'شروع شد' : 'خطا');
      refresh();
    };

    $('btnPause').onclick = async () => {
      const res = await fetch('/api/pause', { method: 'POST' });
      const j = await res.json();
      $('message').textContent = j.message;
      refresh();
    };

    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>`;
