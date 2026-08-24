// server/scripts/test-integration-vps.js
// Verification of Step 8: BE -> MT5 Gateway VPS -> MT5 -> Axi E2E Integration

import jwt from 'jsonwebtoken';
import { JWT_ACCESS_SECRET, MT5_GATEWAY_URL } from '../config/env.js';

const BASE_URL = 'http://localhost:3004';
const USER_ID = 'e1a3bc45-5678-4321-8765-abcdefabcdef'; // A random UUID
const EMAIL = 'testuser@tarapti.com';

const userToken = jwt.sign(
  { sub: USER_ID, email: EMAIL, role: 'user' },
  JWT_ACCESS_SECRET,
  { expiresIn: '5m' }
);

const adminToken = jwt.sign(
  { sub: '00000000-0000-0000-0000-000000000000', email: 'admin@tarapti.com', role: 'admin' },
  JWT_ACCESS_SECRET,
  { expiresIn: '5m' }
);

async function runTests() {
  console.log('=== MT5 GATEWAY INTEGRATION E2E TEST ===\n');

  // 1. MT5_GATEWAY_URL terdeteksi
  console.log('[1] Memeriksa Deteksi MT5_GATEWAY_URL...');
  if (MT5_GATEWAY_URL) {
    console.log(`  ✅ MT5_GATEWAY_URL Terdeteksi: ${MT5_GATEWAY_URL}`);
  } else {
    console.log('  ❌ MT5_GATEWAY_URL tidak terdeteksi');
  }

  // 2. BE -> Gateway /health
  console.log('\n[2] Menguji BE -> Gateway /health...');
  try {
    const res = await fetch(`${BASE_URL}/api/admin/mt5/test`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    });
    const data = await res.json();
    console.log('  Response Status:', res.status);
    console.log('  Response Body:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('  ❌ Gagal menghubungi BE admin/mt5/test:', err.message);
  }

  // 3. Connect Account
  console.log('\n[3] Menguji Connect Account...');
  try {
    const res = await fetch(`${BASE_URL}/api/metatrader/connect`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        platform: 'MT5',
        login: '10055800',
        password: 'investor_password_dummy', // Gateway uses connected Axi session
        server: 'Axi-US50-Demo',
        broker: 'Axi'
      })
    });
    const data = await res.json();
    console.log('  Response Status:', res.status);
    console.log('  Response Body:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('  ❌ Gagal menguji connect account:', err.message);
  }

  // 4. Account data
  console.log('\n[4] Menguji Account Data (Read-Only)...');
  try {
    const res = await fetch(`${BASE_URL}/api/metatrader/account`, {
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    const data = await res.json();
    console.log('  Response Status:', res.status);
    console.log('  Response Body:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('  ❌ Gagal membaca data account:', err.message);
  }

  // 5. Positions read (Backend)
  console.log('\n[5] Menguji Positions Read (Read-Only)...');
  console.log('  ℹ️ Endpoint positions tidak tersedia di Backend (N/A).');

  // 6. Trades read
  console.log('\n[6] Menguji Trades Read (Read-Only)...');
  try {
    const res = await fetch(`${BASE_URL}/api/metatrader/trades`, {
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    const data = await res.json();
    console.log('  Response Status:', res.status);
    console.log('  Response Body:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('  ❌ Gagal membaca trades:', err.message);
  }
}

runTests();
