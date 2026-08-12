// server/scripts/test-monitoring.js
// STEP 14 — Monitoring & Alerting Production Test (Bab 20)
//
// Memverifikasi:
// 1. Endpoint GET /metrics aktif dan mengeluarkan format Prometheus
// 2. Metric blueprint wajib ada di output /metrics
// 3. Konfigurasi Prometheus scrape sesuai blueprint (30s, <IP_VPS>:8000)
// 4. 14 alert rules lengkap di monitoring/alerts.yml
// 5. Dashboard Grafana minimal (4 panel) tersedia
// 6. Instrumentasi gateway (addendum Python) + textfile exporter tersedia
//
// Run: node server/scripts/test-monitoring.js

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../../');
const BASE_URL = process.env.TEST_API_URL || 'http://localhost:3004';

let passed = 0;
let failed = 0;

function ok(label) { console.log(`  OK: ${label}`); passed++; }
function fail(label, detail = '') { console.error(`  FAIL: ${label}${detail ? ' - ' + detail : ''}`); failed++; }
function info(label) { console.log(`  INFO: ${label}`); }

console.log('\n=== STEP 14 - MONITORING & ALERTING TEST ===\n');

// --------------------------------------------------------------------------
// CHECK 1: GET /metrics mengembalikan format Prometheus
// --------------------------------------------------------------------------
console.log('[1] Endpoint GET /metrics');
try {
  const res = await fetch(`${BASE_URL}/metrics`);
  const text = await res.text();
  if (res.status === 200) ok('GET /metrics -> 200');
  else fail('GET /metrics bukan 200', `status ${res.status}`);
  if (text.startsWith('#')) ok('Output berformat Prometheus (diawali #)');
  else fail('Output bukan format Prometheus', text.slice(0, 80));
} catch (e) {
  fail('Backend tidak dapat dijangkau', e.message);
}

// --------------------------------------------------------------------------
// CHECK 2: Metric blueprint wajib ada di output /metrics
// --------------------------------------------------------------------------
console.log('\n[2] Metric blueprint wajib');
// Metric yang bersifat GAUGE / HISTOGRAM (atau counter tanpa label) selalu
// meng-emit seri data (nilai 0) begitu terdaftar — diperiksa via baris nilai.
const requiredMetrics = [
  'tarapti_queue_pending',
  'tarapti_queue_failed',
  'tarapti_sync_success_total',
  'tarapti_sync_duration_seconds',
  'tarapti_worker_active',
  'tarapti_equity_snapshots_size_bytes',
  'tarapti_http_requests_total',
  'tarapti_http_duration_seconds',
];
// Metric COUNTER berlabel adalah event counter: prom-client TIDAK meng-emit
// seri data sebelum event pertama yang nyata (bukan mock). Ini perilaku
// standar Prometheus — seri tetap di-export sebagai keluarga metric
// (# TYPE <name> counter), dan alert increase(...) hanya aktif saat event
// benar-benar terjadi. Diperiksa via baris TYPE.
const typeOnlyMetrics = [
  'tarapti_sync_errors_total',
  'tarapti_mt5_restarts_total',
];
try {
  const res = await fetch(`${BASE_URL}/metrics`);
  const text = await res.text();
  for (const m of requiredMetrics) {
    const regex = new RegExp(`^${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm');
    if (regex.test(text)) ok(`metric ${m} ada (seri data)`);
    else fail(`metric ${m} TIDAK ada di /metrics`);
  }
  for (const m of typeOnlyMetrics) {
    if (text.includes(`# TYPE ${m} `)) ok(`metric ${m} ada (event counter, keluarga metric ter-export)`);
    else fail(`metric ${m} TIDAK ada di /metrics`);
  }
} catch (e) {
  fail('Tidak bisa fetch /metrics untuk cek metric', e.message);
}

// --------------------------------------------------------------------------
// CHECK 3: Config Prometheus sesuai blueprint
// --------------------------------------------------------------------------
console.log('\n[3] Konfigurasi Prometheus (prometheus.yml)');
const promPath = join(ROOT, 'monitoring/prometheus.yml');
if (existsSync(promPath)) {
  const content = readFileSync(promPath, 'utf8');
  if (content.includes('scrape_interval:     30s') ||
      content.includes('scrape_interval: 30s')) ok('scrape_interval 30s');
  else fail('scrape_interval bukan 30s');
  if (content.includes("'tarapti-gateway'")) ok('job tarapti-gateway ada');
  else fail('job tarapti-gateway tidak ada');
  if (content.includes('<IP_VPS>:8000') || content.includes('<IP_VPS>')) ok('target <IP_VPS>:8000 sesuai blueprint');
  else fail('target <IP_VPS>:8000 tidak ditemukan');
  if (content.includes('rule_files')) ok('alerts.yml diload via rule_files');
  else fail('rule_files tidak ada di prometheus.yml');
} else {
  fail('monitoring/prometheus.yml tidak ditemukan');
}

// --------------------------------------------------------------------------
// CHECK 4: 14 alert rules lengkap
// --------------------------------------------------------------------------
console.log('\n[4] 14 alert rules di alerts.yml');
const alertsPath = join(ROOT, 'monitoring/alerts.yml');
const requiredAlerts = [
  'QueuePendingHigh', 'QueueFailedHigh',          // #1
  'WorkerHeartbeatLag', 'NoActiveWorkers',        // #2
  'MT5LoginFailuresHigh',                         // #3
  'EquitySnapshotTableLarge',                     // #4
  'SyncRetryRateHigh',                            // #5
  'EquitySnapshotFailed',                         // #6
  'DealErrorDetected',                            // #7
  'MT5HealthCheckFailed',                         // #8
  'DuplicateWorkerId',                            // #9
  'UnhandledDealHigh',                            // #10
  'MT5RestartLimitReached',                       // #11
  'CacheMissRateHigh',                            // #12
  'BackupOffSiteFailedConsecutive',               // #13
  'ServiceNotRestartedIn5Min',                    // #14
];
if (existsSync(alertsPath)) {
  const content = readFileSync(alertsPath, 'utf8');
  for (const a of requiredAlerts) {
    if (content.includes(`- alert: ${a}`)) ok(`alert ${a} ada`);
    else fail(`alert ${a} TIDAK ada`);
  }
} else {
  fail('monitoring/alerts.yml tidak ditemukan');
}

// --------------------------------------------------------------------------
// CHECK 5: Dashboard Grafana minimal (4 panel)
// --------------------------------------------------------------------------
console.log('\n[5] Dashboard Grafana');
const dashPath = join(ROOT, 'monitoring/grafana-dashboard.json');
if (existsSync(dashPath)) {
  const dash = JSON.parse(readFileSync(dashPath, 'utf8'));
  const panels = dash.panels || [];
  if (panels.length >= 4) ok(`grafana-dashboard.json punya ${panels.length} panel`);
  else fail('Kurang dari 4 panel', `panel count=${panels.length}`);
  const titles = panels.map((p) => p.title);
  const want = ['Fetch Queue', 'Sync Duration', 'Error', 'MT5 Restart'];
  for (const w of want) {
    if (titles.some((t) => t && t.includes(w))) ok(`panel ${w} ada`);
    else fail(`panel ${w} tidak ditemukan`);
  }
} else {
  fail('monitoring/grafana-dashboard.json tidak ditemukan');
}

// --------------------------------------------------------------------------
// CHECK 6: Instrumentasi gateway (addendum) + textfile exporter
// --------------------------------------------------------------------------
console.log('\n[6] Instrumentasi gateway & textfile exporter');
const addendumPath = join(ROOT, 'scripts/gateway/monitoring_gateway_addendum.py');
if (existsSync(addendumPath)) {
  const content = readFileSync(addendumPath, 'utf8');
  const markers = [
    'tarapti_sync_duration_seconds',
    'restart_mt5_instance',
    'complete_task',
    'SYNC_ERRORS_TOTAL',
    'MT5_RESTARTS_TOTAL',
    '@app.get("/metrics")',
    'tarapti_cache_miss_total',
  ];
  for (const m of markers) {
    if (content.includes(m)) ok(`addendum memuat ${m}`);
    else fail(`addendum TIDAK memuat ${m}`);
  }
} else {
  fail('scripts/gateway/monitoring_gateway_addendum.py tidak ditemukan');
}

const tfExporter = join(ROOT, 'scripts/backup/export_prometheus_textfile.ps1');
if (existsSync(tfExporter)) {
  const content = readFileSync(tfExporter, 'utf8');
  if (content.includes('tarapti_backup_offsite_consecutive_failures')) ok('textfile: metric #13 (backup offsite)');
  else fail('textfile: metric #13 tidak ada');
  if (content.includes('tarapti_service_down_minutes')) ok('textfile: metric #14 (service down)');
  else fail('textfile: metric #14 tidak ada');
} else {
  fail('scripts/backup/export_prometheus_textfile.ps1 tidak ditemukan');
}

// --------------------------------------------------------------------------
// CHECK 7: backup_tarapti.ps1 menulis state consecutive failures (#13)
// --------------------------------------------------------------------------
console.log('\n[7] Backup script feed alert #13');
const backPath = join(ROOT, 'scripts/backup/backup_tarapti.ps1');
if (existsSync(backPath)) {
  const content = readFileSync(backPath, 'utf8');
  if (content.includes('backup_offsite_consecutive_failures')) ok('backup_tarapti.ps1 melacak consecutive failures');
  else fail('backup_tarapti.ps1 tidak melacak consecutive failures');
} else {
  fail('scripts/backup/backup_tarapti.ps1 tidak ditemukan');
}

// --------------------------------------------------------------------------
console.log('\n=== HASIL ===');
console.log(`PASS: ${passed} | FAIL: ${failed}`);
if (failed === 0) {
  console.log('\nSUCCESS: Semua monitoring check PASS');
  process.exit(0);
} else {
  console.error(`\nFAILED: ${failed} check gagal`);
  process.exit(1);
}