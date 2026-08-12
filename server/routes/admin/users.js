import { Router } from 'express';
import { listUsers, getUserDetail, updateUser, suspendUser } from '../../services/userAdminService.js';
import { logAdminAction } from '../../services/auditService.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const result = await listUsers(req.query);
    // AdminPortal.tsx (setUsersList(data)) mengharapkan array langsung,
    // bukan objek {data, total, page}. Info paginasi dikirim lewat header
    // supaya tetap tersedia untuk konsumen lain yang butuh.
    res.set('X-Total-Count', String(result.total));
    res.json(result.data);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    res.json(await getUserDetail(req.params.id));
  } catch (err) { next(err); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const result = await updateUser(req.params.id, req.body);
    await logAdminAction({
      adminId: req.user.sub, action: 'update_user',
      targetType: 'user', targetId: req.params.id, detail: req.body,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// [ALIAS] AdminPortal.tsx memakai PUT, bukan PATCH.
router.put('/:id', async (req, res, next) => {
  try {
    const result = await updateUser(req.params.id, req.body);
    await logAdminAction({
      adminId: req.user.sub, action: 'update_user',
      targetType: 'user', targetId: req.params.id, detail: req.body,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// AdminPortal.tsx menyebutnya "suspend/delete" -- diimplementasikan sebagai
// SUSPEND (status='suspended'), BUKAN hard delete, supaya reversibel dan
// tidak menghapus histori/relasi data user tsb (post, komentar, dst).
router.delete('/:id', async (req, res, next) => {
  try {
    const result = await suspendUser(req.params.id);
    await logAdminAction({
      adminId: req.user.sub, action: 'suspend_user',
      targetType: 'user', targetId: req.params.id,
    });
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
