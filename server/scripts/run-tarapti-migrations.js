// BE-GOTRADING/server/scripts/run-tarapti-migrations.js
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import {
  TARAPTI_DB_HOST,
  TARAPTI_DB_PORT,
  TARAPTI_DB_NAME,
  TARAPTI_DB_USER,
  TARAPTI_DB_PASSWORD,
} from '../config/env.js';

const { Client } = pg;

async function run() {
  const host = TARAPTI_DB_HOST;
  const port = TARAPTI_DB_PORT;
  const database = TARAPTI_DB_NAME;
  const user = TARAPTI_DB_USER;
  const password = TARAPTI_DB_PASSWORD;

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
