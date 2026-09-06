/**
 * Free bulk-fetch UI port (Windows) before restart.
 * Run: npm run bulk:ui:restart
 */
import { execSync } from 'node:child_process';

const port = String(process.env.BULK_FETCH_UI_PORT || 3099);

function listListeningPids(): number[] {
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
    const pids = new Set<number>();
    for (const line of out.split('\n')) {
      if (!line.includes('LISTENING')) continue;
      const parts = line.trim().split(/\s+/);
      const pid = Number(parts[parts.length - 1]);
      if (Number.isFinite(pid) && pid > 0) pids.add(pid);
    }
    return [...pids];
  } catch {
    return [];
  }
}

const pids = listListeningPids();
if (pids.length === 0) {
  console.log(`Port ${port} is free.`);
  process.exit(0);
}

for (const pid of pids) {
  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'inherit' });
    console.log(`Stopped PID ${pid} on port ${port}`);
  } catch {
    console.warn(`Could not stop PID ${pid}`);
  }
}
