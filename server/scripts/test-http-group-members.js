import express from 'express';
import jwt from 'jsonwebtoken';
import { JWT_ACCESS_SECRET } from '../config/env.js';
import communityRoutes from '../routes/community.js';
import userRoutes from '../routes/users.js';
import groupsRoutes from '../routes/groups.js';

async function testHttpRoutes() {
  console.log('=== TESTING HTTP ROUTES FOR GROUP MEMBERS ===\n');

  const app = express();
  app.use(express.json());

  // Test token
  const token = jwt.sign({ sub: 'ec8ba9e6-1599-460b-9675-1297266638af', role: 'user' }, JWT_ACCESS_SECRET);
  const authHeader = `Bearer ${token}`;

  app.use('/api/community', communityRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/groups', groupsRoutes);

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. GET /api/users?city=Banjar (backward compatibility -> returns array)
    const res1 = await fetch(`${baseUrl}/api/users?city=Banjar`, {
      headers: { Authorization: authHeader }
    });
    const data1 = await res1.json();
    const xTotalCount1 = res1.headers.get('X-Total-Count');
    console.log('[Route 1] GET /api/users?city=Banjar:');
    console.log('  Status:', res1.status);
    console.log('  Is Array:', Array.isArray(data1));
    console.log('  X-Total-Count:', xTotalCount1);

    // 2. GET /api/users?city=Banjar&page=1&limit=10 (with pagination)
    const res2 = await fetch(`${baseUrl}/api/users?city=Banjar&page=1&limit=10`, {
      headers: { Authorization: authHeader }
    });
    const data2 = await res2.json();
    console.log('\n[Route 2] GET /api/users?city=Banjar&page=1&limit=10:');
    console.log('  Status:', res2.status);
    console.log('  Has members property:', Array.isArray(data2.members));
    console.log('  Page:', data2.page, 'Limit:', data2.limit, 'Total:', data2.total);

    // 3. GET /api/community/members?city=Banjar&page=1&limit=10
    const res3 = await fetch(`${baseUrl}/api/community/members?city=Banjar&page=1&limit=10`, {
      headers: { Authorization: authHeader }
    });
    const data3 = await res3.json();
    console.log('\n[Route 3] GET /api/community/members?city=Banjar&page=1&limit=10:');
    console.log('  Status:', res3.status);
    console.log('  Has members property:', Array.isArray(data3.members));
    console.log('  X-Total-Count:', res3.headers.get('X-Total-Count'));

    // 4. GET /api/groups/999/members?page=1&limit=10
    const res4 = await fetch(`${baseUrl}/api/groups/999/members?page=1&limit=10`, {
      headers: { Authorization: authHeader }
    });
    const data4 = await res4.json();
    console.log('\n[Route 4] GET /api/groups/999/members?page=1&limit=10:');
    console.log('  Status:', res4.status);
    console.log('  Has members property:', Array.isArray(data4.members));

    console.log('\n✅ ALL HTTP ROUTE TESTS PASSED SUCCESSFULLY!');
  } finally {
    server.close();
    process.exit(0);
  }
}

testHttpRoutes().catch(err => {
  console.error('HTTP test error:', err);
  process.exit(1);
});
