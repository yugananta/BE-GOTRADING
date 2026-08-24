import pg from 'pg';
import { DIRECT_URL } from '../config/env.js';
import fs from 'fs';

async function recreate() {
  const pool = new pg.Pool({ connectionString: DIRECT_URL });
  try {
    console.log('Drop tabel lama...');
    await pool.query('DROP TABLE IF EXISTS cities CASCADE');
    await pool.query('DROP TABLE IF EXISTS provinces CASCADE');
    await pool.query('DROP TABLE IF EXISTS countries CASCADE');

    console.log('Buat ulang tabel sesuai 07_locations_schema.sql...');
    const sql = fs.readFileSync('sql/07_locations_schema.sql', 'utf-8');
    await pool.query(sql);

    console.log('Tambah kolom dan constraint tambahan...');
    await pool.query(`ALTER TABLE provinces ADD COLUMN IF NOT EXISTS source_id TEXT;`);
    await pool.query(`ALTER TABLE cities ADD COLUMN IF NOT EXISTS source_id TEXT;`);
    await pool.query(`ALTER TABLE cities ADD COLUMN IF NOT EXISTS original_type TEXT;`);
    await pool.query(`ALTER TABLE cities DROP CONSTRAINT IF EXISTS cities_province_name_key;`);
    await pool.query(`ALTER TABLE cities ADD CONSTRAINT cities_province_name_key UNIQUE (province_id, name);`);

    console.log('Selesai re-create tabel!');
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
recreate();
