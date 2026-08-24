// ============================================================
// gatewayWatchdog.ts — BE-GOTRADING
// ------------------------------------------------------------
// Tujuan: MT5 Gateway (VPS Python) menyimpan sesi login HANYA di
// memory (lihat SESSION di app.py). Begitu gateway/VPS restart,
// sesi itu hilang -> conn_status jadi 'disconnected' dan user
// dipaksa klik "Hubungkan Ulang" manual.
//
// File ini menambal itu: backend yang PROAKTIF mendorong gateway
// login ulang pakai credential terenkripsi yang sudah tersimpan
// di database — user tidak perlu ngapa-ngapain.
//
// Dipanggil dari 2 titik:
//   1. startGatewayWatchdog() saat backend startup (server.ts/index.ts)
//   2. Interval polling di dalam watchdog itu sendiri
// ============================================================

import { decrypt } from './crypto'; // sesuaikan dengan util enkripsi kamu yang sudah ada
import { db } from './db'; // sesuaikan dengan koneksi DB (Supabase client, dsb)

const GATEWAY_URL = process.env.MT5_GATEWAY_URL!; // ex: https://gateway.gotrading.id
const GATEWAY_API_KEY = process.env.MT5_GATEWAY_API_KEY!;
const POLL_INTERVAL_MS = 60_000; // cek tiap 1 menit
const RECONNECT_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000]; // retry gagal makin jarang

let watchdogTimer: NodeJS.Timeout | null = null;
let consecutiveFailures = 0;

async function gatewayFetch(path: string, init?: RequestInit) {
  return fetch(`${GATEWAY_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': GATEWAY_API_KEY,
      ...(init?.headers || {}),
    },
  });
}

/** Ambil status live dari gateway (bukan dari cache DB). */
async function getGatewayLiveStatus(): Promise<{ connected: boolean; login: number | null } | null> {
  try {
    const res = await gatewayFetch('/account');
    if (!res.ok) return null;
    const data = await res.json();
    return { connected: !!data.connected, login: data.login ?? null };
  } catch (err) {
    console.warn('[Watchdog] Gateway unreachable:', (err as Error).message);
    return null;
  }
}

/** Ambil akun yang seharusnya aktif + credential terenkripsi dari DB. */
async function getStoredAccountCredential() {
  // Sesuaikan nama tabel/kolom dengan skema kamu.
  // Asumsi: 1 gateway = 1 sesi aktif (sesuai SESSION global di app.py),
  // jadi ambil akun dengan credential_saved = true yang terakhir dipakai.
  const row = await db.query(
    `SELECT login, server, broker, password_investor_encrypted, conn_status
     FROM mt5_accounts
     WHERE credential_saved = true
     ORDER BY updated_at DESC
     LIMIT 1`
  );
  if (!row || row.length === 0) return null;
  return row[0];
}

async function markStatus(login: string, status: 'reconnecting' | 'connected' | 'error', errorMessage?: string) {
  await db.query(
    `UPDATE mt5_accounts SET conn_status = $1, error_message = $2, updated_at = now() WHERE login = $3`,
    [status, errorMessage || null, login]
  );
}

/** Coba login ulang ke gateway pakai credential tersimpan. */
async function attemptReconnect(): Promise<boolean> {
  const account = await getStoredAccountCredential();
  if (!account) {
    // Tidak ada akun dengan credential tersimpan — memang belum pernah connect,
    // ini valid "not connected", bukan bug.
    return false;
  }

  await markStatus(account.login, 'reconnecting');

  try {
    const password = decrypt(account.password_investor_encrypted);
    const res = await gatewayFetch('/connect', {
      method: 'POST',
      body: JSON.stringify({
        login: account.login,
        password_investor: password,
        server: account.server,
        broker: account.broker,
      }),
    });

    if (res.ok) {
      await markStatus(account.login, 'connected');
      console.log(`[Watchdog] Auto-reconnected MT5 account ${account.login}`);
      consecutiveFailures = 0;
      return true;
    } else {
      const err = await res.json().catch(() => ({}));
      await markStatus(account.login, 'error', err.detail || 'Auto-reconnect gagal');
      console.error(`[Watchdog] Gateway /connect gagal:`, err);
      consecutiveFailures++;
      return false;
    }
  } catch (err) {
    await markStatus(account.login, 'error', 'Gateway tidak bisa dihubungi');
    console.error('[Watchdog] Reconnect error:', err);
    consecutiveFailures++;
    return false;
  }
}

/** Loop utama watchdog — dipanggil berkala. */
async function watchdogTick() {
  const live = await getGatewayLiveStatus();

  if (live === null) {
    // Gateway/VPS mati total — jangan spam log tiap menit, cukup catat.
    console.warn('[Watchdog] Gateway tidak merespons, akan dicoba lagi.');
    return;
  }

  if (live.connected) {
    // Sudah connect, sinkronkan status DB kalau perlu, tidak perlu action.
    consecutiveFailures = 0;
    return;
  }

  // Gateway hidup tapi belum ada sesi MT5 aktif -> coba auto-reconnect.
  const backoffIndex = Math.min(consecutiveFailures, RECONNECT_BACKOFF_MS.length - 1);
  console.log(`[Watchdog] Gateway disconnected, mencoba auto-reconnect (percobaan ke-${consecutiveFailures + 1})...`);
  await attemptReconnect();
  void backoffIndex; // pakai backoffIndex kalau mau jeda dinamis antar-tick, opsional
}

/** Panggil ini SEKALI saat backend startup (index.ts / server.ts). */
export function startGatewayWatchdog() {
  console.log('[Watchdog] MT5 gateway watchdog started.');

  // Langsung coba begitu backend nyala (menutupi kasus backend restart
  // ATAU gateway restart yang kebetulan terjadi bersamaan).
  watchdogTick();

  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = setInterval(watchdogTick, POLL_INTERVAL_MS);
}

export function stopGatewayWatchdog() {
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = null;
}