// server/routes/posts.js
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  listFeed, getPost, createPost, updatePost, deletePost, toggleLike, toggleBookmark, repost,
  listComments, createComment, deleteComment,
} from '../services/postService.js';

const router = Router();

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    res.json(await listFeed(req.query, req.user.sub));
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await createPost(req.user.sub, req.body));
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const post = await getPost(req.params.id, req.user.sub);
    if (!post) return res.status(404).json({ error: 'Post tidak ditemukan' });
    res.json(post);
  } catch (err) { next(err); }
});

router.delete('/comments/:commentId', async (req, res, next) => {
  try {
    await deleteComment(req.params.commentId, req.user.sub);
    res.status(204).end();
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    res.json(await updatePost(req.params.id, req.user.sub, req.body));
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await deletePost(req.params.id, req.user.sub);
    res.status(204).end();
  } catch (err) { next(err); }
});

router.post('/:id/like', async (req, res, next) => {
  try {
    res.json(await toggleLike(req.params.id, req.user.sub));
  } catch (err) { next(err); }
});

router.post('/:id/bookmark', async (req, res, next) => {
  try {
    res.json(await toggleBookmark(req.params.id, req.user.sub));
  } catch (err) { next(err); }
});

router.post('/:id/repost', async (req, res, next) => {
  try {
    res.status(201).json(await repost(req.params.id, req.user.sub));
  } catch (err) { next(err); }
});

router.get('/:id/comments', async (req, res, next) => {
  try {
    res.json(await listComments(req.params.id));
  } catch (err) { next(err); }
});

router.post('/:id/comments', async (req, res, next) => {
  try {
    res.status(201).json(await createComment(req.params.id, req.user.sub, req.body));
  } catch (err) { next(err); }
});

// [ALIAS] PostCard.tsx memanggil bentuk singular '/comment', GroupView.tsx
// memanggil bentuk plural '/comments' di atas -- dua-duanya didukung.
router.post('/:id/comment', async (req, res, next) => {
  try {
    res.status(201).json(await createComment(req.params.id, req.user.sub, req.body));
  } catch (err) { next(err); }
});

export default router;
