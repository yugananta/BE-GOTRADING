import { Router } from 'express';
import { listSyncLogs } from '../../services/logsService.js';
import { listAuditLog } from '../../services/auditService.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    res.json(await listSyncLogs(req.query));
  } catch (err) { next(err); }
});

router.get('/audit', async (req, res, next) => {
  try {
    res.json(await listAuditLog(req.query));
  } catch (err) { next(err); }
});

export default router;
