// server/routes/auth.js
import { Router } from 'express';
import {
  registerUser, loginUser, refreshAccessToken,
  checkAvailability, requestPasswordReset, resetPassword, getUserById,
} from '../services/authService.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

router.post('/register', async (req, res, next) => {
  try {
    const result = await registerUser(req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const result = await loginUser(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const refreshToken = req.body?.refreshToken || req.body?.refresh_token || req.body?.token;
    const result = await refreshAccessToken(refreshToken);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Auth.tsx: dicek real-time saat user mengetik email di form registrasi.
router.get('/check-availability', async (req, res, next) => {
  try {
    res.json(await checkAvailability({ email: req.query.email, username: req.query.username }));
  } catch (err) {
    next(err);
  }
});

// JWT bersifat stateless, jadi tidak ada state server yang perlu dihapus.
// Endpoint ini disediakan supaya frontend punya sesuatu untuk dipanggil
// sebelum menghapus token dari localStorage (Account.tsx / Profile.tsx).
router.post('/logout', async (req, res) => {
  res.json({ success: true });
});

router.post('/forgot-password', async (req, res, next) => {
  try {
    res.json(await requestPasswordReset(req.body.email));
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    res.json(await resetPassword(req.body.token, req.body.password || req.body.newPassword));
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    res.json(await getUserById(req.user.sub));
  } catch (err) {
    next(err);
  }
});

export default router;
