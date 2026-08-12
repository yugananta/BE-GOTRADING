import { Router } from 'express';
import {
  listNewsPosts, createNewsPost, updateNewsPost, deleteNewsPost,
} from '../../services/newsAdminService.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    res.json(await listNewsPosts());
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await createNewsPost({ ...req.body, authorId: req.user.sub }));
  } catch (err) { next(err); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    res.json(await updateNewsPost(req.params.id, req.body));
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteNewsPost(req.params.id);
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
