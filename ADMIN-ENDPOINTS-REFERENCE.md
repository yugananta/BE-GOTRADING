# Referensi Lengkap Endpoint Admin & Terkait (TARAPTI Backend)

Dokumen ini berisi daftar lengkap seluruh endpoint yang terdaftar di backend GoTrading untuk kebutuhan **Admin Panel** (`admin.gotrading.id`), mencakup modul admin (`/api/admin/*`), monitoring (`/metrics`, `/health`), MetaTrader (`/api/metatrader/*`), dan IB self-service (`/api/ib/*`).

Seluruh endpoint di bawah `/api/admin/*` diproteksi secara global oleh middleware `requireAuth` dan `requireAdmin` (wajib menyertakan header `Authorization: Bearer <accessToken>` dengan role `admin`).

---

## 1. Dashboard Summary & Statistik

| Method | Path | Handler Function | Deskripsi Singkat |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/admin/dashboard/summary` | `getDashboardSummary` | Mengambil ringkasan statistik: total user, total akun MT5, status antrean sinkronisasi (`fetch_queue`), dan tren registrasi 7 hari terakhir. |

---

## 2. User Management (Pengguna & Hak Akses)

| Method | Path | Handler Function | Deskripsi Singkat |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/admin/users` | `listUsers` | Mengambil daftar user dengan filter (`search`, `country`, `province`, `city`, `role`, `verificationStatus`) & pagination. Total count dikirim melalui header `X-Total-Count`. |
| `GET` | `/api/admin/users/:id` | `getUserDetail` | Mengambil detail lengkap user tertentu beserta daftar akun MT5 yang terhubung dan riwayat referral-nya. |
| `PATCH` | `/api/admin/users/:id` | `updateUser`, `logAdminAction` | Mengubah status akun (`active`/`suspended`), role (`user`/`admin`/`ib`), atau status verifikasi identitas user. |
| `PUT` | `/api/admin/users/:id` | `updateUser`, `logAdminAction` | Alias `PUT` untuk pembaruan profil/status/role user dari Admin Panel. |
| `DELETE` | `/api/admin/users/:id` | `suspendUser`, `logAdminAction` | Melakukan *soft suspend* (`status = 'suspended'`) terhadap user agar relasi data (post, comment, trade history) tetap terjaga. |

---

## 3. MT5 & Trading Accounts Management

| Method | Path | Handler Function | Deskripsi Singkat |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/admin/mt5-accounts` | `listMt5Accounts` | Mengambil daftar akun MT5 dari TARAPTI DB dengan filter status antrean sync, balance, equity, dan email pemilik akun. |
| `POST` | `/api/admin/mt5-accounts/:id/resync` | `resyncAccount`, `logAdminAction` | Memaksa status sinkronisasi akun MT5 menjadi `pending` via endpoint `/resync` pada MT5 Gateway. |
| `GET` | `/api/admin/mt5-accounts/:id/analytics` | `getAccountAnalytics` | Mengambil metrik analitik trading akun (total posisi, win rate %, net profit, peak equity, max drawdown %, dan equity curve). |
| `GET` | `/api/admin/mt5-accounts/:id/coach-contract` | `getCoachContract` | Mengambil data kontrak metrik AI Coach (schema v1.0) untuk periode hari ini (`today`) dan 7 hari terakhir (`last_7_days`: Sharpe ratio, Exposure %, Max DD, Win Rate). |
| `GET` | `/api/admin/mt5-accounts/:id/transactions` | `getAccountTransactions` | Mengambil histori mutasi balance operations (deposit, withdrawal, credit) untuk akun MT5 tertentu. |

---

## 4. Finance & Payouts (Komisi IB)

| Method | Path | Handler Function | Deskripsi Singkat |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/admin/ib/payouts` | `listPayouts` | Mengambil daftar permohonan pencairan dana komisi dari seluruh IB dengan filter status (`pending`, `paid`, `rejected`). |
| `PATCH` | `/api/admin/ib/payouts/:id` | `updatePayoutStatus` | Menyetujui (`paid`) atau menolak (`rejected`) pengajuan pencairan dana IB, mencatat admin pemroses, dan memperbarui status komisi terkait. |

---

## 5. IB (Introducing Broker) & Partners Management

| Method | Path | Handler Function | Deskripsi Singkat |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/admin/ib` | `listIbs` | Mengambil daftar seluruh user ber-role `ib`, kode referral, region, tier, serta jumlah downline aktif masing-masing. |
| `GET` | `/api/admin/ib/:id/downline` | `getIbDownline` | Mengambil daftar akun user (downline) yang mendaftar menggunakan referral milik IB tertentu. |
| `POST` | `/api/admin/ib/:id/recalculate` | `calculateCommissionsForIb` | Memicu kalkulasi ulang komisi IB secara manual berdasarkan volume trading (lot) seluruh downline yang valid. |
| `GET` | `/api/admin/ib/tiers` | `listTiers` | Mengambil daftar tier komisi IB (nama tier, rate per lot, minimum syarat). |
| `PUT` | `/api/admin/ib/tiers` | `upsertTier` | Menambah atau memperbarui konfigurasi tier dan rate komisi per lot untuk program kemitraan IB. |

---

## 6. Integrations & External Feeds

| Method | Path | Handler Function | Deskripsi Singkat |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/admin/mt5/test` | `testMt5Connection` | Menguji konektivitas jaringan dan integritas API Key ke server MT5 Gateway VPS (`/health`). |
| `POST` | `/api/admin/news/sync` | `refreshNewsCache`, `logAdminAction` | Memaksa pembaruan cache berita pasar forex secara instan dari provider eksternal (Finnhub API). |

---

## 7. News & Internal Announcements Manager (CRUD)

| Method | Path | Handler Function | Deskripsi Singkat |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/admin/news` | `listNewsPosts` | Mengambil daftar artikel berita/pengumuman internal yang dibuat secara manual oleh admin. |
| `POST` | `/api/admin/news` | `createNewsPost` | Membuat artikel berita atau pengumuman internal baru (`title`, `body`, `published`). |
| `PATCH` | `/api/admin/news/:id` | `updateNewsPost` | Memperbarui isi, judul, atau status publikasi artikel berita internal. |
| `DELETE` | `/api/admin/news/:id` | `deleteNewsPost` | Menghapus artikel berita atau pengumuman internal dari database. |

---

## 8. Logs & Audit Trail

| Method | Path | Handler Function | Deskripsi Singkat |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/admin/logs` | `listSyncLogs` | Mengambil catatan error dan aktivitas worker sinkronisasi dari tabel `logs` di database TARAPTI. |
| `GET` | `/api/admin/logs/audit` | `listAuditLog` | Mengambil rekam jejak audit (*audit trail*) atas semua aksi yang dilakukan oleh admin di portal admin. |

---

## 9. Global Settings

| Method | Path | Handler Function | Deskripsi Singkat |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/admin/settings` | `getSettings` | Mengambil konfigurasi global sistem (default server MT5, API keys, konfigurasi Telegram bot, FCM server key, openAccountUrl). |
| `POST` | `/api/admin/settings` | `saveSettings`, `logAdminAction` | Menyimpan dan memperbarui konfigurasi global integrasi pada tabel singleton `admin_settings` (termasuk `openAccountUrl`). |
| `GET` | `/api/settings/public` | `getPublicSettings` | Endpoint publik untuk mengambil pengaturan umum yang aman (seperti `openAccountUrl`) tanpa auth admin. |

---

## 10. Marketing & Notifications Broadcast

| Method | Path | Handler Function | Deskripsi Singkat |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/admin/broadcast` | `sendBroadcast`, `logAdminAction` | Mengirim pesan notifikasi massal (tipe `market_pulse` atau pengumuman) ke seluruh pengguna terdaftar secara *batching*. |

---

## 11. System Health & Monitoring Endpoints

| Method | Path | Handler Function | Deskripsi Singkat |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Inline handler | Healthcheck dasar instance server Express (`{ "status": "ok" }`). |
| `GET` | `/metrics` | `register.metrics` | Prometheus Metrics Exporter (scrape metrik antrean `fetch_queue`, status worker, snapshot size, dan durasi request HTTP). |

---

## 12. Modul MetaTrader & IB (User Endpoints Terkait)

Sebagai referensi komparasi antara endpoint sisi Admin dan sisi Client/User:

| Modul | Method | Path | Handler Function | Deskripsi Singkat |
| :--- | :--- | :--- | :--- | :--- |
| **MT5 (User)** | `GET` | `/api/metatrader/account` | `getMyAccount` / `listMyAccounts` | Mengambil data akun MT5 aktif milik user yang sedang login. |
| **MT5 (User)** | `POST` | `/api/metatrader/connect` | `connectMyAccount` | Menghubungkan akun trading MT5 baru (login, password, server, broker). |
| **MT5 (User)** | `POST` | `/api/metatrader/disconnect` | `disconnectMyAccount` | Memutuskan tautan akun MT5 dari sistem. |
| **MT5 (User)** | `POST` | `/api/metatrader/sync` | `syncMyAccount` | Meminta sinkronisasi ulang data akun trading milik user. |
| **MT5 (User)** | `POST` | `/api/metatrader/reconnect` | `runReconnectCycle` | Memicu siklus koneksi ulang otomatis untuk akun MT5 yang terputus. |
| **MT5 (User)** | `GET` | `/api/metatrader/trades` | `listMyTrades` | Mengambil riwayat closed trades milik user. |
| **MT5 (User)** | `GET` | `/api/metatrader/positions` | `listMyPositions` | Mengambil posisi terbuka (*open positions*) real-time dari MT5 Gateway. |
| **MT5 (User)** | `GET` | `/api/metatrader/deals` | `listMyDeals` | Mengambil histori transaksi deal real-time dari MT5 Gateway. |
| **MT5 (User)** | `GET` | `/api/metatrader/orders` | `listMyOrders` | Mengambil daftar pending orders real-time dari MT5 Gateway. |
| **IB (Self)** | `GET` | `/api/ib/me` | `getIbProfile` | Mengambil ringkasan saldo komisi, tier, rate, dan downline aktif milik IB yang sedang login. |
| **IB (Self)** | `GET` | `/api/ib/me/commissions` | `listMyCommissions` | Mengambil riwayat rincian komisi per trade milik IB yang sedang login. |
| **IB (Self)** | `POST` | `/api/ib/me/recalculate` | `calculateCommissionsForIb` | Memicu hitung ulang komisi mandiri dari trade downline. |
| **IB (Self)** | `POST` | `/api/ib/me/payout-request` | `requestPayout` | Mengajukan permohonan penarikan saldo komisi IB. |
