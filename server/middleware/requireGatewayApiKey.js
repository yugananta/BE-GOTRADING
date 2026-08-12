// server/middleware/requireGatewayApiKey.js
//
// STEP 12 — KEAMANAN LANJUTAN (Bab 19)
//
// Middleware untuk memverifikasi X-API-KEY pada request masuk dari
// MT5 Gateway (atau internal service lain) menggunakan timing-safe
// comparison (setara hmac.compare_digest di Python) untuk mencegah
// timing attack.
//
// Penggunaan: router.post('/webhook', requireGatewayApiKey, handler)
// Hanya pasang pada route internal yang dipanggil oleh Gateway/worker.

import crypto from 'crypto';
import { MT5GW_API_KEY } from '../config/env.js';

/**
 * Timing-safe string comparison.
 * Setara dengan hmac.compare_digest() di Python (Bab 19).
 * Mencegah timing attack yang bisa mengungkap API key secara bertahap.
 */
function timingSafeEqual(a, b) {
  // Buffer.from + crypto.timingSafeEqual memastikan waktu perbandingan
  // tidak bergantung pada posisi byte yang berbeda.
  try {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    // Panjang harus sama agar timingSafeEqual tidak throw
    if (bufA.length !== bufB.length) {
      // Tetap lakukan comparison dummy dengan bufA vs bufA untuk
      // mempertahankan waktu eksekusi yang konstan (constant-time)
      crypto.timingSafeEqual(bufA, bufA);
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export function requireGatewayApiKey(req, res, next) {
  const provided = req.headers['x-api-key'] || '';

  if (!MT5GW_API_KEY) {
    // Config error — jangan proses lebih lanjut
    console.error('[SECURITY] MT5GW_API_KEY tidak dikonfigurasi');
    return res.status(500).json({ error: 'Konfigurasi server tidak lengkap' });
  }

  if (!timingSafeEqual(provided, MT5GW_API_KEY)) {
    console.warn('[SECURITY] Invalid API key attempt dari', req.ip, 'ke', req.path);
    return res.status(401).json({ error: 'API key tidak valid' });
  }

  next();
}
