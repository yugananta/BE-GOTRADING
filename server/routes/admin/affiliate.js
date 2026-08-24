// server/routes/admin/affiliate.js
import { Router } from 'express';
import {
  listAffiliateProfiles,
  getAffiliateProfileDetail,
  listAffiliateReferrals,
  getAffiliateSettings,
  updateAffiliateSettings,
  listAffiliateCommissions,
  updateCommissionStatus,
  listAffiliatePayouts,
  updatePayoutStatus
} from '../../services/affiliateService.js';
import { logAdminAction } from '../../services/auditService.js';

const router = Router();

// 1. Profiles
router.get('/profiles', async (req, res, next) => {
  try {
    const result = await listAffiliateProfiles(req.query);
    res.set('X-Total-Count', String(result.total));
    res.json(result.data);
  } catch (err) { next(err); }
});

router.get('/profiles/:userId', async (req, res, next) => {
  try {
    const result = await getAffiliateProfileDetail(req.params.userId);
    res.json(result);
  } catch (err) { next(err); }
});

// 2. Referrals
router.get('/referrals', async (req, res, next) => {
  try {
    const result = await listAffiliateReferrals(req.query);
    res.set('X-Total-Count', String(result.total));
    res.json(result.data);
  } catch (err) { next(err); }
});

// 3. Settings
router.get('/settings', async (req, res, next) => {
  try {
    const result = await getAffiliateSettings();
    res.json(result);
  } catch (err) { next(err); }
});

router.put('/settings', async (req, res, next) => {
  try {
    const result = await updateAffiliateSettings(req.body);
    await logAdminAction({
      adminId: req.user.sub,
      action: 'update_affiliate_settings',
      targetType: 'affiliate_settings',
      targetId: 'global',
      detail: req.body,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// 4. Commissions
router.get('/commissions', async (req, res, next) => {
  try {
    const result = await listAffiliateCommissions(req.query);
    res.set('X-Total-Count', String(result.total));
    res.json(result.data);
  } catch (err) { next(err); }
});

router.patch('/commissions/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    const result = await updateCommissionStatus(req.params.id, status);
    await logAdminAction({
      adminId: req.user.sub,
      action: 'update_commission_status',
      targetType: 'affiliate_commissions',
      targetId: req.params.id,
      detail: { status },
    });
    res.json(result);
  } catch (err) { next(err); }
});

// 5. Payouts
router.get('/payouts', async (req, res, next) => {
  try {
    const result = await listAffiliatePayouts(req.query);
    res.set('X-Total-Count', String(result.total));
    res.json(result.data);
  } catch (err) { next(err); }
});

router.patch('/payouts/:id', async (req, res, next) => {
  try {
    const result = await updatePayoutStatus(req.params.id, {
      ...req.body,
      processedBy: req.user.sub,
    });
    await logAdminAction({
      adminId: req.user.sub,
      action: 'update_affiliate_payout',
      targetType: 'affiliate_payouts',
      targetId: req.params.id,
      detail: req.body,
    });
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
