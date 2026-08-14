// server/integrations/mt5-gateway/client.js
//
// Client untuk TARAPTI MT5 Gateway API (stateless, sequential queue).
// Semua endpoint data query menggunakan metode POST dengan body JSON
// kredensial { login, password, server, broker } dan header X-API-Key.
//
// Endpoint yang didukung:
//   POST /connect                      -> verifikasi login / connect akun MT5
//   POST /account                      -> profil + balance/equity/margin akun
//   POST /positions                    -> posisi terbuka akun
//   POST /orders                       -> order pending akun
//   POST /trades                       -> riwayat trade (open + closed)
//   POST /deals                        -> riwayat deal lengkap (dengan waktu)
//   POST /symbol/{symbol}              -> quote bid/ask sebuah simbol
//   POST /disconnect                   -> lepas sesi (opsional)
//   GET  /health                       -> probe liveness gateway

import { MT5_GATEWAY_URL, MT5_GATEWAY_API_KEY, MT5GW_API_KEY } from '../../config/env.js';
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

export function formatCredentialsBody(credentials, additional = {}) {
  if (!credentials) return additional;
  const rawLogin = credentials.login ?? credentials.akun_id ?? credentials.akunId;
  const cleanLogin = rawLogin != null ? parseInt(String(rawLogin).trim(), 10) : undefined;
  const plainPassword = String(credentials.password ?? credentials.password_investor ?? credentials.passwordInvestor ?? '');
  const cleanServer = String(credentials.server ?? '').trim();
  const cleanBroker = String(credentials.broker ?? '').trim() || (cleanServer ? cleanServer.split('-')[0] : 'Axi');
  return {
    login: cleanLogin,
    password: plainPassword,
    password_investor: plainPassword,
    server: cleanServer,
    broker: cleanBroker,
    ...additional,
  };
}

async function request(path, { method = 'POST', body, timeout = 30000 } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const startedAt = process.hrtime.bigint();

  const recordDuration = () => {
    const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    GATEWAY_REQUEST_DURATION.labels(path).observe(seconds);
    if (method === 'POST') SYNC_DURATION.observe(seconds);
  };

  const recordSyncError = (errorType) => {
    SYNC_ERRORS_TOTAL.labels({ error_type: errorType }).inc();
  };

  try {
    const headers = { 'Content-Type': 'application/json' };
    const apiKey = (MT5_GATEWAY_API_KEY || MT5GW_API_KEY || '').trim();
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
      headers['x-api-key'] = apiKey;
      headers['api-key'] = apiKey;
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const res = await fetch(`${MT5_GATEWAY_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : (method === 'POST' ? '{}' : undefined),
      signal: controller.signal,
    });
    clearTimeout(id);

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      recordDuration();
      recordSyncError(`http_${res.status}`);

      if (res.status === 401) {
        console.error(`[MT5-GATEWAY] 401 Unauthorized on ${method} ${path}. Mohon pastikan MT5_GATEWAY_API_KEY di backend persis sama dengan .env di gateway VPS.`);
      }

      if (res.status === 504) {
        const timeoutErr = new Error('Gateway sedang sibuk, coba lagi sebentar');
        timeoutErr.status = 504;
        timeoutErr.body = data;
        throw timeoutErr;
      }

      const detailMsg = data?.detail || data?.message || data?.error || `MT5 Gateway error (HTTP ${res.status})`;
      throw new MT5GatewayError(
        detailMsg,
        res.status,
        data
      );
    }
    recordDuration();
    SYNC_SUCCESS_TOTAL.inc();
    return data;
  } catch (err) {
    clearTimeout(id);
    if (err.name === 'AbortError' || err.status === 504) {
      recordDuration();
      recordSyncError('gateway_timeout');
      const timeoutErr = new Error('Gateway sedang sibuk, coba lagi sebentar');
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

// POST /account (profil + balance/equity akun via kredensial)
export function getAccount(credentials) {
  return request('/account', {
    method: 'POST',
    body: formatCredentialsBody(credentials),
  });
}

// POST /positions (posisi terbuka akun via kredensial)
export function getPositions(credentials) {
  return request('/positions', {
    method: 'POST',
    body: formatCredentialsBody(credentials),
  });
}

// POST /orders (pending orders via kredensial)
export function getOrders(credentials) {
  return request('/orders', {
    method: 'POST',
    body: formatCredentialsBody(credentials),
  });
}

// POST /trades (riwayat trade, open + closed via kredensial)
export function getTrades(credentials) {
  return request('/trades', {
    method: 'POST',
    body: formatCredentialsBody(credentials),
  });
}

// POST /deals (riwayat deal, berisi waktu eksekusi via kredensial)
export function getDeals(credentials) {
  return request('/deals', {
    method: 'POST',
    body: formatCredentialsBody(credentials),
  });
}

// POST /symbol/{symbol}
export function getSymbol(symbol, credentials) {
  return request(`/symbol/${encodeURIComponent(symbol)}`, {
    method: 'POST',
    body: formatCredentialsBody(credentials),
  });
}

// Probe ringan liveness gateway (POST /health dengan fallback GET)
export async function getGatewayHealth() {
  try {
    return await request('/health', { method: 'POST', body: {}, timeout: 5000 });
  } catch (err) {
    if (err.status === 405) {
      return await request('/health', { method: 'GET', timeout: 5000 });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// MT5 PERSISTENCE & AUTO-RECONNECT (STATELESS MODEL)
// ---------------------------------------------------------------------------

// Probe status koneksi gateway untuk akun tertentu (atau health jika tanpa credentials).
export async function getGatewayState(credentials = null) {
  try {
    if (credentials) {
      const account = await getAccount(credentials);
      return {
        reachable: true,
        login: account && account.login != null ? Number(account.login) : Number(credentials.login || credentials.akun_id),
        account,
        error: null,
      };
    }
    const health = await getGatewayHealth();
    return {
      reachable: true,
      login: null,
      account: health,
      error: null,
    };
  } catch (err) {
    return { reachable: false, login: null, account: null, error: err };
  }
}

// Perintahkan gateway untuk login/verifikasi akun MT5 tertentu.
export async function gatewayConnect({ login, server, password, broker }) {
  return request('/connect', {
    method: 'POST',
    body: formatCredentialsBody({ login, server, password, broker }),
    timeout: 30000,
  });
}

// Perintahkan gateway melepas sesi MT5 jika diperlukan.
export async function gatewayDisconnect(credentials = null) {
  return request('/disconnect', {
    method: 'POST',
    body: formatCredentialsBody(credentials),
    timeout: 15000,
  });
}

// Perintahkan gateway untuk trigger resync.
export async function gatewayResync(akunId, credentials = null) {
  return request(`/accounts/${Number(akunId)}/resync`, {
    method: 'POST',
    body: formatCredentialsBody(credentials),
    timeout: 15000,
  });
}

// Normalisasi respons /connect atau /account dari gateway.
export function normalizeConnectResult(res) {
  if (!res) return null;
  const login = res.login ?? res.account?.login ?? res.akun_id ?? res.user_id ?? null;
  return login != null ? Number(login) : null;
}
