import { db } from '../db/connection';

try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
  console.log('--- TELEGRAM-BACKEND SQLITE TABLES ---');
  for (const t of tables) {
    const c = (db.prepare(`SELECT count(*) as count FROM ${t.name}`).get() as any).count;
    console.log(`${t.name}: ${c.toLocaleString()}`);
  }
} catch (e: any) {
  console.error('Error:', e.message);
}
process.exit(0);
