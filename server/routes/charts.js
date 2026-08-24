// server/routes/charts.js
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { getPriceSeries } from '../services/priceService.js';

const router = Router();

router.use(requireAuth);

router.get('/prices', async (req, res, next) => {
  try {
    if (!req.query.pair) return res.status(400).json({ error: 'pair wajib diisi' });
    res.json(await getPriceSeries(req.query.pair));
  } catch (err) { next(err); }
});

export default router;
