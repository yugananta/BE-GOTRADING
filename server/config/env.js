// server/config/env.js
//
// SATU pintu untuk semua environment variable di seluruh backend.
// File lain WAJIB import dari sini, jangan panggil process.env langsung.

import 'dotenv/config';

function required(name, fallback = '') {
  const value = process.env[name];
  if (!value) {
    if (fallback) return fallback;
    console.warn(`[ENV WARN] Environment variable ${name} belum diisi.`);
    return fallback;
  }
  return value;
}

function optional(name, fallback = null) {
  return process.env[name] || fallback;
}

export const PORT = Number(process.env.PORT || 3000);
export const FRONTEND_URL = optional('FRONTEND_URL', '*'); // batasi ini di production, jangan biarkan '*'
export const ADMIN_FRONTEND_URL = optional('ADMIN_FRONTEND_URL', '*'); // URL admin panel (AI Studio project terpisah)

// --- Supabase (data registrasi/auth: users, user_mt5_accounts, news) ---
export const SUPABASE_URL = required('SUPABASE_URL', 'https://mock.supabase.co');
export const SUPABASE_SERVICE_ROLE_KEY = required('SUPABASE_SERVICE_ROLE_KEY', 'mock-service-role-key');
export const DIRECT_URL = optional('DIRECT_URL', '');

// --- Auth (JWT custom) ---
// SELALU dibaca dari environment variable Railway yang FIXED (JWT_SECRET / JWT_ACCESS_SECRET / JWT_REFRESH_SECRET).
// Kunci ini TIDAK BOLEH digenerate secara acak saat startup Node.js.
const rawJwtSecret = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || 'tarapti-jwt-access-secret-32-chars';
export const JWT_ACCESS_SECRET = rawJwtSecret;
export const JWT_SECRET = rawJwtSecret; // Alias untuk kompatibilitas jika dipanggil dengan nama JWT_SECRET
export const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET_KEY || rawJwtSecret;

// --- MT5 Gateway API (TARAPTI, repo terpisah) - dipakai untuk WRITE:
// daftar akun baru, trigger resync
export const MT5_GATEWAY_URL = required('MT5_GATEWAY_URL', 'http://localhost:8000');
export const MT5GW_BASE_URL = MT5_GATEWAY_URL;
export const MT5GW_API_KEY = optional('MT5GW_API_KEY', '');

// --- Kunci enkripsi credential MT5 (AES-256-GCM) ---
// 32-byte base64 atau hex 64-char. WAJIB stabil antar restart/deploy,
// jika hilang semua password_enc yang tersimpan tidak bisa didekripsi.
// Fallback otomatis ke turunan JWT_ACCESS_SECRET bila belum diset.
export const MT5_CREDENTIAL_ENCRYPTION_KEY = optional('MT5_CREDENTIAL_ENCRYPTION_KEY', '');

// --- TARAPTI Database - koneksi READ-ONLY langsung, dipakai untuk
// laporan/analitik admin panel (closed_trades, balance_operations,
// equity_snapshots, logs) supaya tidak perlu hit HTTP API satu-satu
// untuk data tabular besar. REKOMENDASI: buat DB user PostgreSQL
// terpisah dengan hak akses SELECT saja untuk kredensial ini.
export const TARAPTI_DB_HOST = required('TARAPTI_DB_HOST', 'localhost');
export const TARAPTI_DB_PORT = optional('TARAPTI_DB_PORT', 5432);
export const TARAPTI_DB_USER = required('TARAPTI_DB_USER', 'postgres');
export const TARAPTI_DB_PASSWORD = required('TARAPTI_DB_PASSWORD', 'postgres');
export const TARAPTI_DB_NAME = optional('TARAPTI_DB_NAME', 'mt5_trading');

// --- News API ---
export const NEWS_API_KEY = optional('NEWS_API_KEY');
export const NEWS_BASE_URL = optional('NEWS_BASE_URL');

// Tambah integrasi API baru nanti? Tambahkan konstanta env-nya DI SINI
// dulu (prefix nama service-nya), baru dipakai di
// server/integrations/<nama-service>/client.js
