// server/routes/news.js
import { Router } from 'express';
import { getLatestNews } from '../services/newsService.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const news = await getLatestNews();
    res.json(news);
  } catch (err) {
    next(err);
  }
});

export default router;
