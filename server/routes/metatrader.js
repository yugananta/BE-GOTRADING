// server/routes/metatrader.js
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  getMyAccount, listMyAccounts, listMyTrades, listMyPositions, listMyDeals, listMyOrders, connectMyAccount, disconnectMyAccount, syncMyAccount,
} from '../services/metatraderService.js';
import { runReconnectCycle } from '../services/mt5ReconnectService.js';

const router = Router();

router.use(requireAuth);

// GET /account -- kembalikan SEMUA akun MT5 milik user (bukan cuma satu),
// supaya frontend (Account.tsx) bisa menampilkan tab multi-akun.
router.get('/account', async (req, res, next) => {
  try {
    const { accounts } = await listMyAccounts(req.user.sub);
    res.json({
      account: accounts.length > 0 ? accounts[0] : null,
      accounts,
    });
  }
  catch (err) { next(err); }
});

// Paksa siklus auto-reconnect segera (mis. dari tombol "Coba Lagi" di
// frontend). Aman: hanya membaca credential tersimpan, tidak pernah
// menghapus akun, dan tetap mematuhi backoff di server.
router.post('/reconnect', async (req, res, next) => {
  try {
    await runReconnectCycle();
    res.json({ success: true });
  }
  catch (err) { next(err); }
});

// GET /trades -- terima akunId dari query supaya trades yang dikembalikan
// sesuai akun yang sedang dipilih di tab frontend, bukan akun default.
router.get('/trades', async (req, res, next) => {
  try { res.json(await listMyTrades(req.user.sub, req.query)); }
  catch (err) { next(err); }
});

// GET /positions -- ambil data posisi terbuka real-time dari MT5 Gateway
router.get('/positions', async (req, res, next) => {
  try { res.json(await listMyPositions(req.user.sub, req.query)); }
  catch (err) { next(err); }
});

// GET /deals -- ambil data riwayat deal real-time dari MT5 Gateway
router.get('/deals', async (req, res, next) => {
  try { res.json(await listMyDeals(req.user.sub, req.query)); }
  catch (err) { next(err); }
});

// GET /orders -- ambil data order pending real-time dari MT5 Gateway
router.get('/orders', async (req, res, next) => {
  try { res.json(await listMyOrders(req.user.sub, req.query)); }
  catch (err) { next(err); }
});

router.post('/connect', async (req, res, next) => {
  try {
    const { platform, login, password, server, broker } = req.body;
    if (!platform || !login || !password || !server) {
      const err = new Error('Semua field wajib diisi: platform, login, password, server');
      err.status = 400;
      throw err;
    }
    const cleanLogin = String(login).trim();
    if (!cleanLogin) {
      const err = new Error('Field login tidak boleh kosong');
      err.status = 400;
      throw err;
    }
    // Broker optional (FE lama/konektor lain mengirim tanpa field broker);
    // default diambil dari nama server atau 'Axi'.
    const cleanBroker = (broker || '').trim() || (server || '').split('-')[0] || 'Axi';
    const result = await connectMyAccount(req.user.sub, {
      platform,
      login: cleanLogin,
      password,
      server,
      broker: cleanBroker
    }, req.user.email);

    // Kembalikan juga daftar SEMUA akun terbaru supaya frontend bisa
    // langsung refresh tab akun tanpa perlu GET /account terpisah.
    const { accounts } = await listMyAccounts(req.user.sub);
    res.status(201).json({ ...result, accounts });
  }
  catch (err) { next(err); }
});

// POST /disconnect -- WAJIB terima accountId/akunId dari body. Tanpa ini,
// disconnectMyAccount akan memutus SEMUA akun MT5 milik user (lihat
// warning log di metatraderService.js). Account.tsx mengirim
// { accountId: activeAccount.id } -- pastikan mapGatewayAccount di
// metatraderService.js sudah mengembalikan field `id` (row UUID), atau
// sesuaikan di sini untuk menerima akun_id/login sebagai alternatif.
router.post('/disconnect', async (req, res, next) => {
  try {
    const { accountId, akunId, login } = req.body || {};
    // Terima beberapa kemungkinan nama field dari frontend untuk fleksibilitas,
    // tapi utamakan akunId/login (nomor akun MT5) karena itu yang dipakai
    // sebagai filter di query Supabase, BUKAN id/UUID row.
    const targetAkunId = akunId || login || accountId;

    if (!targetAkunId) {
      console.warn('[MT5 route] POST /disconnect tanpa accountId/akunId -- akan memutus SEMUA akun user:', req.user.sub);
    }

    await disconnectMyAccount(req.user.sub, targetAkunId || null);

    // Kembalikan daftar akun terbaru setelah disconnect
    const { accounts } = await listMyAccounts(req.user.sub);
    res.json({ success: true, accounts });
  }
  catch (err) { next(err); }
});

// POST /sync -- terima akunId dari body supaya sync akun yang benar
// (akun yang sedang aktif di tab), bukan selalu akun "terbaru".
router.post('/sync', async (req, res, next) => {
  try {
    const { accountId, akunId, login } = req.body || {};
    const targetAkunId = akunId || login || accountId || null;
    res.json(await syncMyAccount(req.user.sub, targetAkunId));
  }
  catch (err) { next(err); }
});

export default router;