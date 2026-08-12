// server/scripts/test-coach-contract.js
// STEP 11 — AI Coach Data Contract Test (Bab 16)
//
// Validates GET /api/admin/mt5-accounts/:id/coach-contract returns a valid
// schema v1.0 payload with today + last_7_days fields as required by blueprint.
//
// Run: node server/scripts/test-coach-contract.js

import jwt from 'jsonwebtoken';

const JWT_ACCESS_SECRET = 'dev_dummy_access_secret_change_me';
const BASE_URL     = process.env.TEST_API_URL || 'http://localhost:3004';
const TEST_AKUN_ID = '123456';

// Generate an admin token using the same secret as the backend container
const token = jwt.sign(
  { sub: '00000000-0000-0000-0000-000000000000', email: 'admin@tarapti.com', role: 'admin' },
  JWT_ACCESS_SECRET,
  { expiresIn: '15m' }
);

console.log('--- STARTING AI COACH DATA CONTRACT TEST (STEP 11) ---');
console.log(`Generated Admin Token: ${token.slice(0, 20)}...`);
console.log(`Fetching coach contract for account: ${TEST_AKUN_ID}\n`);

const res = await fetch(`${BASE_URL}/api/admin/mt5-accounts/${TEST_AKUN_ID}/coach-contract`, {
  headers: { Authorization: `Bearer ${token}` },
});

console.log(`Response status: ${res.status}`);
const body = await res.json();
console.log('Response body:', JSON.stringify(body, null, 2));

// ---- Validation ----
let passed = true;
const fail = (msg) => { console.error(`FAIL: ${msg}`); passed = false; };

// Top-level fields
if (body.schema_version !== '1.0')         fail(`schema_version must be "1.0", got "${body.schema_version}"`);
if (typeof body.today       !== 'object')  fail('today must be an object');
if (typeof body.last_7_days !== 'object')  fail('last_7_days must be an object');

// today fields
const todayFields = ['net_profit','total_positions','win_rate','max_drawdown','avg_hold_hours'];
for (const f of todayFields) {
  if (typeof body.today?.[f] !== 'number') fail(`today.${f} must be a number, got ${typeof body.today?.[f]}`);
}

// last_7_days fields (superset of today + sharpe + exposure)
const weekFields = [...todayFields, 'sharpe_ratio', 'exposure_pct'];
for (const f of weekFields) {
  if (typeof body.last_7_days?.[f] !== 'number') fail(`last_7_days.${f} must be a number, got ${typeof body.last_7_days?.[f]}`);
}

// Numeric sanity checks
if (body.today.win_rate       < 0 || body.today.win_rate       > 100) fail('today.win_rate out of range [0,100]');
if (body.last_7_days.win_rate < 0 || body.last_7_days.win_rate > 100) fail('last_7_days.win_rate out of range [0,100]');
if (body.today.max_drawdown       > 0) fail('today.max_drawdown must be <= 0');
if (body.last_7_days.max_drawdown > 0) fail('last_7_days.max_drawdown must be <= 0');

console.log('');
if (passed && res.status === 200) {
  console.log('SUCCESS: AI Coach Data Contract test passed — schema v1.0 valid!');
} else {
  console.error('FAILED: One or more validation checks did not pass.');
  process.exit(1);
}
