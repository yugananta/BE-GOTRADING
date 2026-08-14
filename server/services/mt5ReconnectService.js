// server/services/mt5ReconnectService.js
//
// MONITOR AUTO-RECONNECT MT5 (STATELESS GATEWAY)
// ---------------------------------------------------------------
// Tujuan: memastikan kredensial akun MT5 tersinkronisasi dan status koneksi
// selalu akurat saat gateway/terminal MT5 di VPS mengalami restart.
//
// Cara kerja (loop interval, sequential queue):
//   1. Ambil semua akun yang credential_saved = true (tersimpan di DB).
//   2. Probe kesehatan gateway (GET /health).
//      - Gateway tidak reachable -> semua akun = RECONNECTING.
//   3. Untuk tiap akun dengan credential:
//      - Dekripsi password investor.
//      - Kirim POST /connect ke gateway.
//      - Jika sukses -> status CONNECTED & update snapshot.
//      - Jika auth error (401/invalid user) -> status ERROR (tidak retry terus).
//      - Jika transient error (504/502) -> status RECONNECTING dengan exponential backoff.

import { supabase } from '../integrations/supabase/client.js';
import {
  getGatewayState,
  gatewayConnect,
  normalizeConnectResult,
} from '../integrations/mt5-gateway/client.js';
import { decryptPassword } from './mt5CredentialStore.js';
import { MT5_LOGIN_FAILURES } from '../monitoring/metrics.js';

export const CONN_STATUS = {
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
};

// Nilai bisa di-tweak lewat env (dipakai test otomasi & tuning production).
const MAX_ATTEMPTS = Number(process.env.MT5_RECONNECT_MAX_ATTEMPTS || 8);
const BASE_BACKOFF_MS = Number(process.env.MT5_RECONNECT_BASE_BACKOFF_MS || 10_000);
const MAX_BACKOFF_MS = Number(process.env.MT5_RECONNECT_MAX_BACKOFF_MS || 10 * 60 * 1000);
const MONITOR_INTERVAL_MS = Number(process.env.MT5_RECONNECT_INTERVAL_MS || 60_000);

let timer = null;
let cycleRunning = false;

function isAuthError(err) {
  if (!err) return false;
  if (err.status === 401) return true;
  const msg = String(err.message || err.body?.detail || '').toLowerCase();
  return /login|password|credential|invalid|authentication|invalid_user_or_password/i.test(msg);
}

function backoffDelay(attempt) {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, Math.min(Math.max(attempt - 1, 0), 8)));
  const jitter = Math.min(exp, 1000) * 0.5 * Math.random();
  return Math.round(exp + jitter);
}

async function setRowStatus(id, patch) {
  const { error } = await supabase
    .from('user_mt5_accounts')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    console.error('[MT5-RECONNECT] Gagal update status akun:', error.message);
  }
}

export async function runReconnectCycle() {
  const { data: rows, error } = await supabase.from('user_mt5_accounts').select('*');
  if (error) {
    console.error('[MT5-RECONNECT] Gagal mengambil daftar akun:', error.message);
    return;
  }

  const accounts = (rows || []).filter(
    (r) => r.credential_saved === true && r.conn_status !== 'disconnected' && Number(r.akun_id) >= 1_000_000
  );
  if (accounts.length === 0) return;

  const gwState = await getGatewayState();
  const now = Date.now();

  // Gateway tidak bisa dihubungi -> semua akun ber-credential masuk RECONNECTING.
  if (!gwState.reachable) {
    for (const acc of accounts) {
      if (acc.conn_status !== CONN_STATUS.RECONNECTING) {
        await setRowStatus(acc.id, {
          conn_status: CONN_STATUS.RECONNECTING,
          error_message: 'MT5 Gateway tidak dapat dihubungi. Menunggu koneksi kembali...',
        });
      }
    }
    return;
  }

  // Gateway reachable. Proses akun secara sequential queue.
  for (const acc of accounts) {
    const accLogin = Number(acc.akun_id);

    // Sudah ERROR -> cek apakah karena auth error permanen
    if (acc.conn_status === CONN_STATUS.ERROR) {
      const isPermanent = acc.error_message && (
        acc.error_message.includes('Credential MT5 invalid') ||
        acc.error_message.includes('didekripsi')
      );
      if (isPermanent) {
        continue;
      }
      const nextAt = acc.next_reconnect_at ? new Date(acc.next_reconnect_at).getTime() : 0;
      if (nextAt > now) {
        continue;
      }
    }

    // Jika akun sudah CONNECTED dan terakhir terkoneksi masih wajar (kurang dari interval x 2),
    // kita tidak perlu re-authenticate setiap menit untuk menghemat beban queue gateway
    if (acc.conn_status === CONN_STATUS.CONNECTED && acc.last_connected_at) {
      const lastConnected = new Date(acc.last_connected_at).getTime();
      if (now - lastConnected < MONITOR_INTERVAL_MS * 2) {
        continue;
      }
    }

    // Batas percobaan tercapai -> ERROR
    const attempts = Number(acc.reconnect_attempts || 0);
    if (attempts >= MAX_ATTEMPTS && acc.conn_status !== CONN_STATUS.ERROR) {
      await setRowStatus(acc.id, {
        conn_status: CONN_STATUS.ERROR,
        reconnect_attempts: attempts,
        next_reconnect_at: new Date(now + backoffDelay(attempts)).toISOString(),
        error_message: 'Gagal reconnect otomatis setelah beberapa percobaan. Silakan hubungkan ulang akun Anda.',
      });
      continue;
    }

    // Masih dalam jendela backoff -> tunggu
    const nextAt = acc.next_reconnect_at ? new Date(acc.next_reconnect_at).getTime() : 0;
    if (nextAt > now) continue;

    const password = decryptPassword(acc.password_enc);
    if (!password) {
      await setRowStatus(acc.id, {
        conn_status: CONN_STATUS.ERROR,
        error_message: 'Credential tersimpan tidak dapat didekripsi. Silakan hubungkan ulang akun Anda.',
      });
      continue;
    }

    try {
      const res = await gatewayConnect({
        login: String(accLogin),
        server: acc.server,
        password,
        broker: acc.broker,
      });
      const connectedLogin = normalizeConnectResult(res);
      if (connectedLogin && connectedLogin === accLogin) {
        await setRowStatus(acc.id, {
          conn_status: CONN_STATUS.CONNECTED,
          last_connected_at: new Date(now).toISOString(),
          error_message: null,
          reconnect_attempts: 0,
          next_reconnect_at: null,
          snapshot: {
            ...(acc.snapshot || {}),
            account: res?.account || res,
            fetched_at: new Date(now).toISOString(),
          },
        });
        console.log(`[MT5-RECONNECT] Akun ${acc.akun_id} berhasil diverifikasi di gateway.`);
      } else {
        const a = Math.min(attempts + 1, MAX_ATTEMPTS);
        await setRowStatus(acc.id, {
          conn_status: a >= MAX_ATTEMPTS ? CONN_STATUS.ERROR : CONN_STATUS.RECONNECTING,
          reconnect_attempts: a,
          next_reconnect_at: new Date(now + backoffDelay(a)).toISOString(),
          error_message: a >= MAX_ATTEMPTS
            ? 'Gagal terhubung ke broker/gateway (batas percobaan tercapai). Mencoba kembali secara berkala...'
            : 'Gateway merespons tapi sesi belum aktif. Akan dicoba lagi.',
        });
      }
    } catch (err) {
      const a = Math.min(attempts + 1, MAX_ATTEMPTS);
      if (isAuthError(err)) {
        try {
          MT5_LOGIN_FAILURES.labels({ akun_id: String(accLogin) }).inc();
        } catch (e) {}
        await setRowStatus(acc.id, {
          conn_status: CONN_STATUS.ERROR,
          reconnect_attempts: a,
          error_message: 'Credential MT5 invalid atau sudah kedaluwarsa. Silakan hubungkan ulang akun Anda.',
        });
      } else {
        await setRowStatus(acc.id, {
          conn_status: a >= MAX_ATTEMPTS ? CONN_STATUS.ERROR : CONN_STATUS.RECONNECTING,
          reconnect_attempts: a,
          next_reconnect_at: new Date(now + backoffDelay(a)).toISOString(),
          error_message: a >= MAX_ATTEMPTS
            ? 'Gagal terhubung ke broker/gateway (batas percobaan tercapai). Mencoba kembali secara berkala...'
            : (err.message || 'Gagal reconnect. Akan dicoba lagi.'),
        });
      }
    }
  }
}

async function resetReconnectAttemptsOnStartup() {
  try {
    const { data: rows, error } = await supabase
      .from('user_mt5_accounts')
      .select('id, conn_status, error_message, credential_saved');
    if (error) throw error;

    for (const acc of rows || []) {
      const isPermanent = acc.error_message && (
        acc.error_message.includes('Credential MT5 invalid') ||
        acc.error_message.includes('didekripsi')
      );
      if (acc.conn_status === CONN_STATUS.ERROR && isPermanent) {
        continue;
      }
      const nextStatus = acc.credential_saved ? CONN_STATUS.RECONNECTING : acc.conn_status;
      await supabase
        .from('user_mt5_accounts')
        .update({
          reconnect_attempts: 0,
          next_reconnect_at: null,
          conn_status: nextStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', acc.id);
    }
    console.log('[MT5-RECONNECT] Reset status reconnect untuk startup selesai.');
  } catch (err) {
    console.error('[MT5-RECONNECT] Gagal reset status reconnect saat startup:', err.message);
  }
}

export function startReconnectMonitor() {
  if (process.env.NODE_ENV === 'test') {
    console.log('[MT5-RECONNECT] Mode test, monitor otomatis tidak dijalankan.');
    return null;
  }
  if (timer) return timer;
  console.log('[MT5-RECONNECT] Monitor auto-reconnect dimulai.');

  const tick = async () => {
    if (cycleRunning) return;
    cycleRunning = true;
    try {
      await runReconnectCycle();
    } catch (err) {
      console.error('[MT5-RECONNECT] Siklus monitor error:', err.message);
    } finally {
      cycleRunning = false;
    }
  };

  resetReconnectAttemptsOnStartup().then(() => {
    tick();
    timer = setInterval(tick, MONITOR_INTERVAL_MS);
    timer.unref?.();
  }).catch((err) => {
    console.error('[MT5-RECONNECT] Gagal inisialisasi startup monitor:', err.message);
    tick();
    timer = setInterval(tick, MONITOR_INTERVAL_MS);
    timer.unref?.();
  });

  return timer;
}

export function stopReconnectMonitor() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function getMonitorInterval() {
  return MONITOR_INTERVAL_MS;
}

