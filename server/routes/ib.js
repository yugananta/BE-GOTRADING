// server/routes/ib.js
//
// Endpoint IB untuk user biasa (role='ib') -- lihat profil komisi sendiri,
// riwayat komisi, dan ajukan payout. Beda dari routes/admin/ib.js yang
// isinya untuk admin mengelola SEMUA IB.

import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  getIbProfile, listMyCommissions, requestPayout, calculateCommissionsForIb,
} from '../services/ibService.js';

const router = Router();

router.use(requireAuth);

function requireIbRole(req, res, next) {
  if (req.user.role !== 'ib') {
    return res.status(403).json({ error: 'Fitur ini khusus akun IB' });
  }
  next();
}

router.use(requireIbRole);

// Profil IB: kode referral, tier, rate per lot, downline aktif, total earnings
router.get('/me', async (req, res, next) => {
  try {
    res.json(await getIbProfile(req.user.sub));
  } catch (err) { next(err); }
});

// Riwayat komisi (paginated)
router.get('/me/commissions', async (req, res, next) => {
  try {
    res.json(await listMyCommissions(req.user.sub, req.query));
  } catch (err) { next(err); }
});

// Hitung ulang komisi dari trade downline terbaru. MVP: dipanggil manual
// dari tombol "Refresh Komisi" di UI. Untuk production, sebaiknya ini
// dijadwalkan (cron / dipanggil dari MT5 sync engine tiap trade close)
// supaya IB tidak perlu klik manual.
router.post('/me/recalculate', async (req, res, next) => {
  try {
    res.json(await calculateCommissionsForIb(req.user.sub));
  } catch (err) { next(err); }
});

router.post('/me/payout-request', async (req, res, next) => {
  try {
    res.status(201).json(await requestPayout(req.user.sub, req.body));
  } catch (err) { next(err); }
});

export default router;
