-- tarapti-backend - Data lokasi (negara/provinsi/kota) untuk dropdown
-- registrasi & filter komunitas. Sebelumnya data ini cuma ada sebagai file
-- JSON statis di frontend (src/data/countries.json, src/data/states/*.json,
-- src/data/cities/*.json) plus mock array hardcoded di LocationRepository.ts
-- frontend. Sekarang jadi tabel di database, diisi lewat
-- scripts/seedLocations.js (lihat file itu untuk cara pakai).

CREATE TABLE IF NOT EXISTS countries (
    id INT PRIMARY KEY,          -- pakai id yang sama dengan dataset sumber
    name TEXT NOT NULL,
    iso2 TEXT NOT NULL,
    iso3 TEXT,
    phonecode TEXT,
    currency TEXT,
    emoji TEXT
);

CREATE TABLE IF NOT EXISTS provinces (
    id INT PRIMARY KEY,
    country_id INT NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
    name TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_provinces_country ON provinces (country_id);

CREATE TABLE IF NOT EXISTS cities (
    id INT PRIMARY KEY,
    province_id INT NOT NULL REFERENCES provinces(id) ON DELETE CASCADE,
    name TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cities_province ON cities (province_id);
