// server/middleware/httpMetrics.js
// STEP 14 — HTTP instrumentation middleware.
//
// Catat tarapti_http_requests_total dan tarapti_http_duration_seconds
// untuk setiap request masuk ke backend.
// Pasang di index.js sebelum semua route.

import { HTTP_REQUESTS_TOTAL, HTTP_DURATION } from '../monitoring/metrics.js';

// Normalisasi path — ganti :id dan UUID agar tidak kardinalitas meledak
function normalizePath(path) {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid')
    .replace(/\/\d+/g, '/:id');
}

export function httpMetricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  const route = normalizePath(req.path);

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e9;
    HTTP_REQUESTS_TOTAL.labels(req.method, route, String(res.statusCode)).inc();
    HTTP_DURATION.labels(req.method, route).observe(durationMs);
  });

  next();
}
