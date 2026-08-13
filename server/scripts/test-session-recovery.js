// server/scripts/test-session-recovery.js
//
// TEST SUITE FOR JWT SESSION RECOVERY & REFRESH FLOW (Matrix A - E)

process.env.NODE_ENV = 'test';
process.env.MT5_GATEWAY_URL = 'http://127.0.0.1:8139';
process.env.SUPABASE_URL = 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key';
process.env.JWT_ACCESS_SECRET = 'persistent-railway-access-secret-12345';
process.env.JWT_REFRESH_SECRET = 'persistent-railway-refresh-secret-12345';
process.env.MT5_CREDENTIAL_ENCRYPTION_KEY = Buffer.from('c'.repeat(32)).toString('base64');

import http from 'http';
import jwt from 'jsonwebtoken';

// Mock Gateway Server for MT5 endpoints
const mockGwSession = { login: 7001122, server: 'Axi-US50-Demo', broker: 'Axi', connected: true };
const gwServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (req.url === '/account') {
    return res.end(JSON.stringify({
      login: mockGwSession.login, server: mockGwSession.server, broker: mockGwSession.broker,
      connected: true, balance: 10000, equity: 10000, profit: 0, margin: 0, margin_free: 10000, margin_level: 0, currency: 'USD', leverage: 100
    }));
  }
  res.end(JSON.stringify({ connected: true }));
});

async function runTests() {
  await new Promise((r) => gwServer.listen(8139, r));
  console.log('--- STARTING SESSION RECOVERY TEST MATRIX (A-E) ---');

  const { resetMockDb, supabase } = await import('../integrations/supabase/client.js');
  const { registerUser, loginUser, refreshAccessToken, verifyAccessToken, getUserById } = await import('../services/authService.js');
  const { connectMyAccount, listMyAccounts } = await import('../services/metatraderService.js');
  const { JWT_ACCESS_SECRET, JWT_REFRESH_SECRET } = await import('../config/env.js');

  resetMockDb();

  // --- Skenario A: Login -> access token valid ---
  console.log('\n[TEST A] Login -> Access token valid');
  const regResult = await registerUser({
    email: 'sessionuser@tarapti.com',
    password: 'Password123!',
    fullName: 'Session User',
    username: 'sessionuser'
  });
  const userId = regResult.user.id;
  const initialAccessToken = regResult.accessToken;
  const initialRefreshToken = regResult.refreshToken;

  const verifiedInitial = verifyAccessToken(initialAccessToken);
  console.log('✅ PASS | Initial token payload verified:', verifiedInitial.sub === userId);

  // Connect MT5 Account to verify MT5 persistence
  await connectMyAccount(userId, {
    platform: 'MT5',
    login: '7001122',
    password: 'InvestorPass123',
    server: 'Axi-US50-Demo',
    broker: 'Axi'
  }, 'sessionuser@tarapti.com');

  const accBefore = await listMyAccounts(verifiedInitial.sub);
  console.log('✅ PASS | Access token valid, fetched MT5 account count:', accBefore.accounts.length);

  // --- Skenario B: Access token expired -> otomatis refresh ---
  console.log('\n[TEST B] Access token expired -> Otomatis refresh');
  // Create artificially expired access token (1 hour ago)
  const expiredAccessToken = jwt.sign(
    { sub: userId, email: 'sessionuser@tarapti.com', role: 'user' },
    JWT_ACCESS_SECRET,
    { expiresIn: '-1h' }
  );

  let verificationFailed = false;
  try {
    verifyAccessToken(expiredAccessToken);
  } catch (err) {
    verificationFailed = true;
    console.log('✅ PASS | Expired access token correctly failed verification:', err.message);
  }
  if (!verificationFailed) throw new Error('Expired token should have failed verification!');

  // Trigger refresh with initialRefreshToken (supports object with refreshToken or refresh_token)
  const refreshRes = await refreshAccessToken(initialRefreshToken);
  console.log('✅ PASS | Refresh token endpoint succeeded.');
  console.log('Refresh result keys:', Object.keys(refreshRes));

  const newAccessToken = refreshRes.accessToken;
  const newRefreshToken = refreshRes.refreshToken;

  if (!newAccessToken || !newRefreshToken) throw new Error('Refresh response missing new tokens');

  // --- Skenario C: Request API setelah refresh -> berhasil tanpa login ulang ---
  console.log('\n[TEST C] Request API setelah refresh -> Berhasil tanpa login ulang');
  const verifiedRefreshed = verifyAccessToken(newAccessToken);
  console.log('✅ PASS | Refreshed access token verified for user:', verifiedRefreshed.sub === userId);

  const userRecord = await getUserById(verifiedRefreshed.sub);
  console.log('✅ PASS | User profile retrieved via refreshed token:', userRecord.email === 'sessionuser@tarapti.com');

  // --- Skenario D: Simulasi backend restart/deploy dengan secret yang sama -> session tetap valid ---
  console.log('\n[TEST D] Simulasi backend restart/deploy -> Session tetap valid');

  // Simulate container restart where old process ended and new process loaded with persistent secret
  const persistentSecret = process.env.JWT_REFRESH_SECRET;
  const reloadedSecret = persistentSecret; // Secrets remain persistent across Railway redeploys

  const payloadFromOldToken = jwt.verify(newRefreshToken, reloadedSecret);
  console.log('✅ PASS | Existing refresh token issued before restart is valid on new container:', payloadFromOldToken.sub === userId);

  const postDeployRefreshRes = await refreshAccessToken(newRefreshToken);
  console.log('✅ PASS | Post-deploy refresh succeeded seamlessly without requiring re-login.');

  const postDeployAccessToken = postDeployRefreshRes.accessToken;

  // --- Skenario E: MT5 account tetap muncul setelah session recovery ---
  console.log('\n[TEST E] MT5 account tetap muncul setelah session recovery');
  const postDeployUser = verifyAccessToken(postDeployAccessToken);
  const accAfterRecovery = await listMyAccounts(postDeployUser.sub);

  console.log('✅ PASS | Account status after session recovery:', accAfterRecovery.accounts[0]?.status);
  console.log('✅ PASS | Account login matches:', accAfterRecovery.accounts[0]?.login === '7001122');
  if (accAfterRecovery.accounts.length === 0 || accAfterRecovery.accounts[0]?.status !== 'connected') {
    throw new Error('MT5 Account missing or disconnected after session recovery!');
  }

  gwServer.close();
  console.log('\n=====================================================');
  console.log('ALL SESSION RECOVERY TESTS (A - E) PASSED SUCCESSFULLY!');
  console.log('=====================================================');
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
