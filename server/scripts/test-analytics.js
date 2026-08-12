import jwt from 'jsonwebtoken';

const JWT_ACCESS_SECRET = 'dev_dummy_access_secret_change_me';
const BACKEND_URL = 'http://localhost:3004';

async function testAnalytics() {
  console.log('--- STARTING ANALYTICS ENGINE TEST ---');

  // 1. Generate trusted Admin Token
  const token = jwt.sign(
    { sub: '00000000-0000-0000-0000-000000000000', email: 'admin@tarapti.com', role: 'admin' },
    JWT_ACCESS_SECRET,
    { expiresIn: '15m' }
  );
  console.log(`Generated Admin Token: ${token.substring(0, 15)}...`);

  // 2. Fetch MT5 Account Analytics from Backend
  const targetAccountId = '123456';
  console.log(`Fetching analytics for account: ${targetAccountId}`);
  
  const res = await fetch(`${BACKEND_URL}/api/admin/mt5-accounts/${targetAccountId}/analytics`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  console.log(`Response status: ${res.status}`);
  const data = await res.json();
  console.log('Response body:', JSON.stringify(data, null, 2));

  // 3. Assertions
  if (res.status !== 200) {
    console.error('FAIL: Status code is not 200');
    process.exit(1);
  }

  if (typeof data.totalPosisi !== 'number' || typeof data.winRate !== 'number' || typeof data.netProfit !== 'number') {
    console.error('FAIL: Missing or invalid aggregate analytics keys');
    process.exit(1);
  }

  if (!Array.isArray(data.equityCurve)) {
    console.error('FAIL: equityCurve is not an array');
    process.exit(1);
  }

  console.log('SUCCESS: Analytics Engine test passed perfectly!');
  process.exit(0);
}

testAnalytics().catch((err) => {
  console.error('FAIL: Unhandled exception', err);
  process.exit(1);
});
