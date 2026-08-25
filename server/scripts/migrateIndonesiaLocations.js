import pg from 'pg';
import { DIRECT_URL } from '../config/env.js';

/**
 * Migration & Backfill Script:
 * Updates Indonesia Provinces & Cities from emsifa/api-wilayah-indonesia.
 * 
 * Rules:
 * 1. Fetch provinces from https://emsifa.github.io/api-wilayah-indonesia/api/provinces.json
 * 2. Fetch regencies from https://emsifa.github.io/api-wilayah-indonesia/api/regencies/{province_id}.json
 * 3. Strip "KABUPATEN " or "KOTA " prefix
 * 4. If Kota + Kabupaten with same clean name -> keep only Kota, discard Kabupaten
 * 5. If only one -> keep it (clean name without prefix)
 * 6. Enforce UNIQUE (province_id, name) on cities table
 * 7. Provide kota_kabupaten alias/view for compatibility
 * 8. Keep non-Indonesia countries untouched
 */

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      return await res.json();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 600));
    }
  }
}

function formatProvinceName(rawName) {
  const upper = rawName.trim().toUpperCase();
  if (upper === 'DKI JAKARTA') return 'DKI Jakarta';
  if (upper === 'DI YOGYAKARTA' || upper === 'DAERAH ISTIMEWA YOGYAKARTA') return 'DI Yogyakarta';
  return upper.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function cleanRegencyName(rawName) {
  const upper = rawName.toUpperCase();
  const isKota = upper.startsWith('KOTA ');
  const isKab = upper.startsWith('KABUPATEN ');
  const stripped = upper
    .replace(/^KOTA\s+/, '')
    .replace(/^KABUPATEN\s+/, '')
    .trim();

  const cleanName = stripped.split(' ').map(w => {
    if (/^[IVXLCDM]+$/.test(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');

  return {
    cleanName,
    isKota,
    isKab,
    originalType: isKota ? 'Kota' : isKab ? 'Kabupaten' : 'Kota/Kabupaten'
  };
}

export async function runIndonesiaLocationMigration() {
  console.log('--- Memulai Migrasi Data Lokasi Indonesia (emsifa/api-wilayah-indonesia) ---');
  const pool = new pg.Pool({ connectionString: DIRECT_URL });

  try {
    // 1. Pastikan kolom-kolom pendukung tersedia
    await pool.query(`ALTER TABLE provinces ADD COLUMN IF NOT EXISTS source_id TEXT;`);
    await pool.query(`ALTER TABLE cities ADD COLUMN IF NOT EXISTS source_id TEXT;`);
    await pool.query(`ALTER TABLE cities ADD COLUMN IF NOT EXISTS original_type TEXT;`);

    // 2. Pastikan tabel/view kota_kabupaten ada jika ada query langsung ke nama tersebut
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'kota_kabupaten') THEN
          CREATE VIEW kota_kabupaten AS SELECT * FROM cities;
        END IF;
      END $$;
    `);

    // 3. Cari / pastikan entri negara Indonesia di tabel countries
    let idCountryRes = await pool.query(`SELECT id FROM countries WHERE iso2 = 'ID' LIMIT 1;`);
    let idCountryId;
    if (idCountryRes.rowCount === 0) {
      const maxC = await pool.query(`SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM countries;`);
      idCountryId = maxC.rows[0].next_id;
      await pool.query(
        `INSERT INTO countries (id, name, iso2, iso3, phonecode, currency, emoji) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [idCountryId, 'Indonesia', 'ID', 'IDN', '62', 'IDR', '🇮🇩']
      );
    } else {
      idCountryId = idCountryRes.rows[0].id;
    }

    console.log(`Country ID Indonesia: ${idCountryId}`);

    // 4. Hapus data provinsi dan kota lama khusus Indonesia (sehingga data negara lain tetap aman)
    console.log('Menghapus data provinsi dan kota lama khusus Indonesia...');
    await pool.query(`
      DELETE FROM cities 
      WHERE province_id IN (SELECT id FROM provinces WHERE country_id = $1);
    `, [idCountryId]);

    await pool.query(`
      DELETE FROM provinces 
      WHERE country_id = $1;
    `, [idCountryId]);

    // 5. Fetch 34 Provinsi dari emsifa
    console.log('Mengunduh data provinsi dari emsifa API...');
    const rawProvinces = await fetchWithRetry('https://emsifa.github.io/api-wilayah-indonesia/api/provinces.json');
    console.log(`Ditemukan ${rawProvinces.length} provinsi.`);

    // Dapatkan next province_id dan next city_id
    const maxP = await pool.query(`SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM provinces;`);
    let nextProvinceId = maxP.rows[0].next_id;

    const maxCt = await pool.query(`SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM cities;`);
    let nextCityId = maxCt.rows[0].next_id;

    let totalInsertedProvinces = 0;
    let totalInsertedCities = 0;

    for (const rawProv of rawProvinces) {
      const provinceId = nextProvinceId++;
      const provName = formatProvinceName(rawProv.name);

      await pool.query(
        `INSERT INTO provinces (id, country_id, name, source_id) VALUES ($1, $2, $3, $4)`,
        [provinceId, idCountryId, provName, String(rawProv.id)]
      );
      totalInsertedProvinces++;

      // Fetch Regencies (Kota & Kabupaten)
      const rawRegencies = await fetchWithRetry(`https://emsifa.github.io/api-wilayah-indonesia/api/regencies/${rawProv.id}.json`);
      const cityMap = new Map();

      for (const r of rawRegencies) {
        const { cleanName, isKota, originalType } = cleanRegencyName(r.name);

        if (cityMap.has(cleanName)) {
          // Jika sudah ada (misal Kabupaten Bogor sudah masuk, lalu ada Kota Bogor),
          // Sesuai requirement: "simpan cuma yang Kota, buang yang Kabupaten"
          if (isKota) {
            cityMap.set(cleanName, {
              source_id: String(r.id),
              name: cleanName,
              original_type: 'Kota'
            });
          }
        } else {
          cityMap.set(cleanName, {
            source_id: String(r.id),
            name: cleanName,
            original_type: originalType
          });
        }
      }

      // Masukkan hasil kota/kabupaten bersih ke database
      for (const city of cityMap.values()) {
        const cityId = nextCityId++;
        await pool.query(
          `INSERT INTO cities (id, province_id, name, source_id, original_type) VALUES ($1, $2, $3, $4, $5)`,
          [cityId, provinceId, city.name, city.source_id, city.original_type]
        );
        totalInsertedCities++;
      }
    }

    // 6. Pasang constraint UNIQUE (province_id, name)
    console.log('Menyiapkan constraint unik pada tabel cities (province_id, name)...');
    await pool.query(`ALTER TABLE cities DROP CONSTRAINT IF EXISTS cities_province_name_key;`);
    await pool.query(`ALTER TABLE cities ADD CONSTRAINT cities_province_name_key UNIQUE (province_id, name);`);

    console.log('\n✅ MIGRASI SELESAI!');
    console.log(`   Total Provinsi Indonesia di-insert: ${totalInsertedProvinces}`);
    console.log(`   Total Kota/Kabupaten Indonesia di-insert: ${totalInsertedCities}`);

    // 7. Validasi Jawa Barat
    const jbRes = await pool.query(`
      SELECT c.name, c.original_type 
      FROM cities c 
      JOIN provinces p ON c.province_id = p.id 
      WHERE p.country_id = $1 AND p.name = 'Jawa Barat'
      ORDER BY c.name;
    `, [idCountryId]);

    console.log(`\nValidasi Jawa Barat (${jbRes.rowCount} item):`);
    console.log(jbRes.rows.map(r => `${r.name} (${r.original_type})`).join(', '));

    const forbiddenKecamatan = ['Rajapolah', 'Singaparna', 'Banjaran', 'Caringin'];
    const invalidFound = jbRes.rows.filter(r => forbiddenKecamatan.some(k => r.name.toLowerCase() === k.toLowerCase()));
    if (invalidFound.length > 0) {
      console.error('❌ PERINGATAN: Masih ditemukan kecamatan:', invalidFound);
    } else {
      console.log('✅ Validasi lolos: Tidak ada kecamatan (Rajapolah, Singaparna, Banjaran, Caringin) yang masuk sebagai kota!');
    }

  } catch (err) {
    console.error('Error saat migrasi:', err);
    throw err;
  } finally {
    await pool.end();
  }
}

// Jalankan jika dieksekusi langsung
if (process.argv[1] && process.argv[1].endsWith('migrateIndonesiaLocations.js')) {
  runIndonesiaLocationMigration()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
