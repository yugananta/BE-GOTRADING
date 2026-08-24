# tarapti-backend

Backend mandiri TARAPTI -- dipanggil oleh DUA frontend terpisah:
- **User app** (AI Studio) lewat `FRONTEND_URL` / `/api/auth`, `/api/accounts`, `/api/news`
- **Admin panel** (AI Studio project terpisah) lewat `ADMIN_FRONTEND_URL` / `/api/admin/*`

## Struktur

    server/
      index.js                 <- entry point (app.listen)
      config/env.js              <- SATU pintu semua environment variable
      integrations/
        supabase/client.js        (data registrasi: users, user_mt5_accounts, news)
        mt5-gateway/client.js      (HTTP ke TARAPTI Gateway -- operasi TULIS)
        tarapti-db/pool.js         (koneksi READ-ONLY ke DB TARAPTI -- laporan/analitik)
        news/client.js              (Finnhub -- berita forex/pasar)
      services/
        authService.js             (register, login, refresh -- role disertakan di JWT)
        accountService.js          (hubungkan akun MT5 user biasa)
        dashboardService.js        (ringkasan angka utk dashboard admin)
        userAdminService.js        (kelola user: list, detail, suspend/verifikasi)
        ibService.js               (daftar IB + downline)
        mt5AdminService.js         (daftar akun MT5, resync, analitik, transaksi)
        auditService.js            (catat & baca audit log admin)
        logsService.js             (baca log error sync dari DB TARAPTI)
        newsAdminService.js        (CRUD berita manual admin)
        newsService.js             (untuk end-user, cache 30 menit di news_cache)
        calendarService.js         (economic calendar, cache 6 jam, fallback ke earnings calendar)
        communityService.js        (chat grup per kota/provinsi, MVP polling)
      routes/
        auth.js, accounts.js, news.js      <- untuk user app
        news.js, calendar.js, community.js  <- untuk user app
        admin/index.js                      <- mount semua sub-route admin,
                                                WAJIB login + role='admin'
        admin/{dashboard,users,ib,mt5Accounts,logs,news}.js
      middleware/
        requireAuth.js    (verifikasi JWT)
        requireAdmin.js   (cek role === 'admin')

    sql/
      00_backend_tables.sql    <- users, user_mt5_accounts, news_cache
      01_admin_schema.sql      <- role, referred_by, ib_region, verification_status,
                                   status, admin_audit_log, news_posts
      02_community_chat.sql    <- community_groups, community_messages
      03_calendar_cache.sql    <- tambah kolom cache_key ke news_cache

    GATEWAY_ADDENDUM_resync.py  <- endpoint yang HARUS ditambahkan ke
                                    repo tarapti-mt5-gateway (app.py),
                                    BUKAN bagian dari backend ini

## Cara pakai

    npm install
    cp .env.example .env      # isi semua nilai
    # jalankan sql/00_backend_tables.sql lalu sql/01_admin_schema.sql di Supabase
    npm start

Sudah dites: `npm install` + `npm start` boot sukses, endpoint `/health`,
proteksi admin (401 tanpa token), dan error handling (400 rapi, bukan
crash) sudah dicoba dan berfungsi -- dengan nilai .env dummy. Tetap wajib
kamu tes ulang dengan .env asli.

## Jadi admin pertama kali

Tidak ada endpoint API untuk self-promote ke admin (sengaja, demi
keamanan). Setelah register user biasa lewat `/api/auth/register`,
jalankan manual di Supabase SQL Editor:

    UPDATE users SET role = 'admin' WHERE email = 'email_kamu@contoh.com';

## Endpoint user app (butuh header `Authorization: Bearer <accessToken>`, kecuali register/login)

    POST /api/auth/register
    POST /api/auth/login
    POST /api/auth/refresh

    POST /api/accounts
    GET  /api/accounts/:akunId/status

    GET  /api/news                              (Finnhub, cache 30 menit di Supabase)
    GET  /api/calendar                          (economic calendar, cache 6 jam, fallback earnings)

    GET  /api/community/groups?country=&province=
    POST /api/community/groups/resolve            { country, province, city }
    GET  /api/community/groups/:groupId/messages?since=&page=
    POST /api/community/groups/:groupId/messages   { body }

## Endpoint admin yang sudah jadi (semua butuh header
## `Authorization: Bearer <accessToken>` milik user ber-role admin)

    GET  /api/admin/dashboard/summary

    GET  /api/admin/users?page=&search=&country=&province=&city=&role=&verificationStatus=
    GET  /api/admin/users/:id
    PATCH /api/admin/users/:id          { status, role, verificationStatus }

    GET  /api/admin/ib
    GET  /api/admin/ib/:id/downline

    GET  /api/admin/mt5-accounts?page=&status=
    POST /api/admin/mt5-accounts/:id/resync
    GET  /api/admin/mt5-accounts/:id/analytics
    GET  /api/admin/mt5-accounts/:id/transactions?page=&type=

    GET  /api/admin/logs?page=&action=
    GET  /api/admin/logs/audit?page=&adminId=

    GET    /api/admin/news
    POST   /api/admin/news       { title, body, published }
    PATCH  /api/admin/news/:id
    DELETE /api/admin/news/:id

## Troubleshooting -- crash loop karena DNS/koneksi gagal

Kalau di log Railway (atau hosting manapun) muncul error berulang-ulang
seperti `TypeError: fetch failed` / `getaddrinfo ENOTFOUND ...supabase.co`
dan container terus restart (crash loop), ini SUDAH diperbaiki di kode
ini (lihat `integrations/supabase/client.js` -- `autoRefreshToken: false`)
dan ada jaring pengaman tambahan di `index.js`
(`process.on('unhandledRejection', ...)`), supaya error apapun yang lolos
tidak lagi mematikan seluruh proses.

Tapi kalau errornya masih soal hostname Supabase tidak ketemu (`ENOTFOUND`),
itu bukan bug di kode -- cek dulu:
1. Value `SUPABASE_URL` di dashboard hosting kamu (Railway/Render Variables),
   pastikan tidak ada typo/huruf tertukar, dan sudah di-redeploy setelah diedit.
2. Kalau kamu punya lebih dari satu service/environment di hosting-nya,
   pastikan variable diedit di environment yang sedang aktif.

## PENTING -- baca sebelum deploy

0. **MT5 PERSISTENCE & AUTO-RECONNECT (BARU):**
   - `sql/13_mt5_persistence.sql` otomatis menambah kolom `password_enc`,
     `credential_saved`, `conn_status`, dll di `user_mt5_accounts`. Jalankan
     sekali di Supabase SQL Editor (atau biarkan auto-migrasi production).
   - **`GATEWAY_ADDENDUM_reconnect.py` WAJIB ditempel ke repo
     `tarapti-mt5-gateway` (app.py)** supaya backend bisa memerintahkan gateway
     login ulang memakai credential tersimpan. Tanpa ini, koneksi tetap
     terdeteksi putus (RECONNECTING) tapi gateway belum bisa auto-connect.
   - Set `MT5_CREDENTIAL_ENCRYPTION_KEY` (32-byte base64) di Railway. Kalau
     belum diset, sistem memakai turunan `JWT_ACCESS_SECRET` sebagai fallback.
   - Status koneksi: `connected` | `reconnecting` | `disconnected` | `error`.
     User TIDAK perlu login ulang saat backend/MT5 Gateway restart.

1. **`GATEWAY_ADDENDUM_resync.py` wajib ditempel ke repo `tarapti-mt5-gateway`**
   (app.py) dulu, sebelum tombol "Resync" di admin panel bisa jalan --
   endpoint itu belum ada di gateway yang sudah kamu deploy sebelumnya.

2. **`TARAPTI_DB_*` idealnya pakai user PostgreSQL read-only terpisah**,
   bukan user yang sama dengan yang dipakai `worker_v3.py` untuk menulis.
   Contoh perintah SQL-nya ada di komentar `.env.example`. Ini mencegah
   bug di admin panel tidak sengaja bisa menulis/merusak data sync.

3. **`mt5AdminService.js` membaca 2 sumber data sekaligus**: TARAPTI DB
   (akun, fetch_queue, closed_trades, balance_operations, equity_snapshots,
   logs) dan Supabase (buat lampirkan email pemilik akun). Kalau salah
   satu koneksi database ini belum terisi benar di .env, endpoint terkait
   akan error -- cek /health dan log server kalau ada masalah.

4. **Role `admin` TIDAK BISA didapat lewat API** -- satu-satunya jalan
   lewat SQL manual di Supabase (lihat bagian "Jadi admin pertama kali").
   Jangan buat endpoint self-promote, itu lubang keamanan besar.

5. **Community chat pakai polling, BUKAN Supabase Realtime langsung dari
   frontend.** Alasan: auth kita custom JWT, bukan Supabase Auth, jadi RLS
   berbasis `auth.uid()` Supabase tidak otomatis berlaku ke sesi user kita.
   Kalau nanti perlu upgrade ke real-time, tambah WebSocket server di
   backend ini (`ws` library) yang broadcast INSERT baru -- skema tidak
   perlu berubah.

6. Endpoint `/api/admin/news` (CRUD manual) BEDA dengan `/api/news`
   (untuk end-user, sudah pakai Finnhub) -- jangan
   ketuker pas sambungkan ke frontend.
