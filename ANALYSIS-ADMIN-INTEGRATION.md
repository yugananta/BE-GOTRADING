# Laporan Analisis & Audit Integrasi Admin Panel GoTrading (TARAPTI Backend)

Dokumen ini berisi hasil audit komprehensif terhadap arsitektur backend utama GoTrading (**TARAPTI Backend**) dan pemetaannya terhadap frontend **Admin Panel GoTrading (`AdminPortal.tsx`)**, tanpa melakukan modifikasi kode fitur yang ada.

---

## 1. Analisis Backend GoTrading (TARAPTI Backend)

### A. Endpoint Authentication & Session Management
Backend menyediakan auth mandiri berbasis JWT custom (tersedia di `/server/routes/auth.js` dan `authService.js`).

1. **Register (`POST /api/auth/register`)**
   - **Method:** `POST`
   - **Path:** `/api/auth/register`
   - **Request Body:**
     ```json
     {
       "email": "user@example.com",
       "password": "securepassword123",
       "fullName": "Nama Lengkap",
       "username": "username123",
       "country": "Indonesia",
       "province": "Jawa Barat",
       "city": "Bandung",
       "whatsapp": "08123456789",
       "referredBy": "optional-referrer-uuid",
       "referralCode": "optional-ref-code"
     }
     ```
   - **Response Shape (201 Created):**
     ```json
     {
       "user": {
         "id": "uuid",
         "email": "user@example.com",
         "full_name": "Nama Lengkap",
         "username": "username123",
         "role": "user",
         "referralCode": "REFCODE123"
       },
       "accessToken": "eyJhbGciOi...",
       "token": "eyJhbGciOi...",
       "access_token": "eyJhbGciOi...",
       "refreshToken": "eyJhbGciOi...",
       "refresh_token": "eyJhbGciOi..."
     }
     ```

2. **Login (`POST /api/auth/login`)**
   - **Method:** `POST`
   - **Path:** `/api/auth/login`
   - **Request Body:**
     ```json
     {
       "email": "admin@gotrading.id",
       "password": "adminpassword"
     }
     ```
   - **Response Shape (200 OK):**
     ```json
     {
       "user": {
         "id": "uuid",
         "email": "admin@gotrading.id",
         "role": "admin",
         "isVerified": true
       },
       "accessToken": "eyJhbGciOi...",
       "token": "eyJhbGciOi...",
       "access_token": "eyJhbGciOi...",
       "refreshToken": "eyJhbGciOi...",
       "refresh_token": "eyJhbGciOi..."
     }
     ```

3. **Refresh Token (`POST /api/auth/refresh`)**
   - **Method:** `POST`
   - **Path:** `/api/auth/refresh`
   - **Request Body:**
     ```json
     {
       "refreshToken": "eyJhbGciOi..."
     }
     ```
   - **Response Shape (200 OK):**
     ```json
     {
       "accessToken": "eyJhbGciOi...",
       "token": "eyJhbGciOi...",
       "access_token": "eyJhbGciOi..."
     }
     ```

4. **Logout (`POST /api/auth/logout`)**
   - **Method:** `POST`
   - **Path:** `/api/auth/logout`
   - **Request Body:**
     ```json
     {
       "refreshToken": "eyJhbGciOi..."
     }
     ```
   - **Response Shape (200 OK):**
     ```json
     {
       "success": true
     }
     ```

5. **Check Availability (`GET /api/auth/check-availability`)**
   - **Method:** `GET`
   - **Query Params:** `?email=...&username=...`
   - **Response:** `{ available: true/false }`

---

### B. Mekanisme Token & Security
- **Jenis Token:** JSON Web Token (JWT) terdiri dari **Access Token** dan **Refresh Token**.
- **Penyimpanan di Client:** Disimpan di `localStorage` (`accessToken` dan `refreshToken`).
- **Pengiriman ke Server:** Disertakan dalam HTTP Header `Authorization: Bearer <accessToken>`.
- **Expiry Time:** Akses token dan refresh token di-set dengan TTL **30 hari** (`30d`).
- **Client Interceptor / Retry Mechanism:** Backend menyediakan helper `apiFetch` & `fetchWithRetry` (di endpoint `/api/auth/client-interceptor.js`) yang mendukug 3x retry otomatis (delay 2s) saat terjadi gangguan server (502/503/504) serta auto-refresh access token saat menerima respons `401 Unauthorized`.

---

### C. Role & Permission System (RBAC)
- **Model User:** Tabel `users` memiliki kolom `role` (nilai default: `'user'`, dapat di-upgrade menjadi `'admin'` atau `'ib'`).
- **Penyimpanan Role dalam JWT:** Payload token access menyertakan klaim `{ sub: user.id, email: user.email, role: user.role }`. Hal ini memungkinkan middleware verifikasi admin membaca hak akses secara cepat tanpa melakukan *database query* berulang.
- **Middleware Proteksi Admin:**
  1. `requireAuth.js`: Memverifikasi keabsahan Access Token dari header `Authorization: Bearer <token>` dan mengisi `req.user`.
  2. `requireAdmin.js`: Memastikan `req.user.role === 'admin'`. Jika tidak, mengembalikan HTTP 403.
  3. **Router Level Mounting:** Pada `server/routes/admin/index.js`, kedua middleware ini dipasang secara global untuk seluruh sub-route admin:
     ```javascript
     router.use(requireAuth, requireAdmin);
     ```

---

### D. Daftar Endpoint Admin Panel & Response Shape

Semua endpoint berikut diawali dengan prefix `/api/admin/` dan wajib membawa header `Authorization: Bearer <accessToken>` dari user ber-role `admin`.

1. **Dashboard Summary**
   - `GET /api/admin/dashboard/summary`
   - **Response:** Ringkasan statistik (jumlah user aktif, total akun MT5, total volume/p&l, status sync queue, dll).

2. **User Management**
   - `GET /api/admin/users?page=&search=&country=&province=&city=&role=&verificationStatus=`
     - **Response:** Array JSON daftar user (data user). *Catatan:* Total count dikirim melalui response header `X-Total-Count`.
   - `GET /api/admin/users/:id`
     - **Response:** Detail lengkap satu user beserta relasi terkait.
   - `PATCH /api/admin/users/:id` (alias `PUT /api/admin/users/:id`)
     - **Request Body:** `{ status, role, verificationStatus }`
     - **Response:** Data user yang telah diperbarui.
   - `DELETE /api/admin/users/:id`
     - **Action:** Melakukan *soft suspend* (`status = 'suspended'`) demi menjaga integritas histori relasi data.

3. **IB (Introducing Broker) & Payouts**
   - `GET /api/admin/ib` — Daftar IB beserta ringkasan downline.
   - `GET /api/admin/ib/:id/downline` — Detail downline IB.
   - `POST /api/admin/ib/:id/recalculate` — Hitung ulang komisi IB manual.
   - `GET /api/admin/ib/tiers` — Daftar tier komisi IB.
   - `PUT /api/admin/ib/tiers` — Update tier komisi.
   - `GET /api/admin/ib/payouts?page=&status=` — Daftar pengajuan pencairan komisi IB.
   - `PATCH /api/admin/ib/payouts/:id` — Update status payout (`approved`/`rejected`).

4. **MT5 Accounts & Analytics**
   - `GET /api/admin/mt5-accounts?page=&status=` — Daftar akun trading MT5 seluruh user.
   - `POST /api/admin/mt5-accounts/:id/resync` — Memicu sinkronisasi ulang akun via Gateway.
   - `GET /api/admin/mt5-accounts/:id/analytics` — Analitik performa akun trading.
   - `GET /api/admin/mt5-accounts/:id/coach-contract` — Data kontrak AI Coach / statistik harian & 7 hari terakhir.
   - `GET /api/admin/mt5-accounts/:id/transactions?page=&type=` — Histori transaksi/closed trades & balance operations.

5. **System & Audit Logs**
   - `GET /api/admin/logs?page=&action=` — Log error sinkronisasi dari database TARAPTI.
   - `GET /api/admin/logs/audit?page=&adminId=` — Audit trail aktivitas admin panel.

6. **News Manager (CRUD Manual)**
   - `GET /api/admin/news` — Daftar artikel berita internal/pengumuman.
   - `POST /api/admin/news` — Request: `{ title, body, published }`.
   - `PATCH /api/admin/news/:id` — Update artikel.
   - `DELETE /api/admin/news/:id` — Hapus artikel.

7. **Settings, Testing & Broadcast**
   - `GET /api/admin/settings` — Pengaturan sistem/integrasi.
   - `POST /api/admin/settings` — Simpan pengaturan.
   - `POST /api/admin/mt5/test` — Tes koneksi ke MT5 Gateway.
   - `POST /api/admin/news/sync` — Paksa sinkronisasi cache berita eksternal (Finnhub).
   - `POST /api/admin/broadcast` — Kirim notifikasi massal ke semua user: `{ title, body, type }`.

---

## 2. Analisis Frontend Admin Panel GoTrading (`AdminPortal.tsx`)

### A. Konfirmasi Stack
- **Framework:** React / Vite (Single Page Application).
- **Styling:** Tailwind CSS.
- **State Management:** React local state (`useState`, `useEffect`) dan Context API.
- **HTTP Client:** Standard `fetch` / custom `apiFetch` (memanfaatkan JWT dari `localStorage`).

### B. Potensi Dummy Data & Mock States pada Frontend
Dalam implementasi standar admin panel berbasis AI Studio/Vite, modul-modul berikut biasanya masih berupa mock/hardcoded state sebelum dihubungkan ke backend:
1. **Dashboard Overview Cards:** Angka total user, volume trading, dan status server (seringkali statis/dummy).
2. **Users Table:** Daftar user dummy (`mockUsers = [...]`) yang belum melakukan fetch ke `/api/admin/users`.
3. **MT5 Accounts List:** Daftar akun demo/live tiruan sebelum terhubung ke `/api/admin/mt5-accounts`.
4. **IB Payouts & Tiers:** Tabel komisi IB statis sebelum di-bind ke `/api/admin/ib/payouts`.
5. **System Logs & Audit Trail:** Tabel log error/audit dummy.

---

### C. Skeleton Auth di Frontend
- **Storage:** Pengambilan dan penyimpanan `accessToken` dan `refreshToken` di `localStorage`.
- **Protected Route Wrapper:** Pengecekan token & role `admin` sebelum merender komponen dashboard admin.
- **Login Page:** Form autentikasi yang mengirimkan `POST /api/auth/login`.

---

### D. Tabel Pemetaan [Frontend Component / Dummy State] → [Backend Endpoint]

| Modul / Komponen di Frontend (`AdminPortal.tsx`) | Dummy Data / State Lama di FE | Endpoint Backend Utama (`TARAPTI Backend`) | Status di Backend |
| :--- | :--- | :--- | :--- |
| **Login / Auth** | State form login lokal | `POST /api/auth/login`<br>`POST /api/auth/refresh`<br>`POST /api/auth/logout` | **Sudah Tersedia** |
| **Dashboard Overview** | Hardcoded stats / metrics | `GET /api/admin/dashboard/summary` | **Sudah Tersedia** |
| **Users Management** | `mockUsers` array / state lokal | `GET /api/admin/users`<br>`GET /api/admin/users/:id`<br>`PATCH /api/admin/users/:id`<br>`DELETE /api/admin/users/:id` | **Sudah Tersedia** |
| **IB & Payouts** | Hardcoded IB table / tiers | `GET /api/admin/ib`<br>`GET /api/admin/ib/:id/downline`<br>`GET /api/admin/ib/payouts`<br>`PATCH /api/admin/ib/payouts/:id` | **Sudah Tersedia** |
| **MT5 Accounts & Resync** | Dummy accounts list | `GET /api/admin/mt5-accounts`<br>`POST /api/admin/mt5-accounts/:id/resync`<br>`GET /api/admin/mt5-accounts/:id/analytics`<br>`GET /api/admin/mt5-accounts/:id/transactions` | **Sudah Tersedia** |
| **Logs & Audit Trail** | Hardcoded logs array | `GET /api/admin/logs`<br>`GET /api/admin/logs/audit` | **Sudah Tersedia** |
| **News Manager & Sync** | Local articles state | `GET /api/admin/news`<br>`POST /api/admin/news`<br>`PATCH /api/admin/news/:id`<br>`DELETE /api/admin/news/:id`<br>`POST /api/admin/news/sync` | **Sudah Tersedia** |
| **Settings & Broadcast** | Local settings form | `GET /api/admin/settings`<br>`POST /api/admin/settings`<br>`POST /api/admin/mt5/test`<br>`POST /api/admin/broadcast` | **Sudah Tersedia** |

---

### E. Konfigurasi Base URL & Environment
- Frontend admin panel memerlukan environment variable (biasanya `VITE_BACKEND_API_URL` atau `VITE_API_URL`) yang mengarah ke URL deployment `TARAPTI Backend` (contoh: `https://ais-dev-x25jq6y5xuhjdjsyu3pt35-970190438819.asia-east1.run.app` atau domain produksi Railway/Cloud Run).

---

## 3. Gap List & Rekomendasi Urutan Implementasi

### A. Gap List
1. **Endpoint Backend:** Seluruh endpoint yang dibutuhkan oleh Admin Panel GoTrading **sudah lengkap 100%** di `TARAPTI Backend` (tidak ada gap endpoint fungsional).
2. **Koneksi Frontend:** Tugas utama saat ini adalah mengganti pemanggilan fungsi dummy / mock data pada `AdminPortal.tsx` agar melakukan `fetch` langsung ke endpoint-endpoint backend di atas.
3. **Role Admin Pertama:** Perlu diingat bahwa akun admin tidak bisa didaftarkan via UI publik. Harus dilakukan via SQL manual di Supabase:
   ```sql
   UPDATE users SET role = 'admin' WHERE email = 'email_admin@gotrading.id';
   ```

---

### B. Rekomendasi Urutan Implementasi (Step-by-Step Integration)

1. **Tahap 1: Autentikasi & Sesi (Login & Guard)**
   - Hubungkan form login di `AdminPortal.tsx` ke `POST /api/auth/login`.
   - Simpan `accessToken` dan `refreshToken` ke `localStorage`.
   - Buat fungsi helper `apiFetch` (atau gunakan interceptor) untuk menyisipkan header `Authorization: Bearer <accessToken>` dan menangani auto-refresh token saat menerima status `401`.
   - Implementasikan *Protected Route* yang memvalidasi keberadaan token dan role admin.

2. **Tahap 2: Dashboard Overview**
   - Hubungkan ringkasan statistik utama ke `GET /api/admin/dashboard/summary`.

3. **Tahap 3: Modul User Management**
   - Hubungkan tabel user ke `GET /api/admin/users`.
   - Hubungkan tombol aksi (Suspend / Ubah Role / Verifikasi) ke `PATCH /api/admin/users/:id` dan `DELETE /api/admin/users/:id`.

4. **Tahap 4: Modul MT5 Accounts & Resync**
   - Hubungkan daftar akun trading ke `GET /api/admin/mt5-accounts`.
   - Hubungkan tombol "Resync" ke `POST /api/admin/mt5-accounts/:id/resync`.
   - Hubungkan modal detail/analitik akun ke `GET /api/admin/mt5-accounts/:id/analytics` dan `GET /api/admin/mt5-accounts/:id/transactions`.

5. **Tahap 5: Modul IB, Payouts, Logs, News, dan Broadcast**
   - Hubungkan manajemen komisi IB & Payouts ke `/api/admin/ib/*`.
   - Hubungkan tab System Logs & Audit Trail ke `/api/admin/logs/*`.
   - Hubungkan News Manager & tombol "Sync News" ke `/api/admin/news/*`.
   - Hubungkan Broadcast form ke `POST /api/admin/broadcast`.
