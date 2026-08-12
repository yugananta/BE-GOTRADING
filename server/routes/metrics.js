// server/routes/metrics.js
// STEP 14 — GET /metrics endpoint untuk Prometheus scrape (Bab 20.1)
//
// Endpoint ini TIDAK dilindungi auth agar Prometheus bisa scrape tanpa token.
// Batasi akses di level infrastruktur (firewall / private network) —
// jangan ekspos port ke internet publik tanpa perlindungan network.
//
// Scrape config (prometheus.yml di monitoring server):
//   scrape_configs:
//     - job_name: 'tarapti-backend'
//       scrape_interval: 30s
//       static_configs:
//         - targets: ['<RAILWAY_BACKEND_HOST>:443']

import { Router } from 'express';
import { register } from '../monitoring/metrics.js';
import {
  refreshQueueMetrics,
  refreshWorkerMetrics,
  refreshEquitySnapshotSize,
} from '../monitoring/metricsCollector.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    // Update gauge dari DB sebelum generate output
    await Promise.allSettled([
      refreshQueueMetrics(),
      refreshWorkerMetrics(),
      refreshEquitySnapshotSize(),
    ]);

    const metrics = await register.metrics();
    res.set('Content-Type', register.contentType);
    res.send(metrics);
  } catch (err) {
    res.status(500).send('# Error generating metrics\n');
  }
});

export default router;
