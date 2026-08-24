# CHANGELOG Integrasi API GoTrading (Admin Panel & TARAPTI Backend)

Dokumen ini mencatat pembaruan dan standardisasi path endpoint API antara Frontend Admin Panel (`admin.gotrading.id`) dan Backend GoTrading (`TARAPTI Backend`).

---

## [2026-08-22] - Standardisasi Path Auth Endpoint & CORS Whitelist

### 1. Perubahan Path Auth (Penghapusan Prefix Versioning `/v1`)
Backend TARAPTI beroperasi menggunakan base prefix `/api/auth` secara flat tanpa prefix versioning `/v1`. 

Seluruh pemanggilan dari Frontend Admin Panel (`FE-GOTRADING` / `admin.gotrading.id`) disesuaikan ke path berikut:

| Modul / Fungsi | Path Lama (404) | Path Baru (Aktif di BE) | HTTP Method | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| **Login** | `/api/v1/auth/login` | `/api/auth/login` | `POST` | Authenticate user & issue JWT |
| **Refresh Token** | `/api/v1/auth/refresh` | `/api/auth/refresh` | `POST` | Exchange refreshToken with new accessToken |
| **Logout** | `/api/v1/auth/logout` | `/api/auth/logout` | `POST` | Invalidate refreshToken |
| **Register** | `/api/v1/auth/register` | `/api/auth/register` | `POST` | Pendaftaran akun baru |
| **Check Availability** | `/api/v1/auth/check-availability` | `/api/auth/check-availability` | `GET` | Cek email & username |
| **User Profile / Me** | `/api/v1/auth/me` | `/api/auth/me` | `GET` | Ambil data profil user saat ini |

### 2. Modul Lainnya (Audit Prefix API)
- **Modul Admin:** Seluruh endpoint admin di-mount pada prefix `/api/admin/...` (contoh: `/api/admin/dashboard/summary`, `/api/admin/users`, `/api/admin/mt5-accounts`, `/api/admin/ib/*`).
- **Modul MetaTrader:** `/api/metatrader/...`
- **Modul News & Calendar:** `/api/news/...`, `/api/calendar/...`
- **Modul Community & Messages:** `/api/community/...`, `/api/messages/...`
- *Catatan:* String `v1` yang tersisa di backend hanya mengarah ke endpoint pihak ketiga Finnhub (`https://finnhub.io/api/v1/...`) dan penamaan skema internal payload `v1:` pada encryption store / AI coach schema v1.0.

### 3. Pembaruan CORS Whitelist (Backend `server/index.js`)
- Menambahkan whitelist eksplisit untuk:
  - `https://admin.gotrading.id`
  - `https://my.gotrading.id`
  - `https://gotrading.id`
  - Subdomain regex `*.gotrading.id`
  - `http://localhost:3000`, `http://localhost:5173`, `http://localhost:3001`
- Mengaktifkan `credentials: true` dan metode HTTP: `GET, POST, PUT, DELETE, PATCH, OPTIONS`.
- Mengizinkan custom headers termasuk `Authorization`, `Content-Type`, dan `X-Total-Count`.
