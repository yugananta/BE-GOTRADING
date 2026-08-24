// server/routes/groups.js
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { getGroupStats, getGroupMembers } from '../services/communityService.js';

const router = Router();

router.use(requireAuth);

router.get('/stats', async (req, res, next) => {
  try { res.json(await getGroupStats(req.query)); }
  catch (err) { next(err); }
});

router.get('/:groupId/members', async (req, res, next) => {
  try {
    const { page, limit, search } = req.query;
    const result = await getGroupMembers({
      groupId: req.params.groupId,
      search,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      viewerId: req.user?.sub,
    });
    res.setHeader('X-Total-Count', String(result.total));
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
