// server/routes/users.js
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  getProfile, getPublicProfile, updateProfile, updateLanguage, searchUsers, searchUsersByLocation, getLeaderboard,
} from '../services/profileService.js';
import { follow, unfollow, isFollowing, listFollowing, listFollowers } from '../services/followService.js';
import {
  requestConnection, respondConnection, getConnectionStatus, listPendingConnections,
} from '../services/connectionService.js';

const router = Router();

router.use(requireAuth);

router.get('/me', async (req, res, next) => {
  try { res.json(await getProfile(req.user.sub)); }
  catch (err) { next(err); }
});

router.patch('/me', async (req, res, next) => {
  try { res.json(await updateProfile(req.user.sub, req.body)); }
  catch (err) { next(err); }
});

router.get('/search', async (req, res, next) => {
  try { res.json(await searchUsers(req.query.q || '', Number(req.query.limit) || 20)); }
  catch (err) { next(err); }
});

router.get('/leaderboard', async (req, res, next) => {
  try { res.json(await getLeaderboard(Number(req.query.limit) || 50)); }
  catch (err) { next(err); }
});

// [ALIAS] Frontend (Network.tsx, Explore.tsx, Messages.tsx, GroupView.tsx,
// App.tsx) memanggil GET /api/users langsung (root) dengan query
// ?search=, ?city=, atau ?province=, bukan /api/users/search.
router.get('/', async (req, res, next) => {
  try {
    const { search, city, province, country, page, limit, paginate } = req.query;
    const pageNum = page ? Math.max(1, parseInt(page, 10)) : 1;
    const limitNum = limit ? Math.min(100, Math.max(1, parseInt(limit, 10))) : 20;

    if (city || province || country) {
      const result = await searchUsersByLocation({
        city,
        province,
        country,
        search,
        page: pageNum,
        limit: limitNum,
      }, req.user?.sub);

      res.setHeader('X-Total-Count', String(result.total));

      // Jika frontend meminta object pagination atau mempassing parameter page
      if (page || paginate === 'true' || paginate === '1') {
        return res.json(result);
      }

      // Backward compatibility: jika pemanggil lama mengharapkan array murni
      return res.json(result.members);
    }

    res.json(await searchUsers(search || '', limitNum));
  } catch (err) { next(err); }
});

// [ALIAS] Frontend memanggil /api/users/profile/:userId (bukan /api/users/me
// atau /api/users/:idOrUsername) untuk lihat & edit profil (Profile.tsx,
// UserProfile.tsx, MarketPulseModal.tsx, Network.tsx).
router.get('/profile/:userId', async (req, res, next) => {
  try {
    const user = await getPublicProfile(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
    res.json(user);
  } catch (err) { next(err); }
});

router.put('/profile/:userId', async (req, res, next) => {
  try {
    if (req.params.userId !== req.user.sub) {
      return res.status(403).json({ error: 'Tidak boleh mengedit profil orang lain' });
    }
    res.json(await updateProfile(req.user.sub, req.body));
  } catch (err) { next(err); }
});

router.put('/profile/:userId/language', async (req, res, next) => {
  try {
    if (req.params.userId !== req.user.sub) {
      return res.status(403).json({ error: 'Tidak boleh mengubah bahasa milik user lain' });
    }
    res.json(await updateLanguage(req.user.sub, req.body.language));
  } catch (err) { next(err); }
});

// --- Follow (satu arah, tanpa approval) ---

router.post('/:targetUserId/follow', async (req, res, next) => {
  try {
    const already = await isFollowing(req.user.sub, req.params.targetUserId);
    if (already) {
      await unfollow(req.user.sub, req.params.targetUserId);
      return res.json({ following: false });
    }
    await follow(req.user.sub, req.params.targetUserId);
    res.json({ following: true });
  } catch (err) { next(err); }
});

router.get('/:userId/follows', async (req, res, next) => {
  try {
    const [following, followers] = await Promise.all([
      listFollowing(req.params.userId),
      listFollowers(req.params.userId),
    ]);
    res.json({ following, followers });
  } catch (err) { next(err); }
});

// --- Connection (dua arah, butuh approval) ---

router.post('/connect', async (req, res, next) => {
  try {
    const receiverId = req.body.targetUserId || req.body.userId || req.body.receiverId;
    res.status(201).json(await requestConnection(req.user.sub, receiverId));
  } catch (err) { next(err); }
});

router.put('/connect/accept', async (req, res, next) => {
  try {
    const requesterId = req.body.targetUserId || req.body.userId || req.body.requesterId;
    res.json(await respondConnection(requesterId, req.user.sub, 'accepted'));
  } catch (err) { next(err); }
});

router.put('/connect/decline', async (req, res, next) => {
  try {
    const requesterId = req.body.targetUserId || req.body.userId || req.body.requesterId;
    res.json(await respondConnection(requesterId, req.user.sub, 'declined'));
  } catch (err) { next(err); }
});

router.get('/:userId/connection-status/:targetId', async (req, res, next) => {
  try {
    res.json(await getConnectionStatus(req.params.userId, req.params.targetId));
  } catch (err) { next(err); }
});

// AppContext.tsx: badge notifikasi permintaan koneksi masuk yang belum
// direspon. Harus tetap di ATAS catch-all :idOrUsername di bawah.
router.get('/:userId/pending-connections', async (req, res, next) => {
  try {
    res.json(await listPendingConnections(req.params.userId));
  } catch (err) { next(err); }
});

// Ditaruh PALING BAWAH -- ini catch-all id/username, harus kalah prioritas
// dari route spesifik di atas.
router.get('/:idOrUsername', async (req, res, next) => {
  try {
    const user = await getPublicProfile(req.params.idOrUsername);
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
    res.json(user);
  } catch (err) { next(err); }
});

export default router;
