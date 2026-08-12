// server/routes/calendar.js
import { Router } from 'express';
import { getCalendar } from '../services/calendarService.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    res.json(await getCalendar());
  } catch (err) { next(err); }
});

export default router;
