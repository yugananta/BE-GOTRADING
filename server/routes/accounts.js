// server/routes/accounts.js
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

// Deprecate legacy POST /api/accounts to prevent accidental wiping of persistent credentials.
router.post('/', requireAuth, async (req, res, next) => {
  const err = new Error('Endpoint /api/accounts sudah tidak digunakan. Gunakan /api/metatrader/connect agar kredensial dapat disimpan secara aman.');
  err.status = 410; // Gone
  next(err);
});

// Deprecate legacy GET /api/accounts/:akunId/status.
router.get('/:akunId/status', requireAuth, async (req, res, next) => {
  const err = new Error('Endpoint /api/accounts/:akunId/status sudah tidak digunakan. Gunakan GET /api/metatrader/account.');
  err.status = 410; // Gone
  next(err);
});

export default router;
