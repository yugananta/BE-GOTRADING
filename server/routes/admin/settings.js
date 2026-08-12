// server/routes/admin/settings.js
import { Router } from 'express';
import { getSettings, saveSettings } from '../../services/adminSettingsService.js';
import { logAdminAction } from '../../services/auditService.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try { res.json(await getSettings()); }
  catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const result = await saveSettings(req.body);
    await logAdminAction({ adminId: req.user.sub, action: 'update_settings', targetType: 'admin_settings', targetId: '1' });
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
