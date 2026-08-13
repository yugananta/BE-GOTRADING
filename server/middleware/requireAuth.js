// server/middleware/requireAuth.js
//
// Pasang di route yang butuh login: router.get('/x', requireAuth, handler)

import { verifyAccessToken } from '../services/authService.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  console.log(`[BACKEND-AUTH] Path: ${req.method} ${req.path}`);
  if (!header || !header.startsWith('Bearer ')) {
    console.warn('[BACKEND-AUTH] Authorization header missing or does not start with Bearer:', header);
    return res.status(401).json({ error: 'Token tidak ditemukan' });
  }
  const rawToken = header.slice('Bearer '.length).trim().replace(/^["']|["']$/g, '');
  if (!rawToken || rawToken === 'undefined' || rawToken === 'null') {
    console.warn('[BACKEND-AUTH] Empty or malformed token string provided:', header);
    return res.status(401).json({ error: 'Token tidak valid atau kedaluwarsa' });
  }
  try {
    const verified = verifyAccessToken(rawToken); // { sub: userId, email } or { userId }
    console.log('[BACKEND-AUTH-OK] Token verified successfully for sub/userId:', verified.sub || verified.userId);
    req.user = {
      sub: verified.sub || verified.userId,
      email: verified.email,
      role: verified.role || 'user'
    };
    next();
  } catch (err) {
    console.error('[BACKEND-AUTH-ERR] Token verification failed:', err.message);
    return res.status(401).json({ error: 'Token tidak valid atau kedaluwarsa' });
  }
}
