// server/db/migrations.js
import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Client } = pg;

export async function runMigrations() {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[MIGRATION] Non-production environment, skipping auto-migrations.');
    return;
  }

  console.log('[MIGRATION] Running database migrations...');
  const connectionString = process.env.DIRECT_URL;
  if (!connectionString) {
    console.error('[MIGRATION] ❌ DIRECT_URL environment variable is missing.');
    return;
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('[MIGRATION] Connected to Supabase PostgreSQL database.');

    const sqlDir = './sql';
    const files = fs.readdirSync(sqlDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`[MIGRATION] Found ${files.length} SQL migration files.`);

    for (const file of files) {
      console.log(`[MIGRATION] Executing: ${file}`);
      const filePath = path.join(sqlDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      await client.query(sql);
      console.log(`[MIGRATION] ✅ Success: ${file}`);
    }
    console.log('[MIGRATION] All migrations executed successfully.');
  } catch (err) {
    console.error('[MIGRATION] ❌ Error during database migration:', err.message);
  } finally {
    try {
      await client.end();
    } catch (e) {
      // ignore
    }
  }
}
