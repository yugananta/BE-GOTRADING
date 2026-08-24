# Laporan Struktur Database Lokasi Saat Ini

## 1. Tabel `countries`
- `id` (INT) - Primary Key
- `name` (TEXT)
- `iso2` (TEXT)
- `iso3` (TEXT)
- `phonecode` (TEXT)
- `currency` (TEXT)
- `emoji` (TEXT)

## 2. Tabel `provinces`
- `id` (INT) - Primary Key
- `country_id` (INT) - Foreign Key ke `countries(id)`
- `name` (TEXT)

## 3. Tabel `cities`
- `id` (INT) - Primary Key
- `province_id` (INT) - Foreign Key ke `provinces(id)`
- `name` (TEXT)

## 4. Tabel `users`
Tabel users menyimpan data lokasi sebagai teks biasa (bukan ID foreign key) dengan kolom:
- `country` (TEXT)
- `province` (TEXT)
- `city` (TEXT)

## Rencana Perubahan Skema (Menunggu Konfirmasi)
Sesuai instruksi Anda, saya mengusulkan perubahan skema berikut sebelum menjalankan import data:
1. **Tambah kolom `original_type` (TEXT)** di tabel `cities` untuk menyimpan keterangan asal (contoh: "Kota", "Kabupaten", atau "GeoNames") untuk keperluan audit tanpa ditambahkan ke nama kota yang ditampilkan.
2. **Tambah Constraint Unik** di tabel `cities` untuk kombinasi `(province_id, name)` agar tidak ada duplikasi kota dalam satu provinsi.
3. Karena data GeoNames dan wilayah.id mungkin menghasilkan ID yang berbeda/konflik dengan ID existing, apakah Anda setuju jika **data lama di tabel `cities`, `provinces`, dan `countries` di-TRUNCATE/dihapus** sebelum script import baru dijalankan?

Mohon konfirmasi agar saya dapat langsung mengeksekusi perubahan skema database dan membuat script import (`server/scripts/importLocationsApi.js`) yang akan menarik data dari GeoNames dan wilayah.id.
