// server/middleware/requireAuth.js
//
// Pasang di route yang butuh login: router.get('/x', requireAuth, handler)

import { verifyAccessToken } from '../services/authService.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token tidak ditemukan' });
  }
  const token = header.slice('Bearer '.length);
  try {
    const verified = verifyAccessToken(token); // { sub: userId, email } or { userId }
    req.user = {
      sub: verified.sub || verified.userId,
      email: verified.email,
      role: verified.role || 'user'
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Token tidak valid atau kedaluwarsa' });
  }
}
