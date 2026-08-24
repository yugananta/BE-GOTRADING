// [DEPRECATED] Modul IB lama digantikan oleh 2-Level Affiliate System (/api/admin/affiliate)
import { Router } from 'express';
import {
  listIbs, getIbDownline, listTiers, upsertTier,
  listPayouts, updatePayoutStatus, calculateCommissionsForIb,
} from '../../services/ibService.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    res.json(await listIbs());
  } catch (err) { next(err); }
});

router.get('/:id/downline', async (req, res, next) => {
  try {
    res.json(await getIbDownline(req.params.id));
  } catch (err) { next(err); }
});

// Paksa hitung ulang komisi seorang IB (dipakai admin untuk verifikasi
// manual, atau bisa dipanggil dari cron job internal)
router.post('/:id/recalculate', async (req, res, next) => {
  try {
    res.json(await calculateCommissionsForIb(req.params.id));
  } catch (err) { next(err); }
});

// Tier komisi
router.get('/tiers', async (req, res, next) => {
  try {
    res.json(await listTiers());
  } catch (err) { next(err); }
});

router.put('/tiers', async (req, res, next) => {
  try {
    res.json(await upsertTier(req.body));
  } catch (err) { next(err); }
});

// Payout -- admin lihat semua pengajuan pencairan dan approve/reject
router.get('/payouts', async (req, res, next) => {
  try {
    res.json(await listPayouts(req.query));
  } catch (err) { next(err); }
});

router.patch('/payouts/:id', async (req, res, next) => {
  try {
    res.json(await updatePayoutStatus(req.params.id, { ...req.body, processedBy: req.user.sub }));
  } catch (err) { next(err); }
});

export default router;
