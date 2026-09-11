import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const RENDER_URL = process.env.RENDER_BACKUP_URL || 'https://telegram-backend-2yck.onrender.com/api/admin/backup/download-sqlite';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const TARGET_FILE = path.resolve('G:/telegram-backend/data/render_live_snapshot.sqlite');
const TEMP_FILE = `${TARGET_FILE}.downloading`;

async function downloadSnapshot() {
  console.log(`[Download] Connecting to Render live backup endpoint...`);
  console.log(`[Download] Target destination: ${TARGET_FILE}`);

  if (fs.existsSync(TEMP_FILE)) {
    fs.unlinkSync(TEMP_FILE);
  }

  const startTime = Date.now();

  const req = https.request(
    RENDER_URL,
    {
      method: 'GET',
      headers: {
        'x-admin-secret': ADMIN_SECRET,
      },
      timeout: 300000, // 5 min timeout
    },
    (res) => {
      console.log(`[Download] HTTP Response Status: ${res.statusCode} ${res.statusMessage}`);
      console.log(`[Download] Headers:`, JSON.stringify(res.headers, null, 2));

      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', (chunk) => (errBody += chunk));
        res.on('end', () => {
          console.error(`[Download ERROR] Server responded with error: ${errBody}`);
          process.exit(1);
        });
        return;
      }

      const totalBytesHeader = res.headers['content-length'];
      const totalBytes = totalBytesHeader ? parseInt(totalBytesHeader, 10) : 0;

      const fileStream = fs.createWriteStream(TEMP_FILE);
      const hash = crypto.createHash('sha256');

      let receivedBytes = 0;
      let lastLogTime = Date.now();

      res.on('data', (chunk) => {
        receivedBytes += chunk.length;
        hash.update(chunk);
        fileStream.write(chunk);

        const now = Date.now();
        if (now - lastLogTime > 2000) {
          lastLogTime = now;
          const mb = (receivedBytes / (1024 * 1024)).toFixed(2);
          const percent = totalBytes > 0 ? ` (${((receivedBytes / totalBytes) * 100).toFixed(1)}%)` : '';
          const speed = (receivedBytes / ((now - startTime) / 1000) / 1024).toFixed(1);
          console.log(`[Download Progress] ${mb} MB received${percent} - Speed: ${speed} KB/s`);
        }
      });

      res.on('end', () => {
        fileStream.end();
      });

      fileStream.on('finish', () => {
        const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
        const finalHash = hash.digest('hex');

        if (fs.existsSync(TARGET_FILE)) {
          fs.unlinkSync(TARGET_FILE);
        }
        fs.renameSync(TEMP_FILE, TARGET_FILE);

        const finalStats = fs.statSync(TARGET_FILE);
        console.log(`\n========================================`);
        console.log(`[Download COMPLETE]`);
        console.log(`File: ${TARGET_FILE}`);
        console.log(`Size: ${finalStats.size} bytes (${(finalStats.size / (1024 * 1024)).toFixed(2)} MB)`);
        console.log(`SHA-256: ${finalHash}`);
        console.log(`Duration: ${durationSec}s`);
        console.log(`========================================\n`);
      });

      fileStream.on('error', (err) => {
        console.error(`[Download File Stream ERROR]:`, err);
        process.exit(1);
      });
    }
  );

  req.on('error', (err) => {
    console.error(`[Download Request ERROR]:`, err);
    process.exit(1);
  });

  req.on('timeout', () => {
    console.error(`[Download Timeout] Connection timed out after 300s`);
    req.destroy();
    process.exit(1);
  });

  req.end();
}

downloadSnapshot();
