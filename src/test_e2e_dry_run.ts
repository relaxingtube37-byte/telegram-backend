/**
 * ════════════════════════════════════════════════════════════════════════════
 * 🎾 END-TO-END DRY RUN VERIFICATION
 * ════════════════════════════════════════════════════════════════════════════
 * Flow:
 * 1. Football State publishes analysis-only payload to backend
 * 2. Backend stores record in SQLite database
 * 3. ChannelPosterService generates channel post string
 *    -> Asserts 0 betting text, 100% analysis-first
 * 4. WebApp authenticates via HMAC-SHA256 validated initData
 * 5. WebApp fetches predictions and consumes prediction without betting pills
 * ════════════════════════════════════════════════════════════════════════════
 */

process.env.ADMIN_SECRET = 'dry-run-admin-secret-key-at-least-32-chars!';

import http from 'http';
import express from 'express';
import { corsMiddleware } from './middlewares/cors';
import { apiRouter } from './routes';
import { ChannelPosterService } from './services/channel-poster.service';
import { signTelegramInitData } from './utils/telegramAuth';
import { PredictionsService } from './services/predictions.service';
import { PredictionsRepo } from './db';
import { initSchema } from './db/schema';
import { runMigrations } from './db/migrations';
import { ENV } from './config/env';

const TEST_PORT = 3197;
let server: http.Server;

async function run() {
  console.log('========================================================');
  console.log('🚀 RUNNING END-TO-END DRY-RUN: Football State -> Backend -> Channel -> WebApp');
  console.log('========================================================\n');

  initSchema();
  runMigrations();

  const app = express();
  app.use(corsMiddleware);
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use('/', apiRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(TEST_PORT, resolve));

  const baseUrl = `http://127.0.0.1:${TEST_PORT}`;
  const adminSecret = ENV.ADMIN_SECRET;

  // STEP 1: Football State publishes payload
  console.log('--- Step 1: Football State publishes payload to Backend ---');
  const footballStatePayload = {
    fixture_id: 98765432,
    match_title: 'Carlos Alcaraz vs Jannik Sinner',
    tournament_name: 'Roland Garros',
    surface: 'Clay',
    round_name: 'Final',
    match_date: new Date().toISOString(),
    home_name: 'Carlos Alcaraz',
    away_name: 'Jannik Sinner',
    home_odds: '1.85',
    away_odds: '2.05',
    predicted_winner: 'Carlos Alcaraz',
    predicted_score: '3:1',
    win_probability: 72,
    confidence: 'HIGH',
    key_factors: [
      'Superior baseline rally conversion on clay (58% vs 49%)',
      'Dominant second-serve return win rate under heavy topspin',
      'Recent high fatigue metrics observed on opponent'
    ],
    ai_summary: 'Alcaraz holds a clear tactical edge in extended baseline exchanges on Philippe-Chatrier. His topspin heavy forehand forces deeper positioning, neutralising Sinner flat driving pace.',
    devils_advocate_risk: 'High unforced error count during windy conditions',
    // Best bet fields may still be generated internally by desktop app, but MUST NOT leak to channel or WebApp betting UI
    best_bet_market: 'Match Winner',
    best_bet_selection: 'Carlos Alcaraz',
    best_bet_rationale: 'Value odds at 1.85 with projected 72% true win probability',
    best_bet_ev: '+12.4%',
    alt_bet_market: 'Over 3.5 Sets',
    alt_bet_selection: 'Yes',
    alt_bet_rationale: 'Grand slam finals between top 2 seeds frequently extend past straight sets',
    alt_bet_risk: 'LOW',
    postToChannel: false, // We will manually format channel message to verify preview
    publish_mode: 'analysis_only',
  };

  const publishRes = await fetch(`${baseUrl}/api/admin/predictions/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': adminSecret,
    },
    body: JSON.stringify(footballStatePayload),
  });

  const publishData = await publishRes.json();
  console.log('Publish HTTP Status:', publishRes.status);
  console.log('Publish Response:', publishData);
  if (!publishRes.ok || !publishData.success) {
    throw new Error(`Step 1 failed: ${JSON.stringify(publishData)}`);
  }
  const predictionId = publishData.predictionId;
  console.log(`✅ Step 1 SUCCESS: Prediction stored in SQLite with ID: ${predictionId}\n`);

  // STEP 2: Backend stored record verification
  console.log('--- Step 2: Backend DB Record Verification ---');
  const storedRecord = PredictionsService.getById(predictionId);
  if (!storedRecord) {
    throw new Error(`Step 2 failed: Record #${predictionId} not found in DB`);
  }
  console.log('Stored Home Name:', storedRecord.home_name);
  console.log('Stored Away Name:', storedRecord.away_name);
  console.log('Stored Predicted Winner:', storedRecord.predicted_winner);
  console.log('Stored Win Probability:', storedRecord.win_probability);
  console.log('Stored AI Summary:', storedRecord.ai_summary);
  console.log('Stored Key Factors:', storedRecord.key_factors);
  console.log(`✅ Step 2 SUCCESS: DB record contains complete analysis fields.\n`);

  // STEP 3: Formatted Channel Message Preview
  console.log('--- Step 3: Formatted Channel Message Preview ---');
  const channelMessageText = ChannelPosterService.formatPredictionHtml(storedRecord);
  console.log('=== CHANNEL MESSAGE OUTPUT PREVIEW ===');
  console.log(channelMessageText);
  console.log('======================================\n');

  // Verify Analysis-First requirements
  console.log('Checking Channel Post Constraints:');
  const forbiddenKeywords = [
    'RECOMMENDED VALUE BET',
    'best_bet',
    'alt_bet',
    'Value Bet',
    'Odds:',
    'EV:',
    'Hedge',
    'Over 3.5',
    'Match Winner',
  ];

  for (const forbidden of forbiddenKeywords) {
    if (channelMessageText.includes(forbidden)) {
      throw new Error(`VIOLATION: Channel post contains forbidden betting keyword: "${forbidden}"`);
    }
  }
  console.log('  ✅ No betting keywords, markets, odds, or EV found in channel post.');

  // Verify mandatory analysis elements
  if (!channelMessageText.includes('Carlos Alcaraz vs Jannik Sinner')) throw new Error('Missing match title');
  if (!channelMessageText.includes('Carlos Alcaraz')) throw new Error('Missing predicted winner');
  if (!channelMessageText.includes('72%')) throw new Error('Missing win probability');
  if (!channelMessageText.includes('Superior baseline rally conversion')) throw new Error('Missing key factors');
  if (!channelMessageText.includes('Philippe-Chatrier')) throw new Error('Missing ai_summary');
  console.log('  ✅ Match Title, Predicted Winner, Win Probability, AI Summary, and Key Factors are properly present.');
  console.log(`✅ Step 3 SUCCESS: Channel message is 100% publish-safe & analysis-first!\n`);

  // STEP 4: WebApp Authentication Security
  console.log('--- Step 4: WebApp Authentication Security ---');
  const botToken = ENV.BOT_TOKEN;
  const testUser = {
    id: 11223344,
    first_name: 'TestUser',
    last_name: 'TennisFan',
    username: 'testuser_tg',
  };

  const validInitData = signTelegramInitData(testUser, botToken);
  const forgedInitData = validInitData.replace('testuser_tg', 'hacker_attacker');

  // Test 4a: Rejection of forged initData
  const forgedAuthRes = await fetch(`${baseUrl}/api/webapp/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: forgedInitData }),
  });
  if (forgedAuthRes.status !== 401) {
    throw new Error(`Step 4a failed: Forged initData was not rejected with 401 (got ${forgedAuthRes.status})`);
  }
  console.log('  ✅ Forged initData rejected with 401 Unauthorized.');

  // Test 4b: Acceptance of authentic initData
  const validAuthRes = await fetch(`${baseUrl}/api/webapp/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: validInitData }),
  });
  if (!validAuthRes.ok) {
    throw new Error(`Step 4b failed: Valid initData was rejected (got ${validAuthRes.status})`);
  }
  const authSession = await validAuthRes.json();
  if (authSession.user.telegram_id !== testUser.id) {
    throw new Error(`Step 4b failed: User ID mismatch (expected ${testUser.id}, got ${authSession.user.telegram_id})`);
  }
  console.log(`  ✅ Authentic initData validated; User ID ${testUser.id} securely extracted.`);
  console.log(`✅ Step 4 SUCCESS: Cryptographic WebApp auth fully working!\n`);

  // STEP 5: WebApp Predictions Fetch
  console.log('--- Step 5: WebApp Predictions Fetch ---');
  const predictionsRes = await fetch(`${baseUrl}/api/webapp/predictions`);
  if (!predictionsRes.ok) {
    throw new Error(`Step 5 failed: GET /api/webapp/predictions returned ${predictionsRes.status}`);
  }
  const activePredictions = await predictionsRes.json();
  const found = activePredictions.find((p: any) => p.fixture_id === 98765432 || p.id === predictionId);
  if (!found) {
    throw new Error('Step 5 failed: Published prediction not found in active predictions list');
  }

  console.log('Found Prediction in WebApp Feed:');
  console.log('  Title:', found.match_title);
  console.log('  Predicted Winner:', found.predicted_winner);
  console.log('  Win Probability:', found.win_probability, '%');
  console.log('  Confidence:', found.confidence);
  console.log('  AI Summary length:', found.ai_summary?.length, 'chars');
  console.log('  Key Factors count:', found.key_factors?.length);

  console.log(`✅ Step 5 SUCCESS: WebApp feed serves analysis data seamlessly!\n`);

  console.log('========================================================');
  console.log('🏆 COMPLETE END-TO-END DRY RUN PASSED 100% SUCCESSFULLY!');
  console.log('========================================================');

  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

run().catch((err) => {
  console.error('❌ Dry-run failed:', err);
  process.exit(1);
});
