// server/monitoring/metrics.js
// STEP 14 — MONITORING & ALERTING PRODUKSI (Bab 20)
//
// Registry Prometheus metrics terpusat untuk Railway backend.
// Metrics ini mencerminkan kondisi backend → TARAPTI DB dan MT5 Gateway,
// melengkapi metrics dari sisi VPS (worker_v3.py + app.py Python).
//
// Metrics blueprint yang diimplementasikan di sini (Node.js scope):
//   - tarapti_queue_pending   : query fetch_queue status=pending
//   - tarapti_queue_failed    : query fetch_queue status=failed
//   - tarapti_sync_errors_total : counter per error_type dari backend calls
//   - tarapti_sync_success_total : counter sync sukses (gateway 2xx)
//   - tarapti_sync_duration_seconds : histogram durasi operasi sync
//   - tarapti_worker_active   : query worker_registry status=active
//   - tarapti_equity_snapshots_size_bytes : ukuran tabel + partisi equity_snapshots
//   - tarapti_http_requests_total : counter semua request masuk
//   - tarapti_http_duration_seconds : histogram latency endpoint
//
// Metrics berikut ada di sisi VPS Python (dijelaskan di
// scripts/gateway/monitoring_gateway_addendum.py + monitoring/README.md):
//   - tarapti_sync_duration_seconds (worker_v3.py, sumber utama)
//   - tarapti_mt5_restarts_total    (restart_mt5_instance)
//   - tarapti_mt5_login_failures_total
//   - tarapti_mt5_health_check_consecutive_failures
//   - tarapti_worker_heartbeat_seconds
//   - tarapti_duplicate_worker_id_total
//   - tarapti_cache_miss_total
//   - tarapti_log_action_total
//   - tarapti_service_down_minutes
//   - tarapti_backup_offsite_consecutive_failures

import client from 'prom-client';

// Aktifkan default metrics Node.js (heap, GC, event loop lag, dll)
const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'tarapti_node_' });

// ---------------------------------------------------------------------------
// QUEUE METRICS (update saat /metrics dipanggil, via query ringan ke DB)
// ---------------------------------------------------------------------------
export const QUEUE_PENDING = new client.Gauge({
  name: 'tarapti_queue_pending',
  help: 'Jumlah akun berstatus pending di fetch_queue',
  registers: [register],
});

export const QUEUE_FAILED = new client.Gauge({
  name: 'tarapti_queue_failed',
  help: 'Jumlah akun berstatus failed di fetch_queue',
  registers: [register],
});

export const WORKER_ACTIVE = new client.Gauge({
  name: 'tarapti_worker_active',
  help: 'Jumlah worker berstatus active di worker_registry',
  registers: [register],
});

// ---------------------------------------------------------------------------
// ERROR + SUCCESS COUNTERS
// ---------------------------------------------------------------------------
export const SYNC_ERRORS_TOTAL = new client.Counter({
  name: 'tarapti_sync_errors_total',
  help: 'Total sync error dari backend (gateway timeout, db error, dll)',
  labelNames: ['error_type'],
  registers: [register],
});

export const SYNC_SUCCESS_TOTAL = new client.Counter({
  name: 'tarapti_sync_success_total',
  help: 'Total operasi sinkronisasi yang berhasil (gateway merespons 2xx)',
  registers: [register],
});

// ---------------------------------------------------------------------------
// SYNC DURATION — blueprint metric tarapti_sync_duration_seconds.
// Di backend Node: mengukur operasi sinkronisasi yang DIPICU dari sini
// (register account, trigger resync). Sumber utama durasi full sync-cycle
// tetap di worker_v3.py sisi gateway (metric dengan nama yang sama di-export
// oleh job tarapti-gateway) — lihat monitoring_gateway_addendum.py.
// ---------------------------------------------------------------------------
// Sesuai blueprint Bab 20.1: Histogram TANPA label (identik dengan definisi
// di worker_v3.py). Tanpa label, prom-client langsung meng-emit seri nol
// saat proses start, jadi metric selalu tampil di /metrics sebelum event
// pertama terjadi.
export const SYNC_DURATION = new client.Histogram({
  name: 'tarapti_sync_duration_seconds',
  help: 'Durasi satu siklus operasi sync per akun (detik)',
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 300],
  registers: [register],
});

// ---------------------------------------------------------------------------
// EQUITY SNAPSHOT TABLE SIZE (alert #4 — periksa ukuran partisi)
// ---------------------------------------------------------------------------
export const EQUITY_SNAPSHOTS_SIZE_BYTES = new client.Gauge({
  name: 'tarapti_equity_snapshots_size_bytes',
  help: 'Ukuran tabel equity_snapshots termasuk seluruh partisinya (bytes)',
  registers: [register],
});

// Alert #3 — MT5 login failures counter
export const MT5_LOGIN_FAILURES = new client.Counter({
  name: 'tarapti_mt5_login_failures_total',
  help: 'Total kegagalan login MT5 (per akun)',
  labelNames: ['akun_id'],
  registers: [register],
});

// Alert #6/#7 — equity_snapshot_failed, deal_error dari logs
export const LOG_ACTION_TOTAL = new client.Counter({
  name: 'tarapti_log_action_total',
  help: 'Total log entry per action type (equity_snapshot_failed, deal_error, unhandled_deal)',
  labelNames: ['action'],
  registers: [register],
});

// ---------------------------------------------------------------------------
// HTTP INSTRUMENTATION
// ---------------------------------------------------------------------------
export const HTTP_REQUESTS_TOTAL = new client.Counter({
  name: 'tarapti_http_requests_total',
  help: 'Total HTTP request ke backend',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

export const HTTP_DURATION = new client.Histogram({
  name: 'tarapti_http_duration_seconds',
  help: 'Durasi HTTP request backend (detik)',
  labelNames: ['method', 'route'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});

// ---------------------------------------------------------------------------
// MT5 GATEWAY METRICS
// ---------------------------------------------------------------------------
export const MT5_RESTARTS_TOTAL = new client.Counter({
  name: 'tarapti_mt5_restarts_total',
  help: 'Total restart MT5 yang di-trigger via backend',
  labelNames: ['instance_path'],
  registers: [register],
});

export const GATEWAY_REQUEST_DURATION = new client.Histogram({
  name: 'tarapti_gateway_request_duration_seconds',
  help: 'Durasi request ke MT5 Gateway (detik)',
  labelNames: ['endpoint'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 15],
  registers: [register],
});

export { register };
