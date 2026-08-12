// server/services/metatraderService.js
//
// Endpoint MT5 yang dipanggil LANGSUNG oleh user (bukan admin) --
// AppContext.tsx: fetchMetaTraderData, syncMetaTrader, connectBroker,
// disconnectBroker.
//
// ARSITEKTUR (hasil audit integrasi MT5):
//   - MT5 Gateway (app.py) adalah jembatan SATU sesi: satu akun broker yang
//     terhubung di VPS. Data account/positions/trades/orders diambil langsung
//     dan real-time dari gateway (GET /account, GET /trades, dst).
//     >> CATATAN PENTING: karena gateway cuma 1 sesi, hanya SATU akun MT5
//        yang bisa 'live' di satu waktu untuk seluruh sistem. Akun lain akan
//        tetap dalam status 'reconnecting' sampai gateway di-upgrade untuk
//        mendukung multi-session, atau sampai user tersebut yang aktif di
//        gateway.
//   - Supabase `user_mt5_accounts` menyimpan tautan:
//     user_id + akun_id -> snapshot data MT5 + CREDENTIAL TERENKRIPSI
//     (password_enc) supaya sistem bisa auto-reconnect tanpa meminta user
//     login ulang saat backend/MT5 Gateway restart.
//   - PERSYARATAN BISNIS TARAPTI:
//     1. 1 Profile boleh memiliki banyak akun MT5 (1 user -> N akun_id).
//     2. 1 Akun MT5 TIDAK boleh dimiliki banyak profile (akun_id UNIQUE secara global).
//     3. Riwayat transaksi & report bersifat PER AKUN (tidak diakumulasi antar akun).
//
// DB CONSTRAINT YANG DIBUTUHKAN (lihat migration 01_fix_multi_account_constraint.sql):
//   - UNIQUE(user_id, akun_id)  -> user boleh punya banyak baris/akun
//   - UNIQUE(akun_id)           -> 1 akun MT5 cuma boleh dimiliki 1 user manapun
//
// MT5 PERSISTENCE & AUTO-RECONNECT:
//   - connectMyAccount: simpan credential (login + password investor + server)
//     secara TERENKRIPSI di database, lalu verifikasi/terhubungkan ke gateway.
//     Kalau gateway sedang tidak bisa dihubungi, akun tetap tersimpan dengan
//     conn_status = 'reconnecting' dan monitor auto-reconnect akan menyambungkan.
//   - Credential TIDAK pernah dikirim kembali ke Frontend dan TIDAK pernah
//     ditulis di log.
//   - Status koneksi: 'connected' | 'reconnecting' | 'disconnected' | 'error'.

import { supabase } from '../integrations/supabase/client.js';
import {
  getAccount,
  getPositions,
  getOrders,
  getTrades,
  getDeals,
  getGatewayState,
  gatewayConnect,
  gatewayDisconnect,
  normalizeConnectResult,
} from '../integrations/mt5-gateway/client.js';
import { encryptPassword, decryptPassword } from './mt5CredentialStore.js';

const GATEWAY_UNAVAILABLE_MSG = 'MT5 Gateway tidak tersedia atau tidak dapat dihubungi';

// Status koneksi yang dipakai di kolom `conn_status`.
export const CONN_STATUS = {
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
};

function isAuthError(err) {
  if (!err) return false;
  if (err.status === 401) return true;
  const msg = String(err.message || err.body?.detail || '').toLowerCase();
  return /login|password|credential|invalid|authentication|invalid_user_or_password/i.test(msg);
}

async function getMyAkunRow(userId, akunId = null) {
  let query = supabase
    .from('user_mt5_accounts')
    .select('*')
    .eq('user_id', userId);

  if (akunId) {
    query = query.eq('akun_id', Number(akunId));
  } else {
    // Tanpa akunId spesifik: ambil akun paling baru dibuat.
    // NOTE: kalau user punya banyak akun, endpoint yang butuh SATU akun
    // (getMyAccount/listMyTrades/syncMyAccount) sebaiknya SELALU dipanggil
    // dengan akunId eksplisit dari frontend (akun yang sedang dipilih di
    // tab), bukan mengandalkan fallback "akun terbaru" ini.
    query = query.order('created_at', { ascending: false });
  }

  const { data, error } = await query.limit(1).maybeSingle();

  if (error) {
    if (error.code === 'PGRST205') {
      const err = new Error(
        'Tabel user_mt5_accounts belum ada. Jalankan migrasi sql/00_backend_tables.sql di Supabase SQL Editor.'
      );
      err.status = 503;
      throw err;
    }
    throw error;
  }
  return data || null;
}

// Konversi payload GET /account dari gateway ke bentuk yang dipakai FE.
function mapGatewayAccount(gw, stored) {
  const toNum = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const storedConn = stored?.conn_status;
  const connStatus = storedConn
    || (stored?.status === 'connected' ? CONN_STATUS.CONNECTED : CONN_STATUS.DISCONNECTED);
  return {
    // WAJIB: id row Supabase -- dipakai frontend (Account.tsx) untuk
    // handleDisconnect(activeAccount.id) supaya disconnect hanya memutus
    // akun yang dipilih, bukan semua akun user. Tanpa ini, disconnect akan
    // mengirim accountId=undefined dan memutus SEMUA akun sekaligus.
    id: stored?.id ?? null,
    akunId: stored?.akun_id ?? toNum(gw?.login),
    login: String(stored?.akun_id ?? gw?.login ?? ''),
    server: gw?.server ?? stored?.server ?? stored?.snapshot?.requested_server ?? 'Axi-US50-Demo',
    broker: gw?.broker ?? stored?.broker ?? stored?.snapshot?.requested_broker ?? 'Axi',
    platform: stored?.platform || 'MT5',
    accountType: null,
    currency: gw?.currency ?? 'USD',
    leverage: toNum(gw?.leverage || 100),
    status: stored?.status || 'connected',
    conn_status: connStatus,
    error_message: stored?.error_message || null,
    last_connected_at: stored?.last_connected_at || null,
    credential_saved: stored?.credential_saved !== undefined ? Boolean(stored.credential_saved) : false,
    updated_at: stored?.updated_at || null,
    balance: toNum(gw?.balance),
    equity: toNum(gw?.equity),
    profit: toNum(gw?.profit),
    margin: toNum(gw?.margin),
    freeMargin: toNum(gw?.margin_free),
    marginLevel: toNum(gw?.margin_level),
  };
}

// Bangun peta ticket/position -> waktu entry/exit dari GET /deals.
function buildDealTimeline(deals) {
  const byPosition = {};
  for (const d of deals || []) {
    if (!d || d.type === 2) continue; // DEAL_TYPE_BALANCE, bukan trade
    const key = d.position_id || d.order || d.ticket;
    if (!key) continue;
    const ms = d.time_msc || (d.time ? d.time * 1000 : null);
    if (ms == null) continue;
    byPosition[key] = byPosition[key] || {};
    if (d.entry === 0) {
      if (byPosition[key].openTime == null || ms < byPosition[key].openTime) {
        byPosition[key].openTime = ms;
      }
    } else if (d.entry === 1) {
      if (byPosition[key].closeTime == null || ms > byPosition[key].closeTime) {
        byPosition[key].closeTime = ms;
      }
    }
  }
  return byPosition;
}

export async function getMyAccount(userId, akunId = null) {
  const row = await getMyAkunRow(userId, akunId);
  if (!row) return { account: null };

  let gw = null;
  let live = false;
  try {
    const liveGw = await getAccount();
    if (liveGw && Number(liveGw.login) === Number(row.akun_id)) {
      gw = liveGw;
      live = true;
    }
  } catch (err) {
    console.warn('[MT5] Gateway getAccount failed, using saved snapshot:', err.message);
  }

  // Jika gateway belum terhubung ke akun ini, tapi credential tersimpan -> coba reconnect proaktif
  if (!live && row.credential_saved && row.conn_status !== CONN_STATUS.DISCONNECTED && row.conn_status !== CONN_STATUS.ERROR && row.password_enc) {
    try {
      const password = decryptPassword(row.password_enc);
      if (password) {
        const connectRes = await gatewayConnect({
          login: String(row.akun_id),
          server: row.server,
          password,
          broker: row.broker,
        });
        const connectedLogin = normalizeConnectResult(connectRes);
        if (connectedLogin && connectedLogin === Number(row.akun_id)) {
          gw = connectRes?.account || connectRes;
          live = true;
          row.conn_status = CONN_STATUS.CONNECTED;
          supabase
            .from('user_mt5_accounts')
            .update({
              conn_status: CONN_STATUS.CONNECTED,
              status: 'connected',
              last_connected_at: new Date().toISOString(),
              error_message: null,
              reconnect_attempts: 0,
              next_reconnect_at: null,
            })
            .eq('id', row.id)
            .then(() => {})
            .catch(() => {});
        }
      }
    } catch (e) {
      console.warn('[MT5] On-demand reconnect in getMyAccount failed:', e.message);
    }
  }

  const fallback = row.snapshot?.account || {
    login: row.akun_id,
    server: row.server || row.snapshot?.requested_server || 'Axi-US50-Demo',
    broker: row.broker || row.snapshot?.requested_broker || 'Axi',
    balance: 0,
    equity: 0,
    profit: 0,
    margin: 0,
    margin_free: 0,
    margin_level: 0,
    currency: 'USD',
    leverage: 100
  };

  // Hanya promosikan ke 'connected' bila gateway benar-benar login di akun ini.
  let connStatus = row.conn_status || CONN_STATUS.DISCONNECTED;
  if (live && connStatus !== CONN_STATUS.ERROR) {
    connStatus = CONN_STATUS.CONNECTED;
  } else if (!live && connStatus === CONN_STATUS.CONNECTED && row.credential_saved) {
    // Tautan masih ada tapi gateway tidak lagi di akun ini -> sedang reconnect
    connStatus = CONN_STATUS.RECONNECTING;
  }

  const mapped = mapGatewayAccount(gw || fallback, { ...row, conn_status: connStatus });

  return { account: mapped, live };
}

export async function listMyTrades(userId, { limit = 200, akunId = null } = {}) {
  const row = await getMyAkunRow(userId, akunId);
  if (!row) return { trades: [] };

  const limitNum = Number(limit) || 200;
  let gwTrades = null;
  let gwDeals = [];

  try {
    const gw = await getAccount();
    // Live trades hanya diambil jika gateway sedang terhubung ke akun_id yang tepat!
    if (gw && Number(gw.login) === Number(row.akun_id)) {
      gwTrades = await getTrades();
      try {
        gwDeals = (await getDeals()).deals || [];
      } catch (err) {
        console.warn('[MT5] Gagal ambil /deals, lanjut tanpa timeline:', err.message);
      }
    }
  } catch (err) {
    console.warn('[MT5] Gagal ambil trades dari gateway, fallback ke snapshot:', err.message);
  }

  if (gwTrades && gwTrades.trades) {
    const timeline = buildDealTimeline(gwDeals);
    const trades = (gwTrades.trades || []).slice(0, limitNum).map((t) => {
      const tl = timeline[t.ticket] || {};
      return {
        id: String(t.ticket ?? ''),
        symbol: t.symbol ?? '',
        type: (t.side || '').toUpperCase(),
        lots: parseFloat(t.volume) || 0,
        openPrice: parseFloat(t.open_price) || 0,
        closePrice: parseFloat(t.close_price) || 0,
        pl: parseFloat(t.profit) || 0,
        swap: parseFloat(t.swap) || 0,
        commission: parseFloat(t.commission) || 0,
        openTime: tl.openTime != null ? new Date(tl.openTime).toISOString() : null,
        closeTime: tl.closeTime != null ? new Date(tl.closeTime).toISOString() : null,
        status: (t.status || 'CLOSED').toUpperCase(),
      };
    });

    // Update snapshot trades secara terisolasi untuk akun ini
    supabase
      .from('user_mt5_accounts')
      .update({
        snapshot: {
          ...row.snapshot,
          trades,
          fetched_at: new Date().toISOString(),
        }
      })
      .eq('id', row.id)
      .then(() => {})
      .catch((e) => console.warn('[MT5] Gagal update snapshot trades:', e.message));

    return { trades };
  }

  // Fallback: Kembalikan trades murni khusus dari snapshot akun ini (TIDAK dicampur dengan akun lain)
  const snapshotTrades = row.snapshot?.trades || [];
  return { trades: snapshotTrades.slice(0, limitNum) };
}

export async function ensureUserExists(userId, email) {
  const { data: existing, error: checkError } = await supabase
    .from('users')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (checkError) {
    if (checkError.code === 'PGRST205') {
      const err = new Error(
        'Tabel users belum ada. Jalankan migrasi sql/00_backend_tables.sql di Supabase SQL Editor.'
      );
      err.status = 503;
      throw err;
    }
    throw checkError;
  }

  if (!existing) {
    const { error: insertError } = await supabase
      .from('users')
      .insert({
        id: userId,
        email: email || `external-${userId}@tarapti.com`,
        password_hash: 'TRUSTED_EXTERNAL_AUTH_BY_FRONTEND_PROXY',
        verification_status: 'verified'
      });
    if (insertError) {
      console.error('Failed to auto-provision user in backend:', insertError);
      throw insertError;
    }
  }
}

export async function connectMyAccount(userId, { platform, login, password, server, broker }, email) {
  await ensureUserExists(userId, email);

  // Parse akun_id dengan aman -- akun MT5 seperti 81320024295 melebihi
  // Number.MAX_SAFE_INTEGER, jadi kita harus pakai parseInt (bukan Number()).
  const loginStr = String(login).trim().replace(/\s/g, '');
  if (!/^\d+$/.test(loginStr)) {
    const err = new Error('Nomor login MT5 harus berupa angka.');
    err.status = 400;
    throw err;
  }

  const akunId = parseInt(loginStr, 10);
  if (!akunId || isNaN(akunId)) {
    const err = new Error('Akun MT5 tidak terdeteksi. Silakan masukkan nomor login MT5 yang benar.');
    err.status = 400;
    throw err;
  }

  // Validasi: akun MT5 Axi real minimal 7 digit (ID >= 8.000.000 untuk akun
  // lama; akun baru Axi bisa 10–11 digit seperti 81320024295).
  // Yang diblokir: angka acak pendek < 1.000.000 (jelas bukan akun MT5).
  if (akunId < 1_000_000) {
    const err = new Error(`Nomor akun MT5 tidak valid (${akunId}). Pastikan login MT5 Axi Anda benar (minimal 7 digit).`);
    err.status = 400;
    throw err;
  }

  // PRINSIP BISNIS 1: 1 Akun MT5 TIDAK boleh dimiliki banyak profile
  const { data: existingAccount, error: findError } = await supabase
    .from('user_mt5_accounts')
    .select('user_id')
    .eq('akun_id', akunId)
    .maybeSingle();

  if (findError) throw findError;

  if (existingAccount && existingAccount.user_id !== userId) {
    const err = new Error('Akun MT5 ini sudah terhubung ke profil lain');
    err.status = 400;
    throw err;
  }

  const cleanServer = (server || '').trim() || null;
  const cleanBroker = (broker || '').trim() || (cleanServer ? cleanServer.split('-')[0] : null) || 'Axi';
  const passwordEnc = encryptPassword(password);

  // --- Coba hubungkan/verifikasi ke gateway (best-effort, tidak memblokir) ---
  // Kalau gateway tidak bisa dihubungi sekarang, credential tetap disimpan
  // dan monitor auto-reconnect akan menyambungkan kemudian.
  let gwState = { reachable: false, login: null, account: null, error: null };
  try {
    gwState = await getGatewayState();
  } catch (err) {
    console.warn('[MT5] getGatewayState gagal saat connect:', err.message);
  }

  let connStatus = CONN_STATUS.RECONNECTING;
  let errorMessage = null;
  let gwAccount = gwState.account || null;
  let initialTrades = [];
  let initialDeals = [];

  if (gwState.reachable && Number(gwState.login) === akunId) {
    connStatus = CONN_STATUS.CONNECTED;
    try {
      const tRes = await getTrades();
      initialTrades = tRes?.trades || [];
      try {
        const dRes = await getDeals();
        initialDeals = dRes?.deals || [];
      } catch (err) {}
    } catch (e) {}
  } else if (gwState.reachable || passwordEnc) {
    // Gateway hidup tapi bukan di akun ini, atau kita punya credential -> coba connect
    try {
      const connectRes = await gatewayConnect({
        login: String(akunId),
        server: cleanServer,
        password,
        broker: cleanBroker,
      });
      const connectedLogin = normalizeConnectResult(connectRes);
      if (connectedLogin && connectedLogin === akunId) {
        connStatus = CONN_STATUS.CONNECTED;
        gwAccount = connectRes?.account || connectRes || gwAccount;
      } else {
        connStatus = CONN_STATUS.RECONNECTING;
        errorMessage = 'Koneksi diproses. Sistem akan otomatis terhubung.';
      }
    } catch (err) {
      if (isAuthError(err)) {
        connStatus = CONN_STATUS.ERROR;
        errorMessage = 'Credential MT5 invalid atau sudah kedaluwarsa. Silakan periksa kembali dan hubungkan ulang.';
      } else {
        connStatus = CONN_STATUS.RECONNECTING;
        errorMessage = gwState.reachable
          ? 'Gagal terhubung sekarang. Sistem akan mencoba lagi secara otomatis.'
          : GATEWAY_UNAVAILABLE_MSG;
      }
    }
  }

  // Ambil trades khusus untuk akun ini jika gateway sedang login di akun_id tersebut
  if (connStatus === CONN_STATUS.CONNECTED && (!initialTrades || initialTrades.length === 0)) {
    try {
      const tRes = await getTrades();
      initialTrades = tRes?.trades || [];
      try {
        const dRes = await getDeals();
        initialDeals = dRes?.deals || [];
      } catch (err) {}
    } catch (e) {}
  }

  // 1 Profile boleh memiliki BANYAK akun MT5. Cari row yang SAMA PERSIS
  // (user_id + akun_id) -- ini menentukan apakah kita UPDATE akun yang sudah
  // ada, atau INSERT akun baru tanpa mengganggu akun lain milik user ini.
  const { data: existingUserRow } = await supabase
    .from('user_mt5_accounts')
    .select('id, akun_id, snapshot, last_connected_at')
    .eq('user_id', userId)
    .eq('akun_id', akunId)
    .maybeSingle();

  const isSameAccount = Boolean(existingUserRow);

  let mappedTrades = isSameAccount ? (existingUserRow?.snapshot?.trades || []) : [];
  if (initialTrades.length > 0) {
    const timeline = buildDealTimeline(initialDeals);
    mappedTrades = initialTrades.map((t) => {
      const tl = timeline[t.ticket] || {};
      return {
        id: String(t.ticket ?? ''),
        symbol: t.symbol ?? '',
        type: (t.side || '').toUpperCase(),
        lots: parseFloat(t.volume) || 0,
        openPrice: parseFloat(t.open_price) || 0,
        closePrice: parseFloat(t.close_price) || 0,
        pl: parseFloat(t.profit) || 0,
        swap: parseFloat(t.swap) || 0,
        commission: parseFloat(t.commission) || 0,
        openTime: tl.openTime != null ? new Date(tl.openTime).toISOString() : null,
        closeTime: tl.closeTime != null ? new Date(tl.closeTime).toISOString() : null,
        status: (t.status || 'CLOSED').toUpperCase(),
      };
    });
  }

  const nowIso = new Date().toISOString();
  const patch = {
    status: 'connected',
    platform: platform || 'MT5',
    server: cleanServer,
    broker: cleanBroker,
    password_enc: passwordEnc,
    credential_saved: Boolean(passwordEnc),
    conn_status: connStatus,
    error_message: errorMessage,
    reconnect_attempts: 0,
    next_reconnect_at: null,
    last_connected_at: connStatus === CONN_STATUS.CONNECTED
      ? nowIso
      : (isSameAccount ? (existingUserRow?.last_connected_at || null) : null),
    updated_at: nowIso,
    snapshot: {
      account: connStatus === CONN_STATUS.CONNECTED ? gwAccount : (isSameAccount ? (existingUserRow?.snapshot?.account || null) : null),
      trades: mappedTrades,
      requested_login: String(akunId),
      requested_server: cleanServer,
      requested_broker: cleanBroker,
      fetched_at: nowIso,
    },
  };

  // Credential invalid pada percobaan PERTAMA: jangan sampai membuat baris
  // akun di database -- user belum berhasil terkoneksi, minta connect ulang.
  if (connStatus === CONN_STATUS.ERROR && !existingUserRow) {
    const err = new Error(errorMessage || 'Gagal terhubung ke akun MT5. Silakan coba lagi.');
    err.status = 400;
    err.conn_status = CONN_STATUS.ERROR;
    throw err;
  }

  let stored;
  if (existingUserRow) {
    // Update akun yang SUDAH ADA (user_id + akun_id sama persis)
    const { data: updated, error: updateErr } = await supabase
      .from('user_mt5_accounts')
      .update(patch)
      .eq('id', existingUserRow.id)
      .select('*')
      .single();
    if (updateErr) throw updateErr;
    stored = updated;
  } else {
    // INSERT baris BARU -- akun MT5 baru untuk user ini, TIDAK menyentuh
    // akun-akun lain yang sudah terhubung sebelumnya.
    const { data: inserted, error: insertErr } = await supabase
      .from('user_mt5_accounts')
      .insert({ user_id: userId, akun_id: akunId, ...patch })
      .select('*')
      .single();
    if (insertErr) throw insertErr;
    stored = inserted;
  }

  // Credential invalid pada akun yang sudah pernah terhubung: status 'error'
  // tersimpan di DB; frontend menampilkan error dan minta user connect ulang.
  if (connStatus === CONN_STATUS.ERROR) {
    const err = new Error(errorMessage || 'Gagal terhubung ke akun MT5. Silakan coba lagi.');
    err.status = 400;
    err.conn_status = CONN_STATUS.ERROR;
    throw err;
  }

  return { account: mapGatewayAccount(gwAccount || {}, stored) };
}

export async function disconnectMyAccount(userId, akunId = null) {
  // Minta gateway melepas sesi MT5 (best-effort) secara asynchronous agar tidak memblokir HTTP response
  gatewayDisconnect().catch((err) => {
    console.warn('[MT5] gatewayDisconnect gagal saat user disconnect (background):', err.message);
  });

  // Hapus akun dari database (DELETE) agar benar-benar terputus dan hilang dari list UI
  // sesuai pesan konfirmasi frontend: "Riwayat transaksi akun ini akan dihapus dari aplikasi."
  if (!akunId) {
    console.warn('[MT5] disconnectMyAccount dipanggil TANPA akunId -- akan menghapus SEMUA akun user ini:', userId);
  }

  let targetAkunId = null;
  let targetRowId = null;

  if (akunId !== null && akunId !== undefined && akunId !== '') {
    const raw = String(akunId).trim();
    const numeric = Number(raw);
    if (/^\d+$/.test(raw)) {
      targetAkunId = Number(raw);
    } else if (raw.includes('-')) {
      targetRowId = raw;
    } else {
      targetAkunId = Number.isFinite(numeric) ? numeric : null;
    }
  }

  if (targetRowId) {
    const { data: existingRow, error: lookupErr } = await supabase
      .from('user_mt5_accounts')
      .select('id, akun_id')
      .eq('user_id', userId)
      .eq('id', targetRowId)
      .maybeSingle();

    if (lookupErr) throw lookupErr;
    if (existingRow) {
      targetAkunId = Number(existingRow.akun_id);
      targetRowId = existingRow.id;
    }
  }

  let query = supabase
    .from('user_mt5_accounts')
    .delete()
    .eq('user_id', userId);

  if (targetRowId) {
    query = query.eq('id', targetRowId);
  } else if (targetAkunId !== null && targetAkunId !== undefined && targetAkunId !== '') {
    query = query.eq('akun_id', Number(targetAkunId));
  }

  const { error } = await query;
  if (error) throw error;
  return { success: true };
}

export async function syncMyAccount(userId, akunId = null) {
  const row = await getMyAkunRow(userId, akunId);
  if (!row) {
    const err = new Error('Belum ada akun MT5 yang terhubung');
    err.status = 404;
    throw err;
  }

  let gw = null;
  let gwTrades = null;
  let gwDeals = [];
  let live = false;
  try {
    gw = await getAccount();
    // PERMINTAAN KLIEN: Sync trades HANYA jika gateway terhubung pada akun_id yang sama!
    if (gw && Number(gw.login) === Number(row.akun_id)) {
      live = true;
      gwTrades = await getTrades();
      try {
        const dRes = await getDeals();
        gwDeals = dRes?.deals || [];
      } catch (err) {
        console.warn('[MT5] Gagal ambil /deals saat sync, lanjut tanpa timeline:', err.message);
      }
    }
  } catch (e) {
    console.warn('[MT5] Gateway sync failed:', e.message);
  }

  let newTrades = row.snapshot?.trades || [];
  if (gwTrades && gwTrades.trades) {
    const timeline = buildDealTimeline(gwDeals);
    newTrades = gwTrades.trades.map((t) => {
      const tl = timeline[t.ticket] || {};
      return {
        id: String(t.ticket ?? ''),
        symbol: t.symbol ?? '',
        type: (t.side || '').toUpperCase(),
        lots: parseFloat(t.volume) || 0,
        openPrice: parseFloat(t.open_price) || 0,
        closePrice: parseFloat(t.close_price) || 0,
        pl: parseFloat(t.profit) || 0,
        swap: parseFloat(t.swap) || 0,
        commission: parseFloat(t.commission) || 0,
        openTime: tl.openTime != null ? new Date(tl.openTime).toISOString() : null,
        closeTime: tl.closeTime != null ? new Date(tl.closeTime).toISOString() : null,
        status: (t.status || 'CLOSED').toUpperCase(),
      };
    });
  }

  let connStatus = row.conn_status || CONN_STATUS.DISCONNECTED;
  if (live) {
    connStatus = CONN_STATUS.CONNECTED;
  } else if (row.credential_saved && connStatus !== CONN_STATUS.ERROR) {
    connStatus = CONN_STATUS.RECONNECTING;
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from('user_mt5_accounts')
    .update({
      status: 'connected',
      conn_status: connStatus,
      last_connected_at: live ? nowIso : (row.last_connected_at || null),
      error_message: live ? null : (row.error_message || 'Menunggu reconnect otomatis...'),
      updated_at: nowIso,
      snapshot: {
        ...row.snapshot,
        account: live ? gw : row.snapshot?.account,
        trades: newTrades,
        fetched_at: nowIso,
      },
    })
    .eq('id', row.id)
    .select('*')
    .single();

  if (error) throw error;

  return {
    success: true,
    account: mapGatewayAccount(gw || row.snapshot?.account || {}, updated),
    tradesCount: newTrades.length,
  };
}

export async function listMyAccounts(userId) {
  const { data: rows, error } = await supabase
    .from('user_mt5_accounts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  let liveGw = null;
  // gatewayReachable = true HANYA jika gateway berhasil merespons dengan data akun.
  // Jika gateway throw error (IPC timeout, 503, dll), tetap gunakan conn_status dari DB
  // dan jangan override ke reconnecting — watchdog yang akan menangani reconnect.
  let gatewayReachable = false;
  try {
    liveGw = await getAccount();
    // getAccount() sukses = gateway reachable dan MT5 terminal aktif
    gatewayReachable = !!(liveGw && liveGw.login != null);
  } catch (err) {
    console.warn('[MT5] Gateway getAccount failed in listMyAccounts (transient, ignoring):', err.message);
    // Biarkan gatewayReachable = false — conn_status tidak akan di-override
  }

  let needsReconnect = false;
  const mapped = (rows || []).map((row) => {
    const isLive = liveGw && Number(liveGw.login) === Number(row.akun_id);
    if (gatewayReachable && !isLive && row.credential_saved && row.conn_status !== CONN_STATUS.DISCONNECTED && row.conn_status !== CONN_STATUS.ERROR) {
      needsReconnect = true;
    }
    const fallback = row.snapshot?.account || {
      login: row.akun_id,
      server: row.server || row.snapshot?.requested_server || 'Axi-US50-Demo',
      broker: row.broker || row.snapshot?.requested_broker || 'Axi',
      balance: 0,
      equity: 0,
      profit: 0,
      margin: 0,
      margin_free: 0,
      margin_level: 0,
      currency: 'USD',
      leverage: 100
    };

    let connStatus = row.conn_status || CONN_STATUS.DISCONNECTED;
    if (gatewayReachable) {
      // Gateway berhasil diakses: override conn_status berdasarkan realitas live
      if (isLive && connStatus !== CONN_STATUS.ERROR) {
        connStatus = CONN_STATUS.CONNECTED;
      } else if (!isLive && connStatus === CONN_STATUS.CONNECTED && row.credential_saved) {
        // Gateway hidup tapi akun ini bukan sesi aktif — tandai reconnecting
        connStatus = CONN_STATUS.RECONNECTING;
      }
    }
    // Jika gatewayReachable = false (error sementara): biarkan conn_status dari DB apa adanya

    return mapGatewayAccount(isLive ? liveGw : fallback, { ...row, conn_status: connStatus });
  });

  if (needsReconnect) {
    import('./mt5ReconnectService.js').then(({ runReconnectCycle }) => {
      runReconnectCycle().catch((err) => console.warn('[MT5] Background reconnect trigger error:', err.message));
    }).catch(() => {});
  }

  return { accounts: mapped };
}

export async function listMyPositions(userId, { akunId = null } = {}) {
  const row = await getMyAkunRow(userId, akunId);
  if (!row) return { positions: [], count: 0 };

  let gwPositions = null;
  try {
    const gw = await getAccount();
    if (gw && Number(gw.login) === Number(row.akun_id)) {
      gwPositions = await getPositions();
    }
  } catch (err) {
    console.warn('[MT5] Gagal ambil positions dari gateway, fallback ke snapshot:', err.message);
  }

  if (gwPositions) {
    const rawPos = gwPositions.positions || gwPositions.data || (Array.isArray(gwPositions) ? gwPositions : []);
    const positions = rawPos.map((p) => ({
      ticket: String(p.ticket ?? p.id ?? ''),
      symbol: p.symbol ?? '',
      type: (p.type || p.side || '').toUpperCase(),
      volume: parseFloat(p.volume || p.lots) || 0,
      lots: parseFloat(p.volume || p.lots) || 0,
      openPrice: parseFloat(p.open_price || p.price) || 0,
      currentPrice: parseFloat(p.current_price || p.price_current) || 0,
      sl: parseFloat(p.sl) || 0,
      tp: parseFloat(p.tp) || 0,
      profit: parseFloat(p.profit) || 0,
      swap: parseFloat(p.swap) || 0,
      comment: p.comment || '',
    }));

    supabase
      .from('user_mt5_accounts')
      .update({
        snapshot: {
          ...row.snapshot,
          positions,
          fetched_at: new Date().toISOString(),
        }
      })
      .eq('id', row.id)
      .then(() => {})
      .catch((e) => console.warn('[MT5] Gagal update snapshot positions:', e.message));

    return { positions, count: positions.length };
  }

  const snapshotPositions = row.snapshot?.positions || [];
  return { positions: snapshotPositions, count: snapshotPositions.length };
}

export async function listMyDeals(userId, { limit = 200, akunId = null } = {}) {
  const row = await getMyAkunRow(userId, akunId);
  if (!row) return { deals: [], count: 0 };

  const limitNum = Number(limit) || 200;
  let gwDeals = null;
  try {
    const gw = await getAccount();
    if (gw && Number(gw.login) === Number(row.akun_id)) {
      gwDeals = await getDeals();
    }
  } catch (err) {
    console.warn('[MT5] Gagal ambil deals dari gateway, fallback ke snapshot:', err.message);
  }

  if (gwDeals) {
    const rawDeals = gwDeals.deals || gwDeals.data || (Array.isArray(gwDeals) ? gwDeals : []);
    const deals = rawDeals.slice(0, limitNum).map((d) => ({
      ticket: String(d.ticket ?? ''),
      order: String(d.order ?? ''),
      position_id: String(d.position_id ?? ''),
      symbol: d.symbol ?? '',
      type: (d.type || '').toUpperCase(),
      entry: d.entry,
      volume: parseFloat(d.volume) || 0,
      price: parseFloat(d.price) || 0,
      profit: parseFloat(d.profit) || 0,
      swap: parseFloat(d.swap) || 0,
      commission: parseFloat(d.commission) || 0,
      time: d.time_msc != null ? new Date(d.time_msc).toISOString() : (d.time ? new Date(d.time * 1000).toISOString() : null),
      comment: d.comment || '',
    }));

    supabase
      .from('user_mt5_accounts')
      .update({
        snapshot: {
          ...row.snapshot,
          deals,
          fetched_at: new Date().toISOString(),
        }
      })
      .eq('id', row.id)
      .then(() => {})
      .catch((e) => console.warn('[MT5] Gagal update snapshot deals:', e.message));

    return { deals, count: deals.length };
  }

  const snapshotDeals = row.snapshot?.deals || [];
  return { deals: snapshotDeals.slice(0, limitNum), count: snapshotDeals.length };
}

export async function listMyOrders(userId, { akunId = null } = {}) {
  const row = await getMyAkunRow(userId, akunId);
  if (!row) return { orders: [], count: 0 };

  let gwOrders = null;
  try {
    const gw = await getAccount();
    if (gw && Number(gw.login) === Number(row.akun_id)) {
      gwOrders = await getOrders();
    }
  } catch (err) {
    console.warn('[MT5] Gagal ambil orders dari gateway, fallback ke snapshot:', err.message);
  }

  if (gwOrders) {
    const rawOrders = gwOrders.orders || gwOrders.data || (Array.isArray(gwOrders) ? gwOrders : []);
    const orders = rawOrders.map((o) => ({
      ticket: String(o.ticket ?? ''),
      symbol: o.symbol ?? '',
      type: (o.type || '').toUpperCase(),
      volume: parseFloat(o.volume || o.lots) || 0,
      openPrice: parseFloat(o.open_price || o.price) || 0,
      sl: parseFloat(o.sl) || 0,
      tp: parseFloat(o.tp) || 0,
      state: o.state || 'PENDING',
      comment: o.comment || '',
    }));

    supabase
      .from('user_mt5_accounts')
      .update({
        snapshot: {
          ...row.snapshot,
          orders,
          fetched_at: new Date().toISOString(),
        }
      })
      .eq('id', row.id)
      .then(() => {})
      .catch((e) => console.warn('[MT5] Gagal update snapshot orders:', e.message));

    return { orders, count: orders.length };
  }

  const snapshotOrders = row.snapshot?.orders || [];
  return { orders: snapshotOrders, count: snapshotOrders.length };
}