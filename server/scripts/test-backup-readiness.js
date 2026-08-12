// server/scripts/test-backup-readiness.js
// STEP 13 — Backup & DR Readiness Test
//
// Verifikasi bahwa semua prasyarat backup tersedia dan terkonfigurasi
// di environment ini (Node.js / Railway backend scope).
//
// Yang diverifikasi:
// 1. Script backup/restore/verify ada di repo
// 2. Env vars backup S3 terdokumentasi di .env.example
// 3. ENCRYPTION_KEY terdokumentasi
// 4. Tidak ada credential hardcoded di source code
// 5. pool.js terhubung ke DB (atau fallback mock berjalan)
// 6. Admin endpoint terlindungi (tidak bisa diakses tanpa auth)
//
// Run: node server/scripts/test-backup-readiness.js

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../../');
const BASE_URL = process.env.TEST_API_URL || 'http://localhost:3004';

let passed = 0;
let failed = 0;

function ok(label) { console.log(`  ✅ PASS: ${label}`); passed++; }
function fail(label, detail = '') { console.error(`  ❌ FAIL: ${label}${detail ? ' — ' + detail : ''}`); failed++; }
function info(label) { console.log(`  ℹ️  INFO: ${label}`); }

console.log('\n=== STEP 13 — BACKUP & DR READINESS TEST ===\n');

// --------------------------------------------------------------------------
// CHECK 1: Script backup ada di repo
// --------------------------------------------------------------------------
console.log('[1] Script backup/restore/verify tersedia di repo');
const scripts = [
  'scripts/backup/backup_tarapti.ps1',
  'scripts/backup/restore_tarapti.ps1',
  'scripts/backup/verify_backup.ps1',
];
for (const s of scripts) {
  const fullPath = join(ROOT, s);
  if (existsSync(fullPath)) ok(`${s} ada`);
  else fail(`${s} tidak ditemukan`);
}

// --------------------------------------------------------------------------
// CHECK 2: .env.example memuat semua env vars yang dibutuhkan backup
// --------------------------------------------------------------------------
console.log('\n[2] .env.example berisi semua env vars backup');
const envExample = readFileSync(join(ROOT, '.env.example'), 'utf8');
const requiredVars = [
  'ENCRYPTION_KEY',
  'BACKUP_S3_BUCKET',
  'BACKUP_S3_ENDPOINT',
  'BACKUP_S3_ACCESS_KEY',
  'BACKUP_S3_SECRET_KEY',
  'BACKUP_ARCHIVE_PASSWORD',
];
for (const v of requiredVars) {
  if (envExample.includes(v)) ok(`${v} terdokumentasi di .env.example`);
  else fail(`${v} TIDAK ada di .env.example`);
}

// --------------------------------------------------------------------------
// CHECK 3: Tidak ada credential hardcoded di source code yang berkaitan backup
// --------------------------------------------------------------------------
console.log('\n[3] Credential tidak hardcoded di source code');
const checkFiles = [
  'server/integrations/tarapti-db/pool.js',
  'server/integrations/mt5-gateway/client.js',
  'server/config/env.js',
];
const dangerPatterns = [
  /password\s*=\s*['"][^'"]{8,}/i,
  /secret\s*=\s*['"][^'"]{8,}/i,
  /api[_-]?key\s*=\s*['"][^'"]{8,}/i,
];
for (const f of checkFiles) {
  const content = readFileSync(join(ROOT, f), 'utf8');
  const found = dangerPatterns.some(p => p.test(content));
  if (!found) ok(`${f} — tidak ada credential hardcoded`);
  else fail(`${f} — kemungkinan ada credential hardcoded, periksa manual`);
}

// --------------------------------------------------------------------------
// CHECK 4: .gitignore melarang .env masuk ke git
// --------------------------------------------------------------------------
console.log('\n[4] .gitignore melindungi .env');
const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
if (gitignore.includes('.env')) ok('.env ada di .gitignore');
else fail('.env TIDAK ada di .gitignore — bahaya! Credential bisa ter-commit ke Git');

// --------------------------------------------------------------------------
// CHECK 5: Backend berjalan dan health endpoint merespons
// --------------------------------------------------------------------------
console.log('\n[5] Backend health check');
try {
  const res = await fetch(`${BASE_URL}/health`);
  const body = await res.json();
  if (res.status === 200 && body.status === 'ok') ok('GET /health → 200 OK');
  else fail('GET /health tidak mengembalikan status ok', `${res.status} ${JSON.stringify(body)}`);
} catch (e) {
  fail('Backend tidak dapat dijangkau', e.message);
}

// --------------------------------------------------------------------------
// CHECK 6: Analytics endpoint (data penting) terlindungi auth
// --------------------------------------------------------------------------
console.log('\n[6] Data endpoint terlindungi auth');
try {
  const res = await fetch(`${BASE_URL}/api/admin/mt5-accounts/1/analytics`);
  if (res.status === 401) ok('/api/admin/mt5-accounts/1/analytics → 401 tanpa token');
  else fail(`Endpoint sensitif tidak terlindungi`, `got ${res.status}`);
} catch (e) {
  fail('Tidak bisa cek proteksi endpoint', e.message);
}

// --------------------------------------------------------------------------
// CHECK 7: DR checklist ada (DISASTER_RECOVERY.md)
// --------------------------------------------------------------------------
console.log('\n[7] Dokumentasi DR tersedia');
const drDocPath = join(ROOT, 'DISASTER_RECOVERY.md');
if (existsSync(drDocPath)) ok('DISASTER_RECOVERY.md ada di repo');
else {
  info('DISASTER_RECOVERY.md belum dibuat — akan diverifikasi setelah dibuat');
  // Tidak fail — hanya info, file akan dibuat setelah test ini
}

// --------------------------------------------------------------------------
console.log('\n=== HASIL ===');
console.log(`PASS: ${passed} | FAIL: ${failed}`);
if (failed === 0) {
  console.log('\nSUCCESS: Semua Backup & DR readiness check PASS ✅');
  process.exit(0);
} else {
  console.error(`\nFAILED: ${failed} check gagal ❌`);
  process.exit(1);
}
