// server/integrations/mt5-gateway/client.js
//
// Client tipis untuk manggil TARAPTI MT5 Gateway API (app.py, repo terpisah
// tarapti-mt5-gateway). Gateway live saat ini adalah jembatan SATU sesi MT5
// (satu akun broker yang terhubung di VPS) dan expose endpoint sebagai
// berikut (diverifikasi via GET /openapi.json, gateway v0.1.0):
//
//   GET /account                       -> profil + balance/equity/margin akun
//   GET /positions                     -> posisi terbuka
//   GET /orders                        -> order pending
//   GET /trades                        -> riwayat trade (open + closed)
//   GET /deals                         -> riwayat deal lengkap (dengan waktu)
//   GET /symbol/{symbol}               -> quote bid/ask sebuah simbol
//   POST /order                        -> buka order (BELUM dipakai)
//   POST /close/{ticket}               -> tutup posisi (BELUM dipakai)
//
// CATATAN INTEGRASI (hasil audit):
//   - Gateway TIDAK punya endpoint /accounts, /accounts/{id}/status, maupun
//     /accounts/{id}/resync. Endpoint resync TIDAK ada -> JANGAN manggilnya.
//     "Refresh/sync" di sisi backend cukup dengan memanggil ulang GET /account
//     dan GET /trades (data gateway selalu real-time dari terminal MT5).
//   - Gateway live TIDAK memakai x-api-key (openapi tanpa security scheme).
//     Header tetap dikirim kalau MT5GW_API_KEY diisi, untuk kompatibilitas
//     bila di depan gateway ada proxy yang mewajibkannya.

import { MT5_GATEWAY_URL, MT5GW_API_KEY } from '../../config/env.js';
import {
  SYNC_DURATION,
  SYNC_SUCCESS_TOTAL,
  SYNC_ERRORS_TOTAL,
  GATEWAY_REQUEST_DURATION,
} from '../../monitoring/metrics.js';

export class MT5GatewayError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'MT5GatewayError';
    this.status = status;
    this.body = body;
  }
}

async function request(path, { method = 'GET', body, timeout = 15000 } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const startedAt = process.hrtime.bigint();

  const recordDuration = () => {
    const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    GATEWAY_REQUEST_DURATION.labels(path).observe(seconds);
    if (method === 'POST') SYNC_DURATION.observe(seconds);
  };

  const recordSyncError = (errorType) => {
    if (method === 'POST' || method === 'GET') {
      SYNC_ERRORS_TOTAL.labels({ error_type: errorType }).inc();
    }
  };

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (MT5GW_API_KEY) headers['x-api-key'] = MT5GW_API_KEY;

    const res = await fetch(`${MT5_GATEWAY_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    clearTimeout(id);

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (!res.ok) {
      recordDuration();
      recordSyncError(`http_${res.status}`);
      throw new MT5GatewayError(
        data?.detail || `MT5 Gateway error (HTTP ${res.status})`,
        res.status,
        data
      );
    }
    recordDuration();
    SYNC_SUCCESS_TOTAL.inc();
    return data;
  } catch (err) {
    clearTimeout(id);
    if (err.name === 'AbortError') {
      recordDuration();
      recordSyncError('gateway_timeout');
      const timeoutErr = new Error('Koneksi ke MT5 Gateway timeout');
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    if (err.message && (err.message.includes('fetch failed') || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND')) {
      recordDuration();
      recordSyncError('gateway_unavailable');
      const connErr = new Error('MT5 Gateway tidak tersedia atau tidak dapat dihubungi');
      connErr.status = 503;
      throw connErr;
    }
    throw err;
  }
}

// Sesuai GET /account di app.py (profil + balance akun sesi gateway)
export function getAccount(timeout = 15000) {
  return request('/account', { timeout });
}

// Sesuai GET /positions di app.py
export function getPositions() {
  return request('/positions');
}

// Sesuai GET /orders di app.py
export function getOrders() {
  return request('/orders');
}

// Sesuai GET /trades di app.py (riwayat trade, open + closed)
export function getTrades() {
  return request('/trades');
}

// Sesuai GET /deals di app.py (riwayat deal, berisi waktu eksekusi)
export function getDeals() {
  return request('/deals');
}

// Sesuai GET /symbol/{symbol} di app.py
export function getSymbol(symbol) {
  return request(`/symbol/${encodeURIComponent(symbol)}`);
}

// ---------------------------------------------------------------------------
// MT5 PERSISTENCE & AUTO-RECONNECT
// ---------------------------------------------------------------------------
// Endpoint berikut TIDAK boleh dipanggil langsung oleh Frontend. Dipakai
// oleh backend untuk mendeteksi koneksi terputus dan memaksa gateway
// reconnect memakai credential yang tersimpan di database.
//
// Endpoint /connect & /disconnect di gateway diimplementasikan lewat
// GATEWAY_ADDENDUM_reconnect.py (lihat file tersebut).

// Probe ringan kondisi koneksi gateway. TIDAK pernah throw: kembalikan
// { reachable, login, account, error } supaya pemanggil bisa memutuskan
// status CONNECTED / RECONNECTING / DISCONNECTED / ERROR.
export async function getGatewayState() {
  try {
    const account = await getAccount(3000);
    return {
      reachable: true,
      login: account && account.login != null ? Number(account.login) : null,
      account,
      error: null,
    };
  } catch (err) {
    if (err instanceof MT5GatewayError) {
      return { reachable: true, login: null, account: null, error: err };
    }
    return { reachable: false, login: null, account: null, error: err };
  }
}

// Perintahkan gateway untuk login/reconnect ke akun MT5 tertentu.
// Body mengikuti GATEWAY_ADDENDUM_reconnect.py. Timeout lebih panjang
// karena login MT5 bisa memakan waktu.
export async function gatewayConnect({ login, server, password, broker }) {
  return request('/connect', {
    method: 'POST',
    body: {
      login: parseInt(login, 10),
      password: password,
      password_investor: password,
      server: server,
      broker: broker || (server ? server.split('-')[0] : 'Axi'),
    },
    timeout: 30000,
  });
}

// Perintahkan gateway melepas sesi MT5 yang aktif (dipakai saat user
// sengaja disconnect).
export async function gatewayDisconnect() {
  return request('/disconnect', { method: 'POST', timeout: 15000 });
}

// Perintahkan gateway untuk memaksa status akun 'pending' di fetch_queue.
export async function gatewayResync(akunId) {
  return request(`/accounts/${Number(akunId)}/resync`, { method: 'POST', timeout: 15000 });
}

// Normalisasi respons /connect dari berbagai bentuk (addendum yang
// menyesuaikan versi gateway). Mengembalikan login akun yang aktif, atau null.
export function normalizeConnectResult(res) {
  if (!res) return null;
  const login = res.login ?? res.account?.login ?? res.akun_id ?? null;
  return login != null ? Number(login) : null;
}
