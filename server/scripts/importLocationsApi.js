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

async function fetchGeonamesCountries() {
  const url = `http://api.geonames.org/countryInfoJSON?username=${GEONAMES_USERNAME}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.geonames) {
    console.warn('GeoNames API error/limit reached. Using static fallback for countries...');
    const staticPath = path.join(__dirname, '..', '..', 'data', 'locations', 'countries.json');
    if (fs.existsSync(staticPath)) {
      return JSON.parse(fs.readFileSync(staticPath, 'utf-8')).map(c => ({
        countryName: c.name, countryCode: c.iso2, isoAlpha3: c.iso3, phone: c.phonecode, currencyCode: c.currency
      }));
    }
    return [];
  }
  return data.geonames;
}

async function fetchGeonamesProvinces(iso2) {
  const url = `http://api.geonames.org/searchJSON?country=${iso2}&featureCode=ADM1&maxRows=1000&username=${GEONAMES_USERNAME}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.geonames || [];
}

async function fetchGeonamesCities(iso2) {
  const url = `http://api.geonames.org/searchJSON?country=${iso2}&featureCode=ADM2&maxRows=1000&username=${GEONAMES_USERNAME}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.geonames || [];
}

async function fetchWilayahIdProvinces() {
  const res = await fetch('https://wilayah.id/api/provinces.json');
  const data = await res.json();
  return data.data || [];
}

async function fetchWilayahIdCities(provinceCode) {
  const res = await fetch(`https://wilayah.id/api/regencies/${provinceCode}.json`);
  const data = await res.json();
  return data.data || [];
}

async function runImport() {
  console.log('Memulai import lokasi...');
  const pool = new pg.Pool({ connectionString: DIRECT_URL });
  let totalCountries = 0, totalProvinces = 0, totalCities = 0;

  try {
    const gnCountries = await fetchGeonamesCountries();
    // Proses semua yang didapat (jika pakai demo mungkin cuma fallback, jika pakai real akan dapat semua)
    for (const c of gnCountries) {
      const countryId = nextCountryId++;
      await pool.query(
        `INSERT INTO countries (id, name, iso2, iso3, phonecode, currency) VALUES ($1, $2, $3, $4, $5, $6)`,
        [countryId, c.countryName, c.countryCode, c.isoAlpha3, c.phone || '', c.currencyCode || '']
      );
      totalCountries++;

      if (c.countryCode === 'ID') {
        console.log('  -> Memproses INDONESIA via wilayah.id...');
        const idProvinces = await fetchWilayahIdProvinces();
        for (const p of idProvinces) {
          const provinceId = nextProvinceId++;
          await pool.query(
            `INSERT INTO provinces (id, country_id, name, source_id) VALUES ($1, $2, $3, $4)`,
            [provinceId, countryId, p.name, p.code]
          );
          totalProvinces++;

          const idCities = await fetchWilayahIdCities(p.code);
          const cityMap = new Map();
          for (const city of idCities) {
            let originalType = '';
            let cleanName = city.name.toUpperCase();
            if (cleanName.startsWith('KOTA ')) {
              originalType = 'Kota';
              cleanName = cleanName.replace('KOTA ', '').trim();
            } else if (cleanName.startsWith('KABUPATEN ')) {
              originalType = 'Kabupaten';
              cleanName = cleanName.replace('KABUPATEN ', '').trim();
            }
            // Title Case
            cleanName = cleanName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

            if (cityMap.has(cleanName)) {
              const existing = cityMap.get(cleanName);
              existing.original_type = existing.original_type + '/' + originalType;
            } else {
              cityMap.set(cleanName, { source_id: city.code, original_type: originalType });
            }
          }

          for (const [name, cityData] of cityMap.entries()) {
            const cityId = nextCityId++;
            await pool.query(
              `INSERT INTO cities (id, province_id, name, source_id, original_type) VALUES ($1, $2, $3, $4, $5)`,
              [cityId, provinceId, name, cityData.source_id, cityData.original_type]
            );
            totalCities++;
          }
          await delay(200);
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
        await delay(500);
      }
    }
    console.log(`\n✅ IMPORT SELESAI! Negara: ${totalCountries}, Provinsi: ${totalProvinces}, Kota: ${totalCities}`);
  } catch (err) {
    console.error('Error saat import:', err);
  } finally {
    await pool.end();
  }
}
runImport();
