// server/routes/admin/integrations.js
//
// Endpoint lepas yang dipanggil AdminPortal.tsx di path /api/admin/mt5/test
// dan /api/admin/broadcast (bukan di bawah /api/admin/mt5-accounts atau
// /api/admin/news, jadi ditaruh terpisah supaya path-nya persis sama).

import { Router } from 'express';
import { testMt5Connection } from '../../services/adminSettingsService.js';
import { sendBroadcast } from '../../services/broadcastService.js';
import { refreshNewsCache } from '../../services/newsService.js';
import { logAdminAction } from '../../services/auditService.js';

const router = Router();

router.post('/mt5/test', async (req, res, next) => {
  try { res.json(await testMt5Connection()); }
  catch (err) { next(err); }
});

router.post('/news/sync', async (req, res, next) => {
  try {
    const articles = await refreshNewsCache();
    await logAdminAction({ adminId: req.user.sub, action: 'sync_news', targetType: 'news_cache', targetId: 'news' });
    res.json({ message: 'Berita berhasil disinkronkan.', articles });
  } catch (err) { next(err); }
});

router.post('/broadcast', async (req, res, next) => {
  try {
    const result = await sendBroadcast(req.body);
    await logAdminAction({ adminId: req.user.sub, action: 'broadcast', targetType: 'notifications', targetId: 'all', detail: req.body });
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
