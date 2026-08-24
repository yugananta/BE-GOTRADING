// server/routes/leaderboard.js
//
// [ALIAS] Leaderboard.tsx memanggil /api/leaderboard langsung, bukan
// /api/users/leaderboard (yang tetap ada & dipertahankan untuk konsumen
// lain). Logikanya sama persis, tinggal reuse profileService.

import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { getLeaderboard } from '../services/profileService.js';

const router = Router();

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try { res.json(await getLeaderboard(Number(req.query.limit) || 50)); }
  catch (err) { next(err); }
});

export default router;
