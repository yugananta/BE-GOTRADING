// server/routes/validations.js
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  submitValidation,
  getLatestValidationStatus,
} from '../services/validationService.js';

const router = Router();

// POST /api/validations (user, auth required)
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;
    const result = await submitValidation(userId, req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/validations/status (user, auth required)
router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;
    const result = await getLatestValidationStatus(userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
