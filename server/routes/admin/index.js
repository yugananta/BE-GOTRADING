// server/routes/admin/index.js
//
// Semua route di bawah /api/admin WAJIB login DAN role='admin'.
// Proteksi dipasang SEKALI di sini untuk seluruh sub-router, jadi
// route individual (users.js, mt5Accounts.js, dst.) tidak perlu
// pasang requireAuth/requireAdmin berulang-ulang.

import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireAdmin } from '../../middleware/requireAdmin.js';

import dashboardRoutes from './dashboard.js';
import usersRoutes from './users.js';
import ibRoutes from './ib.js'; // [DEPRECATED] Digantikan oleh affiliateRoutes
import affiliateRoutes from './affiliate.js';
import mt5AccountsRoutes from './mt5Accounts.js';
import logsRoutes from './logs.js';
import newsRoutes from './news.js';
import settingsRoutes from './settings.js';
import integrationsRoutes from './integrations.js';

const router = Router();

router.use(requireAuth, requireAdmin);

router.use('/dashboard', dashboardRoutes);
router.use('/users', usersRoutes);
router.use('/ib', ibRoutes); // [DEPRECATED]
router.use('/affiliate', affiliateRoutes);
router.use('/mt5-accounts', mt5AccountsRoutes);
router.use('/logs', logsRoutes);
router.use('/news', newsRoutes);
router.use('/settings', settingsRoutes);
// Endpoint lepas (bukan sub-resource CRUD): /api/admin/mt5/test,
// /api/admin/news/sync, /api/admin/broadcast -- lihat integrations.js.
router.use('/', integrationsRoutes);

export default router;
