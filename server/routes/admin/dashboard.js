import { Router } from 'express';
import { getDashboardSummary } from '../../services/dashboardService.js';

const router = Router();

router.get('/summary', async (req, res, next) => {
  try {
    res.json(await getDashboardSummary());
  } catch (err) { next(err); }
});

export default router;
