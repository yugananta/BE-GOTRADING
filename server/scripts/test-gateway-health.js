// server/scripts/test-gateway-health.js
// Verification script for Step 8: Connect BE Railway to MT5 Gateway VPS
//
// Run: node server/scripts/test-gateway-health.js

import jwt from 'jsonwebtoken';
import { testMt5Connection } from '../services/adminSettingsService.js';
import { JWT_ACCESS_SECRET, MT5_GATEWAY_URL } from '../config/env.js';

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:3005';

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

console.log('\n=== STEP 8 — MT5 GATEWAY VPS CONNECTION TEST ===\n');

// --------------------------------------------------------------------------
// TEST 1: Direct function call to testMt5Connection()
// --------------------------------------------------------------------------
console.log('[1] Testing direct connection function (testMt5Connection)');
try {
  console.log(`  Connecting to MT5 Gateway at: ${MT5_GATEWAY_URL}`);
  const result = await testMt5Connection();
  console.log('  Result:', JSON.stringify(result, null, 2));
  if (result && result.status === 'connected') {
    ok('Successfully reached MT5 Gateway and confirmed Axi account connected.');
  } else {
    fail('Reached MT5 Gateway, but status was not "connected".', JSON.stringify(result));
  }
} catch (err) {
  fail('Failed to connect to MT5 Gateway.', err.stack || err.message);
}

// --------------------------------------------------------------------------
// TEST 2: Endpoint GET /health of MT5 Gateway directly (verifikasi url env)
// --------------------------------------------------------------------------
console.log('\n[2] Testing direct GET /health to MT5 Gateway URL');
try {
  const res = await fetch(`${MT5_GATEWAY_URL}/health`);
  const data = await res.json();
  if (res.status === 200 && data.status === 'connected') {
    ok(`Gateway responds 200 OK with connected status (Broker: ${data.broker})`);
  } else {
    fail(`Gateway returned non-success response`, `${res.status} ${JSON.stringify(data)}`);
  }
} catch (err) {
  fail('Could not reach Gateway URL directly', err.message);
}

// --------------------------------------------------------------------------
// TEST 3: Admin HTTP route /api/admin/mt5/test
// --------------------------------------------------------------------------
console.log('\n[3] Testing admin HTTP route /api/admin/mt5/test');
try {
  const adminToken = jwt.sign(
    { sub: '00000000-0000-0000-0000-000000000000', email: 'admin@tarapti.com', role: 'admin' },
    JWT_ACCESS_SECRET,
    { expiresIn: '5m' }
  );

  console.log(`  Sending POST request to ${BASE_URL}/api/admin/mt5/test`);
  const res = await fetch(`${BASE_URL}/api/admin/mt5/test`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    }
  });

  const body = await res.json();
  console.log('  Response:', JSON.stringify(body, null, 2));

  if (res.status === 200 && body.status === 'connected') {
    ok('Backend Admin API successfully proxied connection test to MT5 Gateway and returned connected status.');
  } else {
    fail('Backend Admin API returned non-success response', `${res.status} ${JSON.stringify(body)}`);
  }
} catch (err) {
  fail('Backend Admin API could not be reached', err.message);
}

// --------------------------------------------------------------------------
console.log('\n=== HASIL ===');
console.log(`PASS: ${passed} | FAIL: ${failed}`);
if (failed === 0) {
  console.log('\nSUCCESS: MT5 Gateway VPS connection test PASS ✅');
  process.exit(0);
} else {
  console.error(`\nFAILED: ${failed} check gagal ❌`);
  process.exit(1);
}
