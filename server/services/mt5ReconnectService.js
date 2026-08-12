// server/services/mt5ReconnectService.js
//
// MONITOR AUTO-RECONNECT MT5
// ---------------------------------------------------------------
// Tujuan: memastikan koneksi akun MT5 TIDAK hilang karena restart/deploy
// backend ataupun restart MT5 Gateway / MT5 terminal di VPS.
//
// Cara kerja (loop interval, aman tanpa infinite loop):
//   1. Ambil semua akun yang credential_saved = true (tersimpan di DB).
//   2. Probe koneksi gateway (GET /account).
//      - Gateway tidak reachable  -> semua akun = RECONNECTING, tunggu.
//      - Gateway reachable & login == akun -> akun = CONNECTED.
//      - Gateway reachable tapi akun bukan sesi aktif -> coba gatewayConnect()
//        memakai credential terenkripsi yang tersimpan.
//   3. Retry memakai exponential backoff (mulai 10 detik, naik 2x tiap
//      gagal, maksimal 10 menit) dan batas MAX_ATTEMPTS sebelum berhenti
//      (menghindari infinite loop). Setelah batas -> status ERROR dan user
//      diminta connect ulang.
//   4. Credential invalid / expired -> status ERROR (tidak retry terus).
//   5. Monitor TIDAK PERNAH menghapus baris account dari database.

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
  // Jitter proporsional supaya tidak terjadi lonjakan retry serentak,
  // namun tetap kecil di konfigurasi test (base backoff kecil).
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

  // Gateway reachable. Proses per akun.
  let hijackedThisCycle = false;
  for (const acc of accounts) {
    const accLogin = Number(acc.akun_id);

    // Sesi aktif gateway cocok dengan akun ini -> CONNECTED.
    if (accLogin === Number(gwState.login)) {
      await setRowStatus(acc.id, {
        conn_status: CONN_STATUS.CONNECTED,
        last_connected_at: new Date(now).toISOString(),
        error_message: null,
        reconnect_attempts: 0,
        next_reconnect_at: null,
      });
      continue;
    }

    // Sudah ERROR -> cek apakah karena auth error atau sudah mencapai batas.
    if (acc.conn_status === CONN_STATUS.ERROR) {
      // Jika auth error (password salah/expired) atau error dekripsi, kita skip permanen.
      const isPermanent = acc.error_message && (
        acc.error_message.includes('Credential MT5 invalid') ||
        acc.error_message.includes('didekripsi')
      );
      if (isPermanent) {
        continue;
      }
      // Jika bukan auth error (misal gateway/broker down), kita batasi retry dengan backoff lambat.
      const nextAt = acc.next_reconnect_at ? new Date(acc.next_reconnect_at).getTime() : 0;
      if (nextAt > now) {
        continue;
      }
      // Jeda sudah lewat -> biarkan loop mencoba menghubungkan lagi!
    }

    // Akun bukan sesi aktif -> tandai sedang reconnect.
    if (acc.conn_status !== CONN_STATUS.RECONNECTING && acc.conn_status !== CONN_STATUS.ERROR) {
      await setRowStatus(acc.id, {
        conn_status: CONN_STATUS.RECONNECTING,
        error_message: 'Sesi MT5 terputus. Mencoba reconnect otomatis...',
      });
    }

    // Batas percobaan tercapai -> ERROR, minta user connect ulang.
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

    // Masih dalam jendela backoff -> tunggu.
    const nextAt = acc.next_reconnect_at ? new Date(acc.next_reconnect_at).getTime() : 0;
    if (nextAt > now) continue;

    // Hindari mengganti sesi aktif berkali-kali dalam satu siklus (single-session gateway).
    if (hijackedThisCycle) continue;

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
        hijackedThisCycle = true;
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
        console.log(`[MT5-RECONNECT] Akun ${acc.akun_id} berhasil terhubung ulang otomatis.`);
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
    // Jalankan saja monitor jika reset awal gagal
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
