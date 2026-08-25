// server/routes/settings.js
//
// Endpoint publik untuk membaca pengaturan umum yang aman (non-sensitif),
// seperti openAccountUrl. Terbuka tanpa auth admin.

import { Router } from 'express';
import { getPublicSettings } from '../services/adminSettingsService.js';

const router = Router();

// GET /api/settings/public
router.get('/public', async (req, res, next) => {
  try {
    const data = await getPublicSettings();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
