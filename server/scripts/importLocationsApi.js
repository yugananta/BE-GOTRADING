import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { DIRECT_URL } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GEONAMES_USERNAME = process.env.GEONAMES_USERNAME || 'demo';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let nextCountryId = 1;
let nextProvinceId = 1;
let nextCityId = 1;

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      return await res.json();
    } catch (err) {
      if (i === retries - 1) throw err;
      await delay(600);
    }
  }
}

async function fetchGeonamesCountries() {
  const url = `http://api.geonames.org/countryInfoJSON?username=${GEONAMES_USERNAME}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.geonames) {
      throw new Error(data?.status?.message || 'GeoNames error');
    }
    return data.geonames;
  } catch {
    console.warn('GeoNames API error/limit reached. Using static fallback for countries...');
    const staticPath = path.join(__dirname, '..', '..', 'data', 'locations', 'countries.json');
    if (fs.existsSync(staticPath)) {
      return JSON.parse(fs.readFileSync(staticPath, 'utf-8')).map(c => ({
        countryName: c.name, countryCode: c.iso2, isoAlpha3: c.iso3, phone: c.phonecode, currencyCode: c.currency
      }));
    }
    return [];
  }
}

async function fetchGeonamesProvinces(iso2) {
  const url = `http://api.geonames.org/searchJSON?country=${iso2}&featureCode=ADM1&maxRows=1000&username=${GEONAMES_USERNAME}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return data.geonames || [];
  } catch {
    return [];
  }
}

async function fetchGeonamesCities(iso2) {
  const url = `http://api.geonames.org/searchJSON?country=${iso2}&featureCode=ADM2&maxRows=1000&username=${GEONAMES_USERNAME}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return data.geonames || [];
  } catch {
    return [];
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

async function runImport() {
  console.log('Memulai import lokasi...');
  const pool = new pg.Pool({ connectionString: DIRECT_URL });
  let totalCountries = 0, totalProvinces = 0, totalCities = 0;

  try {
    // Siapkan kolom & tabel
    await pool.query(`ALTER TABLE provinces ADD COLUMN IF NOT EXISTS source_id TEXT;`);
    await pool.query(`ALTER TABLE cities ADD COLUMN IF NOT EXISTS source_id TEXT;`);
    await pool.query(`ALTER TABLE cities ADD COLUMN IF NOT EXISTS original_type TEXT;`);

    // Reset tabel
    await pool.query(`TRUNCATE TABLE countries, provinces, cities CASCADE;`);

    const gnCountries = await fetchGeonamesCountries();
    for (const c of gnCountries) {
      const countryId = nextCountryId++;
      await pool.query(
        `INSERT INTO countries (id, name, iso2, iso3, phonecode, currency) VALUES ($1, $2, $3, $4, $5, $6)`,
        [countryId, c.countryName, c.countryCode, c.isoAlpha3, c.phone || '', c.currencyCode || '']
      );
      totalCountries++;

      if (c.countryCode === 'ID') {
        console.log('  -> Memproses INDONESIA via emsifa/api-wilayah-indonesia (Kemendagri)...');
        const idProvinces = await fetchWithRetry('https://emsifa.github.io/api-wilayah-indonesia/api/provinces.json');
        
        for (const p of idProvinces) {
          const provinceId = nextProvinceId++;
          const provName = formatProvinceName(p.name);
          await pool.query(
            `INSERT INTO provinces (id, country_id, name, source_id) VALUES ($1, $2, $3, $4)`,
            [provinceId, countryId, provName, String(p.id)]
          );
          totalProvinces++;

          const idCities = await fetchWithRetry(`https://emsifa.github.io/api-wilayah-indonesia/api/regencies/${p.id}.json`);
          const cityMap = new Map();

          for (const city of idCities) {
            const { cleanName, isKota, originalType } = cleanRegencyName(city.name);

            if (cityMap.has(cleanName)) {
              // Jika pasangan Kota + Kabupaten dengan nama sama: simpan Kota, buang Kabupaten
              if (isKota) {
                cityMap.set(cleanName, {
                  source_id: String(city.id),
                  name: cleanName,
                  original_type: 'Kota'
                });
              }
            } else {
              cityMap.set(cleanName, {
                source_id: String(city.id),
                name: cleanName,
                original_type: originalType
              });
            }
          }

          for (const cityData of cityMap.values()) {
            const cityId = nextCityId++;
            await pool.query(
              `INSERT INTO cities (id, province_id, name, source_id, original_type) VALUES ($1, $2, $3, $4, $5)`,
              [cityId, provinceId, cityData.name, cityData.source_id, cityData.original_type]
            );
            totalCities++;
          }
          await delay(100);
        }
      } else {
        console.log(`  -> Memproses ${c.countryName} via GeoNames...`);
        const adm1List = await fetchGeonamesProvinces(c.countryCode);
        const adm2List = await fetchGeonamesCities(c.countryCode);

        const provinceIdMap = {};
        for (const adm1 of adm1List) {
          const provinceId = nextProvinceId++;
          await pool.query(
            `INSERT INTO provinces (id, country_id, name, source_id) VALUES ($1, $2, $3, $4)`,
            [provinceId, countryId, adm1.name, String(adm1.geonameId)]
          );
          provinceIdMap[adm1.adminCode1] = provinceId;
          totalProvinces++;
        }

        for (const adm2 of adm2List) {
          const pId = provinceIdMap[adm2.adminCode1];
          if (!pId) continue;
          const cityId = nextCityId++;
          try {
            await pool.query(
              `INSERT INTO cities (id, province_id, name, source_id, original_type) VALUES ($1, $2, $3, $4, $5)`,
              [cityId, pId, adm2.name, String(adm2.geonameId), 'GeoNames (ADM2)']
            );
            totalCities++;
          } catch (err) {
             if (err.code !== '23505') throw err;
          }
        }
        await delay(300);
      }
    }

    // Constraint Unik
    await pool.query(`ALTER TABLE cities DROP CONSTRAINT IF EXISTS cities_province_name_key;`);
    await pool.query(`ALTER TABLE cities ADD CONSTRAINT cities_province_name_key UNIQUE (province_id, name);`);

    console.log(`\n✅ IMPORT SELESAI! Negara: ${totalCountries}, Provinsi: ${totalProvinces}, Kota: ${totalCities}`);
  } catch (err) {
    console.error('Error saat import:', err);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('importLocationsApi.js')) {
  runImport().then(() => process.exit(0)).catch(() => process.exit(1));
}
