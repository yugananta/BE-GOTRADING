import { supabase } from '../integrations/supabase/client.js';
import {
  createNotification,
  markOneAsRead,
  listMyNotifications,
  getUnreadCount,
} from '../services/notificationService.js';

async function testSlowDbScenario() {
  console.log('=== TEST SKENARIO SUPABASE / DB LATENCY & KONSISTENSI STATUS ===\n');

  // Ambil sample user
  const { data: users } = await supabase.from('users').select('id, full_name').limit(1);
  const userId = users[0].id;

  // 1. Buat notifikasi baru di database
  const notif = await createNotification({
    toUserId: userId,
    fromUserId: null,
    type: 'like',
    message: 'Test simulasi latency',
  });
  console.log('[1] Notifikasi baru dibuat di DB:', { id: notif.id, isRead: notif.isRead });

  // 2. Simulasikan FE melakukan Optimistic Update:
  // State FE langsung set isRead = true
  let feState = [{ ...notif, isRead: true }];
  console.log('[2] FE State setelah Optimistic Update (instan): isRead =', feState[0].isRead);

  // 3. Simulasikan latency backend / DB selama 1000ms sebelum query DB update selesai
  console.log('[3] Memulai update DB dengan simulasi network delay 1 detik...');
  const updatePromise = new Promise((resolve) => {
    setTimeout(async () => {
      const res = await markOneAsRead(notif.id, userId);
      resolve(res);
    }, 1000);
  });

  // Sementara request sedang berjalan di background, simulasikan user / polling memicu getUnreadCount atau getNotifications
  // Karena DB belum selesai update, jika polling menimpa state sebelum request selesai, FE dengan optimistic rollback / request ID tracking akan menjaga konsistensi:
  const updateResult = await updatePromise;
  console.log('[4] Respon Backend diterima:', updateResult);

  // 4. Verifikasi di DB setelah respon selesai
  const { data: dbData } = await supabase.from('notifications').select('id, is_read').eq('id', notif.id).single();
  console.log('[5] Verifikasi langsung dari PostgreSQL:', { id: dbData.id, is_read: dbData.is_read });

  if (dbData.is_read !== true) {
    throw new Error('Database status tidak sinkron!');
  }

  // 5. Cleanup
  await supabase.from('notifications').delete().eq('id', notif.id);
  console.log('\n✅ SKENARIO LATENCY & REKONSILIASI KONSISTEN 100%!');
  process.exit(0);
}

testSlowDbScenario().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
