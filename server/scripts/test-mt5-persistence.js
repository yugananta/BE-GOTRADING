// server/scripts/test-mt5-persistence.js
//
// TEST OTOMASI: MT5 ACCOUNT PERSISTENCE & AUTO-RECONNECT
// ---------------------------------------------------------------
// Menjalankan skenario wajib:
//   A. Connect account pertama kali -> harus berhasil.
//   B. Restart Backend -> account tetap tersimpan & auto-reconnect.
//   C. Restart MT5 Gateway -> account tetap tersimpan & auto-reconnect.
//   D. Koneksi MT5 terputus -> status RECONNECTING -> CONNECTED.
//   E. Deploy/update Backend -> user TIDAK login ulang Axi.
//   F. Credential invalid -> status ERROR & minta connect ulang.
// Plus:
//   - Tidak ada infinite loop (batas percobaan -> ERROR, berhenti retry).
//   - Password tidak tersimpan plaintext & tidak bocor ke respons API.
//
// Cara jalan:
//   node server/scripts/test-mt5-persistence.js
//
// Menggunakan mock MT5 Gateway (HTTP lokal) + mock Supabase (offline).
// CATATAN ESM: semua service di-import DINAMIS setelah env diset, supaya
// tidak memakai nilai dari file .env production.

// 1) Set env SEBELUM import modul mana pun yang membaca config/env.js.
process.env.NODE_ENV = 'test';
process.env.MT5_GATEWAY_URL = 'http://127.0.0.1:8137';
process.env.SUPABASE_URL = 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-1234567890';
process.env.TARAPTI_DB_HOST = '127.0.0.1';
process.env.TARAPTI_DB_USER = 'test';
process.env.TARAPTI_DB_PASSWORD = 'test';
process.env.MT5_CREDENTIAL_ENCRYPTION_KEY =
  Buffer.from('a'.repeat(32)).toString('base64');
// Backoff kecil agar siklus reconnect cepat (uji no-infinite-loop).
process.env.MT5_RECONNECT_BASE_BACKOFF_MS = '10';
process.env.MT5_RECONNECT_MAX_BACKOFF_MS = '50';
process.env.MT5_RECONNECT_MAX_ATTEMPTS = '3';

import http from 'http';

// ============================================================================
// MOCK MT5 GATEWAY (meniru GATEWAY_ADDENDUM_reconnect.py)
// ============================================================================
const gw = {
  down: false,          // false = gateway hidup; true = gateway mati (503)
  session: null,        // { login, password, server, broker }
  validCredentials: {}, // login -> password
  connectCalls: [],
  connectNeverActivates: false, // simulasi gateway merespons tanpa login aktif
};

function accountOf() {
  if (!gw.session) {
    return {
      login: null, connected: false, balance: 0, equity: 0,
      profit: 0, margin: 0, margin_free: 0, margin_level: 0,
      currency: 'USD', leverage: 100,
    };
  }
  return {
    login: gw.session.login, server: gw.session.server,
    broker: gw.session.broker, connected: true,
    balance: 10000, equity: 10000, profit: 0, margin: 0,
    margin_free: 10000, margin_level: 0, currency: 'USD', leverage: 100,
  };
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const send = (status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (gw.down) return send(503, { detail: 'MT5 Gateway tidak tersedia' });

  if (req.method === 'GET' && req.url === '/account') {
    return send(200, accountOf());
  }

  if (req.method === 'POST' && req.url === '/connect') {
    const body = await readJson(req);
    gw.connectCalls.push({ ...body });
    if (gw.connectNeverActivates) {
      return send(200, { login: null, connected: false });
    }
    const expected = gw.validCredentials[String(body.login)];
    const providedPassword = body.password !== undefined ? body.password : body.password_investor;
    if (!expected || String(providedPassword) !== expected) {
      return send(401, { detail: 'Invalid account or password' });
    }
    gw.session = {
      login: Number(body.login),
      password: providedPassword,
      server: body.server,
      broker: body.broker,
    };
    return send(200, { login: gw.session.login, account: accountOf(), connected: true });
  }

  if (req.method === 'POST' && req.url === '/disconnect') {
    gw.session = null;
    return send(200, { success: true });
  }

  return send(404, { detail: 'Not found' });
});

// ============================================================================
// HELPER TEST
// ============================================================================
let passed = 0;
let failed = 0;

function check(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ✅ PASS | ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    failed++;
    console.log(`  ❌ FAIL | ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

function uuid(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

async function fetchRow(userId, akunId) {
  const { supabase } = await import('../integrations/supabase/client.js');
  const { data } = await supabase
    .from('user_mt5_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('akun_id', akunId)
    .maybeSingle();
  return data;
}

async function resetDb() {
  const { resetMockDb } = await import('../integrations/supabase/client.js');
  resetMockDb();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scenarioA(services) {
  const { connectMyAccount } = services;
  console.log('\n=== A. Connect account pertama kali -> harus berhasil ===');
  await resetDb();
  const userId = uuid(1);
  gw.validCredentials['10055800'] = 'S3cret!Investor';
  gw.down = false;
  gw.session = null;

  const res = await connectMyAccount(userId, {
    platform: 'MT5', login: '10055800', password: 'S3cret!Investor',
    server: 'Axi-US50-Demo', broker: 'Axi',
  }, 'a@tarapti.com');

  check('connectMyAccount mengembalikan account', res?.account != null, `status=${res?.account?.conn_status}`);
  check('conn_status = connected (gateway sudah login akun ini)',
    res?.account?.conn_status === 'connected', res?.account?.conn_status);
  check('account.login = 10055800', String(res?.account?.login) === '10055800');

  const row = await fetchRow(userId, 10055800);
  check('akun tersimpan di database (credential_saved=true)',
    row?.credential_saved === true);
  check('password TIDAK disimpan plaintext',
    row?.password_enc && !String(row.password_enc).includes('S3cret!Investor'),
    String(row?.password_enc || '').slice(0, 20) + '...');
  check('password_enc terenkripsi (format v1:)',
    typeof row?.password_enc === 'string' && row.password_enc.startsWith('v1:'));

  const json = JSON.stringify(res);
  check('respons API tidak mengandung password_enc/password',
    !json.includes('password_enc') && !json.includes('S3cret!Investor'));
}

async function scenarioB(services) {
  const { connectMyAccount, getMyAccount } = services;
  const { runReconnectCycle } = services;
  console.log('\n=== B. Restart Backend -> akun tersimpan & auto-reconnect ===');
  await resetDb();
  const userId = uuid(2);
  gw.validCredentials['10055801'] = 'BackendRestart!Pass';
  gw.down = false;
  gw.session = null;

  await connectMyAccount(userId, {
    platform: 'MT5', login: '10055801', password: 'BackendRestart!Pass',
    server: 'Axi-US50-Demo', broker: 'Axi',
  }, 'b@tarapti.com');

  // Simulasi "backend restart": siklus monitor jalan lagi dari awal
  // (proses backend baru membaca ulang DB -- credential masih tersimpan).
  await runReconnectCycle();
  let row = await fetchRow(userId, 10055801);
  check('setelah restart backend: credential masih tersimpan',
    row?.credential_saved === true && !!row?.password_enc);
  check('setelah restart backend: auto-reconnect -> CONNECTED',
    row?.conn_status === 'connected', row?.conn_status);

  // Kasus terburuk: gateway juga kehilangan sesi saat backend restart.
  gw.session = null;
  await runReconnectCycle();
  row = await fetchRow(userId, 10055801);
  check('backend restart + sesi gateway hilang -> reconnect otomatis CONNECTED',
    row?.conn_status === 'connected', row?.conn_status);
  check('reconnect memakai credential tersimpan (tanpa input user)',
    gw.connectCalls.some((c) => String(c.login) === '10055801'
      && (c.password === 'BackendRestart!Pass' || c.password_investor === 'BackendRestart!Pass')));

  const acc = await getMyAccount(userId);
  check('getMyAccount mencerminkan CONNECTED', acc?.account?.conn_status === 'connected');
}

async function scenarioC(services) {
  const { connectMyAccount, getMyAccount } = services;
  const { runReconnectCycle } = services;
  console.log('\n=== C. Restart MT5 Gateway -> akun tersimpan & auto-reconnect ===');
  await resetDb();
  const userId = uuid(3);
  gw.validCredentials['10055802'] = 'GatewayDown!Pass';
  gw.down = false;
  gw.session = null;

  await connectMyAccount(userId, {
    platform: 'MT5', login: '10055802', password: 'GatewayDown!Pass',
    server: 'Axi-US50-Demo', broker: 'Axi',
  }, 'c@tarapti.com');

  // Restart gateway = gateway mati sesaat.
  gw.down = true;
  gw.session = null;
  await runReconnectCycle();
  let row = await fetchRow(userId, 10055802);
  check('gateway mati -> conn_status = reconnecting',
    row?.conn_status === 'reconnecting', row?.conn_status);
  check('koneksi putus sementara TIDAK menghapus akun dari DB',
    !!row && row.credential_saved === true);

  // Gateway hidup lagi, MT5 belum login -> monitor auto-connect.
  gw.down = false;
  gw.session = null;
  await runReconnectCycle();
  row = await fetchRow(userId, 10055802);
  check('gateway restart -> auto-reconnect -> CONNECTED',
    row?.conn_status === 'connected', row?.conn_status);
  check('reconnect memakai credential tersimpan',
    gw.connectCalls.some((c) => String(c.login) === '10055802'
      && (c.password === 'GatewayDown!Pass' || c.password_investor === 'GatewayDown!Pass')));

  const acc = await getMyAccount(userId);
  check('getMyAccount mencerminkan CONNECTED', acc?.account?.conn_status === 'connected');
}

async function scenarioD(services) {
  const { connectMyAccount, getMyAccount } = services;
  const { runReconnectCycle } = services;
  console.log('\n=== D. Simulasi koneksi MT5 terputus -> RECONNECTING -> CONNECTED ===');
  await resetDb();
  const userId = uuid(4);
  gw.validCredentials['10055803'] = 'Dips!Pass';
  gw.down = false;
  gw.session = null;

  await connectMyAccount(userId, {
    platform: 'MT5', login: '10055803', password: 'Dips!Pass',
    server: 'Axi-US50-Demo', broker: 'Axi',
  }, 'd@tarapti.com');

  let acc = await getMyAccount(userId);
  check('awal: CONNECTED', acc?.account?.conn_status === 'connected');

  // Koneksi terputus (gateway mati).
  gw.down = true;
  await runReconnectCycle();
  acc = await getMyAccount(userId);
  check('koneksi putus -> RECONNECTING', acc?.account?.conn_status === 'reconnecting',
    acc?.account?.conn_status);

  // Pulih -> CONNECTED kembali.
  gw.down = false;
  gw.session = null;
  await runReconnectCycle();
  acc = await getMyAccount(userId);
  check('pulih -> otomatis CONNECTED kembali', acc?.account?.conn_status === 'connected',
    acc?.account?.conn_status);
}

async function scenarioE(services) {
  const { connectMyAccount, getMyAccount } = services;
  const { runReconnectCycle } = services;
  console.log('\n=== E. Deploy/update Backend -> user tidak login ulang Axi ===');
  await resetDb();
  const userId = uuid(5);
  gw.validCredentials['10055804'] = 'DeploySafe!Pass';
  gw.down = false;
  gw.session = null;

  await connectMyAccount(userId, {
    platform: 'MT5', login: '10055804', password: 'DeploySafe!Pass',
    server: 'Axi-US50-Demo', broker: 'Axi',
  }, 'e@tarapti.com');

  // Simulasi beberapa siklus deploy/restart (monitor jalan ulang berkali-kali).
  for (let i = 0; i < 3; i++) {
    gw.session = null;
    await runReconnectCycle();
  }

  const row = await fetchRow(userId, 10055804);
  const acc = await getMyAccount(userId);
  check('setelah deploy berulang: akun tetap tersimpan', row?.credential_saved === true);
  check('setelah deploy berulang: auto-reconnect tetap CONNECTED',
    row?.conn_status === 'connected' && acc?.account?.conn_status === 'connected');
  check('tidak perlu password baru (stored password dipakai ulang)',
    gw.connectCalls.some((c) => String(c.login) === '10055804'
      && (c.password === 'DeploySafe!Pass' || c.password_investor === 'DeploySafe!Pass')));
}

async function scenarioF(services) {
  const { connectMyAccount, disconnectMyAccount } = services;
  const { runReconnectCycle } = services;
  console.log('\n=== F. Credential invalid -> ERROR & minta connect ulang ===');
  await resetDb();
  const userId = uuid(6);
  gw.validCredentials['10055805'] = 'Correct!Pass';
  gw.down = false;
  gw.session = null;

  // Connect pertama dengan password salah.
  let threw = false;
  let errStatus = null;
  try {
    await connectMyAccount(userId, {
      platform: 'MT5', login: '10055805', password: 'WRONG!Pass',
      server: 'Axi-US50-Demo', broker: 'Axi',
    }, 'f@tarapti.com');
  } catch (err) {
    threw = true;
    errStatus = err.status;
  }
  check('connect dengan password salah -> error ditampilkan', threw);
  check('error status 400 (credential invalid)', errStatus === 400, `status=${errStatus}`);

  // Akun yang SEBELUMNYA valid lalu credential-nya expired/invalid.
  const userId2 = uuid(7);
  gw.validCredentials['10055806'] = 'Old!Pass';
  await connectMyAccount(userId2, {
    platform: 'MT5', login: '10055806', password: 'Old!Pass',
    server: 'Axi-US50-Demo', broker: 'Axi',
  }, 'f2@tarapti.com');

  // Password di broker berubah -> credential lama invalid.
  delete gw.validCredentials['10055806'];
  gw.validCredentials['10055806'] = 'New!Pass';
  gw.session = null;

  await runReconnectCycle();
  let row = await fetchRow(userId2, 10055806);
  check('credential expired -> conn_status = error',
    row?.conn_status === 'error', row?.conn_status);
  check('error_message menjelaskan minta connect ulang',
    /(hubungkan ulang|invalid|kedaluwarsa)/i.test(row?.error_message || ''),
    row?.error_message);

  // No infinite loop: akun berstatus ERROR TIDAK memanggil /connect lagi.
  const callsBefore = gw.connectCalls.filter((c) => String(c.login) === '10055806').length;
  for (let i = 0; i < 5; i++) await runReconnectCycle();
  const callsAfter = gw.connectCalls.filter((c) => String(c.login) === '10055806').length;
  check('tidak ada infinite loop (status ERROR berhenti retry)',
    callsAfter === callsBefore, `calls(10055806) before=${callsBefore} after=${callsAfter}`);

  // Batas percobaan pada kegagalan umum -> ERROR lalu berhenti.
  const userId3 = uuid(8);
  gw.validCredentials['10055807'] = 'Loop!Pass';
  gw.connectNeverActivates = true;
  try {
    await connectMyAccount(userId3, {
      platform: 'MT5', login: '10055807', password: 'Loop!Pass',
      server: 'Axi-US50-Demo', broker: 'Axi',
    }, 'f3@tarapti.com');
  } catch (e) {}

  for (let i = 0; i < 12; i++) {
    await runReconnectCycle();
    await sleep(25); // biarkan backoff 10ms berlalu tiap siklus
  }
  gw.connectNeverActivates = false;
  row = await fetchRow(userId3, 10055807);
  check('kegagalan berulang -> mencapai ERROR (bukan infinite loop)',
    row?.conn_status === 'error', `status=${row?.conn_status} attempts=${row?.reconnect_attempts}`);

  // User sengaja disconnect -> akun dihapus (harus connect ulang = wajar).
  await disconnectMyAccount(userId, 10055805);
  const afterDisconnect = await fetchRow(userId, 10055805);
  check('user sengaja disconnect -> akun dilepas dari DB',
    afterDisconnect == null);
}

async function main() {
  await new Promise((resolve) => server.listen(8137, resolve));
  console.log('Mock MT5 Gateway jalan di http://127.0.0.1:8137');

  // Import DINAMIS: pastikan config/env membaca nilai dari atas file ini,
  // BUKAN dari .env production (import statis akan hoisted duluan).
  const metatraderService = await import('../services/metatraderService.js');
  const reconnectService = await import('../services/mt5ReconnectService.js');
  const services = { ...metatraderService, ...reconnectService };

  try {
    await scenarioA(services);
    await scenarioB(services);
    await scenarioC(services);
    await scenarioD(services);
    await scenarioE(services);
    await scenarioF(services);
  } catch (err) {
    failed++;
    console.error('\n  ❌ ERROR TAK TERDUGA:', err);
  } finally {
    server.close();
  }

  console.log('\n=====================================================');
  console.log(`HASIL: ${passed} PASS, ${failed} FAIL`);
  console.log('=====================================================');
  process.exit(failed > 0 ? 1 : 0);
}

main();
