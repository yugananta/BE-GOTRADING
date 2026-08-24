// server/scripts/audit-persistence-matrix.js
//
// DIAGNOSTIC AUDIT FOR MT5 ACCOUNT PERSISTENCE
// Runs Test Matrix A - E against Supabase DB and MetaTrader Services

process.env.NODE_ENV = 'test';
process.env.MT5_GATEWAY_URL = 'http://127.0.0.1:8138';
process.env.SUPABASE_URL = 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key';
process.env.JWT_ACCESS_SECRET = 'audit-test-access-secret-123456789';
process.env.JWT_REFRESH_SECRET = 'audit-test-refresh-secret-123456789';
process.env.MT5_CREDENTIAL_ENCRYPTION_KEY = Buffer.from('b'.repeat(32)).toString('base64');

import http from 'http';
import jwt from 'jsonwebtoken';

const mockGwSession = { login: 50066941, server: 'Axi-US50-Demo', broker: 'Axi', connected: true };

const gwServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (req.url === '/account') {
    return res.end(JSON.stringify({
      login: mockGwSession.login, server: mockGwSession.server, broker: mockGwSession.broker,
      connected: true, balance: 5000, equity: 5000, profit: 0, margin: 0, margin_free: 5000, margin_level: 0, currency: 'USD', leverage: 100
    }));
  }
  if (req.url === '/connect') {
    return res.end(JSON.stringify({ login: mockGwSession.login, connected: true }));
  }
  res.end(JSON.stringify({ connected: true }));
});

async function runAudit() {
  await new Promise((r) => gwServer.listen(8138, r));
  console.log('--- STARTING DIAGNOSTIC AUDIT ---');

  const { resetMockDb, supabase } = await import('../integrations/supabase/client.js');
  const { registerUser, loginUser } = await import('../services/authService.js');
  const { connectMyAccount, listMyAccounts } = await import('../services/metatraderService.js');
  const { verifyAccessToken } = await import('../services/authService.js');

  resetMockDb();

  // Step 0: Register User
  console.log('\n[STEP 0] Registering user test user...');
  const reg = await registerUser({
    email: 'audituser@tarapti.com',
    password: 'Password123!',
    fullName: 'Audit User',
    username: 'audituser'
  });
  const userId = reg.user.id;
  let token1 = reg.accessToken;
  console.log('User registered. ID:', userId);

  // A. Connect MT5 → check database record
  console.log('\n--- TEST A: Connect MT5 & Check DB Record ---');
  const connectRes = await connectMyAccount(userId, {
    platform: 'MT5',
    login: '50066941',
    password: 'InvestorPass123',
    server: 'Axi-US50-Demo',
    broker: 'Axi'
  }, 'audituser@tarapti.com');

  console.log('Connect Result:', JSON.stringify(connectRes, null, 2));

  const { data: dbRecords } = await supabase
    .from('user_mt5_accounts')
    .select('*')
    .eq('user_id', userId);

  console.log('DB Records Count:', dbRecords ? dbRecords.length : 0);
  console.log('DB Record 0:', JSON.stringify(dbRecords ? dbRecords[0] : null, null, 2));

  // B. Langsung GET /api/metatrader/account → catat response
  console.log('\n--- TEST B: Immediately Call listMyAccounts ---');
  const getAccResB = await listMyAccounts(userId);
  console.log('GET Account Response B:', JSON.stringify(getAccResB, null, 2));

  // C. Reload halaman → GET endpoint lagi → bandingkan response
  console.log('\n--- TEST C: Simulate Page Reload (Same User Token) ---');
  const verifiedTokenC = verifyAccessToken(token1);
  const getAccResC = await listMyAccounts(verifiedTokenC.sub);
  console.log('GET Account Response C:', JSON.stringify(getAccResC, null, 2));
  console.log('B vs C equal:', JSON.stringify(getAccResB) === JSON.stringify(getAccResC));

  // D. Pindah Home → Partner → GET endpoint → bandingkan response
  console.log('\n--- TEST D: Simulate Navigation Home -> Partner ---');
  const getAccResD = await listMyAccounts(userId);
  console.log('GET Account Response D:', JSON.stringify(getAccResD, null, 2));
  console.log('B vs D equal:', JSON.stringify(getAccResB) === JSON.stringify(getAccResD));

  // E. Logout → login kembali → GET endpoint → pastikan account tetap ada
  console.log('\n--- TEST E: Logout -> Login Back -> Fetch Account ---');
  const loginRes = await loginUser({ email: 'audituser@tarapti.com', password: 'Password123!' });
  const newToken = loginRes.accessToken;
  const verifiedNewToken = verifyAccessToken(newToken);
  console.log('New Verified User ID after login:', verifiedNewToken.sub);

  const getAccResE = await listMyAccounts(verifiedNewToken.sub);
  console.log('GET Account Response E:', JSON.stringify(getAccResE, null, 2));
  console.log('Account exists in E:', getAccResE.accounts && getAccResE.accounts.length > 0);

  gwServer.close();
  console.log('\n--- AUDIT COMPLETE ---');
}

runAudit().catch(console.error);
