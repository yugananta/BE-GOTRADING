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
const rawJwtSecret = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
if (!rawJwtSecret) {
  throw new Error('[FATAL ERROR] Environment variable JWT_SECRET or JWT_ACCESS_SECRET is not configured! Enforcing fail-fast.');
}
export const JWT_ACCESS_SECRET = rawJwtSecret;
export const JWT_SECRET = rawJwtSecret; // Alias untuk kompatibilitas jika dipanggil dengan nama JWT_SECRET

const rawRefreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET_KEY;
if (!rawRefreshSecret) {
  throw new Error('[FATAL ERROR] Environment variable JWT_REFRESH_SECRET or JWT_REFRESH_SECRET_KEY is not configured! Enforcing fail-fast.');
}
export const JWT_REFRESH_SECRET = rawRefreshSecret;

// --- MT5 Gateway API (TARAPTI, repo terpisah) - dipakai untuk WRITE/READ:
// daftar akun baru, trigger resync, stateless data requests
const rawGatewayUrl = (
  process.env.MT5_GATEWAY_URL ||
  process.env.GATEWAY_URL ||
  process.env.MT5GW_BASE_URL ||
  process.env.MT5_GATEWAY_BASE_URL ||
  process.env.MT5GW_URL ||
  process.env.GATEWAY_BASE_URL ||
  'http://localhost:8000'
).trim().replace(/\/+$/, '');
export const MT5_GATEWAY_URL = rawGatewayUrl;
export const MT5GW_BASE_URL = rawGatewayUrl;
const rawGatewayApiKey = (
  process.env.MT5_GATEWAY_API_KEY ||
  process.env.MT5GW_API_KEY ||
  process.env.GATEWAY_API_KEY ||
  process.env.API_KEY ||
  'tarapti-gateway-secret'
).trim();
export const MT5_GATEWAY_API_KEY = rawGatewayApiKey;
export const MT5GW_API_KEY = rawGatewayApiKey;

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
if (!process.env.TARAPTI_DB_HOST) {
  throw new Error('[FATAL ERROR] TARAPTI_DB_HOST is not set');
}
export const TARAPTI_DB_HOST = process.env.TARAPTI_DB_HOST;

export const TARAPTI_DB_PORT = process.env.TARAPTI_DB_PORT ? Number(process.env.TARAPTI_DB_PORT) : 5432;

if (!process.env.TARAPTI_DB_USER) {
  throw new Error('[FATAL ERROR] TARAPTI_DB_USER is not set');
}
export const TARAPTI_DB_USER = process.env.TARAPTI_DB_USER;

if (!process.env.TARAPTI_DB_PASSWORD) {
  throw new Error('[FATAL ERROR] TARAPTI_DB_PASSWORD is not set');
}
export const TARAPTI_DB_PASSWORD = process.env.TARAPTI_DB_PASSWORD;

if (!process.env.TARAPTI_DB_NAME) {
  throw new Error('[FATAL ERROR] TARAPTI_DB_NAME is not set');
}
export const TARAPTI_DB_NAME = process.env.TARAPTI_DB_NAME;

// --- News API ---
export const NEWS_API_KEY = optional('NEWS_API_KEY');
export const NEWS_BASE_URL = optional('NEWS_BASE_URL');

// Tambah integrasi API baru nanti? Tambahkan konstanta env-nya DI SINI
// dulu (prefix nama service-nya), baru dipakai di
// server/integrations/<nama-service>/client.js
