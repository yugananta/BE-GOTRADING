// BE-GOTRADING/server/scripts/test-production-backend.js
import jwt from 'jsonwebtoken';

const JWT_ACCESS_SECRET = '387fcbae1d474c2621b23f668f95a8cb2147b03c5bdbd61ab5710739b18871e7';
const BASE_URL = 'https://be-gotrading-production.up.railway.app';
const USER_ID = '13ecaf22-7f34-4430-9750-2a74d79c910a';
const EMAIL = 'blehkenzz@gmail.com';
const ACCOUNT_ID = '10056027';

// Generate token valid for 1 hour
const token = jwt.sign(
  { sub: USER_ID, email: EMAIL, role: 'user' },
  JWT_ACCESS_SECRET,
  { expiresIn: '1h' }
);

console.log('Generated JWT Token:', token);

async function checkTrades() {
  const url = `${BASE_URL}/api/metatrader/trades?akunId=${ACCOUNT_ID}`;
  console.log(`Fetching from: ${url}`);

  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    console.log(`HTTP Status: ${res.status}`);
    const body = await res.json();
    
    if (res.ok) {
      const trades = body.trades || [];
      console.log(`Success! Total trades returned: ${trades.length}`);
      
      const openTrades = trades.filter(t => t.status === 'OPEN');
      const closedTrades = trades.filter(t => t.status === 'CLOSED');
      console.log(`- Open/Floating trades: ${openTrades.length}`);
      console.log(`- Closed trades: ${closedTrades.length}`);

      if (closedTrades.length > 0) {
        console.log('Sample closed trade:', JSON.stringify(closedTrades[0], null, 2));
      } else {
        console.log('WARNING: Closed trades count is 0. Check database sync.');
      }
    } else {
      console.error('API Error Response:', JSON.stringify(body, null, 2));
    }
  } catch (err) {
    console.error('Fetch failed:', err);
  }
}

checkTrades();
