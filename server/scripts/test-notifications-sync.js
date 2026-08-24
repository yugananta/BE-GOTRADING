import express from 'express';
import jwt from 'jsonwebtoken';
import { JWT_ACCESS_SECRET } from '../config/env.js';
import notificationRoutes from '../routes/notifications.js';
import { supabase } from '../integrations/supabase/client.js';

async function testNotificationsSync() {
  console.log('=== TEST NOTIFICATIONS SYNC & SINGLE SOURCE OF TRUTH (POSTGRESQL) ===\n');

  // 1. Get sample user
  const { data: users } = await supabase.from('users').select('id, full_name, email').limit(1);
  const sampleUser = users?.[0] || { id: 'ec8ba9e6-1599-460b-9675-1297266638af', full_name: 'Test User' };
  const userId = sampleUser.id;
  console.log(`Using test user: ${sampleUser.full_name} (${userId})`);

  const app = express();
  app.use(express.json());
  const token = jwt.sign({ sub: userId, role: 'user' }, JWT_ACCESS_SECRET);
  const authHeader = `Bearer ${token}`;

  app.use('/api/notifications', notificationRoutes);

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/notifications`;

  try {
    // 1. Test Trigger / Create new notification
    console.log('\n[Step 1] Creating new notification via POST /api/notifications/test-trigger...');
    const createRes = await fetch(`${baseUrl}/test-trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ eventType: 'friend_request' }),
    });
    const createdNotif = await createRes.json();
    console.log('  Status:', createRes.status);
    console.log('  Created notification:', createdNotif);
    const notifId = createdNotif.id;

    if (!notifId) throw new Error('Notification ID was not returned');

    // Verify in DB directly
    const { data: dbCheck1 } = await supabase.from('notifications').select('*').eq('id', notifId).single();
    console.log('  Direct DB verify after create: is_read =', dbCheck1.is_read, ', id =', dbCheck1.id);
    if (dbCheck1.is_read !== false) throw new Error('DB is_read should be false');

    // 2. Fetch notifications list & unread count
    console.log('\n[Step 2] Fetching notifications list via GET /api/notifications...');
    const listRes = await fetch(`${baseUrl}`, {
      headers: { Authorization: authHeader },
    });
    const listResBody = await listRes.json();
    const listData = listResBody.data || listResBody;
    const xUnread = listRes.headers.get('X-Unread-Count');
    console.log('  Status:', listRes.status);
    console.log(`  Found ${listData.length} notifications, Header X-Unread-Count: ${xUnread}`);
    if (listResBody.meta) console.log('  Meta:', listResBody.meta);
    const targetInList = listData.find((n) => String(n.id) === String(notifId));
    console.log('  Target found in list:', !!targetInList, 'isRead:', targetInList?.isRead);

    // 3. Mark as read
    console.log(`\n[Step 3] Marking notification ${notifId} as read via PUT /api/notifications/${notifId}/read...`);
    const readRes = await fetch(`${baseUrl}/${notifId}/read`, {
      method: 'PUT',
      headers: { Authorization: authHeader },
    });
    const readData = await readRes.json();
    console.log('  Status:', readRes.status, 'Response:', readData);

    // Direct DB verify
    const { data: dbCheck2 } = await supabase.from('notifications').select('*').eq('id', notifId).single();
    console.log('  Direct DB verify after mark read: is_read =', dbCheck2.is_read);
    if (dbCheck2.is_read !== true) throw new Error('DB is_read should be true after update');

    // 4. Reload / Refetch simulation
    console.log('\n[Step 4] Simulating page reload / refetch via GET /api/notifications...');
    const refetchRes = await fetch(`${baseUrl}`, {
      headers: { Authorization: authHeader },
    });
    const refetchBody = await refetchRes.json();
    const refetchData = refetchBody.data || refetchBody;
    const targetAfterReload = refetchData.find((n) => String(n.id) === String(notifId));
    console.log('  Target notification after reload isRead:', targetAfterReload?.isRead);
    if (targetAfterReload?.isRead !== true) throw new Error('isRead should remain true after reload');

    // 5. Delete notification
    console.log(`\n[Step 5] Deleting notification ${notifId} via DELETE /api/notifications/${notifId}...`);
    const delRes = await fetch(`${baseUrl}/${notifId}`, {
      method: 'DELETE',
      headers: { Authorization: authHeader },
    });
    console.log('  Delete Status:', delRes.status);

    // Direct DB verify
    const { data: dbCheck3 } = await supabase.from('notifications').select('*').eq('id', notifId).maybeSingle();
    console.log('  Direct DB verify after delete: found =', !!dbCheck3);
    if (dbCheck3) throw new Error('Notification should be completely deleted from DB');

    console.log('\n✅ ALL NOTIFICATION DATABASE PERSISTENCE TESTS PASSED SUCCESSFULLY!');
  } finally {
    server.close();
    process.exit(0);
  }
}

testNotificationsSync().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
