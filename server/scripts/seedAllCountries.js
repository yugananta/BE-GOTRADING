import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { DIRECT_URL } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COUNTRIES_JSON_PATH = path.join(__dirname, '..', '..', 'data', 'locations', 'countries.json');

/**
 * Seed all ~250 countries from data/locations/countries.json into the `countries` table.
 * Ensures provinces for Indonesia are correctly linked to Indonesia (iso2 = 'ID').
 */
export async function seedAllCountries() {
  console.log('--- Seeding All 250 Countries into Database ---');
  const pool = new pg.Pool({ connectionString: DIRECT_URL });

  try {
    if (!fs.existsSync(COUNTRIES_JSON_PATH)) {
      throw new Error(`File not found: ${COUNTRIES_JSON_PATH}`);
    }

    const countries = JSON.parse(fs.readFileSync(COUNTRIES_JSON_PATH, 'utf-8'));
    console.log(`Loaded ${countries.length} countries from JSON.`);

    const indJson = countries.find(c => c.iso2 === 'ID');
    if (!indJson) {
      throw new Error("Indonesia ('ID') not found in countries dataset!");
    }
    const indonesiaIdInDataset = indJson.id;
    console.log(`Indonesia ID in dataset: ${indonesiaIdInDataset}`);

    // 1. Insert/Upsert semua 250 negara
    for (const c of countries) {
      await pool.query(
        `INSERT INTO countries (id, name, iso2, iso3, phonecode, currency, emoji)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           iso2 = EXCLUDED.iso2,
           iso3 = EXCLUDED.iso3,
           phonecode = EXCLUDED.phonecode,
           currency = EXCLUDED.currency,
           emoji = EXCLUDED.emoji`,
        [
          c.id,
          c.name,
          c.iso2,
          c.iso3 || null,
          c.phonecode ? String(c.phonecode) : null,
          c.currency || null,
          c.emoji || null
        ]
      );
    }

    // 2. Hubungkan semua 34 provinsi Indonesia ke ID negara Indonesia (102)
    const updateRes = await pool.query(
      `UPDATE provinces SET country_id = $1 WHERE country_id != $1 OR country_id IS NULL`,
      [indonesiaIdInDataset]
    );
    console.log(`Updated ${updateRes.rowCount} provinces to country_id = ${indonesiaIdInDataset}`);

    // 3. Verifikasi total negara
    const countRes = await pool.query(`SELECT COUNT(*) AS total FROM countries`);
    console.log(`\n✅ Database saat ini memiliki ${countRes.rows[0].total} negara.`);

    // 4. Verifikasi relasi Indonesia
    const checkInd = await pool.query(`
      SELECT c.id, c.name, c.iso2, COUNT(p.id) AS province_count
      FROM countries c
      LEFT JOIN provinces p ON p.country_id = c.id
      WHERE c.iso2 = 'ID'
      GROUP BY c.id, c.name, c.iso2
    `);
    console.log('Indonesia status:', checkInd.rows[0]);

    // 5. Verifikasi Jawa Barat
    const jbRes = await pool.query(`
      SELECT p.id, p.name, COUNT(c.id) AS city_count
      FROM provinces p
      JOIN cities c ON c.province_id = p.id
      WHERE p.country_id = $1 AND p.name = 'Jawa Barat'
      GROUP BY p.id, p.name
    `, [indonesiaIdInDataset]);
    console.log('Jawa Barat status:', jbRes.rows[0]);

  } catch (err) {
    console.error('Error during country seeding:', err);
    throw err;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('seedAllCountries.js')) {
  seedAllCountries()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
