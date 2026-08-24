// server/routes/notifications.js
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  listMyNotifications, createNotification, markAllAsRead, markOneAsRead, deleteNotification, deleteNotificationsByType,
} from '../services/notificationService.js';

const router = Router();

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try { res.json(await listMyNotifications(req.user.sub)); }
  catch (err) { next(err); }
});

// Journal.tsx: user membuat notifikasi sistem untuk dirinya sendiri (mis.
// profit target tercapai, drawdown harian). toUserId selalu dipaksa ke
// user yang sedang login -- TIDAK BOLEH percaya toUserId dari body,
// supaya user A tidak bisa kirim notifikasi palsu ke user B.
router.post('/', async (req, res, next) => {
  try {
    const { type, message, assetClass } = req.body;
    res.status(201).json(await createNotification({ toUserId: req.user.sub, fromUserId: null, type, message, assetClass }));
  } catch (err) { next(err); }
});

router.post('/read-all', async (req, res, next) => {
  try { await markAllAsRead(req.user.sub); res.status(204).end(); }
  catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try { await deleteNotification(req.params.id, req.user.sub); res.status(204).end(); }
  catch (err) { next(err); }
});

// --- Alias untuk kontrak lama frontend (AppContext.tsx) ---

// GET /:userId -- userId di URL diabaikan demi keamanan, selalu pakai
// identitas dari token (req.user.sub), bukan dari parameter yang bisa
// dipalsukan siapa saja yang tahu ID user lain.
router.get('/:userId', async (req, res, next) => {
  try { res.json(await listMyNotifications(req.user.sub)); }
  catch (err) { next(err); }
});

router.put('/:id/read', async (req, res, next) => {
  try { await markOneAsRead(req.params.id, req.user.sub); res.status(204).end(); }
  catch (err) { next(err); }
});

router.put('/user/:userId/read-all', async (req, res, next) => {
  try { await markAllAsRead(req.user.sub); res.status(204).end(); }
  catch (err) { next(err); }
});

// Journal.tsx / AppContext.tsx: hapus notifikasi market_pulse spesifik.
router.delete('/user/:userId/market_pulse', async (req, res, next) => {
  try {
    await deleteNotificationsByType(req.user.sub, 'market_pulse');
    res.status(204).end();
  } catch (err) { next(err); }
});

// AppContext.tsx: tombol "simulasikan notifikasi" di halaman dev/testing --
// membuat notifikasi dummy untuk diri sendiri supaya UI notifikasi bisa
// dicoba tanpa perlu trigger asli (like/follow/pesan dari user lain).
const TEST_TRIGGER_MESSAGES = {
  friend_request: 'mengirim permintaan koneksi (simulasi)',
  friend_accepted: 'menerima permintaan koneksi Anda (simulasi)',
  new_message: 'mengirim pesan baru (simulasi)',
  like: 'menyukai postingan Anda (simulasi)',
};

router.post('/test-trigger', async (req, res, next) => {
  try {
    const eventType = req.body.eventType || 'like';
    const type = eventType === 'new_message' ? 'message' : eventType;
    const message = TEST_TRIGGER_MESSAGES[eventType] || 'notifikasi simulasi';
    res.status(201).json(await createNotification({ toUserId: req.user.sub, fromUserId: null, type, message }));
  } catch (err) { next(err); }
});

export default router;
