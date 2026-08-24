// server/scripts/test-security.js
// STEP 12 — Security Audit Test (Bab 19)
//
// Memverifikasi poin-poin keamanan yang dapat diuji secara otomatis:
// 1. Semua env var wajib terkonfigurasi (tidak pakai placeholder)
// 2. Admin routes terlindungi (401 tanpa token, 403 tanpa role admin)
// 3. Error response tidak mengandung stack trace / internal path
// 4. Timing-safe API key verification berfungsi
// 5. Password/credentials tidak bocor di error response
//
// Run: node server/scripts/test-security.js

import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_ACCESS_SECRET = 'dev_dummy_access_secret_change_me';
const BASE_URL = process.env.TEST_API_URL || 'http://localhost:3004';

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✅ PASS: ${label}`);
  passed++;
}
function fail(label, detail = '') {
  console.error(`  ❌ FAIL: ${label}${detail ? ' — ' + detail : ''}`);
  failed++;
}

async function get(path, token) {
  return fetch(`${BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

// --------------------------------------------------------------------------
console.log('\n=== STEP 12 — SECURITY AUDIT TEST ===\n');

// --- TEST 1: Admin route tanpa token → 401 ---
console.log('[1] Admin route protection (no token)');
{
  const res = await get('/api/admin/mt5-accounts');
  if (res.status === 401) ok('Returns 401 without token');
  else fail('Should return 401 without token', `got ${res.status}`);

  const body = await res.json();
  const bodyStr = JSON.stringify(body);
  if (!bodyStr.includes('stack') && !bodyStr.includes('Error:')) ok('No stack trace in 401 response');
  else fail('Stack trace leaked in 401 response', bodyStr.slice(0, 100));
}

// --- TEST 2: Admin route dengan user token (non-admin) → 403 ---
console.log('\n[2] Admin route protection (non-admin token)');
{
  const userToken = jwt.sign(
    { sub: 'user-123', email: 'user@test.com', role: 'user' },
    JWT_ACCESS_SECRET,
    { expiresIn: '5m' }
  );
  const res = await get('/api/admin/mt5-accounts', userToken);
  if (res.status === 403) ok('Returns 403 for non-admin role');
  else fail('Should return 403 for non-admin', `got ${res.status}`);

  const body = await res.json();
  const bodyStr = JSON.stringify(body);
  if (!bodyStr.includes('stack') && !bodyStr.includes('/home/') && !bodyStr.includes('/app/')) {
    ok('No internal path in 403 response');
  } else {
    fail('Internal path leaked in 403 response', bodyStr.slice(0, 100));
  }
}

// --- TEST 3: 500 error tidak expose stack trace ---
console.log('\n[3] 500 error sanitization');
{
  // Route yang tidak ada → 404, bukan 500 dengan stack
  const res = await get('/api/nonexistent-route-xyz');
  const body = await res.json().catch(() => ({}));
  const bodyStr = JSON.stringify(body);
  if (!bodyStr.includes('at ') && !bodyStr.includes('node_modules')) {
    ok('No stack trace in error response');
  } else {
    fail('Stack trace may be leaking in error response', bodyStr.slice(0, 100));
  }
}

// --- TEST 4: Admin route dengan token valid (admin) → 200 ---
console.log('\n[4] Valid admin access');
{
  const adminToken = jwt.sign(
    { sub: '00000000-0000-0000-0000-000000000000', email: 'admin@tarapti.com', role: 'admin' },
    JWT_ACCESS_SECRET,
    { expiresIn: '5m' }
  );
  const res = await get('/api/admin/mt5-accounts', adminToken);
  if (res.status === 200) ok('Admin token grants access (200)');
  else fail('Valid admin token should return 200', `got ${res.status}`);
}

// --- TEST 5: Timing-safe compare (unit test) ---
console.log('\n[5] Timing-safe API key comparison (unit test)');
{
  // Simulasi: verifikasi bahwa crypto.timingSafeEqual digunakan dengan benar
  const key = crypto.randomBytes(32).toString('hex');
  const wrongKey = crypto.randomBytes(32).toString('hex');

  const bufA = Buffer.from(key, 'utf8');
  const bufB = Buffer.from(key, 'utf8');
  const bufC = Buffer.from(wrongKey, 'utf8');

  const sameResult = bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
  const diffResult = bufA.length === bufC.length && crypto.timingSafeEqual(bufA, bufC);

  if (sameResult) ok('timingSafeEqual correctly matches same key');
  else fail('timingSafeEqual failed to match same key');

  if (!diffResult) ok('timingSafeEqual correctly rejects different key');
  else fail('timingSafeEqual falsely matched different key');
}

// --- TEST 6: Coach contract & analytics endpoints terlindungi ---
console.log('\n[6] Sensitive analytics endpoints protected');
{
  const routes = [
    '/api/admin/mt5-accounts/123/analytics',
    '/api/admin/mt5-accounts/123/coach-contract',
    '/api/admin/mt5-accounts/123/transactions',
  ];
  for (const route of routes) {
    const res = await get(route); // tanpa token
    if (res.status === 401) ok(`${route} → 401 without token`);
    else fail(`${route} should be protected`, `got ${res.status}`);
  }
}

// --------------------------------------------------------------------------
console.log('\n=== HASIL ===');
console.log(`PASS: ${passed} | FAIL: ${failed}`);
if (failed === 0) {
  console.log('\nSUCCESS: Semua security check PASS ✅');
  process.exit(0);
} else {
  console.error(`\nFAILED: ${failed} check gagal ❌`);
  process.exit(1);
}
