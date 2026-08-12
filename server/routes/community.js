// server/routes/community.js
//
// Community chat -- semua endpoint butuh login (requireAuth), tidak
// perlu admin. Untuk user app (bukan admin panel).

import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  getOrCreateGroup, listGroups, getMessages, postMessage,
} from '../services/communityService.js';

const router = Router();

router.use(requireAuth);

// Daftar grup yang tersedia, filter opsional by country/province
router.get('/groups', async (req, res, next) => {
  try {
    res.json(await listGroups(req.query));
  } catch (err) { next(err); }
});

// Ambil atau buat grup sesuai negara/provinsi/kota user (dipanggil sekali
// saat user pertama buka halaman komunitas, untuk dapat groupId-nya)
router.post('/groups/resolve', async (req, res, next) => {
  try {
    res.json(await getOrCreateGroup(req.body));
  } catch (err) { next(err); }
});

// Ambil pesan. Polling: client panggil ulang tiap beberapa detik dengan
// ?since=<timestamp pesan terakhir yang diterima>
router.get('/groups/:groupId/messages', async (req, res, next) => {
  try {
    res.json(await getMessages(req.params.groupId, req.query));
  } catch (err) { next(err); }
});

router.post('/groups/:groupId/messages', async (req, res, next) => {
  try {
    const message = await postMessage(req.params.groupId, req.user.sub, req.body.body);
    res.status(201).json(message);
  } catch (err) { next(err); }
});

export default router;
