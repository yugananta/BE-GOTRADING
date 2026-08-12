// server/services/broadcastService.js
//
// AdminPortal.tsx: kirim satu notifikasi ke SEMUA user sekaligus (mis.
// pengumuman market pulse). Dilakukan sebagai bulk insert langsung ke
// tabel notifications, BUKAN loop createNotification() satu-satu, supaya
// tidak lambat kalau user sudah ribuan.

import { supabase } from '../integrations/supabase/client.js';

export async function sendBroadcast({ message, type = 'market_pulse' }) {
  if (!message || !message.trim()) {
    const err = new Error('Pesan broadcast tidak boleh kosong');
    err.status = 400;
    throw err;
  }

  const { data: users, error: usersError } = await supabase.from('users').select('id');
  if (usersError) throw usersError;

  const rows = (users || []).map((u) => ({ to_user_id: u.id, from_user_id: null, type, message }));
  if (rows.length === 0) return { sent: 0 };

  // Insert per-batch (Supabase/Postgres punya batas ukuran payload) supaya
  // aman untuk jumlah user besar.
  const BATCH_SIZE = 500;
  let sent = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('notifications').insert(batch);
    if (error) throw error;
    sent += batch.length;
  }

  return { sent };
}
