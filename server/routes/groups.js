// server/routes/groups.js
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { getGroupStats } from '../services/communityService.js';

const router = Router();

router.use(requireAuth);

router.get('/stats', async (req, res, next) => {
  try { res.json(await getGroupStats(req.query)); }
  catch (err) { next(err); }
});

export default router;
