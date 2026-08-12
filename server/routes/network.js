// server/routes/network.js
//
// Digabung: follow (satu arah) + connection (dua arah dengan approval).
// Dua konsep beda yang sama-sama dipakai frontend (Network.tsx,
// UserProfile.tsx) -- follow untuk "ikuti update", connection untuk
// "kenalan/koneksi" yang butuh persetujuan.

import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  follow, unfollow, listFollowers, listFollowing, isFollowing,
} from '../services/followService.js';
import {
  requestConnection, respondConnection, removeConnection, listMyConnections,
} from '../services/connectionService.js';

const router = Router();

router.use(requireAuth);

// --- Follow ---
router.post('/follow/:userId', async (req, res, next) => {
  try { await follow(req.user.sub, req.params.userId); res.status(204).end(); }
  catch (err) { next(err); }
});

router.delete('/follow/:userId', async (req, res, next) => {
  try { await unfollow(req.user.sub, req.params.userId); res.status(204).end(); }
  catch (err) { next(err); }
});

router.get('/followers/:userId', async (req, res, next) => {
  try { res.json(await listFollowers(req.params.userId)); }
  catch (err) { next(err); }
});

router.get('/following/:userId', async (req, res, next) => {
  try { res.json(await listFollowing(req.params.userId)); }
  catch (err) { next(err); }
});

router.get('/follow-status/:userId', async (req, res, next) => {
  try { res.json({ following: await isFollowing(req.user.sub, req.params.userId) }); }
  catch (err) { next(err); }
});

// --- Connections ---
router.get('/connections', async (req, res, next) => {
  try { res.json(await listMyConnections(req.user.sub)); }
  catch (err) { next(err); }
});

router.post('/connections/:userId', async (req, res, next) => {
  try { res.status(201).json(await requestConnection(req.user.sub, req.params.userId)); }
  catch (err) { next(err); }
});

// Penerima merespons permintaan dari requesterId
router.patch('/connections/:requesterId', async (req, res, next) => {
  try { res.json(await respondConnection(req.params.requesterId, req.user.sub, req.body.status)); }
  catch (err) { next(err); }
});

router.delete('/connections/:userId', async (req, res, next) => {
  try { await removeConnection(req.user.sub, req.params.userId); res.status(204).end(); }
  catch (err) { next(err); }
});

export default router;
