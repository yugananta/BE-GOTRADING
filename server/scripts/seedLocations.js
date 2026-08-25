// server/scripts/seedLocations.js
//
// Isi tabel countries/provinces/cities (lihat sql/07_locations_schema.sql)
// dari file JSON statis di data/locations/. Jalankan SEKALI setelah
// migrasi SQL dijalankan, dan ulangi tiap kali data/locations/*.json
// ditambah (aman dijalankan berkali-kali -- pakai upsert).
//
// Cara pakai:
//   node server/scripts/seedLocations.js
//
// CATATAN: dataset bawaan di data/locations/ saat ini masih sangat minim
// (baru 1 negara/provinsi/kota, hasil copy dari frontend AI Studio yang
// juga belum lengkap -- lihat data/locations/states/ID.json). Tambahkan
// file JSON lain dengan format yang sama (satu file per kode negara di
// states/, satu file per province id di cities/) untuk melengkapi.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../integrations/supabase/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'locations');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

async function seedCountries() {
  const countries = readJson(path.join(DATA_DIR, 'countries.json'));
  const rows = countries.map((c) => ({
    id: c.id, name: c.name, iso2: c.iso2, iso3: c.iso3 || null,
    phonecode: c.phonecode ? String(c.phonecode) : null, currency: c.currency || null, emoji: c.emoji || null,
  }));
  const { error } = await supabase.from('countries').upsert(rows, { onConflict: 'id' });
  if (error) throw error;
  console.log(`✓ ${rows.length} negara`);
}

async function seedProvinces() {
  const dir = path.join(DATA_DIR, 'states');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  let total = 0;
  for (const file of files) {
    const provinces = readJson(path.join(dir, file));
    const rows = provinces.map((p) => ({ id: p.id, country_id: p.country_id, name: p.name }));
    if (rows.length === 0) continue;
    const { error } = await supabase.from('provinces').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
    total += rows.length;
  }
  console.log(`✓ ${total} provinsi (${files.length} file negara)`);
}

async function seedCities() {
  const dir = path.join(DATA_DIR, 'cities');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  let total = 0;
  for (const file of files) {
    const cities = readJson(path.join(dir, file));
    const rows = cities.map((c) => ({ id: c.id, province_id: c.state_id ?? c.province_id, name: c.name }));
    if (rows.length === 0) continue;
    const { error } = await supabase.from('cities').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
    total += rows.length;
  }
  console.log(`✓ ${total} kota (${files.length} file provinsi)`);
}

async function main() {
  await seedCountries();
  await seedProvinces();
  await seedCities();
  console.log('Selesai.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed lokasi gagal:', err);
  process.exit(1);
});
