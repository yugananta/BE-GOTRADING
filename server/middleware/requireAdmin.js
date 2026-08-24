// server/middleware/requireAdmin.js
//
// Pasang SETELAH requireAuth: router.get('/x', requireAuth, requireAdmin, handler)
// Mengandalkan req.user (hasil decode JWT dari requireAuth), field `role`
// sudah disertakan di token sejak login (lihat authService.signAccessToken).

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Akses ditolak, khusus admin' });
  }
  next();
}
