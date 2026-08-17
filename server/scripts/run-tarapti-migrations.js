// BE-GOTRADING/server/scripts/run-tarapti-migrations.js
import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Client } = pg;

async function run() {
  const host = process.env.TARAPTI_DB_HOST || '103.219.251.22';
  const port = parseInt(process.env.TARAPTI_DB_PORT || '5432', 10);
  const database = process.env.TARAPTI_DB_NAME || 'mt5_trading';
  const user = process.env.TARAPTI_DB_USER || 'mt5app';
  const password = process.env.TARAPTI_DB_PASSWORD || 'Xx5pbMJSAaFW4Tk6dnzu';

  console.log(`Connecting to TARAPTI DB at ${host}:${port}/${database}...`);
  const client = new Client({
    host,
    port,
    database,
    user,
    password,
    connectionTimeoutMillis: 10000,
  });

  try {
    await client.connect();
    console.log('Connected successfully!');

    const sqlFiles = [
      'sql/00_0_sync_engine_tables.sql',
      'sql/12_analytics_views.sql'
    ];

    for (const file of sqlFiles) {
      console.log(`Reading and executing migration: ${file}`);
      const sqlPath = path.resolve(file);
      const sqlContent = fs.readFileSync(sqlPath, 'utf8');
      
      // Execute the migration SQL
      await client.query(sqlContent);
      console.log(`✅ Completed: ${file}`);
    }

    // Verify tables
    const res = await client.query(`
      SELECT schemaname, tablename 
      FROM pg_tables 
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    `);
    console.log('\nExisting Tables in TARAPTI DB:');
    console.log(res.rows);

  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
