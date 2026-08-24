import { Router } from 'express';
import {
  listMt5Accounts, resyncAccount, getAccountAnalytics,
  getAccountTransactions, getCoachContract,
} from '../../services/mt5AdminService.js';
import { logAdminAction } from '../../services/auditService.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    res.json(await listMt5Accounts(req.query));
  } catch (err) { next(err); }
});

router.post('/:id/resync', async (req, res, next) => {
  try {
    const result = await resyncAccount(req.params.id);
    await logAdminAction({
      adminId: req.user.sub, action: 'resync_account',
      targetType: 'mt5_account', targetId: req.params.id,
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/:id/analytics', async (req, res, next) => {
  try {
    res.json(await getAccountAnalytics(req.params.id));
  } catch (err) { next(err); }
});

// STEP 11 — AI Coach Data Contract (schema v1.0, Bab 16)
router.get('/:id/coach-contract', async (req, res, next) => {
  try {
    res.json(await getCoachContract(req.params.id));
  } catch (err) { next(err); }
});

router.get('/:id/transactions', async (req, res, next) => {
  try {
    res.json(await getAccountTransactions(req.params.id, req.query));
  } catch (err) { next(err); }
});

export default router;
