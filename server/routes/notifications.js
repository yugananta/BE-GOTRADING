// server/routes/notifications.js
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  listMyNotifications,
  createNotification,
  markAllAsRead,
  markOneAsRead,
  deleteNotification,
  deleteNotificationsByType,
  getUnreadCount,
} from '../services/notificationService.js';

const router = Router();

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const result = await listMyNotifications(req.user.sub);
    const unreadCount = result.data.filter((n) => !n.isRead).length;
    res.setHeader('X-Unread-Count', String(unreadCount));
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/unread-count', async (req, res, next) => {
  try {
    const count = await getUnreadCount(req.user.sub);
    res.json({ unreadCount: count, count });
  } catch (err) { next(err); }
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
  try {
    const result = await markAllAsRead(req.user.sub);
    res.json(result);
  } catch (err) { next(err); }
});

router.put('/read-all', async (req, res, next) => {
  try {
    const result = await markAllAsRead(req.user.sub);
    res.json(result);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const result = await deleteNotification(req.params.id, req.user.sub);
    res.json(result);
  } catch (err) { next(err); }
});

// --- Alias untuk kontrak lama frontend (AppContext.tsx / Repository) ---

// GET /:userId -- userId di URL diabaikan demi keamanan, selalu pakai
// identitas dari token (req.user.sub), bukan dari parameter yang bisa
// dipalsukan siapa saja yang tahu ID user lain.
router.get('/user/:userId', async (req, res, next) => {
  try { res.json(await listMyNotifications(req.user.sub)); }
  catch (err) { next(err); }
});

router.get('/user/:userId/unread-count', async (req, res, next) => {
  try {
    const count = await getUnreadCount(req.user.sub);
    res.json({ unreadCount: count, count });
  } catch (err) { next(err); }
});

router.get('/:userId', async (req, res, next) => {
  try { res.json(await listMyNotifications(req.user.sub)); }
  catch (err) { next(err); }
});

router.put('/:id/read', async (req, res, next) => {
  try {
    const result = await markOneAsRead(req.params.id, req.user.sub);
    res.json(result);
  } catch (err) { next(err); }
});

router.patch('/:id/read', async (req, res, next) => {
  try {
    const result = await markOneAsRead(req.params.id, req.user.sub);
    res.json(result);
  } catch (err) { next(err); }
});

router.put('/user/:userId/read-all', async (req, res, next) => {
  try {
    const result = await markAllAsRead(req.user.sub);
    res.json(result);
  } catch (err) { next(err); }
});

// Hapus notifikasi berdasarkan tipe tertentu (misal: 'market_pulse')
router.delete('/user/:userId/:type', async (req, res, next) => {
  try {
    const result = await deleteNotificationsByType(req.user.sub, req.params.type);
    res.json(result);
  } catch (err) { next(err); }
});

router.delete('/type/:type', async (req, res, next) => {
  try {
    const result = await deleteNotificationsByType(req.user.sub, req.params.type);
    res.json(result);
  } catch (err) { next(err); }
});

// AppContext.tsx: tombol "simulasikan notifikasi" di halaman dev/testing --
// membuat notifikasi dummy untuk diri sendiri dan DISIMPAN PERSISTEN ke PostgreSQL
// agar tidak split-brain dengan memory state.
const TEST_TRIGGER_MESSAGES = {
  friend_request: 'mengirim permintaan koneksi (simulasi)',
  friend_accepted: 'menerima permintaan koneksi Anda (simulasi)',
  new_message: 'mengirim pesan baru (simulasi)',
  like: 'menyukai postingan Anda (simulasi)',
};

router.post('/test-trigger', async (req, res, next) => {
  try {
    const eventType = req.body.eventType || req.body.type || 'like';
    const type = eventType === 'new_message' ? 'message' : eventType;
    const message = req.body.message || TEST_TRIGGER_MESSAGES[eventType] || 'notifikasi simulasi';
    const created = await createNotification({ toUserId: req.user.sub, fromUserId: null, type, message });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

export default router;

