// server/routes/stories.js
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { listActiveStories, createStory, recordView, deleteStory } from '../services/storyService.js';

const router = Router();

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try { res.json(await listActiveStories()); }
  catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try { res.status(201).json(await createStory(req.user.sub, req.body)); }
  catch (err) { next(err); }
});

// StoriesList.tsx: catat bahwa req.user (bukan hanya viewerUserId dari
// body) sudah melihat story ini, lalu kembalikan daftar viewer terbaru
// untuk ditampilkan di modal "dilihat oleh".
router.post('/:storyId/view', async (req, res, next) => {
  try { res.json({ success: true, viewers: await recordView(req.params.storyId, req.user.sub) }); }
  catch (err) { next(err); }
});

router.delete('/:storyId', async (req, res, next) => {
  try { res.json(await deleteStory(req.params.storyId, req.user.sub)); }
  catch (err) { next(err); }
});

export default router;
