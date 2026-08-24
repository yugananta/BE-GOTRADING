import pg from 'pg';
import { DIRECT_URL } from '../config/env.js';

async function migrate() {
  const pool = new pg.Pool({ connectionString: DIRECT_URL });
  try {
    console.log('Menambahkan kolom baru...');
    await pool.query(`ALTER TABLE provinces ADD COLUMN IF NOT EXISTS source_id TEXT;`);
    await pool.query(`ALTER TABLE cities ADD COLUMN IF NOT EXISTS source_id TEXT;`);
    await pool.query(`ALTER TABLE cities ADD COLUMN IF NOT EXISTS original_type TEXT;`);

    console.log('TRUNCATE tabel (menghapus data lama)...');
    await pool.query(`TRUNCATE TABLE countries, provinces, cities CASCADE;`);

    console.log('Menambahkan constraint unik...');
    await pool.query(`ALTER TABLE cities DROP CONSTRAINT IF EXISTS cities_province_name_key;`);
    await pool.query(`ALTER TABLE cities ADD CONSTRAINT cities_province_name_key UNIQUE (province_id, name);`);

    console.log('Migrasi skema dan TRUNCATE berhasil!');
  } catch (err) {
    console.error('Migrasi gagal:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
