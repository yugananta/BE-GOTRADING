// server/routes/messages.js
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  listChatSessions, listHistory, sendMessage, markAsRead, toggleReaction,
} from '../services/messageService.js';

const router = Router();

router.use(requireAuth);

router.get('/sessions', async (req, res, next) => {
  try { res.json(await listChatSessions(req.user.sub)); }
  catch (err) { next(err); }
});

// [ALIAS] AppContext.tsx memanggil /sessions/:userId (userId di URL
// diabaikan, selalu dari token) dan /history?userId=&partnerId=.
router.get('/sessions/:userId', async (req, res, next) => {
  try { res.json(await listChatSessions(req.user.sub)); }
  catch (err) { next(err); }
});

router.get('/history', async (req, res, next) => {
  try {
    const partnerId = req.query.partnerId;
    if (!partnerId) return res.status(400).json({ error: 'partnerId wajib diisi' });
    res.json(await listHistory(req.user.sub, partnerId, req.query));
  } catch (err) { next(err); }
});

// [ALIAS] Bentuk generik: penerima dikirim di body (receiverId/partnerId/
// userId), dipakai AppContext.tsx. Ditaruh SEBELUM '/:partnerId' supaya
// tidak ketangkap sebagai partnerId="".
router.post('/', async (req, res, next) => {
  try {
    const receiverId = req.body.receiverId || req.body.partnerId || req.body.userId;
    if (!receiverId) return res.status(400).json({ error: 'receiverId wajib diisi' });
    res.status(201).json(await sendMessage(req.user.sub, receiverId, req.body));
  } catch (err) { next(err); }
});

router.get('/:partnerId', async (req, res, next) => {
  try { res.json(await listHistory(req.user.sub, req.params.partnerId, req.query)); }
  catch (err) { next(err); }
});

router.post('/:partnerId', async (req, res, next) => {
  try { res.status(201).json(await sendMessage(req.user.sub, req.params.partnerId, req.body)); }
  catch (err) { next(err); }
});

router.post('/:partnerId/read', async (req, res, next) => {
  try { await markAsRead(req.user.sub, req.params.partnerId); res.status(204).end(); }
  catch (err) { next(err); }
});

router.post('/reactions/:messageId', async (req, res, next) => {
  try { res.json(await toggleReaction(req.params.messageId, req.user.sub, req.body.emoji)); }
  catch (err) { next(err); }
});

// [ALIAS] AppContext.tsx memanggil bentuk '/:messageId/react'.
router.post('/:messageId/react', async (req, res, next) => {
  try { res.json(await toggleReaction(req.params.messageId, req.user.sub, req.body.emoji)); }
  catch (err) { next(err); }
});

export default router;
