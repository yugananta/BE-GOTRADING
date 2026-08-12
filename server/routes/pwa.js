// server/routes/pwa.js
//
// Profile.tsx: tombol "Simulate Market Pulse Alert" (fitur demo/testing
// untuk user coba rasakan notifikasi push volatilitas market tanpa perlu
// menunggu event asli).

import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { createNotification } from '../services/notificationService.js';

const router = Router();

router.use(requireAuth);

router.post('/market-pulse/simulate', async (req, res, next) => {
  try {
    const assetClass = req.body.assetClass || 'XAUUSD';
    const notification = await createNotification({
      toUserId: req.user.sub,
      fromUserId: null,
      type: 'market_pulse',
      message: `Volatilitas tinggi terdeteksi di ${assetClass} (simulasi)`,
      assetClass,
    });
    res.status(201).json({ notifiedCount: notification ? 1 : 0, chosenAsset: assetClass });
  } catch (err) { next(err); }
});

export default router;
