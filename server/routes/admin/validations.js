// server/routes/admin/validations.js
import { Router } from 'express';
import {
  listAdminValidations,
  approveValidation,
  rejectValidation,
} from '../../services/validationService.js';
import { logAdminAction } from '../../services/auditService.js';

const router = Router();

// GET /api/admin/validations
router.get('/', async (req, res, next) => {
  try {
    const { status, search, page, limit } = req.query;
    const result = await listAdminValidations({ status, search, page, limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/validations/:id/approve
router.post('/:id/approve', async (req, res, next) => {
  try {
    const adminId = req.user.sub || req.user.id;
    const result = await approveValidation(req.params.id, adminId);
    await logAdminAction({
      adminId,
      action: 'approve_validation',
      targetType: 'account_validations',
      targetId: req.params.id,
      detail: `Approved MT5 account validation for account ${result.mt5AccountNumber} (${result.email})`,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/validations/:id/reject
router.post('/:id/reject', async (req, res, next) => {
  try {
    const adminId = req.user.sub || req.user.id;
    const { reason } = req.body || {};
    const result = await rejectValidation(req.params.id, adminId, reason);
    await logAdminAction({
      adminId,
      action: 'reject_validation',
      targetType: 'account_validations',
      targetId: req.params.id,
      detail: `Rejected MT5 account validation for account ${result.mt5AccountNumber} (${result.email}): ${reason || 'No reason specified'}`,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
